import { Trade } from '../models/trade.models';

/**
 * Per-trade charge and net P&L, shared by every drilldown that lists individual trades.
 *
 * Trades hydrated from the Firebase fast path can arrive without `allocatedCharges`, so the
 * blended `chargeRatio` from the report summary is the fallback. Keeping this in one place
 * matters: the dashboard, stock detail and watchlists all render these into the same columns,
 * and they previously disagreed — watchlists fell back to zero and showed inflated net P&L.
 */
export function tradeAllocatedCharge(trade: Trade, chargeRatio: number): number {
  return trade.allocatedCharges ?? trade.sellValue * chargeRatio;
}

export function tradeNetPnL(trade: Trade, chargeRatio: number): number {
  return trade.netPnL ?? trade.realisedPnL - tradeAllocatedCharge(trade, chargeRatio);
}

/** The callback pair `summariseTradesByDay()` expects, bound to one charge ratio. */
export function tradeChargeFns(chargeRatio: number): {
  chargeForTrade: (trade: Trade) => number;
  netPnLForTrade: (trade: Trade) => number;
} {
  return {
    chargeForTrade: (trade) => tradeAllocatedCharge(trade, chargeRatio),
    netPnLForTrade: (trade) => tradeNetPnL(trade, chargeRatio),
  };
}
