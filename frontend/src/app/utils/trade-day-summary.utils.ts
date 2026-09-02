import { Trade } from '../models/trade.models';
import { formatDate } from './format.utils';
import { tradeDateKey } from './trade-date.utils';

export interface TradeDaySummary {
  date: string;
  label: string;
  tradeCount: number;
  quantity: number;
  buyValue: number;
  sellValue: number;
  realisedPnL: number;
  allocatedCharges: number;
  netPnL: number;
  trades: Trade[];
}

export function summariseTradesByDay(
  trades: Trade[],
  chargeForTrade: (trade: Trade) => number,
  netPnLForTrade: (trade: Trade) => number
): TradeDaySummary[] {
  const byDay = new Map<string, Trade[]>();
  for (const trade of trades) {
    const date = tradeDateKey(trade.sellDate) || 'unknown';
    const list = byDay.get(date) ?? [];
    list.push(trade);
    byDay.set(date, list);
  }

  return [...byDay.entries()]
    .map(([date, dayTrades]) => {
      let quantity = 0;
      let buyValue = 0;
      let sellValue = 0;
      let realisedPnL = 0;
      let allocatedCharges = 0;
      let netPnL = 0;
      for (const trade of dayTrades) {
        quantity += trade.quantity;
        buyValue += trade.buyValue;
        sellValue += trade.sellValue;
        realisedPnL += trade.realisedPnL;
        allocatedCharges += chargeForTrade(trade);
        netPnL += netPnLForTrade(trade);
      }
      return {
        date,
        label: date === 'unknown' ? 'Unknown date' : formatDate(date),
        tradeCount: dayTrades.length,
        quantity,
        buyValue,
        sellValue,
        realisedPnL,
        allocatedCharges,
        netPnL,
        trades: dayTrades,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
