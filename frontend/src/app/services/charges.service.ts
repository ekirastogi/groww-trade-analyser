import { Injectable, signal } from '@angular/core';
import {
  ChargeBreakdown,
  ChargeLegInput,
  ChargeRates,
  LadderInput,
  LadderResult,
  ProfitTargetResult,
  RoundTripInput,
  RoundTripResult,
} from '../models/charges.models';
import { ChargeItem } from '../models/trade.models';
import {
  DEFAULT_CHARGE_RATES,
  RealizedTradeRow,
  calcLadder,
  calcLegCharges,
  calcRealizedCharges,
  calcRoundTrip,
  chargeItems,
  solveBreakevenPrice,
  solveProfitTarget,
} from '../utils/charges.utils';
import { readJson, writeJson } from '../utils/local-store.utils';

// v3 splits the DP fee into depository/broker parts and adds the SEBI brokerage ceiling.
const RATES_STORAGE_KEY = 'kairo-charge-rates-v3';

/** Fills gaps from the default card so a partial or older saved override still works. */
function mergeWithDefaults(stored: ChargeRates): ChargeRates {
  return {
    ...DEFAULT_CHARGE_RATES,
    ...stored,
    segments: {
      delivery: { ...DEFAULT_CHARGE_RATES.segments.delivery, ...stored?.segments?.delivery },
      intraday: { ...DEFAULT_CHARGE_RATES.segments.intraday, ...stored?.segments?.intraday },
      mtf: { ...DEFAULT_CHARGE_RATES.segments.mtf, ...stored?.segments?.mtf },
    },
  };
}

/**
 * Single source of truth for forward-looking trading cost estimates (brokerage, STT,
 * exchange, SEBI, IPFT, stamp duty, DP, GST). Rates default to the Groww card and can be
 * overridden locally; every calculator in the app should go through this service.
 */
@Injectable({ providedIn: 'root' })
export class ChargesService {
  private ratesState = signal<ChargeRates>(
    mergeWithDefaults(readJson(RATES_STORAGE_KEY, DEFAULT_CHARGE_RATES))
  );

  readonly rates = this.ratesState.asReadonly();

  setRates(rates: ChargeRates): void {
    this.ratesState.set(rates);
    writeJson(RATES_STORAGE_KEY, rates);
  }

  resetRates(): void {
    this.ratesState.set(DEFAULT_CHARGE_RATES);
    writeJson(RATES_STORAGE_KEY, DEFAULT_CHARGE_RATES);
  }

  /** Charges for a single buy or sell leg. */
  legCharges(input: ChargeLegInput): ChargeBreakdown {
    return calcLegCharges(input, this.ratesState());
  }

  /** Entry + exit charges with gross and net P&L for a complete trade. */
  roundTrip(input: RoundTripInput): RoundTripResult {
    return calcRoundTrip(input, this.ratesState());
  }

  /** Charges and P&L for a position exited in parts at different prices. */
  ladder(input: LadderInput): LadderResult {
    return calcLadder(input, this.ratesState());
  }

  /** Exit price needed to keep the given net profit after all charges. */
  profitTarget(
    input: Omit<RoundTripInput, 'exitPrice'>,
    targetNetProfit: number
  ): ProfitTargetResult | null {
    return solveProfitTarget(input, targetNetProfit, this.ratesState());
  }

  /** Exit price where the trade nets zero after all charges. */
  breakevenPrice(input: Omit<RoundTripInput, 'exitPrice'>): number | null {
    return solveBreakevenPrice(input, this.ratesState());
  }

  /**
   * Charges for realized statement trades, grouped into executed orders. F&O rows get
   * a flat ₹20 + GST per order; remaining statement charges are applied by the caller.
   */
  realized(rows: RealizedTradeRow[]): Map<string, ChargeBreakdown> {
    return calcRealizedCharges(rows, this.ratesState());
  }

  /** Non-zero charge lines, ready for display. */
  items(breakdown: ChargeBreakdown): ChargeItem[] {
    return chargeItems(breakdown);
  }
}
