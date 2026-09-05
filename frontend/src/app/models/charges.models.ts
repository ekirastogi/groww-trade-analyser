import { TradeDirection, TradeSegment } from './trading-journal.models';

export type ChargeSegment = TradeSegment | 'futures' | 'options';
export type ChargeExchange = 'NSE' | 'BSE';
export type ChargeSide = 'buy' | 'sell';

export interface SegmentChargeRates {
  /** Percent of turnover per order; ignored when `brokerageFlat` is set. */
  brokeragePct: number;
  /** Rupee cap per order; 0 means uncapped. */
  brokerageCap: number;
  /** Rupee floor per order. */
  brokerageMin: number;
  /** Flat rupees per order (F&O style pricing). */
  brokerageFlat: number | null;
  sttBuyPct: number;
  sttSellPct: number;
  /** Stamp duty applies on the buy side only. */
  stampDutyBuyPct: number;
  exchangeTxnPct: Record<ChargeExchange, number>;
  ipftPct: Record<ChargeExchange, number>;
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
  exchange: ChargeExchange;
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
  exchange: ChargeExchange;
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
  /** Gross move needed per share to clear charges and the profit goal. */
  movePerShare: number;
}
