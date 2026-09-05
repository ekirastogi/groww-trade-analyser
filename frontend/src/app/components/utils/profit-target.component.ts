import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TradeDirection } from '../../models/trading-journal.models';
import { ChargeExchange, ChargeSegment } from '../../models/charges.models';
import { ChargesService } from '../../services/charges.service';
import {
  CHARGE_EXCHANGES,
  CHARGE_SEGMENT_LABELS,
  roundToTick,
} from '../../utils/charges.utils';
import { formatCurrency, formatPctSigned, formatPrice, pnlClass } from '../../utils/format.utils';
import { readJson, writeJson } from '../../utils/local-store.utils';

const STORAGE_KEY = 'kairo-profit-target-v1';
const LADDER_PCTS = [0.5, 1, 2, 3, 5];

type ProfitUnit = 'inr' | 'pct';

interface PersistedState {
  segment: ChargeSegment;
  exchange: ChargeExchange;
  direction: TradeDirection;
  entryPrice: number;
  quantity: number;
  profitGoal: number;
  profitUnit: ProfitUnit;
}

const FALLBACK: PersistedState = {
  segment: 'delivery',
  exchange: 'NSE',
  direction: 'long',
  entryPrice: 0,
  quantity: 0,
  profitGoal: 0,
  profitUnit: 'inr',
};

@Component({
  selector: 'app-profit-target',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profit-target.component.html',
  styles: `
    .target-hero {
      @apply overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 text-white shadow-lg sm:p-5;
    }
    .hero-kpi {
      @apply rounded-xl border border-white/10 bg-white/5 px-3 py-2.5;
    }
    .hero-kpi-label {
      @apply text-[10px] font-semibold uppercase tracking-wider text-slate-400;
    }
    .hero-kpi-value {
      @apply mt-1 text-base font-bold tabular-nums sm:text-lg;
    }
    .field-label {
      @apply text-[10px] font-semibold uppercase tracking-wide text-slate-400;
    }
    .mini-toggle {
      @apply rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800;
    }
    .mini-toggle-active {
      @apply bg-slate-900 text-white hover:text-white;
    }
    .charge-line {
      @apply flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-sm first:border-t-0;
    }
    .ladder-row {
      @apply grid grid-cols-[3rem_1fr_1fr] items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm first:border-t-0;
    }
  `,
})
export class ProfitTargetComponent {
  private readonly charges = inject(ChargesService);
  private persisted = { ...FALLBACK, ...readJson<Partial<PersistedState>>(STORAGE_KEY, FALLBACK) };

  segment = signal<ChargeSegment>(this.persisted.segment);
  exchange = signal<ChargeExchange>(this.persisted.exchange);
  direction = signal<TradeDirection>(this.persisted.direction);
  entryPrice = signal<number>(this.persisted.entryPrice);
  quantity = signal<number>(this.persisted.quantity);
  profitGoal = signal<number>(this.persisted.profitGoal);
  profitUnit = signal<ProfitUnit>(this.persisted.profitUnit);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;
  readonly segmentLabels = CHARGE_SEGMENT_LABELS;
  readonly segments: ChargeSegment[] = ['delivery', 'intraday', 'futures', 'options'];
  readonly exchanges = CHARGE_EXCHANGES;
  readonly ladderPcts = LADDER_PCTS;

  constructor() {
    effect(() => writeJson(STORAGE_KEY, this.snapshot()));
  }

  private snapshot = computed<PersistedState>(() => ({
    segment: this.segment(),
    exchange: this.exchange(),
    direction: this.direction(),
    entryPrice: this.entryPrice(),
    quantity: this.quantity(),
    profitGoal: this.profitGoal(),
    profitUnit: this.profitUnit(),
  }));

  private trade = computed(() => ({
    segment: this.segment(),
    exchange: this.exchange(),
    direction: this.direction(),
    quantity: this.quantity(),
    entryPrice: this.entryPrice(),
  }));

  ready = computed(() => this.entryPrice() > 0 && this.quantity() > 0);

  capital = computed(() => this.entryPrice() * this.quantity());

  /** Profit goal in rupees, whichever unit the user typed it in. */
  goalAmount = computed(() =>
    this.profitUnit() === 'pct' ? (this.capital() * this.profitGoal()) / 100 : this.profitGoal()
  );

  result = computed(() => {
    if (!this.ready() || this.goalAmount() <= 0) return null;
    return this.charges.profitTarget(this.trade(), this.goalAmount());
  });

  breakeven = computed(() => (this.ready() ? this.charges.breakevenPrice(this.trade()) : null));

  /** Tradable price, nudged away from entry so the goal still clears after ticking. */
  tradablePrice = computed(() => {
    const solved = this.result();
    if (!solved) return null;
    return roundToTick(solved.targetPrice, this.direction() === 'long' ? 'up' : 'down');
  });

  chargeLines = computed(() => {
    const solved = this.result();
    return solved ? this.charges.items(solved.roundTrip.combined) : [];
  });

  ladder = computed(() => {
    if (!this.ready()) return [];
    return LADDER_PCTS.map((pct) => {
      const goal = (this.capital() * pct) / 100;
      const solved = this.charges.profitTarget(this.trade(), goal);
      return {
        pct,
        goal,
        price: solved ? roundToTick(solved.targetPrice, this.direction() === 'long' ? 'up' : 'down') : null,
        movePct: solved ? solved.movePct : null,
      };
    });
  });

  setSegment(segment: ChargeSegment): void {
    this.segment.set(segment);
  }

  setExchange(exchange: ChargeExchange): void {
    this.exchange.set(exchange);
  }

  setDirection(direction: TradeDirection): void {
    this.direction.set(direction);
  }

  setNumber(target: 'entryPrice' | 'quantity' | 'profitGoal', value: unknown): void {
    const parsed = Number(value);
    this[target].set(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }

  setProfitUnit(unit: ProfitUnit): void {
    this.profitUnit.set(unit);
  }

  reset(): void {
    this.entryPrice.set(0);
    this.quantity.set(0);
    this.profitGoal.set(0);
  }
}
