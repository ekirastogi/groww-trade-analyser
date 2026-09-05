import {
  ChargeBreakdown,
  ChargeExchange,
  ChargeLegInput,
  ChargeRates,
  ChargeSegment,
  ProfitTargetResult,
  RoundTripInput,
  RoundTripResult,
} from '../models/charges.models';
import { ChargeItem } from '../models/trade.models';

/**
 * Groww equity + F&O rate card (FY 2025-26). Percent values are percent of turnover,
 * so 0.1 means 0.1%. Override via ChargesService when the rate card changes.
 */
export const DEFAULT_CHARGE_RATES: ChargeRates = {
  gstPct: 18,
  sebiPct: 0.0001,
  segments: {
    delivery: {
      brokeragePct: 0.1,
      brokerageCap: 20,
      brokerageMin: 2,
      brokerageFlat: null,
      sttBuyPct: 0.1,
      sttSellPct: 0.1,
      stampDutyBuyPct: 0.015,
      exchangeTxnPct: { NSE: 0.00297, BSE: 0.00375 },
      ipftPct: { NSE: 0.0001, BSE: 0 },
      dpChargePerSell: 20,
    },
    intraday: {
      brokeragePct: 0.1,
      brokerageCap: 20,
      brokerageMin: 2,
      brokerageFlat: null,
      sttBuyPct: 0,
      sttSellPct: 0.025,
      stampDutyBuyPct: 0.003,
      exchangeTxnPct: { NSE: 0.00297, BSE: 0.00375 },
      ipftPct: { NSE: 0.0001, BSE: 0 },
      dpChargePerSell: 0,
    },
    futures: {
      brokeragePct: 0,
      brokerageCap: 0,
      brokerageMin: 0,
      brokerageFlat: 20,
      sttBuyPct: 0,
      sttSellPct: 0.02,
      stampDutyBuyPct: 0.002,
      exchangeTxnPct: { NSE: 0.00183, BSE: 0.00183 },
      ipftPct: { NSE: 0, BSE: 0 },
      dpChargePerSell: 0,
    },
    options: {
      brokeragePct: 0,
      brokerageCap: 0,
      brokerageMin: 0,
      brokerageFlat: 20,
      sttBuyPct: 0,
      sttSellPct: 0.1,
      stampDutyBuyPct: 0.003,
      exchangeTxnPct: { NSE: 0.03553, BSE: 0.03553 },
      ipftPct: { NSE: 0, BSE: 0 },
      dpChargePerSell: 0,
    },
  },
};

export const CHARGE_SEGMENT_LABELS: Record<ChargeSegment, string> = {
  delivery: 'Delivery',
  intraday: 'Intraday',
  futures: 'Futures',
  options: 'Options',
};

export const CHARGE_EXCHANGES: ChargeExchange[] = ['NSE', 'BSE'];

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
    gst: 0,
    total: 0,
  };
}

function pctOf(value: number, pct: number): number {
  return (value * pct) / 100;
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
  const cap = segment.brokerageCap > 0 ? segment.brokerageCap : Infinity;
  const brokerage =
    segment.brokerageFlat != null
      ? segment.brokerageFlat
      : Math.max(Math.min(pctOf(turnover, segment.brokeragePct), cap), segment.brokerageMin);

  const stt = pctOf(turnover, isBuy ? segment.sttBuyPct : segment.sttSellPct);
  const exchangeTxn = pctOf(turnover, segment.exchangeTxnPct[input.exchange] ?? 0);
  const ipft = pctOf(turnover, segment.ipftPct[input.exchange] ?? 0);
  const sebi = pctOf(turnover, rates.sebiPct);
  const stampDuty = isBuy ? pctOf(turnover, segment.stampDutyBuyPct) : 0;
  const dpCharges = isBuy ? 0 : segment.dpChargePerSell;
  const gst = pctOf(brokerage + exchangeTxn + ipft + sebi + dpCharges, rates.gstPct);

  return {
    turnover,
    brokerage,
    stt,
    exchangeTxn,
    sebi,
    ipft,
    stampDuty,
    dpCharges,
    gst,
    total: brokerage + stt + exchangeTxn + ipft + sebi + stampDuty + dpCharges + gst,
  };
}

function addBreakdowns(a: ChargeBreakdown, b: ChargeBreakdown): ChargeBreakdown {
  return {
    turnover: a.turnover + b.turnover,
    brokerage: a.brokerage + b.brokerage,
    stt: a.stt + b.stt,
    exchangeTxn: a.exchangeTxn + b.exchangeTxn,
    sebi: a.sebi + b.sebi,
    ipft: a.ipft + b.ipft,
    stampDuty: a.stampDuty + b.stampDuty,
    dpCharges: a.dpCharges + b.dpCharges,
    gst: a.gst + b.gst,
    total: a.total + b.total,
  };
}

export function calcRoundTrip(
  input: RoundTripInput,
  rates: ChargeRates = DEFAULT_CHARGE_RATES
): RoundTripResult {
  const long = input.direction === 'long';
  const base = { segment: input.segment, exchange: input.exchange, quantity: input.quantity };
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
  const combined = addBreakdowns(entryLeg, exitLeg);
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
    { label: 'GST', amount: breakdown.gst },
  ].filter((item) => item.amount > 0);
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
