export type FillSide = 'buy' | 'sell';

export interface AvgFill {
  id: string;
  side: FillSide;
  price: number;
  quantity: number;
}

export interface AvgTarget {
  id: string;
  price: number;
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

export interface AvgTargetView {
  id: string;
  price: number;
  /** Distance from the open position average, or from the buy average when flat. */
  fromAvg: { delta: number; pct: number } | null;
  grossPnL: number | null;
  charges: number | null;
  netPnL: number | null;
}

/** Charges for exiting `position` at `exitPrice`. */
export type AvgChargeFn = (position: AvgPosition, exitPrice: number) => number;

function newId(): string {
  return crypto.randomUUID();
}

export function createFill(side: FillSide, price: number, quantity: number): AvgFill {
  return { id: newId(), side, price, quantity };
}

export function createTarget(price: number): AvgTarget {
  return { id: newId(), price };
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

function distance(from: number, to: number): { delta: number; pct: number } {
  return { delta: to - from, pct: from ? ((to - from) / from) * 100 : 0 };
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

export function grossPnLAtTarget(position: AvgPosition, exitPrice: number): number {
  return position.side === 'buy'
    ? (exitPrice - position.avgPrice) * position.quantity
    : (position.avgPrice - exitPrice) * position.quantity;
}

export function evaluateTargets(
  targets: AvgTarget[],
  summary: AvgCalculatorSummary,
  chargeFn?: AvgChargeFn
): AvgTargetView[] {
  const position = openPosition(summary);
  const referenceAvg = position?.avgPrice ?? summary.avgBuy ?? summary.avgSell;

  return [...targets]
    .sort((a, b) => a.price - b.price)
    .map((target) => {
      const grossPnL = position ? grossPnLAtTarget(position, target.price) : null;
      const charges = position && chargeFn ? chargeFn(position, target.price) : null;

      return {
        id: target.id,
        price: target.price,
        fromAvg: referenceAvg != null ? distance(referenceAvg, target.price) : null,
        grossPnL,
        charges,
        netPnL: grossPnL == null ? null : grossPnL - (charges ?? 0),
      };
    });
}
