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

export interface AvgTargetView {
  id: string;
  price: number;
  vsBuy: { delta: number; pct: number } | null;
  vsSell: { delta: number; pct: number } | null;
  remainingPnL: number | null;
}

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

export function evaluateTargets(targets: AvgTarget[], summary: AvgCalculatorSummary): AvgTargetView[] {
  return targets.map((target) => {
    let remainingPnL: number | null = null;
    if (summary.remainingQty > 0 && summary.remainingAvg != null && summary.remainingSide) {
      remainingPnL =
        summary.remainingSide === 'buy'
          ? (target.price - summary.remainingAvg) * summary.remainingQty
          : (summary.remainingAvg - target.price) * summary.remainingQty;
    } else if (summary.avgBuy != null && summary.buyQty > 0 && summary.remainingQty === 0) {
      remainingPnL = (target.price - summary.avgBuy) * summary.buyQty;
    }

    return {
      id: target.id,
      price: target.price,
      vsBuy: summary.avgBuy != null ? distance(summary.avgBuy, target.price) : null,
      vsSell: summary.avgSell != null ? distance(summary.avgSell, target.price) : null,
      remainingPnL,
    };
  });
}
