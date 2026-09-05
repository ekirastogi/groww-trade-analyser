import { TradeDirection } from '../models/trading-journal.models';

export type FillSide = 'buy' | 'sell';

export interface AvgFill {
  id: string;
  side: FillSide;
  price: number;
  quantity: number;
}

/** A partial exit level: sell this many shares of the position at this price. */
export interface AvgTarget {
  id: string;
  price: number;
  quantity: number;
}

export interface AvgCalculatorSummary {
  buyQty: number;
  buyValue: number;
  avgBuy: number | null;
  sellQty: number;
  sellValue: number;
  avgSell: number | null;
  matchedQty: number;
  netQty: number;
  realizedPnL: number | null;
  remainingSide: FillSide | null;
  remainingQty: number;
  remainingAvg: number | null;
}

/** The open position a target is measured against: leftover lots, or the full buy leg when flat. */
export interface AvgPosition {
  side: FillSide;
  quantity: number;
  avgPrice: number;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createFill(side: FillSide, price: number, quantity: number): AvgFill {
  return { id: newId(), side, price, quantity };
}

export function createTarget(price: number, quantity: number): AvgTarget {
  return { id: newId(), price, quantity };
}

export function summarizeFills(fills: AvgFill[]): AvgCalculatorSummary {
  let buyQty = 0;
  let buyValue = 0;
  let sellQty = 0;
  let sellValue = 0;

  for (const fill of fills) {
    const value = fill.price * fill.quantity;
    if (fill.side === 'buy') {
      buyQty += fill.quantity;
      buyValue += value;
    } else {
      sellQty += fill.quantity;
      sellValue += value;
    }
  }

  const avgBuy = buyQty > 0 ? buyValue / buyQty : null;
  const avgSell = sellQty > 0 ? sellValue / sellQty : null;
  const matchedQty = Math.min(buyQty, sellQty);
  const realizedPnL =
    matchedQty > 0 && avgBuy != null && avgSell != null ? matchedQty * (avgSell - avgBuy) : null;
  const netQty = buyQty - sellQty;
  const remainingQty = Math.abs(netQty);
  const remainingSide: FillSide | null = netQty > 0 ? 'buy' : netQty < 0 ? 'sell' : null;
  const remainingAvg = remainingSide === 'buy' ? avgBuy : remainingSide === 'sell' ? avgSell : null;

  return {
    buyQty,
    buyValue,
    avgBuy,
    sellQty,
    sellValue,
    avgSell,
    matchedQty,
    netQty,
    realizedPnL,
    remainingSide,
    remainingQty,
    remainingAvg,
  };
}

export function openPosition(summary: AvgCalculatorSummary): AvgPosition | null {
  if (summary.remainingQty > 0 && summary.remainingAvg != null && summary.remainingSide) {
    return {
      side: summary.remainingSide,
      quantity: summary.remainingQty,
      avgPrice: summary.remainingAvg,
    };
  }
  if (summary.remainingQty === 0 && summary.buyQty > 0 && summary.avgBuy != null) {
    return { side: 'buy', quantity: summary.buyQty, avgPrice: summary.avgBuy };
  }
  return null;
}

/** Position direction in the terms the charges service and trade book use. */
export function positionDirection(position: AvgPosition): TradeDirection {
  return position.side === 'buy' ? 'long' : 'short';
}
