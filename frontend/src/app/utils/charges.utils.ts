import { TradeSegment } from '../models/trading-journal.models';
import {
  ChargeBreakdown,
  ChargeLegInput,
  ChargeRates,
  ChargeSegment,
  ChargeSide,
  LadderInput,
  LadderResult,
  LadderSliceResult,
  ProfitTargetResult,
  RoundTripInput,
  RoundTripResult,
  SegmentChargeRates,
} from '../models/charges.models';
import { ChargeItem, TradeType } from '../models/trade.models';

/**
 * Groww equity rate card on NSE (FY 2025-26). Percent values are percent of turnover,
 * so 0.1 means 0.1%. Override via ChargesService when the rate card changes.
 */
export const DEFAULT_CHARGE_RATES: ChargeRates = {
  gstPct: 18,
  sebiPct: 0.0001,
  brokerageMaxPct: 2.5,
  segments: {
    delivery: {
      brokeragePct: 0.1,
      brokerageCap: 20,
      brokerageMin: 5,
      sttBuyPct: 0.1,
      sttSellPct: 0.1,
      stampDutyBuyPct: 0.015,
      exchangeTxnPct: 0.00297,
      ipftPct: 0.0001,
      dpDepositoryPerSell: 3.5,
      dpBrokerPerSell: 16.5,
      dpBrokerWaiverBelowValue: 100,
      pledgePerBuy: 0,
      unpledgePerSell: 0,
      interestPctPerYear: 0,
    },
    mtf: {
      brokeragePct: 0.1,
      brokerageCap: 20,
      brokerageMin: 5,
      sttBuyPct: 0.1,
      sttSellPct: 0.1,
      stampDutyBuyPct: 0.015,
      exchangeTxnPct: 0.00297,
      ipftPct: 0.0001,
      dpDepositoryPerSell: 3.5,
      dpBrokerPerSell: 16.5,
      dpBrokerWaiverBelowValue: 100,
      pledgePerBuy: 20,
      unpledgePerSell: 20,
      interestPctPerYear: 14.95,
    },
    intraday: {
      brokeragePct: 0.1,
      brokerageCap: 20,
      brokerageMin: 5,
      sttBuyPct: 0,
      sttSellPct: 0.025,
      stampDutyBuyPct: 0.003,
      exchangeTxnPct: 0.00297,
      ipftPct: 0.0001,
      dpDepositoryPerSell: 0,
      dpBrokerPerSell: 0,
      dpBrokerWaiverBelowValue: 0,
      pledgePerBuy: 0,
      unpledgePerSell: 0,
      interestPctPerYear: 0,
    },
  },
};

export const CHARGE_SEGMENT_LABELS: Record<ChargeSegment, string> = {
  delivery: 'Delivery',
  intraday: 'Intraday',
  mtf: 'MTF',
};

export const CHARGE_SEGMENTS: ChargeSegment[] = ['delivery', 'intraday', 'mtf'];

/** Default share of an MTF position funded by the broker (4x leverage). */
export const DEFAULT_MTF_FUNDED_PCT = 75;

/** Equity price tick on Indian exchanges. */
export const PRICE_TICK = 0.05;

/** Snaps a solved price to a tradable tick, away from entry so the goal still clears. */
export function roundToTick(price: number, mode: 'up' | 'down', tick = PRICE_TICK): number {
  if (!Number.isFinite(price) || tick <= 0) return price;
  const ticks = price / tick;
  const snapped = mode === 'up' ? Math.ceil(ticks) : Math.floor(ticks);
  return Math.max(0, Number((snapped * tick).toFixed(2)));
}

function emptyBreakdown(): ChargeBreakdown {
  return {
    turnover: 0,
    brokerage: 0,
    stt: 0,
    exchangeTxn: 0,
    sebi: 0,
    ipft: 0,
    stampDuty: 0,
    dpCharges: 0,
    pledgeCharges: 0,
    interest: 0,
    gst: 0,
    total: 0,
  };
}

function pctOf(value: number, pct: number): number {
  return (value * pct) / 100;
}

/**
 * Groww bills ₹20 or 0.1% per executed order, whichever is lower, with a ₹5 floor —
 * except the floor itself is capped at 2.5% of turnover, so a ₹50 order pays ₹1.25
 * rather than ₹5. SEBI's 2.5% ceiling bounds the result either way.
 */
function calcBrokerage(
  turnover: number,
  segment: SegmentChargeRates,
  rates: ChargeRates
): number {
  const cap = segment.brokerageCap > 0 ? segment.brokerageCap : Infinity;
  const maxPct = rates.brokerageMaxPct > 0 ? rates.brokerageMaxPct : 100;
  const regulatoryCeiling = pctOf(turnover, maxPct);
  const slab = Math.min(pctOf(turnover, segment.brokeragePct), cap);
  const floor = Math.min(segment.brokerageMin, regulatoryCeiling);
  return Math.min(Math.max(slab, floor), regulatoryCeiling);
}

/**
 * DP fee on a delivery sell: the depository's cut always applies, while Groww waives
 * its own share on debit values under ₹100.
 */
function calcDpCharge(turnover: number, segment: SegmentChargeRates): number {
  const broker = turnover < segment.dpBrokerWaiverBelowValue ? 0 : segment.dpBrokerPerSell;
  return segment.dpDepositoryPerSell + broker;
}

/**
 * MTF funding interest: charged daily on the amount the broker funded, so it grows with
 * how long the position is held. Zero for delivery and intraday.
 */
function calcFundingInterest(
  entryValue: number,
  input: { segment: ChargeSegment; holdingDays?: number; fundedPct?: number },
  rates: ChargeRates
): number {
  const annualPct = rates.segments[input.segment]?.interestPctPerYear ?? 0;
  const days = Math.max(0, input.holdingDays ?? 0);
  if (annualPct <= 0 || days <= 0 || !(entryValue > 0)) return 0;
  const fundedPct = Math.min(100, Math.max(0, input.fundedPct ?? DEFAULT_MTF_FUNDED_PCT));
  const fundedAmount = pctOf(entryValue, fundedPct);
  return pctOf(fundedAmount, annualPct) * (days / 365);
}

export function calcLegCharges(
  input: ChargeLegInput,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): ChargeBreakdown {
  const segment = rates.segments[input.segment];
  const price = Number.isFinite(input.price) ? Math.max(0, input.price) : 0;
  const quantity = Number.isFinite(input.quantity) ? Math.max(0, input.quantity) : 0;
  const turnover = price * quantity;
  if (!turnover || !segment) return emptyBreakdown();

  const isBuy = input.side === 'buy';
  const brokerage = calcBrokerage(turnover, segment, rates);

  const stt = pctOf(turnover, isBuy ? segment.sttBuyPct : segment.sttSellPct);
  const exchangeTxn = pctOf(turnover, segment.exchangeTxnPct);
  const ipft = pctOf(turnover, segment.ipftPct);
  const sebi = pctOf(turnover, rates.sebiPct);
  const stampDuty = isBuy ? pctOf(turnover, segment.stampDutyBuyPct) : 0;
  const dpCharges = isBuy ? 0 : calcDpCharge(turnover, segment);
  const pledgeCharges = isBuy ? segment.pledgePerBuy : segment.unpledgePerSell;
  const gst = pctOf(
    brokerage + exchangeTxn + ipft + sebi + dpCharges + pledgeCharges,
    rates.gstPct
  );

  return {
    turnover,
    brokerage,
    stt,
    exchangeTxn,
    sebi,
    ipft,
    stampDuty,
    dpCharges,
    pledgeCharges,
    interest: 0,
    gst,
    total:
      brokerage +
      stt +
      exchangeTxn +
      ipft +
      sebi +
      stampDuty +
      dpCharges +
      pledgeCharges +
      gst,
  };
}

export function addBreakdowns(a: ChargeBreakdown, b: ChargeBreakdown): ChargeBreakdown {
  return {
    turnover: a.turnover + b.turnover,
    brokerage: a.brokerage + b.brokerage,
    stt: a.stt + b.stt,
    exchangeTxn: a.exchangeTxn + b.exchangeTxn,
    sebi: a.sebi + b.sebi,
    ipft: a.ipft + b.ipft,
    stampDuty: a.stampDuty + b.stampDuty,
    dpCharges: a.dpCharges + b.dpCharges,
    pledgeCharges: a.pledgeCharges + b.pledgeCharges,
    interest: a.interest + b.interest,
    gst: a.gst + b.gst,
    total: a.total + b.total,
  };
}

export function calcRoundTrip(
  input: RoundTripInput,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): RoundTripResult {
  const long = input.direction === 'long';
  const base = { segment: input.segment, quantity: input.quantity };
  const entryLeg = calcLegCharges(
    { ...base, side: long ? 'buy' : 'sell', price: input.entryPrice },
    rates
  );
  const exitLeg = calcLegCharges(
    { ...base, side: long ? 'sell' : 'buy', price: input.exitPrice },
    rates
  );

  const entryValue = entryLeg.turnover;
  const exitValue = exitLeg.turnover;
  const grossPnL = long ? exitValue - entryValue : entryValue - exitValue;
  const interest = calcFundingInterest(entryValue, input, rates);
  const legs = addBreakdowns(entryLeg, exitLeg);
  const combined: ChargeBreakdown = {
    ...legs,
    interest,
    total: legs.total + interest,
  };
  const netPnL = grossPnL - combined.total;

  return {
    entryLeg,
    exitLeg,
    combined,
    entryValue,
    exitValue,
    grossPnL,
    charges: combined.total,
    netPnL,
    netPnLPct: entryValue > 0 ? (netPnL / entryValue) * 100 : 0,
    chargesPctOfTurnover: combined.turnover > 0 ? (combined.total / combined.turnover) * 100 : 0,
  };
}

export function chargeItems(breakdown: ChargeBreakdown): ChargeItem[] {
  return [
    { label: 'Brokerage', amount: breakdown.brokerage },
    { label: 'STT', amount: breakdown.stt },
    { label: 'Exchange transaction charges', amount: breakdown.exchangeTxn },
    { label: 'SEBI turnover fees', amount: breakdown.sebi },
    { label: 'IPFT charges', amount: breakdown.ipft },
    { label: 'Stamp duty', amount: breakdown.stampDuty },
    { label: 'DP charges', amount: breakdown.dpCharges },
    { label: 'Pledge / unpledge', amount: breakdown.pledgeCharges },
    { label: 'MTF interest', amount: breakdown.interest },
    { label: 'GST', amount: breakdown.gst },
  ].filter((item) => item.amount > 0);
}

/**
 * Charges and P&L for a position exited in parts. The entry is treated as one order
 * (so its brokerage is charged once and shared pro rata), while each exit slice pays
 * its own brokerage, STT and DP charges — which is how a real scale-out is billed.
 */
export function calcLadder(
  input: LadderInput,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): LadderResult {
  const long = input.direction === 'long';
  const entryPrice = Math.max(0, input.entryPrice || 0);
  const usable = (slice: { quantity: number; price: number }) => slice.quantity > 0 && slice.price > 0;
  const allocatedQty = input.slices
    .filter(usable)
    .reduce((sum, slice) => sum + slice.quantity, 0);

  const entryLeg = calcLegCharges(
    { segment: input.segment, side: long ? 'buy' : 'sell', price: entryPrice, quantity: allocatedQty },
    rates
  );

  let combined = entryLeg;
  // Every input slice gets a result row, so callers can line results up with their own list.
  const slices: LadderSliceResult[] = input.slices.map((slice) => {
    if (!usable(slice)) {
      return {
        quantity: Math.max(0, slice.quantity || 0),
        price: Math.max(0, slice.price || 0),
        sharePct: 0,
        grossPnL: 0,
        charges: 0,
        netPnL: 0,
        movePct: 0,
      };
    }

    const exitLeg = calcLegCharges(
      { segment: input.segment, side: long ? 'sell' : 'buy', price: slice.price, quantity: slice.quantity },
      rates
    );
    combined = addBreakdowns(combined, exitLeg);

    const sharePct = allocatedQty > 0 ? (slice.quantity / allocatedQty) * 100 : 0;
    const grossPnL = long
      ? (slice.price - entryPrice) * slice.quantity
      : (entryPrice - slice.price) * slice.quantity;
    const charges = exitLeg.total + entryLeg.total * (sharePct / 100);

    return {
      quantity: slice.quantity,
      price: slice.price,
      sharePct,
      grossPnL,
      charges,
      netPnL: grossPnL - charges,
      movePct: entryPrice > 0 ? ((slice.price - entryPrice) / entryPrice) * 100 : 0,
    };
  });

  const grossPnL = slices.reduce((sum, slice) => sum + slice.grossPnL, 0);
  const charges = combined.total;
  const entryValue = entryPrice * allocatedQty;
  const exitValue = input.slices
    .filter(usable)
    .reduce((sum, slice) => sum + slice.price * slice.quantity, 0);

  return {
    slices,
    allocatedQty,
    unallocatedQty: (input.totalQuantity || 0) - allocatedQty,
    avgExitPrice: allocatedQty > 0 ? exitValue / allocatedQty : 0,
    entryValue,
    grossPnL,
    charges,
    netPnL: grossPnL - charges,
    netPnLPct: entryValue > 0 ? ((grossPnL - charges) / entryValue) * 100 : 0,
    combined,
  };
}

/** MTF positions are held in the delivery segment, so trade records store them as such. */
export function tradeSegmentForCharge(segment: ChargeSegment): TradeSegment {
  return segment === 'intraday' ? 'intraday' : 'delivery';
}

/**
 * Maps a statement trade type onto a rate-card segment. Returns null for rows the equity
 * card cannot price (F&O), so callers can fall back instead of billing them as equity.
 */
export function chargeSegmentForTradeType(tradeType: TradeType): ChargeSegment | null {
  switch (tradeType) {
    case 'intraday':
    case 'same_day':
      return 'intraday';
    case 'delivery':
      return 'delivery';
    case 'mtf':
      return 'mtf';
    default:
      return null;
  }
}

/** One realized buy→sell pair from a P&L statement. */
export interface RealizedTradeRow {
  /** Caller's identifier, echoed back on the result. */
  key: string;
  /** DP charges are levied per ISIN per day, so rows are grouped by it. */
  isin: string;
  tradeType: TradeType;
  quantity: number;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
}

function scaleBreakdown(b: ChargeBreakdown, factor: number): ChargeBreakdown {
  return {
    turnover: b.turnover * factor,
    brokerage: b.brokerage * factor,
    stt: b.stt * factor,
    exchangeTxn: b.exchangeTxn * factor,
    sebi: b.sebi * factor,
    ipft: b.ipft * factor,
    stampDuty: b.stampDuty * factor,
    dpCharges: b.dpCharges * factor,
    pledgeCharges: b.pledgeCharges * factor,
    interest: b.interest * factor,
    gst: b.gst * factor,
    total: b.total * factor,
  };
}

interface OrderGroup {
  segment: ChargeSegment;
  side: ChargeSide;
  quantity: number;
  value: number;
  members: { key: string; value: number }[];
}

/**
 * Charges for realized trades from a P&L statement, billed the way a broker actually
 * bills them rather than as a flat percentage of turnover.
 *
 * Statement rows are matched buy/sell legs, not orders, so rows sharing a scrip, date and
 * side are treated as one order. That matters because brokerage is capped at ₹20 per order
 * and the DP fee is a flat per-scrip-per-day charge: pricing each row separately would
 * multiply both. Each order's charges are then split across its rows pro rata by value.
 *
 * Rows whose trade type has no equity rate card (F&O) are omitted from the result.
 */
export function calcRealizedCharges(
  rows: RealizedTradeRow[],
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): Map<string, ChargeBreakdown> {
  const groups = new Map<string, OrderGroup>();

  const addLeg = (
    row: RealizedTradeRow,
    segment: ChargeSegment,
    side: ChargeSide,
    date: string,
    price: number
  ) => {
    const value = price * row.quantity;
    if (!(value > 0)) return;
    const id = `${side}|${segment}|${row.isin}|${date}`;
    const group = groups.get(id);
    if (group) {
      group.quantity += row.quantity;
      group.value += value;
      group.members.push({ key: row.key, value });
      return;
    }
    groups.set(id, {
      segment,
      side,
      quantity: row.quantity,
      value,
      members: [{ key: row.key, value }],
    });
  };

  for (const row of rows) {
    const segment = chargeSegmentForTradeType(row.tradeType);
    if (!segment || !(row.quantity > 0)) continue;
    addLeg(row, segment, 'buy', row.buyDate, row.buyPrice);
    addLeg(row, segment, 'sell', row.sellDate, row.sellPrice);
  }

  const totals = new Map<string, ChargeBreakdown>();
  for (const group of groups.values()) {
    // Charge the whole order once at its average price, then share it out by value.
    const legCharges = calcLegCharges(
      {
        segment: group.segment,
        side: group.side,
        price: group.value / group.quantity,
        quantity: group.quantity,
      },
      rates
    );

    for (const member of group.members) {
      const share = group.value > 0 ? member.value / group.value : 0;
      const existing = totals.get(member.key);
      const portion = scaleBreakdown(legCharges, share);
      totals.set(member.key, existing ? addBreakdowns(existing, portion) : portion);
    }
  }

  return totals;
}

/**
 * Exit price at which net P&L equals `targetNetProfit`. Solved by bisection because
 * brokerage is capped and floored, so charges are not linear in the exit price.
 * Returns null when the goal is unreachable at a non-negative price.
 */
export function solveExitPrice(
  input: Omit<RoundTripInput, 'exitPrice'>,
  targetNetProfit: number,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): number | null {
  if (!(input.quantity > 0) || !(input.entryPrice > 0)) return null;
  if (!Number.isFinite(targetNetProfit)) return null;

  const netAt = (exitPrice: number) => calcRoundTrip({ ...input, exitPrice }, rates).netPnL;
  // Monotonic and increasing in exit price for a long, decreasing for a short.
  const gap = (exitPrice: number) =>
    input.direction === 'long' ? netAt(exitPrice) - targetNetProfit : targetNetProfit - netAt(exitPrice);

  if (gap(0) >= 0) return null;

  let hi = input.entryPrice * 2;
  for (let i = 0; i < 60 && gap(hi) < 0; i++) hi *= 2;
  if (gap(hi) < 0) return null;

  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function solveBreakevenPrice(
  input: Omit<RoundTripInput, 'exitPrice'>,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): number | null {
  return solveExitPrice(input, 0, rates);
}

export function solveProfitTarget(
  input: Omit<RoundTripInput, 'exitPrice'>,
  targetNetProfit: number,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): ProfitTargetResult | null {
  const targetPrice = solveExitPrice(input, targetNetProfit, rates);
  if (targetPrice == null) return null;
  const breakevenPrice = solveBreakevenPrice(input, rates) ?? input.entryPrice;
  const roundTrip = calcRoundTrip({ ...input, exitPrice: targetPrice }, rates);

  return {
    targetPrice,
    breakevenPrice,
    roundTrip,
    movePct: ((targetPrice - input.entryPrice) / input.entryPrice) * 100,
    movePerShare: targetPrice - input.entryPrice,
  };
}
