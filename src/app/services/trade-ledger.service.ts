import { Injectable, inject } from '@angular/core';
import {
  Firestore,
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
  ChargeItem,
  Report,
  StoredTrade,
  StockProfile,
  Trade,
  TradeType,
  UploadRecord,
} from '../models/trade.models';
import { AuthService } from './auth.service';
import { ClientAccountService } from './client-account.service';
import { ParserService } from './parser.service';
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
}

@Injectable({ providedIn: 'root' })
export class TradeLedgerService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private clientSvc = inject(ClientAccountService);
  private parser = inject(ParserService);

  async uploadReport(file: File): Promise<UploadResult> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to push data to Firebase');

    const buffer = await file.arrayBuffer();
    const contentHash = await computeFileContentHash(buffer);
    const report = await this.parser.parseFile(file);

    const clientCode = report.summary.clientCode?.trim() || 'UNKNOWN';
    const clientName = report.summary.clientName?.trim() || clientCode;

    const uploadsCol = this.clientSvc.clientCol(clientCode, 'uploads');
    const existingFile = await getDocs(
      query(uploadsCol, where('contentHash', '==', contentHash), limit(1))
    );
    if (!existingFile.empty) {
      return {
        uploadId: existingFile.docs[0].id,
        clientCode,
        clientName,
        newTradesAdded: 0,
        duplicatesSkipped: 0,
        fileDuplicate: true,
        affectedSymbols: [],
      };
    }

    const uploadId = crypto.randomUUID();
    const totalSellValue = report.trades.reduce((s, t) => s + t.sellValue, 0);
    const chargeRatio = computeChargeRatio(totalSellValue, report.charges.total);

    let newTradesAdded = 0;
    let duplicatesSkipped = 0;
    const affectedSymbols = new Set<string>();
    const batch = writeBatch(this.firestore);
    const now = Date.now();
    const tradesCol = this.clientSvc.clientCol(clientCode, 'trades');

    for (const trade of report.trades) {
      const dedupeKey = await computeTradeDedupeKey(trade, clientCode);
      const symbol = normalizeSymbol(trade.stockName);
      const enriched = enrichTradeWithCharges(trade, chargeRatio);
      const tradeRef = doc(tradesCol, dedupeKey);

      const existingTrade = await getDoc(tradeRef);
      if (existingTrade.exists()) {
        duplicatesSkipped++;
        continue;
      }

      const stored: StoredTrade = {
        ...trade,
        dedupeKey,
        uploadId,
        clientCode,
        clientName,
        symbol,
        allocatedCharges: enriched.allocatedCharges,
        netPnL: enriched.netPnL,
        createdAt: now,
      };
      batch.set(tradeRef, stored);
      newTradesAdded++;
      affectedSymbols.add(symbol);
    }

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
    batch.set(doc(uploadsCol, uploadId), uploadRecord);
    await batch.commit();

    await this.clientSvc.registerClient(clientCode, clientName, report.trades.length);

    for (const symbol of affectedSymbols) {
      await this.recomputeStockProfile(clientCode, clientName, symbol);
    }

    return {
      uploadId,
      clientCode,
      clientName,
      newTradesAdded,
      duplicatesSkipped,
      fileDuplicate: false,
      affectedSymbols: [...affectedSymbols],
    };
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

    const plainTrades: Trade[] = trades.map(({ stockName, isin, quantity, buyDate, buyPrice, buyValue, sellDate, sellPrice, sellValue, realisedPnL, remark, tradeType, holdingDays }) => ({
      stockName, isin, quantity, buyDate, buyPrice, buyValue, sellDate, sellPrice, sellValue, realisedPnL, remark, tradeType, holdingDays,
    }));

    const typeSet = new Set<TradeType>(['all']);
    plainTrades.forEach((t) => typeSet.add(t.tradeType));
    const dates = plainTrades.map((t) => t.sellDate).sort();

    return {
      summary: {
        clientName,
        clientCode,
        period: lastUpload?.periodLabel ?? 'All trades',
        realisedPnL: plainTrades.reduce((s, t) => s + t.realisedPnL, 0),
        unrealisedPnL: lastUpload?.reportUnrealisedPnL ?? 0,
      },
      charges: {
        items: lastUpload?.charges ?? [],
        total: lastUpload?.chargesTotal ?? 0,
      },
      trades: plainTrades,
      stockSummary: [],
      dateRange: { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' },
      tradeTypes: ['all', 'intraday', 'delivery', 'same_day', 'mtf', 'fno'].filter((t) => typeSet.has(t as TradeType)) as TradeType[],
    };
  }

  async getStockProfiles(clientCode: string): Promise<StockProfile[]> {
    const snap = await getDocs(
      query(this.clientSvc.clientCol(clientCode, 'stockProfiles'), orderBy('netPnL', 'desc'))
    );
    return snap.docs.map((d) => d.data() as StockProfile);
  }

  private async recomputeStockProfile(clientCode: string, clientName: string, symbol: string): Promise<void> {
    const snap = await getDocs(
      query(this.clientSvc.clientCol(clientCode, 'trades'), where('symbol', '==', symbol))
    );
    const trades = snap.docs.map((d) => d.data() as StoredTrade);
    if (!trades.length) return;

    let winningTrades = 0, losingTrades = 0, breakEvenTrades = 0;
    let totalBuyValue = 0, totalSellValue = 0, grossProfit = 0, grossLoss = 0;
    let realisedPnL = 0, allocatedCharges = 0, netPnL = 0, holdingDaysSum = 0;
    const uploadIds = new Set<string>();
    const byType = new Map<TradeType, StoredTrade[]>();
    let first = trades[0].sellDate, last = trades[0].sellDate;

    for (const t of trades) {
      totalBuyValue += t.buyValue;
      totalSellValue += t.sellValue;
      realisedPnL += t.realisedPnL;
      allocatedCharges += t.allocatedCharges;
      netPnL += t.netPnL;
      holdingDaysSum += t.holdingDays;
      uploadIds.add(t.uploadId);
      if (t.realisedPnL > 0) { winningTrades++; grossProfit += t.realisedPnL; }
      else if (t.realisedPnL < 0) { losingTrades++; grossLoss += t.realisedPnL; }
      else breakEvenTrades++;
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

    const profile: StockProfile = {
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

    await setDoc(doc(this.clientSvc.clientCol(clientCode, 'stockProfiles'), symbol), profile);
  }
}
