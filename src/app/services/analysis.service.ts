import { Injectable } from '@angular/core';
import {
  AnalysisOptions,
  AnalysisResult,
  PeriodBucket,
  Report,
  StockSummary,
  Trade,
  TradeType,
} from '../models/trade.models';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  analyze(report: Report, opts: AnalysisOptions = {}): AnalysisResult {
    const reportTotalSell = report.trades.reduce((s, t) => s + t.sellValue, 0);
    const chargeRatio = reportTotalSell > 0 && report.charges.total > 0
      ? report.charges.total / reportTotalSell
      : 0;

    const trades = this.filterTrades(report.trades, opts);

    return {
      summary: this.buildSummary(trades, chargeRatio),
      daily: this.aggregateByPeriod(trades, chargeRatio, 'daily'),
      weekly: this.aggregateByPeriod(trades, chargeRatio, 'weekly'),
      monthly: this.aggregateByPeriod(trades, chargeRatio, 'monthly'),
      stocks: this.aggregateByStock(trades, chargeRatio),
      charges: report.charges,
      filteredTrades: trades,
      filters: {
        startDate: opts.startDate ?? '',
        endDate: opts.endDate ?? '',
        tradeTypes: opts.tradeTypes ?? [],
      },
    };
  }

  private filterTrades(trades: Trade[], opts: AnalysisOptions): Trade[] {
    const typeFilter = this.buildTypeFilter(opts.tradeTypes);
    return trades.filter((t) => {
      if (opts.startDate && t.sellDate < opts.startDate) return false;
      if (opts.endDate && t.sellDate > opts.endDate) return false;
      if (typeFilter && !typeFilter.has(t.tradeType)) return false;
      return true;
    });
  }

  private buildTypeFilter(types?: TradeType[]): Set<TradeType> | null {
    if (!types?.length || types.includes('all')) return null;
    return new Set(types);
  }

  private buildSummary(trades: Trade[], chargeRatio: number) {
    let winningTrades = 0;
    let losingTrades = 0;
    let totalBuyValue = 0;
    let totalSellValue = 0;
    let realisedPnL = 0;

    for (const t of trades) {
      totalBuyValue += t.buyValue;
      totalSellValue += t.sellValue;
      realisedPnL += t.realisedPnL;
      if (t.realisedPnL > 0) winningTrades++;
      else if (t.realisedPnL < 0) losingTrades++;
    }

    const tradeCount = trades.length;
    const allocatedCharges = totalSellValue * chargeRatio;
    return {
      tradeCount,
      totalBuyValue,
      totalSellValue,
      realisedPnL,
      winningTrades,
      losingTrades,
      winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
      allocatedCharges,
      netPnL: realisedPnL - allocatedCharges,
      chargeRatio,
    };
  }

  private aggregateByPeriod(
    trades: Trade[],
    chargeRatio: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): PeriodBucket[] {
    const buckets = new Map<string, PeriodBucket>();

    for (const t of trades) {
      const { key, label } = this.periodKey(t.sellDate, period);
      let b = buckets.get(key);
      if (!b) {
        b = {
          period: key,
          label,
          tradeCount: 0,
          totalBuyValue: 0,
          totalSellValue: 0,
          realisedPnL: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          allocatedCharges: 0,
          netPnL: 0,
          trades: [],
        };
        buckets.set(key, b);
      }
      b.tradeCount++;
      b.totalBuyValue += t.buyValue;
      b.totalSellValue += t.sellValue;
      b.realisedPnL += t.realisedPnL;
      if (t.realisedPnL > 0) b.winningTrades++;
      else if (t.realisedPnL < 0) b.losingTrades++;
      b.trades.push(t);
    }

    return [...buckets.values()]
      .map((b) => {
        b.winRate = b.tradeCount ? (b.winningTrades / b.tradeCount) * 100 : 0;
        b.allocatedCharges = b.totalSellValue * chargeRatio;
        b.netPnL = b.realisedPnL - b.allocatedCharges;
        b.trades.sort((a, b2) => b2.realisedPnL - a.realisedPnL);
        if (period === 'weekly') {
          b.label = this.weeklyRangeLabel(b.trades);
        }
        return b;
      })
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private weeklyRangeLabel(trades: Trade[]): string {
    if (!trades.length) return '';
    const dates = trades.map((t) => t.sellDate).sort();
    return this.formatDateRange(dates[0], dates[dates.length - 1]);
  }

  private formatDateRange(from: string, to: string): string {
    const fmt = (iso: string, withYear: boolean) =>
      new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
      });

    if (from === to) return fmt(from, true);

    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
  }

  private periodKey(dateStr: string, period: string): { key: string; label: string } {
    const d = new Date(dateStr + 'T00:00:00');
    if (period === 'weekly') {
      const { year, week } = this.getISOWeek(d);
      return {
        key: `${year}-W${String(week).padStart(2, '0')}`,
        label: '',
      };
    }
    if (period === 'monthly') {
      const key = dateStr.slice(0, 7);
      return {
        key,
        label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      };
    }
    return {
      key: dateStr,
      label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    };
  }

  private getISOWeek(d: Date): { year: number; week: number } {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: date.getUTCFullYear(), week };
  }

  private aggregateByStock(trades: Trade[], chargeRatio: number): StockSummary[] {
    const map = new Map<string, StockSummary>();

    for (const t of trades) {
      const key = t.isin || t.stockName;
      let s = map.get(key);
      if (!s) {
        s = {
          stockName: t.stockName,
          isin: t.isin,
          quantity: 0,
          avgBuyPrice: 0,
          buyValue: 0,
          avgSellPrice: 0,
          sellValue: 0,
          realisedPnL: 0,
          realisedPnLPct: 0,
          tradeCount: 0,
          allocatedCharges: 0,
          netPnL: 0,
        };
        map.set(key, s);
      }
      s.tradeCount++;
      s.quantity += t.quantity;
      s.buyValue += t.buyValue;
      s.sellValue += t.sellValue;
      s.realisedPnL += t.realisedPnL;
    }

    return [...map.values()]
      .map((s) => {
        if (s.quantity > 0) {
          s.avgBuyPrice = s.buyValue / s.quantity;
          s.avgSellPrice = s.sellValue / s.quantity;
        }
        if (s.buyValue > 0) s.realisedPnLPct = s.realisedPnL / s.buyValue;
        s.allocatedCharges = s.sellValue * chargeRatio;
        s.netPnL = s.realisedPnL - s.allocatedCharges;
        return s;
      })
      .sort((a, b) => b.realisedPnL - a.realisedPnL);
  }
}
