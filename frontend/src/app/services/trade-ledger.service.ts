import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
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
import { WatchlistService } from './watchlist.service';
import { UniverseService } from './universe.service';
import {
  buildTradeTypeStats,
  computeChargeRatio,
  computeFileContentHash,
  computeTradeDedupeKey,
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

export interface ResetAllDataResult {
  clientsRemoved: number;
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

const FIRESTORE_BATCH_LIMIT = 400;

@Injectable({ providedIn: 'root' })
export class TradeLedgerService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private clientSvc = inject(ClientAccountService);
  private parser = inject(ParserService);
  private watchlists = inject(WatchlistService);
  private universe = inject(UniverseService);

  async uploadReport(file: File, options: UploadOptions = {}): Promise<UploadResult> {
    await this.auth.whenReady();
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to push data to Firebase');

    await this.ensureUserProfile();

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

    const uploadsCol = this.clientSvc.clientCol(clientCode, 'uploads');
    if (!options.forceReingest) {
      const existingFile = await getDocs(
        query(uploadsCol, where('contentHash', '==', contentHash), limit(1))
      );
      if (!existingFile.empty) {
        const syncedReport = await this.syncDerivedData(clientCode, clientName);
        return {
          uploadId: existingFile.docs[0].id,
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

    const tradesCol = this.clientSvc.clientCol(clientCode, 'trades');
    const now = Date.now();
    const existingKeys =
      options.forceReingest ? new Set<string>() : await this.loadExistingTradeKeys(tradesCol);

    let newTradesAdded = 0;
    let duplicatesSkipped = 0;
    const affectedSymbols = new Set<string>();
    const pendingWrites: Array<{ ref: DocumentReference; data: StoredTrade }> = [];

    for (const trade of report.trades) {
      const dedupeKey = await computeTradeDedupeKey(trade, clientCode);
      if (existingKeys.has(dedupeKey)) {
        duplicatesSkipped++;
        continue;
      }

      const symbol = normalizeSymbol(trade.stockName);
      const enriched = enrichTradeWithCharges(trade, chargeRatio);
      pendingWrites.push({
        ref: doc(tradesCol, dedupeKey),
        data: {
          ...trade,
          dedupeKey,
          uploadId,
          clientCode,
          clientName,
          symbol,
          allocatedCharges: enriched.allocatedCharges,
          netPnL: enriched.netPnL,
          createdAt: now,
        },
      });
      newTradesAdded++;
      affectedSymbols.add(symbol);
    }

    await this.commitInChunks(pendingWrites);

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
    await setDoc(doc(uploadsCol, uploadId), uploadRecord);

    const uploadedTrades = pendingWrites.map((entry) => entry.data);
    const syncedReport = await this.syncDerivedData(clientCode, clientName, {
      trades: options.forceReingest ? uploadedTrades : undefined,
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
    if (!this.auth.uid) throw new Error('Sign in to backfill universe');

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

    const symbolsSynced = await this.universe.syncSymbols([...symbolMap.values()], 'pnl_upload');

    return {
      clientsProcessed: clients.length,
      symbolsSynced,
      symbols: [...symbolMap.keys()].sort(),
      profilesRebuilt,
    };
  }

  async resetAllData(): Promise<ResetAllDataResult> {
    await this.auth.whenReady();
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to reset data');

    const clients = await this.clientSvc.listClients();
    for (const client of clients) {
      await this.deleteClientData(client.clientCode);
    }
    await this.watchlists.deleteAutoWatchlists();
    this.clientSvc.clearSelectedClient();

    return { clientsRemoved: clients.length };
  }

  async getAllTrades(clientCode: string): Promise<StoredTrade[]> {
    const snap = await getDocs(
      query(this.clientSvc.clientCol(clientCode, 'trades'), orderBy('sellDate', 'desc'))
    );
    return snap.docs.map((d) => d.data() as StoredTrade);
  }

  async buildReportFromClient(clientCode: string): Promise<Report | null> {
    const trades = await this.getAllTrades(clientCode);
    if (!trades.length) return null;

    const uid = this.auth.uid;
    if (!uid) return null;

    const clientSnap = await getDoc(doc(this.firestore, 'users', uid, 'clients', clientCode));
    const clientName = clientSnap.data()?.['clientName'] ?? clientCode;

    const uploadsSnap = await getDocs(
      query(this.clientSvc.clientCol(clientCode, 'uploads'), orderBy('uploadedAt', 'desc'), limit(1))
    );
    const lastUpload = uploadsSnap.docs[0]?.data() as UploadRecord | undefined;
    const stockProfiles = await this.getStockProfiles(clientCode);

    if (stockProfiles.length) {
      await this.universe.syncSymbols(
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
    const snap = await getDocs(
      query(this.clientSvc.clientCol(clientCode, 'stockProfiles'), orderBy('netPnL', 'desc'))
    );
    return snap.docs.map((d) => d.data() as StockProfile);
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

    const uploadMeta =
      options.uploadMeta ??
      ((
        await getDocs(
          query(this.clientSvc.clientCol(clientCode, 'uploads'), orderBy('uploadedAt', 'desc'), limit(1))
        )
      ).docs[0]?.data() as UploadRecord | undefined);

    await this.clientSvc.registerClient(clientCode, clientName, trades.length, {
      totalRealisedPnL: trades.reduce((sum, trade) => sum + trade.realisedPnL, 0),
      totalNetPnL: trades.reduce((sum, trade) => sum + trade.netPnL, 0),
      totalCharges: trades.reduce((sum, trade) => sum + trade.allocatedCharges, 0),
      periodLabel: uploadMeta?.periodLabel,
    });

    const profiles = this.buildStockProfilesFromTrades(trades, clientCode, clientName);
    await this.writeStockProfiles(clientCode, profiles);
    await this.watchlists.syncPnlTierWatchlists(profiles);
    await this.universe.syncSymbols(
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

  private async loadExistingTradeKeys(
    tradesCol: ReturnType<ClientAccountService['clientCol']>
  ): Promise<Set<string>> {
    const keys = new Set<string>();
    const snap = await getDocs(tradesCol);
    snap.forEach((docSnap) => keys.add(docSnap.id));
    return keys;
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
      realisedPnLPct: profile.netPnLPct,
      tradeCount: profile.tradeCount,
      allocatedCharges: profile.allocatedCharges,
      netPnL: profile.netPnL,
      winRate: profile.winRate,
    };
  }

  private async commitInChunks(
    writes: Array<{ ref: DocumentReference; data: StoredTrade }>
  ): Promise<void> {
    for (let i = 0; i < writes.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = writeBatch(this.firestore);
      const chunk = writes.slice(i, i + FIRESTORE_BATCH_LIMIT);
      chunk.forEach(({ ref, data }) => batch.set(ref, data));
      await batch.commit();
    }
  }

  private async writeStockProfiles(clientCode: string, profiles: StockProfile[]): Promise<void> {
    for (let i = 0; i < profiles.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = writeBatch(this.firestore);
      const chunk = profiles.slice(i, i + FIRESTORE_BATCH_LIMIT);
      chunk.forEach((profile) =>
        batch.set(doc(this.clientSvc.clientCol(clientCode, 'stockProfiles'), profile.symbol), profile)
      );
      await batch.commit();
    }
  }

  private async deleteClientData(clientCode: string): Promise<void> {
    await this.deleteCollection(this.clientSvc.clientCol(clientCode, 'trades'));
    await this.deleteCollection(this.clientSvc.clientCol(clientCode, 'uploads'));
    await this.deleteCollection(this.clientSvc.clientCol(clientCode, 'stockProfiles'));
    await deleteDoc(doc(this.firestore, 'users', this.auth.uid!, 'clients', clientCode));
  }

  private async deleteCollection(colRef: CollectionReference): Promise<void> {
    while (true) {
      const snap = await getDocs(query(colRef, limit(FIRESTORE_BATCH_LIMIT)));
      if (snap.empty) return;
      const batch = writeBatch(this.firestore);
      snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      if (snap.size < FIRESTORE_BATCH_LIMIT) return;
    }
  }

  private async ensureUserProfile(): Promise<void> {
    const uid = this.auth.uid;
    const user = this.auth.currentUser;
    if (!uid || !user) return;
    await setDoc(
      doc(this.firestore, 'users', uid),
      {
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  }
}
