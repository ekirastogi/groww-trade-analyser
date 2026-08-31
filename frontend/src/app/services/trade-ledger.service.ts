import { Injectable, inject } from '@angular/core';
import {
  Report,
  StockProfile,
  StockSummary,
  StoredTrade,
  Trade,
  TradeType,
  UploadRecord,
} from '../models/trade.models';
import { AuthService } from './auth.service';
import { ClientAccountService } from './client-account.service';
import { ParserService } from './parser.service';
import { RegistryStockService } from './registry-stock.service';
import { TradePlanService } from './trade-plan.service';
import { WatchlistService } from './watchlist.service';
import { objectToSnake, numField, rowToCamel, SupabaseService } from './supabase.service';
import {
  buildTradeTypeStats,
  computeChargeRatio,
  computeFileContentHash,
  computeTradeFingerprint,
  enrichTradeWithCharges,
  normalizeSymbol,
} from '../utils/upload-merge.utils';

export interface UploadResult {
  uploadId: string;
  clientCode: string;
  clientName: string;
  newTradesAdded: number;
  duplicatesSkipped: number;
  fileDuplicate: boolean;
  affectedSymbols: string[];
  report?: Report;
}

export interface UploadOptions {
  forceReingest?: boolean;
}

export interface ResetDataOptions {
  tradeData?: boolean;
  watchlists?: boolean;
  stockRegistry?: boolean;
  tradePlans?: boolean;
  stockLevels?: boolean;
}

export interface ResetDataResult {
  clientsRemoved: number;
  watchlistsRemoved: number;
  registryStocksRemoved: number;
  plannedTradesRemoved: number;
  levelsRemoved: number;
}

export interface BackfillUniverseOptions {
  rebuildProfiles?: boolean;
}

export interface BackfillUniverseResult {
  clientsProcessed: number;
  symbolsSynced: number;
  symbols: string[];
  profilesRebuilt: number;
}

const UPSERT_BATCH_LIMIT = 400;

function profileFromRow(row: Record<string, unknown>, clientCode: string, clientName: string): StockProfile {
  const camel = rowToCamel<Record<string, unknown>>(row);
  const buyValue = numField(camel, 'buyValue');
  const netPnL = numField(camel, 'netPnL', 'netPnl');
  return {
    symbol: String(camel['symbol'] ?? ''),
    stockName: String(camel['stockName'] ?? ''),
    isin: String(camel['isin'] ?? ''),
    clientCode,
    clientName,
    tradeCount: Number(camel['tradeCount'] ?? 0),
    winningTrades: Number(camel['winningTrades'] ?? 0),
    losingTrades: Number(camel['losingTrades'] ?? 0),
    breakEvenTrades: 0,
    winRate: Number(camel['winRate'] ?? 0),
    totalBuyValue: buyValue,
    totalSellValue: numField(camel, 'sellValue'),
    grossProfit: 0,
    grossLoss: 0,
    realisedPnL: numField(camel, 'realisedPnL', 'realisedPnl'),
    allocatedCharges: numField(camel, 'allocatedCharges'),
    netPnL,
    netPnLPct: buyValue ? (netPnL / buyValue) * 100 : 0,
    avgHoldingDays: 0,
    dateRange: { first: '', last: '' },
    byTradeType: {},
    uploadIds: [],
    updatedAt: Date.now(),
  };
}

function tradeFromRow(row: Record<string, unknown>): StoredTrade {
  const camel = rowToCamel<Record<string, unknown>>(row);
  return {
    dedupeKey: String(camel['dedupeKey'] ?? camel['id'] ?? ''),
    fingerprint: camel['fingerprint'] as string | undefined,
    uploadId: String(camel['uploadId'] ?? ''),
    clientCode: String(camel['clientCode'] ?? ''),
    clientName: String(camel['clientName'] ?? ''),
    symbol: String(camel['symbol'] ?? ''),
    stockName: String(camel['stockName'] ?? ''),
    isin: String(camel['isin'] ?? ''),
    quantity: Number(camel['quantity'] ?? 0),
    buyDate: String(camel['buyDate'] ?? ''),
    buyPrice: numField(camel, 'buyPrice'),
    buyValue: numField(camel, 'buyValue'),
    sellDate: String(camel['sellDate'] ?? ''),
    sellPrice: numField(camel, 'sellPrice'),
    sellValue: numField(camel, 'sellValue'),
    realisedPnL: numField(camel, 'realisedPnL', 'realisedPnl'),
    remark: String(camel['remark'] ?? ''),
    tradeType: (camel['tradeType'] as TradeType) ?? 'delivery',
    holdingDays: Number(camel['holdingDays'] ?? 0),
    allocatedCharges: numField(camel, 'allocatedCharges'),
    netPnL: numField(camel, 'netPnL', 'netPnl'),
    createdAt: Number(camel['createdAt'] ?? 0),
  };
}

function profileToRow(profile: StockProfile, userId: string): Record<string, unknown> {
  return objectToSnake({
    userId,
    clientCode: profile.clientCode,
    symbol: profile.symbol,
    stockName: profile.stockName,
    isin: profile.isin,
    quantity: profile.tradeCount,
    buyValue: profile.totalBuyValue,
    sellValue: profile.totalSellValue,
    realisedPnl: profile.realisedPnL,
    allocatedCharges: profile.allocatedCharges,
    netPnl: profile.netPnL,
    tradeCount: profile.tradeCount,
    winningTrades: profile.winningTrades,
    losingTrades: profile.losingTrades,
    winRate: profile.winRate,
  });
}

function tradeToRow(trade: StoredTrade, userId: string): Record<string, unknown> {
  return objectToSnake({
    id: trade.dedupeKey,
    userId,
    clientCode: trade.clientCode,
    dedupeKey: trade.dedupeKey,
    fingerprint: trade.fingerprint,
    uploadId: trade.uploadId,
    symbol: trade.symbol,
    stockName: trade.stockName,
    isin: trade.isin,
    quantity: trade.quantity,
    buyDate: trade.buyDate,
    buyPrice: trade.buyPrice,
    buyValue: trade.buyValue,
    sellDate: trade.sellDate,
    sellPrice: trade.sellPrice,
    sellValue: trade.sellValue,
    realisedPnl: trade.realisedPnL,
    remark: trade.remark,
    tradeType: trade.tradeType,
    holdingDays: trade.holdingDays,
    allocatedCharges: trade.allocatedCharges,
    netPnl: trade.netPnL,
    clientName: trade.clientName,
    createdAt: trade.createdAt,
  });
}

@Injectable({ providedIn: 'root' })
export class TradeLedgerService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private clientSvc = inject(ClientAccountService);
  private parser = inject(ParserService);
  private registry = inject(RegistryStockService);
  private tradePlans = inject(TradePlanService);
  private watchlists = inject(WatchlistService);

  async uploadReport(file: File, options: UploadOptions = {}): Promise<UploadResult> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to push data');

    const buffer = await file.arrayBuffer();
    const contentHash = await computeFileContentHash(buffer);
    const report = await this.parser.parseFile(file);

    if (!report.trades.length) {
      throw new Error('No trades found in this file. Check that it is a Groww P&L export.');
    }

    const clientCode = report.summary.clientCode?.trim() || 'UNKNOWN';
    const clientName = report.summary.clientName?.trim() || clientCode;

    if (options.forceReingest) {
      await this.deleteClientData(clientCode);
    }

    if (!options.forceReingest) {
      const { data: existingFile } = await this.supabase.client
        .from('uploads')
        .select('id')
        .eq('user_id', uid)
        .eq('client_code', clientCode)
        .eq('content_hash', contentHash)
        .limit(1)
        .maybeSingle();
      if (existingFile) {
        const syncedReport = await this.syncDerivedData(clientCode, clientName);
        return {
          uploadId: existingFile.id,
          clientCode,
          clientName,
          newTradesAdded: 0,
          duplicatesSkipped: 0,
          fileDuplicate: true,
          affectedSymbols: [],
          report: syncedReport ?? undefined,
        };
      }
    }

    const uploadId = crypto.randomUUID();
    const totalSellValue = report.trades.reduce((s, t) => s + t.sellValue, 0);
    const chargeRatio = computeChargeRatio(totalSellValue, report.charges.total);
    const now = Date.now();

    let newTradesAdded = 0;
    const duplicatesSkipped = 0;
    const affectedSymbols = new Set<string>();
    const pendingWrites: StoredTrade[] = [];

    for (let index = 0; index < report.trades.length; index++) {
      const trade = report.trades[index];
      const fingerprint = await computeTradeFingerprint(trade, clientCode);
      const dedupeKey = `${uploadId}_${String(index).padStart(6, '0')}`;
      const symbol = normalizeSymbol(trade.stockName);
      const enriched = enrichTradeWithCharges(trade, chargeRatio);
      pendingWrites.push({
        ...trade,
        dedupeKey,
        fingerprint,
        uploadId,
        clientCode,
        clientName,
        symbol,
        allocatedCharges: enriched.allocatedCharges,
        netPnL: enriched.netPnL,
        createdAt: now,
      });
      newTradesAdded++;
      affectedSymbols.add(symbol);
    }

    await this.commitTradesInChunks(pendingWrites, uid);

    const uploadRecord: Omit<UploadRecord, 'id'> = {
      fileName: file.name,
      contentHash,
      uploadedAt: now,
      clientCode,
      clientName,
      periodLabel: report.summary.period,
      periodStart: report.dateRange.min,
      periodEnd: report.dateRange.max,
      reportRealisedPnL: report.summary.realisedPnL,
      reportUnrealisedPnL: report.summary.unrealisedPnL,
      chargesTotal: report.charges.total,
      charges: report.charges.items,
      tradeCount: report.trades.length,
      newTradesAdded,
      duplicatesSkipped,
      status: 'completed',
    };
    const { error: uploadError } = await this.supabase.client.from('uploads').insert(
      objectToSnake({
        id: uploadId,
        userId: uid,
        ...uploadRecord,
      })
    );
    if (uploadError) throw uploadError;

    const syncedReport = await this.syncDerivedData(clientCode, clientName, {
      trades: pendingWrites,
      uploadMeta: uploadRecord,
    });

    return {
      uploadId,
      clientCode,
      clientName,
      newTradesAdded,
      duplicatesSkipped,
      fileDuplicate: false,
      affectedSymbols: [...affectedSymbols],
      report: syncedReport ?? undefined,
    };
  }

  async backfillUniverse(options: BackfillUniverseOptions = {}): Promise<BackfillUniverseResult> {
    await this.auth.whenReady();
    if (!(await this.auth.getDataUserId())) throw new Error('Sign in to backfill universe');

    const clients = await this.clientSvc.listClients();
    const symbolMap = new Map<string, { symbol: string; name?: string; isin?: string }>();
    let profilesRebuilt = 0;

    for (const client of clients) {
      let profiles = await this.getStockProfiles(client.clientCode);
      if (options.rebuildProfiles || !profiles.length) {
        const trades = await this.getAllTrades(client.clientCode);
        if (trades.length) {
          profiles = this.buildStockProfilesFromTrades(
            trades,
            client.clientCode,
            client.clientName
          );
          await this.writeStockProfiles(client.clientCode, profiles);
          profilesRebuilt++;
        }
      }

      for (const profile of profiles) {
        symbolMap.set(profile.symbol, {
          symbol: profile.symbol,
          name: profile.stockName,
          isin: profile.isin,
        });
      }
    }

    const symbolsSynced = await this.registry.syncSymbols([...symbolMap.values()], 'pnl_upload');

    return {
      clientsProcessed: clients.length,
      symbolsSynced,
      symbols: [...symbolMap.keys()].sort(),
      profilesRebuilt,
    };
  }

  async resetData(options: ResetDataOptions): Promise<ResetDataResult> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to reset data');

    const result: ResetDataResult = {
      clientsRemoved: 0,
      watchlistsRemoved: 0,
      registryStocksRemoved: 0,
      plannedTradesRemoved: 0,
      levelsRemoved: 0,
    };

    if (options.tradeData) {
      const clients = await this.clientSvc.listClients();
      for (const client of clients) {
        await this.deleteClientData(client.clientCode);
      }
      result.clientsRemoved = clients.length;
      this.clientSvc.clearSelectedClient();
    }

    if (options.watchlists) {
      result.watchlistsRemoved = await this.watchlists.deleteAllWatchlists();
    }

    if (options.stockRegistry) {
      result.registryStocksRemoved = await this.registry.deleteAll();
    }

    if (options.tradePlans) {
      result.plannedTradesRemoved = await this.tradePlans.deleteAll();
    }

    if (options.stockLevels) {
      result.levelsRemoved = await this.deleteUserLevels(uid);
    }

    return result;
  }

  private async deleteUserLevels(uid: string): Promise<number> {
    const { data, error: selectError } = await this.supabase.client
      .from('user_stock_levels')
      .select('symbol')
      .eq('user_id', uid);
    if (selectError) throw selectError;
    if (!data?.length) return 0;
    const { error } = await this.supabase.client.from('user_stock_levels').delete().eq('user_id', uid);
    if (error) throw error;
    return data.length;
  }

  async getAllTrades(clientCode: string): Promise<StoredTrade[]> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('trades')
      .select('*')
      .eq('user_id', uid)
      .eq('client_code', clientCode)
      .order('sell_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => tradeFromRow(row));
  }

  async buildReportFromClient(clientCode: string): Promise<Report | null> {
    const trades = await this.getAllTrades(clientCode);
    if (!trades.length) return null;

    const uid = await this.auth.getDataUserId();
    if (!uid) return null;

    const clients = await this.clientSvc.listClients();
    const client = clients.find((c) => c.clientCode === clientCode);
    const clientName = client?.clientName ?? clientCode;

    const { data: lastUploadRow } = await this.supabase.client
      .from('uploads')
      .select('*')
      .eq('user_id', uid)
      .eq('client_code', clientCode)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastUpload = lastUploadRow ? rowToCamel<UploadRecord>(lastUploadRow) : undefined;
    const stockProfiles = await this.getStockProfiles(clientCode);

    if (stockProfiles.length) {
      await this.registry.syncSymbols(
        stockProfiles.map((profile) => ({
          symbol: profile.symbol,
          name: profile.stockName,
          isin: profile.isin,
        })),
        'pnl_upload'
      );
    }

    return this.buildReportFromStoredData(
      trades,
      clientCode,
      clientName,
      lastUpload,
      stockProfiles
    );
  }

  async getStockProfiles(clientCode: string): Promise<StockProfile[]> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const clients = await this.clientSvc.listClients();
    const client = clients.find((c) => c.clientCode === clientCode);
    const clientName = client?.clientName ?? clientCode;
    const { data, error } = await this.supabase.client
      .from('stock_profiles')
      .select('*')
      .eq('user_id', uid)
      .eq('client_code', clientCode)
      .order('net_pnl', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => profileFromRow(row, clientCode, clientName));
  }

  private async syncDerivedData(
    clientCode: string,
    clientName: string,
    options: {
      trades?: StoredTrade[];
      uploadMeta?: Omit<UploadRecord, 'id'>;
    } = {}
  ): Promise<Report | null> {
    const trades = options.trades ?? (await this.getAllTrades(clientCode));
    if (!trades.length) return null;

    let uploadMeta = options.uploadMeta;
    if (!uploadMeta) {
      const uid = await this.auth.getDataUserId();
      if (uid) {
        const { data } = await this.supabase.client
          .from('uploads')
          .select('*')
          .eq('user_id', uid)
          .eq('client_code', clientCode)
          .order('uploaded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        uploadMeta = data ? rowToCamel<UploadRecord>(data) : undefined;
      }
    }

    await this.clientSvc.registerClient(clientCode, clientName, trades.length, {
      totalRealisedPnL: trades.reduce((sum, trade) => sum + trade.realisedPnL, 0),
      totalNetPnL: trades.reduce((sum, trade) => sum + trade.netPnL, 0),
      totalCharges: trades.reduce((sum, trade) => sum + trade.allocatedCharges, 0),
      periodLabel: uploadMeta?.periodLabel,
    });

    const profiles = this.buildStockProfilesFromTrades(trades, clientCode, clientName);
    await this.writeStockProfiles(clientCode, profiles);
    await this.watchlists.syncPnlTierWatchlists(profiles);
    await this.registry.syncSymbols(
      profiles.map((p) => ({ symbol: p.symbol, name: p.stockName, isin: p.isin })),
      'pnl_upload'
    );

    return this.buildReportFromStoredData(
      trades,
      clientCode,
      clientName,
      uploadMeta,
      profiles
    );
  }

  private buildReportFromStoredData(
    trades: StoredTrade[],
    clientCode: string,
    clientName: string,
    uploadMeta: UploadRecord | Omit<UploadRecord, 'id'> | undefined,
    stockProfiles: StockProfile[]
  ): Report {
    const stockSummary = stockProfiles.map((profile) => this.profileToStockSummary(profile));
    const plainTrades: Trade[] = trades.map(
      ({
        stockName,
        isin,
        quantity,
        buyDate,
        buyPrice,
        buyValue,
        sellDate,
        sellPrice,
        sellValue,
        realisedPnL,
        remark,
        tradeType,
        holdingDays,
        allocatedCharges,
        netPnL,
      }) => ({
        stockName,
        isin,
        quantity,
        buyDate,
        buyPrice,
        buyValue,
        sellDate,
        sellPrice,
        sellValue,
        realisedPnL,
        remark,
        tradeType,
        holdingDays,
        allocatedCharges,
        netPnL,
      })
    );

    const typeSet = new Set<TradeType>(['all']);
    plainTrades.forEach((t) => typeSet.add(t.tradeType));
    const dates = plainTrades.map((t) => t.sellDate).sort();
    const allocatedCharges = trades.reduce((sum, trade) => sum + trade.allocatedCharges, 0);
    const realisedPnL = plainTrades.reduce((sum, trade) => sum + trade.realisedPnL, 0);

    return {
      summary: {
        clientName,
        clientCode,
        period: uploadMeta?.periodLabel ?? 'All trades',
        realisedPnL,
        unrealisedPnL: uploadMeta?.reportUnrealisedPnL ?? 0,
      },
      charges: {
        items: uploadMeta?.charges ?? [],
        total: uploadMeta?.chargesTotal ?? allocatedCharges,
      },
      trades: plainTrades,
      stockSummary,
      dateRange: { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' },
      tradeTypes: ['all', 'intraday', 'delivery', 'same_day', 'mtf', 'fno'].filter((t) =>
        typeSet.has(t as TradeType)
      ) as TradeType[],
    };
  }

  private buildStockProfilesFromTrades(
    trades: StoredTrade[],
    clientCode: string,
    clientName: string
  ): StockProfile[] {
    const bySymbol = new Map<string, StoredTrade[]>();
    for (const trade of trades) {
      const list = bySymbol.get(trade.symbol) ?? [];
      list.push(trade);
      bySymbol.set(trade.symbol, list);
    }

    return [...bySymbol.entries()]
      .map(([symbol, symbolTrades]) =>
        this.buildStockProfile(symbol, symbolTrades, clientCode, clientName)
      )
      .sort((a, b) => b.netPnL - a.netPnL);
  }

  private buildStockProfile(
    symbol: string,
    trades: StoredTrade[],
    clientCode: string,
    clientName: string
  ): StockProfile {
    let winningTrades = 0,
      losingTrades = 0,
      breakEvenTrades = 0;
    let totalBuyValue = 0,
      totalSellValue = 0,
      grossProfit = 0,
      grossLoss = 0;
    let realisedPnL = 0,
      allocatedCharges = 0,
      netPnL = 0,
      holdingDaysSum = 0;
    const uploadIds = new Set<string>();
    const byType = new Map<TradeType, StoredTrade[]>();
    let first = trades[0].sellDate,
      last = trades[0].sellDate;

    for (const t of trades) {
      totalBuyValue += t.buyValue;
      totalSellValue += t.sellValue;
      realisedPnL += t.realisedPnL;
      allocatedCharges += t.allocatedCharges;
      netPnL += t.netPnL;
      holdingDaysSum += t.holdingDays;
      uploadIds.add(t.uploadId);
      if (t.realisedPnL > 0) {
        winningTrades++;
        grossProfit += t.realisedPnL;
      } else if (t.realisedPnL < 0) {
        losingTrades++;
        grossLoss += t.realisedPnL;
      } else breakEvenTrades++;
      if (t.sellDate < first) first = t.sellDate;
      if (t.sellDate > last) last = t.sellDate;
      const list = byType.get(t.tradeType) ?? [];
      list.push(t);
      byType.set(t.tradeType, list);
    }

    const tradeCount = trades.length;
    const byTradeType: StockProfile['byTradeType'] = {};
    for (const [type, typeTrades] of byType) {
      if (type !== 'all') byTradeType[type] = buildTradeTypeStats(typeTrades);
    }

    return {
      symbol,
      stockName: trades[0].stockName,
      isin: trades[0].isin,
      clientCode,
      clientName,
      tradeCount,
      winningTrades,
      losingTrades,
      breakEvenTrades,
      winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
      totalBuyValue,
      totalSellValue,
      grossProfit,
      grossLoss,
      realisedPnL,
      allocatedCharges,
      netPnL,
      netPnLPct: totalBuyValue ? (netPnL / totalBuyValue) * 100 : 0,
      avgHoldingDays: tradeCount ? holdingDaysSum / tradeCount : 0,
      dateRange: { first, last },
      byTradeType,
      uploadIds: [...uploadIds],
      updatedAt: Date.now(),
    };
  }

  private profileToStockSummary(profile: StockProfile): StockSummary {
    return {
      stockName: profile.stockName,
      isin: profile.isin,
      symbol: profile.symbol,
      quantity: profile.tradeCount,
      avgBuyPrice: profile.tradeCount ? profile.totalBuyValue / profile.tradeCount : 0,
      buyValue: profile.totalBuyValue,
      avgSellPrice: profile.tradeCount ? profile.totalSellValue / profile.tradeCount : 0,
      sellValue: profile.totalSellValue,
      realisedPnL: profile.realisedPnL,
      realisedPnLPct: profile.totalBuyValue ? profile.realisedPnL / profile.totalBuyValue : 0,
      tradeCount: profile.tradeCount,
      allocatedCharges: profile.allocatedCharges,
      netPnL: profile.netPnL,
      winRate: profile.winRate,
    };
  }

  private async commitTradesInChunks(trades: StoredTrade[], userId: string): Promise<void> {
    for (let i = 0; i < trades.length; i += UPSERT_BATCH_LIMIT) {
      const chunk = trades.slice(i, i + UPSERT_BATCH_LIMIT).map((t) => tradeToRow(t, userId));
      const { error } = await this.supabase.client.from('trades').upsert(chunk);
      if (error) throw error;
    }
  }

  private async writeStockProfiles(clientCode: string, profiles: StockProfile[]): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return;
    for (let i = 0; i < profiles.length; i += UPSERT_BATCH_LIMIT) {
      const chunk = profiles
        .slice(i, i + UPSERT_BATCH_LIMIT)
        .map((profile) => profileToRow(profile, uid));
      const { error } = await this.supabase.client.from('stock_profiles').upsert(chunk);
      if (error) throw error;
    }
  }

  private async deleteClientData(clientCode: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return;
    await this.deleteTableRows('trades', uid, clientCode);
    await this.deleteTableRows('uploads', uid, clientCode);
    await this.deleteTableRows('stock_profiles', uid, clientCode);
    await this.clientSvc.deleteClient(clientCode);
  }

  private async deleteTableRows(
    table: 'trades' | 'uploads' | 'stock_profiles',
    userId: string,
    clientCode: string
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from(table)
      .delete()
      .eq('user_id', userId)
      .eq('client_code', clientCode);
    if (error) throw error;
  }
}
