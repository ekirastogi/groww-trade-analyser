import {
  AnalysisOptions,
  DateRange,
  StockProfile,
  StockSummary,
  TradeType,
  TradeTypeStats,
} from '../models/trade.models';
import { expandTradeTypes } from './trade-type-filter.utils';

export function effectiveAnalysisDateRange(
  reportRange: DateRange | undefined,
  opts: AnalysisOptions
): { startDate: string; endDate: string } {
  return {
    startDate: opts.startDate || reportRange?.min || '',
    endDate: opts.endDate || reportRange?.max || '',
  };
}

export function isFullReportDateRange(
  reportRange: DateRange,
  opts: AnalysisOptions
): boolean {
  if (!reportRange.min || !reportRange.max) return true;
  const { startDate, endDate } = effectiveAnalysisDateRange(reportRange, opts);
  return startDate === reportRange.min && endDate === reportRange.max;
}

export function profilesHaveTypeBreakdown(profiles: StockProfile[]): boolean {
  return profiles.some((profile) => Object.keys(profile.byTradeType).length > 0);
}

function selectedTypes(opts: AnalysisOptions): TradeType[] | null {
  const types = opts.tradeTypes;
  if (!types?.length || types.includes('all')) return null;
  return expandTradeTypes(types) ?? types;
}

function emptyStats(): TradeTypeStats {
  return {
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalBuyValue: 0,
    totalSellValue: 0,
    realisedPnL: 0,
    allocatedCharges: 0,
    netPnL: 0,
  };
}

function mergeStats(a: TradeTypeStats, b: TradeTypeStats): TradeTypeStats {
  const tradeCount = a.tradeCount + b.tradeCount;
  const winningTrades = a.winningTrades + b.winningTrades;
  const losingTrades = a.losingTrades + b.losingTrades;
  return {
    tradeCount,
    winningTrades,
    losingTrades,
    winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
    totalBuyValue: a.totalBuyValue + b.totalBuyValue,
    totalSellValue: a.totalSellValue + b.totalSellValue,
    realisedPnL: a.realisedPnL + b.realisedPnL,
    allocatedCharges: a.allocatedCharges + b.allocatedCharges,
    netPnL: a.netPnL + b.netPnL,
  };
}

function statsForProfile(profile: StockProfile, types: TradeType[] | null): TradeTypeStats {
  if (!types) {
    return {
      tradeCount: profile.tradeCount,
      winningTrades: profile.winningTrades,
      losingTrades: profile.losingTrades,
      winRate: profile.winRate,
      totalBuyValue: profile.totalBuyValue,
      totalSellValue: profile.totalSellValue,
      realisedPnL: profile.realisedPnL,
      allocatedCharges: profile.allocatedCharges,
      netPnL: profile.netPnL,
    };
  }

  return types.reduce((acc, type) => {
    const stats = profile.byTradeType[type];
    return stats ? mergeStats(acc, stats) : acc;
  }, emptyStats());
}

export function profileToStockSummary(profile: StockProfile, types: TradeType[] | null = null): StockSummary {
  const stats = statsForProfile(profile, types);
  const tradeCount = stats.tradeCount;
  return {
    stockName: profile.stockName,
    isin: profile.isin,
    symbol: profile.symbol,
    quantity: tradeCount,
    avgBuyPrice: tradeCount ? stats.totalBuyValue / tradeCount : 0,
    buyValue: stats.totalBuyValue,
    avgSellPrice: tradeCount ? stats.totalSellValue / tradeCount : 0,
    sellValue: stats.totalSellValue,
    realisedPnL: stats.realisedPnL,
    realisedPnLPct: stats.totalBuyValue ? stats.realisedPnL / stats.totalBuyValue : 0,
    tradeCount,
    allocatedCharges: stats.allocatedCharges,
    netPnL: stats.netPnL,
    winRate: stats.winRate,
    winningTrades: stats.winningTrades,
    losingTrades: stats.losingTrades,
  };
}

export function filterProfilesToSummaries(
  profiles: StockProfile[],
  opts: AnalysisOptions
): StockSummary[] {
  const types = selectedTypes(opts);
  return profiles
    .map((profile) => profileToStockSummary(profile, types))
    .filter((summary) => summary.tradeCount > 0)
    .sort((a, b) => b.netPnL - a.netPnL);
}
