import { StockSummary, UnrealisedHolding, UnrealisedLot } from '../models/trade.models';
import { normalizeSymbol } from './upload-merge.utils';

export type PnLBook = 'realised' | 'holdings';

/** Buy-side identity for an open lot so mark-to-market rows can be purged across uploads. */
export function buyLotKey(isin: string, buyDate: string, quantity: number, buyPrice: number): string {
  return `${(isin || '').trim().toUpperCase()}|${buyDate}|${quantity}|${buyPrice.toFixed(4)}`;
}

export function parseHoldingsAsOf(label: string): string | null {
  const match = label.match(/as on\s+(\d{2})-(\d{2})-(\d{4})/i);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function isUnrealisedSectionLabel(label: string): boolean {
  const lower = label.trim().toLowerCase();
  return lower === 'unrealised trades' || lower.startsWith('unrealised (holdings');
}

export function isJunkScripRow(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    !lower ||
    lower === 'stock name' ||
    lower === 'total' ||
    lower === 'realised' ||
    lower === 'realised trades' ||
    lower === 'unrealised trades' ||
    isUnrealisedSectionLabel(name) ||
    lower.startsWith('disclaimer')
  );
}

export function aggregateLotsToHolding(lots: UnrealisedLot[], asOfDate: string): UnrealisedHolding {
  const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const buyValue = lots.reduce((sum, lot) => sum + lot.buyValue, 0);
  const closingValue = lots.reduce((sum, lot) => sum + lot.closingValue, 0);
  const unrealisedPnL = lots.reduce((sum, lot) => sum + lot.unrealisedPnL, 0);
  const first = lots[0];
  return {
    stockName: first.stockName,
    isin: first.isin,
    symbol: normalizeSymbol(first.stockName),
    quantity,
    avgBuyPrice: quantity ? buyValue / quantity : 0,
    buyValue,
    closingPrice: quantity ? closingValue / quantity : first.closingPrice,
    closingValue,
    unrealisedPnL,
    unrealisedPnLPct: buyValue ? unrealisedPnL / buyValue : 0,
    asOfDate: asOfDate || first.closingDate,
    lots,
  };
}

export function mergeHoldingsWithLots(
  scripHoldings: UnrealisedHolding[],
  lots: UnrealisedLot[],
  asOfDate: string
): UnrealisedHolding[] {
  const lotsByKey = new Map<string, UnrealisedLot[]>();
  for (const lot of lots) {
    const key = lot.isin || lot.stockName;
    const list = lotsByKey.get(key) ?? [];
    list.push(lot);
    lotsByKey.set(key, list);
  }

  if (scripHoldings.length) {
    return scripHoldings
      .map((holding) => {
        const key = holding.isin || holding.stockName;
        return {
          ...holding,
          symbol: holding.symbol || normalizeSymbol(holding.stockName),
          asOfDate: holding.asOfDate || asOfDate,
          lots: lotsByKey.get(key) ?? holding.lots ?? [],
        };
      })
      .sort((a, b) => b.unrealisedPnL - a.unrealisedPnL);
  }

  return [...lotsByKey.values()]
    .map((group) => aggregateLotsToHolding(group, asOfDate))
    .sort((a, b) => b.unrealisedPnL - a.unrealisedPnL);
}

/** Shape open holdings like stock summaries so watchlists/heatmap can reuse realised P&L views. */
export function holdingToStockSummary(holding: UnrealisedHolding): StockSummary {
  return {
    stockName: holding.stockName,
    isin: holding.isin,
    symbol: holding.symbol || normalizeSymbol(holding.stockName),
    quantity: holding.quantity,
    avgBuyPrice: holding.avgBuyPrice,
    buyValue: holding.buyValue,
    avgSellPrice: holding.closingPrice,
    sellValue: holding.closingValue,
    realisedPnL: holding.unrealisedPnL,
    realisedPnLPct: holding.unrealisedPnLPct,
    tradeCount: holding.lots?.length || 1,
    allocatedCharges: 0,
    netPnL: holding.unrealisedPnL,
  };
}

export function holdingsToStockSummaries(holdings: UnrealisedHolding[]): StockSummary[] {
  return holdings.map(holdingToStockSummary);
}

export function holdingsTotals(holdings: UnrealisedHolding[]): {
  stockCount: number;
  quantity: number;
  buyValue: number;
  closingValue: number;
  unrealisedPnL: number;
  asOfDate: string;
} {
  const buyValue = holdings.reduce((sum, holding) => sum + holding.buyValue, 0);
  const unrealisedPnL = holdings.reduce((sum, holding) => sum + holding.unrealisedPnL, 0);
  return {
    stockCount: holdings.length,
    quantity: holdings.reduce((sum, holding) => sum + holding.quantity, 0),
    buyValue,
    closingValue: holdings.reduce((sum, holding) => sum + holding.closingValue, 0),
    unrealisedPnL,
    asOfDate: holdings[0]?.asOfDate ?? '',
  };
}
