import {
  AnalysisOptions,
  DateRange,
  StockProfile,
  StockSummary,
  TradeType,
  TradeTypeStats,
} from '../models/trade.models';
import { expandTradeTypes } from './trade-type-filter.utils';
import {
  applyKnownIsins,
  collectIsinsByName,
  mergeByStockIdentity,
  normalizeIsin,
  preferStockSymbol,
} from './stock-identity.utils';

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

export function mergeStockSummaries(stocks: StockSummary[]): StockSummary[] {
  const filled = applyKnownIsins(stocks, collectIsinsByName(stocks));
  return mergeByStockIdentity(filled, combineStockSummaries).sort((a, b) => b.netPnL - a.netPnL);
}

export function mergeStockProfiles(profiles: StockProfile[]): StockProfile[] {
  const filled = applyKnownIsins(profiles, collectIsinsByName(profiles));
  return mergeByStockIdentity(filled, combineStockProfiles).sort((a, b) => b.netPnL - a.netPnL);
}

export function filterProfilesToSummaries(
  profiles: StockProfile[],
  opts: AnalysisOptions
): StockSummary[] {
  const types = selectedTypes(opts);
  return mergeStockProfiles(profiles)
    .map((profile) => profileToStockSummary(profile, types))
    .filter((summary) => summary.tradeCount > 0)
    .sort((a, b) => b.netPnL - a.netPnL);
}

function combineStockSummaries(a: StockSummary, b: StockSummary): StockSummary {
  const tradeCount = a.tradeCount + b.tradeCount;
  const buyValue = a.buyValue + b.buyValue;
  const sellValue = a.sellValue + b.sellValue;
  const realisedPnL = a.realisedPnL + b.realisedPnL;
  const allocatedCharges = a.allocatedCharges + b.allocatedCharges;
  const winningTrades = (a.winningTrades ?? 0) + (b.winningTrades ?? 0);
  const losingTrades = (a.losingTrades ?? 0) + (b.losingTrades ?? 0);
  const quantity = a.quantity + b.quantity;
  return {
    ...a,
    stockName: a.tradeCount >= b.tradeCount ? a.stockName : b.stockName,
    isin: normalizeIsin(a.isin) || normalizeIsin(b.isin),
    symbol: preferStockSymbol(a.symbol, b.symbol),
    quantity,
    avgBuyPrice: quantity ? (a.buyValue + b.buyValue) / quantity : 0,
    buyValue,
    avgSellPrice: quantity ? sellValue / quantity : 0,
    sellValue,
    realisedPnL,
    realisedPnLPct: buyValue ? realisedPnL / buyValue : 0,
    tradeCount,
    allocatedCharges,
    netPnL: realisedPnL - allocatedCharges,
    winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
    winningTrades,
    losingTrades,
  };
}

function combineStockProfiles(a: StockProfile, b: StockProfile): StockProfile {
  const tradeCount = a.tradeCount + b.tradeCount;
  const winningTrades = a.winningTrades + b.winningTrades;
  const losingTrades = a.losingTrades + b.losingTrades;
  const totalBuyValue = a.totalBuyValue + b.totalBuyValue;
  const realisedPnL = a.realisedPnL + b.realisedPnL;
  const allocatedCharges = a.allocatedCharges + b.allocatedCharges;
  const netPnL = a.netPnL + b.netPnL;
  const byTradeType: StockProfile['byTradeType'] = { ...a.byTradeType };
  for (const [type, stats] of Object.entries(b.byTradeType)) {
    const key = type as TradeType;
    const current = byTradeType[key];
    byTradeType[key] = current && stats ? mergeStats(current, stats) : current ?? stats;
  }
  const holdingDaysSum = a.avgHoldingDays * a.tradeCount + b.avgHoldingDays * b.tradeCount;
  return {
    ...a,
    symbol: preferStockSymbol(a.symbol, b.symbol),
    stockName: a.tradeCount >= b.tradeCount ? a.stockName : b.stockName,
    isin: normalizeIsin(a.isin) || normalizeIsin(b.isin),
    tradeCount,
    winningTrades,
    losingTrades,
    breakEvenTrades: a.breakEvenTrades + b.breakEvenTrades,
    winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
    totalBuyValue,
    totalSellValue: a.totalSellValue + b.totalSellValue,
    grossProfit: a.grossProfit + b.grossProfit,
    grossLoss: a.grossLoss + b.grossLoss,
    realisedPnL,
    allocatedCharges,
    netPnL,
    netPnLPct: totalBuyValue ? (netPnL / totalBuyValue) * 100 : 0,
    avgHoldingDays: tradeCount ? holdingDaysSum / tradeCount : 0,
    dateRange: {
      first: earlierDate(a.dateRange.first, b.dateRange.first),
      last: laterDate(a.dateRange.last, b.dateRange.last),
    },
    byTradeType,
    uploadIds: [...new Set([...a.uploadIds, ...b.uploadIds])],
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

function earlierDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function laterDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
