import { Injectable, inject } from '@angular/core';
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
import { objectToSnake, numField, rowToCamel, SupabaseService } from './supabase.service';

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

type PlannedTradePayload = {
  source?: TradePlanSource;
  estimatedStopLossPnL?: number | null;
  executedQuantity?: number | null;
  executedBuyPrice?: number | null;
  executedSellPrice?: number | null;
  updatedAt?: number;
};

function rowToPlannedTrade(row: Record<string, unknown>): PlannedTrade {
  const camel = rowToCamel<Record<string, unknown>>(row);
  const payload = (camel['payload'] as PlannedTradePayload | undefined) ?? {};
  return {
    id: String(camel['id'] ?? ''),
    symbol: String(camel['symbol'] ?? ''),
    stockName: camel['stockName'] as string | undefined,
    tradeDate: String(camel['tradeDate'] ?? ''),
    segment: camel['segment'] as TradeSegment,
    direction: camel['direction'] as TradeDirection,
    quantity: Number(camel['quantity'] ?? 0),
    cmp: camel['cmp'] as number | undefined,
    entryPrice: Number(camel['entryPrice'] ?? 0),
    targetPrice: Number(camel['targetPrice'] ?? 0),
    stopLoss: camel['stopLoss'] as number | undefined,
    source: payload.source ?? 'manual',
    status: (camel['status'] as TradeExecutionStatus) ?? 'planned',
    estimatedPnL: numField(camel, 'estimatedPnL', 'estimatedPnl'),
    estimatedStopLossPnL: payload.estimatedStopLossPnL ?? undefined,
    realizedPnL: (camel['realizedPnL'] ?? camel['realizedPnl']) as number | undefined,
    executedQuantity: payload.executedQuantity ?? undefined,
    executedBuyPrice: payload.executedBuyPrice ?? undefined,
    executedSellPrice: payload.executedSellPrice ?? undefined,
    notes: camel['notes'] as string | undefined,
    createdAt: Number(camel['createdAt'] ?? 0),
    updatedAt: payload.updatedAt ?? Number(camel['createdAt'] ?? 0),
  };
}

@Injectable({ providedIn: 'root' })
export class TradePlanService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watchForDate(tradeDate: string): Observable<PlannedTrade[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable(
          `planned_trades-${tradeDate}`,
          () => this.fetchForDate(tradeDate),
          undefined,
          'planned_trades'
        );
      })
    );
  }

  private async fetchForDate(tradeDate: string): Promise<PlannedTrade[]> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('planned_trades')
      .select('*')
      .eq('user_id', uid)
      .eq('trade_date', tradeDate)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => rowToPlannedTrade(row));
  }

  watchInMonth(year: number, month: number): Observable<PlannedTrade[]> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable(
          `planned_trades-${year}-${month}`,
          () => this.fetchInRange(start, end),
          undefined,
          'planned_trades'
        );
      })
    );
  }

  private async fetchInRange(start: string, end: string): Promise<PlannedTrade[]> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('planned_trades')
      .select('*')
      .eq('user_id', uid)
      .gte('trade_date', start)
      .lte('trade_date', end)
      .order('trade_date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => rowToPlannedTrade(row));
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
    let estimatedStopLossPnL = 0;
    let realizedPnL = 0;
    let executedCount = 0;
    let skippedCount = 0;
    for (const t of trades) {
      estimatedPnL += t.estimatedPnL ?? 0;
      const slPnL = TradePlanService.stopLossPnL(t);
      if (slPnL != null) estimatedStopLossPnL += slPnL;
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
      estimatedStopLossPnL,
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

  static stopLossPnL(
    trade: Pick<PlannedTrade, 'segment' | 'direction' | 'quantity' | 'entryPrice' | 'stopLoss' | 'estimatedStopLossPnL'>
  ): number | null {
    if (trade.estimatedStopLossPnL != null) return trade.estimatedStopLossPnL;
    if (!trade.stopLoss) return null;
    return TradePlanService.estimatePnL(
      trade.segment,
      trade.direction,
      trade.quantity,
      trade.entryPrice,
      trade.stopLoss
    );
  }

  static stopLossPctVsEntry(
    entry: number,
    stopLoss: number | undefined,
    segment: TradeSegment,
    direction: TradeDirection
  ): number | null {
    if (!entry || !stopLoss) return null;
    return TradePlanService.exitPctVsEntry(entry, stopLoss, segment, direction);
  }

  static realizedPnLFromPrices(quantity: number, buyPrice: number, sellPrice: number): number {
    if (!quantity || !buyPrice || !sellPrice) return 0;
    return (sellPrice - buyPrice) * quantity;
  }

  static pctVsCmp(entry: number, cmp?: number): number | null {
    if (!cmp || !entry) return null;
    return ((entry - cmp) / cmp) * 100;
  }

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
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to add trades');

    const segment = input.segment;
    let direction = input.direction;
    if (segment === 'delivery') {
      direction = 'long';
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const estimatedPnL = TradePlanService.estimatePnL(
      segment,
      direction,
      input.quantity,
      input.entryPrice,
      input.targetPrice
    );
    const estimatedStopLossPnL = input.stopLoss
      ? TradePlanService.estimatePnL(
          segment,
          direction,
          input.quantity,
          input.entryPrice,
          input.stopLoss
        )
      : null;

    const row = objectToSnake({
      id,
      userId: uid,
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
      status: 'planned' as TradeExecutionStatus,
      estimatedPnl: estimatedPnL,
      realizedPnl: null,
      notes: input.notes ?? '',
      createdAt: now,
      payload: {
        source: input.source ?? 'manual',
        estimatedStopLossPnL,
        executedQuantity: null,
        executedBuyPrice: null,
        executedSellPrice: null,
        updatedAt: now,
      },
    });
    const { error } = await this.supabase.client.from('planned_trades').insert(row);
    if (error) throw error;
    return id;
  }

  async updateExecution(
    id: string,
    status: TradeExecutionStatus,
    execution?: TradeExecutionInput
  ): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to update trades');
    const existing = await this.getById(id);
    const payload: PlannedTradePayload = {
      source: existing?.source,
      estimatedStopLossPnL: existing?.estimatedStopLossPnL ?? null,
      updatedAt: Date.now(),
      executedQuantity: null,
      executedBuyPrice: null,
      executedSellPrice: null,
    };
    let realizedPnl: number | null = null;
    if (status === 'executed' && execution) {
      realizedPnl = TradePlanService.realizedPnLFromPrices(
        execution.quantity,
        execution.buyPrice,
        execution.sellPrice
      );
      payload.executedQuantity = execution.quantity;
      payload.executedBuyPrice = execution.buyPrice;
      payload.executedSellPrice = execution.sellPrice;
    }
    const { error } = await this.supabase.client
      .from('planned_trades')
      .update(
        objectToSnake({
          status,
          realizedPnl,
          executedAt: status === 'executed' ? Date.now() : null,
          payload,
        })
      )
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
  }

  async getById(id: string): Promise<PlannedTrade | null> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return null;
    const { data, error } = await this.supabase.client
      .from('planned_trades')
      .select('*')
      .eq('id', id)
      .eq('user_id', uid)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToPlannedTrade(data) : null;
  }

  async update(id: string, input: CreatePlannedTradeInput): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to update trades');
    const existing = await this.getById(id);

    const segment = input.segment;
    let direction = input.direction;
    if (segment === 'delivery') {
      direction = 'long';
    }

    const estimatedPnL = TradePlanService.estimatePnL(
      segment,
      direction,
      input.quantity,
      input.entryPrice,
      input.targetPrice
    );
    const estimatedStopLossPnL = input.stopLoss
      ? TradePlanService.estimatePnL(
          segment,
          direction,
          input.quantity,
          input.entryPrice,
          input.stopLoss
        )
      : null;

    const payload: PlannedTradePayload = {
      source: input.source ?? existing?.source ?? 'manual',
      estimatedStopLossPnL,
      executedQuantity: existing?.executedQuantity ?? null,
      executedBuyPrice: existing?.executedBuyPrice ?? null,
      executedSellPrice: existing?.executedSellPrice ?? null,
      updatedAt: Date.now(),
    };

    const { error } = await this.supabase.client
      .from('planned_trades')
      .update(
        objectToSnake({
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
          notes: input.notes ?? '',
          estimatedPnl: estimatedPnL,
          payload,
        })
      )
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to delete trades');
    const { error } = await this.supabase.client
      .from('planned_trades')
      .delete()
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
  }

  async deleteAll(): Promise<number> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;
    const { data, error: selectError } = await this.supabase.client
      .from('planned_trades')
      .select('id')
      .eq('user_id', uid);
    if (selectError) throw selectError;
    if (!data?.length) return 0;
    const { error } = await this.supabase.client.from('planned_trades').delete().eq('user_id', uid);
    if (error) throw error;
    return data.length;
  }
}
