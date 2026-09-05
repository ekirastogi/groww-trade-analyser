import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TradeDirection } from '../../models/trading-journal.models';
import { ChargeBreakdown, ChargeSegment } from '../../models/charges.models';
import { ChargesService } from '../../services/charges.service';
import {
  CHARGE_SEGMENTS,
  CHARGE_SEGMENT_LABELS,
  DEFAULT_MTF_FUNDED_PCT,
} from '../../utils/charges.utils';
import { formatCurrency, formatPctSigned, formatPrice, pnlClass } from '../../utils/format.utils';
import { readJson, writeJson } from '../../utils/local-store.utils';

const STORAGE_KEY = 'kairo-charges-calculator-v1';

interface PersistedState {
  segment: ChargeSegment;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  holdingDays: number;
  fundedPct: number;
}

const FALLBACK: PersistedState = {
  segment: 'delivery',
  direction: 'long',
  entryPrice: 0,
  exitPrice: 0,
  quantity: 0,
  holdingDays: 1,
  fundedPct: DEFAULT_MTF_FUNDED_PCT,
};

const CHARGE_ROWS: { key: keyof ChargeBreakdown; label: string }[] = [
  { key: 'brokerage', label: 'Brokerage' },
  { key: 'stt', label: 'STT' },
  { key: 'exchangeTxn', label: 'Exchange transaction' },
  { key: 'sebi', label: 'SEBI turnover fees' },
  { key: 'ipft', label: 'IPFT' },
  { key: 'stampDuty', label: 'Stamp duty' },
  { key: 'dpCharges', label: 'DP charges' },
  { key: 'pledgeCharges', label: 'Pledge / unpledge' },
  { key: 'gst', label: 'GST' },
  { key: 'interest', label: 'MTF interest' },
];

@Component({
  selector: 'app-charges-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './charges-calculator.component.html',
  styles: `
    .charges-hero {
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
    .breakdown-row {
      @apply grid grid-cols-[1fr_repeat(3,minmax(4.5rem,1fr))] items-center gap-2 border-t border-slate-100 px-4 py-2 text-sm tabular-nums;
    }
    .breakdown-head {
      @apply grid grid-cols-[1fr_repeat(3,minmax(4.5rem,1fr))] items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500;
    }
  `,
})
export class ChargesCalculatorComponent {
  private readonly charges = inject(ChargesService);
  private persisted = { ...FALLBACK, ...readJson<Partial<PersistedState>>(STORAGE_KEY, FALLBACK) };

  segment = signal<ChargeSegment>(this.persisted.segment);
  direction = signal<TradeDirection>(this.persisted.direction);
  entryPrice = signal<number>(this.persisted.entryPrice);
  exitPrice = signal<number>(this.persisted.exitPrice);
  quantity = signal<number>(this.persisted.quantity);
  holdingDays = signal<number>(this.persisted.holdingDays);
  fundedPct = signal<number>(this.persisted.fundedPct);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;
  readonly segmentLabels = CHARGE_SEGMENT_LABELS;
  readonly segments = CHARGE_SEGMENTS;
  readonly chargeRows = CHARGE_ROWS;

  constructor() {
    effect(() => writeJson(STORAGE_KEY, this.snapshot()));
  }

  private snapshot = computed<PersistedState>(() => ({
    segment: this.segment(),
    direction: this.direction(),
    entryPrice: this.entryPrice(),
    exitPrice: this.exitPrice(),
    quantity: this.quantity(),
    holdingDays: this.holdingDays(),
    fundedPct: this.fundedPct(),
  }));

  isMtf = computed(() => this.segment() === 'mtf');

  ready = computed(() => this.entryPrice() > 0 && this.exitPrice() > 0 && this.quantity() > 0);

  /** Only MTF is funded, so holding days and funded share are ignored elsewhere. */
  private fundingInput = computed(() =>
    this.isMtf() ? { holdingDays: this.holdingDays(), fundedPct: this.fundedPct() } : {}
  );

  fundedAmount = computed(() =>
    this.isMtf() ? (this.entryPrice() * this.quantity() * this.fundedPct()) / 100 : 0
  );

  result = computed(() => {
    if (!this.ready()) return null;
    return this.charges.roundTrip({
      segment: this.segment(),
      direction: this.direction(),
      quantity: this.quantity(),
      entryPrice: this.entryPrice(),
      exitPrice: this.exitPrice(),
      ...this.fundingInput(),
    });
  });

  breakeven = computed(() => {
    if (!(this.entryPrice() > 0) || !(this.quantity() > 0)) return null;
    return this.charges.breakevenPrice({
      segment: this.segment(),
      direction: this.direction(),
      quantity: this.quantity(),
      entryPrice: this.entryPrice(),
      ...this.fundingInput(),
    });
  });

  setSegment(segment: ChargeSegment): void {
    this.segment.set(segment);
  }

  setDirection(direction: TradeDirection): void {
    this.direction.set(direction);
  }

  setNumber(
    target: 'entryPrice' | 'exitPrice' | 'quantity' | 'holdingDays' | 'fundedPct',
    value: unknown
  ): void {
    const parsed = Number(value);
    this[target].set(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }

  value(breakdown: ChargeBreakdown, key: keyof ChargeBreakdown): number {
    return breakdown[key];
  }

  reset(): void {
    this.entryPrice.set(0);
    this.exitPrice.set(0);
    this.quantity.set(0);
  }
}
