import { TradeDirection, TradeSegment } from './trading-journal.models';

/** MTF is priced like delivery, plus pledge fees and interest on the funded amount. */
export type ChargeSegment = TradeSegment | 'mtf';
export type ChargeSide = 'buy' | 'sell';

export interface SegmentChargeRates {
  /** Percent of turnover per order. */
  brokeragePct: number;
  /** Rupee cap per order; 0 means uncapped. */
  brokerageCap: number;
  /**
   * Rupee floor per order. Groww bills the lower of this floor and
   * `brokerageMinCapPct` of turnover, so tiny orders are not overcharged.
   */
  brokerageMin: number;
  sttBuyPct: number;
  sttSellPct: number;
  /** Stamp duty applies on the buy side only. */
  stampDutyBuyPct: number;
  exchangeTxnPct: number;
  ipftPct: number;
  /** Depository fee per scrip on a sell, before GST. Never waived. */
  dpDepositoryPerSell: number;
  /** Broker DP fee per scrip on a sell, before GST. Waived under `dpBrokerWaiverBelowValue`. */
  dpBrokerPerSell: number;
  /** Sell turnover below which the broker's share of the DP fee is waived. */
  dpBrokerWaiverBelowValue: number;
  /** Flat pledge fee per buy order, before GST. MTF only. */
  pledgePerBuy: number;
  /** Flat unpledge fee per sell order, before GST. MTF only. */
  unpledgePerSell: number;
  /** Annual interest on the funded amount. MTF only. */
  interestPctPerYear: number;
}

export interface ChargeRates {
  gstPct: number;
  sebiPct: number;
  /**
   * SEBI's ceiling on brokerage as a percent of turnover. Also bounds the rupee floor,
   * matching Groww's "lower of ₹5 or 2.5% of trade value" rule on very small orders.
   */
  brokerageMaxPct: number;
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
  /** Pledge and unpledge fees. MTF only. */
  pledgeCharges: number;
  /** MTF funding interest. Charged per position held, not per leg. */
  interest: number;
  gst: number;
  total: number;
}

export interface RoundTripInput {
  segment: ChargeSegment;
  direction: TradeDirection;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  /** Days the position is held. Drives MTF interest; ignored elsewhere. */
  holdingDays?: number;
  /** Percent of the position funded by the broker. Drives MTF interest. */
  fundedPct?: number;
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
