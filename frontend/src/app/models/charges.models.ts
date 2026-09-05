import { TradeDirection, TradeSegment } from './trading-journal.models';

export type ChargeSegment = TradeSegment;
export type ChargeSide = 'buy' | 'sell';

export interface SegmentChargeRates {
  /** Percent of turnover per order. */
  brokeragePct: number;
  /** Rupee cap per order; 0 means uncapped. */
  brokerageCap: number;
  /** Rupee floor per order. */
  brokerageMin: number;
  sttBuyPct: number;
  sttSellPct: number;
  /** Stamp duty applies on the buy side only. */
  stampDutyBuyPct: number;
  exchangeTxnPct: number;
  ipftPct: number;
  /** Depository + broker DP fee per scrip on a sell, before GST. */
  dpChargePerSell: number;
}

export interface ChargeRates {
  gstPct: number;
  sebiPct: number;
  segments: Record<ChargeSegment, SegmentChargeRates>;
}

export interface ChargeLegInput {
  segment: ChargeSegment;
  side: ChargeSide;
  price: number;
  quantity: number;
}

export interface ChargeBreakdown {
  turnover: number;
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebi: number;
  ipft: number;
  stampDuty: number;
  dpCharges: number;
  gst: number;
  total: number;
}

export interface RoundTripInput {
  segment: ChargeSegment;
  direction: TradeDirection;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
}

export interface RoundTripResult {
  entryLeg: ChargeBreakdown;
  exitLeg: ChargeBreakdown;
  combined: ChargeBreakdown;
  entryValue: number;
  exitValue: number;
  grossPnL: number;
  charges: number;
  netPnL: number;
  /** Net P&L as a percent of capital deployed at entry. */
  netPnLPct: number;
  /** Charges as a percent of round-trip turnover. */
  chargesPctOfTurnover: number;
}

export interface ProfitTargetResult {
  targetPrice: number;
  breakevenPrice: number;
  roundTrip: RoundTripResult;
  /** Percent move from entry to the target price. */
  movePct: number;
  /** Move needed per share to clear charges and the profit goal. */
  movePerShare: number;
}

/** One partial exit: sell (or buy back) this many shares at this price. */
export interface ExitSlice {
  quantity: number;
  price: number;
}

export interface LadderInput {
  segment: ChargeSegment;
  direction: TradeDirection;
  entryPrice: number;
  /** Full position size; anything not allocated to a slice is reported as unallocated. */
  totalQuantity: number;
  slices: ExitSlice[];
}

export interface LadderSliceResult {
  quantity: number;
  price: number;
  /** Share of the position this slice exits. */
  sharePct: number;
  grossPnL: number;
  /** Slice's exit charges plus its pro-rated share of the single entry order. */
  charges: number;
  netPnL: number;
  movePct: number;
}

export interface LadderResult {
  slices: LadderSliceResult[];
  allocatedQty: number;
  /** Position left over after every slice; negative means over-allocated. */
  unallocatedQty: number;
  avgExitPrice: number;
  entryValue: number;
  grossPnL: number;
  charges: number;
  netPnL: number;
  netPnLPct: number;
  /** Every charge line across the entry order and all exit slices. */
  combined: ChargeBreakdown;
}
