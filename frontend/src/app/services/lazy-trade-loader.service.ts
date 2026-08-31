import { Injectable, inject, signal } from '@angular/core';
import { AnalysisOptions, Report, StockSummary, StoredTrade, Trade, TradeType } from '../models/trade.models';
import { TradeLedgerService } from './trade-ledger.service';
import { normalizeSymbol } from '../utils/upload-merge.utils';
import { sortTradesBySellDateDesc, storedTradeToTrade } from '../utils/trade.utils';

@Injectable({ providedIn: 'root' })
export class LazyTradeLoaderService {
  private ledger = inject(TradeLedgerService);
  private lists = signal<Map<string, Trade[]>>(new Map());
  loadingKey = signal<string | null>(null);

  tradesForKey(key: string): Trade[] {
    return this.lists().get(key) ?? [];
  }

  isLoading(key: string): boolean {
    return this.loadingKey() === key;
  }

  stockKey(stock: StockSummary): string {
    return stock.isin || stock.stockName;
  }

  cacheKeyForStock(stock: StockSummary): string {
    return `stock:${this.stockKey(stock)}`;
  }

  async loadForStock(
    clientCode: string,
    stock: StockSummary,
    report: Report | null,
    filters: AnalysisOptions
  ): Promise<Trade[]> {
    const key = this.cacheKeyForStock(stock);
    const cached = this.lists().get(key);
    if (cached) return cached;

    if (report?.trades?.length) {
      const trades = this.filterTrades(report.trades, stock, filters);
      this.setCache(key, trades);
      return trades;
    }

    this.loadingKey.set(key);
    try {
      const symbol = stock.symbol || normalizeSymbol(stock.stockName);
      const rows = await this.ledger.getTradesForSymbol(clientCode, symbol, filters);
      const trades = sortTradesBySellDateDesc(rows.map(storedTradeToTrade));
      this.setCache(key, trades);
      return trades;
    } finally {
      this.loadingKey.set(null);
    }
  }

  async loadForPeriod(
    clientCode: string,
    periodKey: string,
    tab: 'daily' | 'weekly' | 'monthly',
    report: Report | null,
    filters: AnalysisOptions
  ): Promise<Trade[]> {
    const key = `period:${tab}:${periodKey}`;
    const cached = this.lists().get(key);
    if (cached) return cached;

    const range = periodDateRange(periodKey, tab);
    const mergedFilters: AnalysisOptions = {
      ...filters,
      startDate: range.start,
      endDate: range.end,
    };

    if (report?.trades?.length) {
      const trades = this.filterTradesByOptions(report.trades, mergedFilters);
      this.setCache(key, trades);
      return trades;
    }

    this.loadingKey.set(key);
    try {
      const rows = await this.ledger.getTradesForDateRange(clientCode, range.start, range.end, mergedFilters);
      const trades = sortTradesBySellDateDesc(rows.map(storedTradeToTrade));
      this.setCache(key, trades);
      return trades;
    } finally {
      this.loadingKey.set(null);
    }
  }

  clear(): void {
    this.lists.set(new Map());
    this.loadingKey.set(null);
  }

  private setCache(key: string, trades: Trade[]): void {
    this.lists.update((current) => {
      const next = new Map(current);
      next.set(key, trades);
      return next;
    });
  }

  private filterTrades(trades: Trade[], stock: StockSummary, filters: AnalysisOptions): Trade[] {
    const stockKey = this.stockKey(stock);
    return sortTradesBySellDateDesc(
      this.filterTradesByOptions(trades, filters).filter(
        (trade) => (trade.isin || trade.stockName) === stockKey
      )
    );
  }

  private filterTradesByOptions(trades: Trade[], filters: AnalysisOptions): Trade[] {
    const typeFilter = this.buildTypeFilter(filters.tradeTypes);
    return trades.filter((trade) => {
      if (filters.startDate && trade.sellDate < filters.startDate) return false;
      if (filters.endDate && trade.sellDate > filters.endDate) return false;
      if (typeFilter && !typeFilter.has(trade.tradeType)) return false;
      return true;
    });
  }

  private buildTypeFilter(types?: TradeType[]): Set<TradeType> | null {
    if (!types?.length || types.includes('all')) return null;
    return new Set(types);
  }
}

export function periodDateRange(
  periodKey: string,
  tab: 'daily' | 'weekly' | 'monthly'
): { start: string; end: string } {
  if (tab === 'daily') {
    return { start: periodKey, end: periodKey };
  }
  if (tab === 'monthly') {
    const [year, month] = periodKey.split('-').map(Number);
    const start = `${periodKey}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${periodKey}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }

  const match = periodKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return { start: periodKey, end: periodKey };
  const year = Number(match[1]);
  const week = Number(match[2]);
  const start = isoWeekStart(year, week);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: formatIsoDate(start), end: formatIsoDate(end) };
}

function isoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
