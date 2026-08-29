import { Trade } from '../models/trade.models';

export interface StockTradeGroup {
  key: string;
  stockName: string;
  isin: string;
  tradeCount: number;
  totalQuantity: number;
  totalBuyValue: number;
  totalSellValue: number;
  totalPnL: number;
  trades: Trade[];
}

export function groupTradesByStock(trades: Trade[]): StockTradeGroup[] {
  const map = new Map<string, StockTradeGroup>();

  for (const t of trades) {
    const key = t.isin || t.stockName;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        stockName: t.stockName,
        isin: t.isin,
        tradeCount: 0,
        totalQuantity: 0,
        totalBuyValue: 0,
        totalSellValue: 0,
        totalPnL: 0,
        trades: [],
      };
      map.set(key, group);
    }
    group.tradeCount++;
    group.totalQuantity += t.quantity;
    group.totalBuyValue += t.buyValue;
    group.totalSellValue += t.sellValue;
    group.totalPnL += t.realisedPnL;
    group.trades.push(t);
  }

  return [...map.values()].sort((a, b) => b.totalPnL - a.totalPnL);
}
