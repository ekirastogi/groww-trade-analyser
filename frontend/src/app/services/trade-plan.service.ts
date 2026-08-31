import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map, of, switchMap } from 'rxjs';
import {
  DayTradeSummary,
  PlannedTrade,
  TradeDirection,
  TradeExecutionInput,
  TradeExecutionStatus,
  TradePlanSource,
  TradeSegment,
} from '../models/trading-journal.models';
import { AuthService } from './auth.service';

export interface CreatePlannedTradeInput {
  symbol: string;
  stockName?: string;
  tradeDate: string;
  segment: TradeSegment;
  direction: TradeDirection;
  quantity: number;
  cmp?: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss?: number;
  source?: TradePlanSource;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class TradePlanService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  watchForDate(tradeDate: string): Observable<PlannedTrade[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const q = query(
          collection(this.firestore, 'users', user.uid, 'plannedTrades'),
          where('tradeDate', '==', tradeDate),
          orderBy('createdAt', 'asc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<PlannedTrade[]>;
      })
    );
  }

  watchInMonth(year: number, month: number): Observable<PlannedTrade[]> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const q = query(
          collection(this.firestore, 'users', user.uid, 'plannedTrades'),
          where('tradeDate', '>=', start),
          where('tradeDate', '<=', end),
          orderBy('tradeDate', 'asc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<PlannedTrade[]>;
      })
    );
  }

  daySummariesForMonth$(year: number, month: number): Observable<DayTradeSummary[]> {
    return this.watchInMonth(year, month).pipe(map((trades) => this.summarizeByDay(trades)));
  }

  summarizeByDay(trades: PlannedTrade[]): DayTradeSummary[] {
    const byDate = new Map<string, PlannedTrade[]>();
    for (const t of trades) {
      const list = byDate.get(t.tradeDate) ?? [];
      list.push(t);
      byDate.set(t.tradeDate, list);
    }
    return [...byDate.entries()]
      .map(([tradeDate, dayTrades]) => this.summarizeDay(tradeDate, dayTrades))
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }

  summarizeDay(tradeDate: string, trades: PlannedTrade[]): DayTradeSummary {
    let estimatedPnL = 0;
    let realizedPnL = 0;
    let executedCount = 0;
    let skippedCount = 0;
    for (const t of trades) {
      estimatedPnL += t.estimatedPnL ?? 0;
      if (t.status === 'executed') {
        executedCount++;
        realizedPnL += t.realizedPnL ?? 0;
      } else if (t.status === 'skipped') {
        skippedCount++;
      }
    }
    return {
      tradeDate,
      tradeCount: trades.length,
      estimatedPnL,
      realizedPnL,
      executedCount,
      skippedCount,
    };
  }

  static estimatePnL(
    segment: TradeSegment,
    direction: TradeDirection,
    quantity: number,
    entryPrice: number,
    targetPrice: number
  ): number {
    if (!quantity || !entryPrice || !targetPrice) return 0;
    const diff = targetPrice - entryPrice;
    if (segment === 'intraday' && direction === 'short') {
      return (entryPrice - targetPrice) * quantity;
    }
    return diff * quantity;
  }

  /** Realized P&L from actual buy and sell values. */
  static realizedPnLFromValues(buyValue: number, sellValue: number): number {
    return sellValue - buyValue;
  }

  /** Entry price as % above/below CMP. */
  static pctVsCmp(entry: number, cmp?: number): number | null {
    if (!cmp || !entry) return null;
    return ((entry - cmp) / cmp) * 100;
  }

  /** Planned exit move as % from entry (direction-aware). */
  static exitPctVsEntry(
    entry: number,
    exit: number,
    segment: TradeSegment,
    direction: TradeDirection
  ): number | null {
    if (!entry || !exit) return null;
    if (segment === 'intraday' && direction === 'short') {
      return ((entry - exit) / entry) * 100;
    }
    return ((exit - entry) / entry) * 100;
  }

  async create(input: CreatePlannedTradeInput): Promise<string> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to add trades');

    const segment = input.segment;
    let direction = input.direction;
    if (segment === 'delivery') {
      direction = 'long';
    }

    const now = Date.now();
    const estimatedPnL = TradePlanService.estimatePnL(
      segment,
      direction,
      input.quantity,
      input.entryPrice,
      input.targetPrice
    );

    const ref = await addDoc(collection(this.firestore, 'users', uid, 'plannedTrades'), {
      symbol: input.symbol.toUpperCase(),
      stockName: input.stockName ?? input.symbol.toUpperCase(),
      tradeDate: input.tradeDate,
      segment,
      direction,
      quantity: input.quantity,
      cmp: input.cmp ?? null,
      entryPrice: input.entryPrice,
      targetPrice: input.targetPrice,
      stopLoss: input.stopLoss ?? null,
      source: input.source ?? 'manual',
      status: 'planned' as TradeExecutionStatus,
      estimatedPnL,
      realizedPnL: null,
      executedQuantity: null,
      executedBuyValue: null,
      executedSellValue: null,
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  }

  async updateExecution(
    id: string,
    status: TradeExecutionStatus,
    execution?: TradeExecutionInput
  ): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to update trades');
    const patch: {
      status: TradeExecutionStatus;
      updatedAt: number;
      realizedPnL?: number | null;
      executedQuantity?: number | null;
      executedBuyValue?: number | null;
      executedSellValue?: number | null;
    } = {
      status,
      updatedAt: Date.now(),
    };
    if (status === 'executed' && execution) {
      patch.realizedPnL = TradePlanService.realizedPnLFromValues(
        execution.buyValue,
        execution.sellValue
      );
      patch.executedQuantity = execution.quantity;
      patch.executedBuyValue = execution.buyValue;
      patch.executedSellValue = execution.sellValue;
    } else {
      patch.realizedPnL = null;
      patch.executedQuantity = null;
      patch.executedBuyValue = null;
      patch.executedSellValue = null;
    }
    await updateDoc(doc(this.firestore, 'users', uid, 'plannedTrades', id), patch);
  }

  async remove(id: string): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to delete trades');
    await deleteDoc(doc(this.firestore, 'users', uid, 'plannedTrades', id));
  }

  async deleteAll(): Promise<number> {
    const uid = this.auth.uid;
    if (!uid) return 0;
    const snap = await getDocs(collection(this.firestore, 'users', uid, 'plannedTrades'));
    if (snap.empty) return 0;
    const batch = writeBatch(this.firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }
}
