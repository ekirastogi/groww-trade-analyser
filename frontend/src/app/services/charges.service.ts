import { Injectable, signal } from '@angular/core';
import {
  ChargeBreakdown,
  ChargeLegInput,
  ChargeRates,
  ProfitTargetResult,
  RoundTripInput,
  RoundTripResult,
} from '../models/charges.models';
import { ChargeItem } from '../models/trade.models';
import {
  DEFAULT_CHARGE_RATES,
  calcLegCharges,
  calcRoundTrip,
  chargeItems,
  solveBreakevenPrice,
  solveProfitTarget,
} from '../utils/charges.utils';
import { readJson, writeJson } from '../utils/local-store.utils';

const RATES_STORAGE_KEY = 'kairo-charge-rates-v1';

/**
 * Single source of truth for forward-looking trading cost estimates (brokerage, STT,
 * exchange, SEBI, IPFT, stamp duty, DP, GST). Rates default to the Groww card and can be
 * overridden locally; every calculator in the app should go through this service.
 */
@Injectable({ providedIn: 'root' })
export class ChargesService {
  private ratesState = signal<ChargeRates>(readJson(RATES_STORAGE_KEY, DEFAULT_CHARGE_RATES));

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

  /** Non-zero charge lines, ready for display. */
  items(breakdown: ChargeBreakdown): ChargeItem[] {
    return chargeItems(breakdown);
  }
}
