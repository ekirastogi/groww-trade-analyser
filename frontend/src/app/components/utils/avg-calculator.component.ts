import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatCurrency, formatPrice, formatPctSigned, pnlClass } from '../../utils/format.utils';
import {
  AvgChargeFn,
  AvgFill,
  AvgPosition,
  AvgTarget,
  FillSide,
  createFill,
  createTarget,
  evaluateTargets,
  openPosition,
  summarizeFills,
} from '../../utils/avg-calculator.utils';
import { ChargeExchange, ChargeSegment } from '../../models/charges.models';
import { CHARGE_EXCHANGES, CHARGE_SEGMENT_LABELS, roundToTick } from '../../utils/charges.utils';
import { ChargesService } from '../../services/charges.service';
import { readJson, writeJson } from '../../utils/local-store.utils';

const STORAGE_KEY = 'kairo-avg-calculator-v1';

type TargetMode = 'price' | 'profit';
type ProfitUnit = 'inr' | 'pct';

interface PersistedState {
  fills: AvgFill[];
  targets: AvgTarget[];
  segment: ChargeSegment;
  exchange: ChargeExchange;
}

function loadState(): PersistedState {
  const fallback: PersistedState = {
    fills: [],
    targets: [],
    segment: 'delivery',
    exchange: 'NSE',
  };
  const parsed = readJson<Partial<PersistedState>>(STORAGE_KEY, fallback);
  return {
    fills: Array.isArray(parsed.fills) ? parsed.fills : [],
    targets: Array.isArray(parsed.targets) ? parsed.targets : [],
    segment: parsed.segment ?? 'delivery',
    exchange: parsed.exchange ?? 'NSE',
  };
}

@Component({
  selector: 'app-avg-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './avg-calculator.component.html',
  styles: `
    .avg-hero {
      @apply overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 text-white shadow-lg sm:p-5;
    }
    .avg-kpi {
      @apply rounded-xl border border-white/10 bg-white/5 px-3 py-2.5;
    }
    .avg-kpi-label {
      @apply text-[10px] font-semibold uppercase tracking-wider text-slate-400;
    }
    .avg-kpi-value {
      @apply mt-1 text-lg font-bold tabular-nums sm:text-xl;
    }
    .blotter-row {
      @apply grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-[5.5rem_1fr_1fr_auto];
    }
    .field-label {
      @apply text-[10px] font-semibold uppercase tracking-wide text-slate-400;
    }
    .mini-toggle {
      @apply rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800;
    }
    .mini-toggle-active {
      @apply bg-slate-900 text-white hover:text-white;
    }
    .target-row {
      @apply rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300;
    }
    .target-metric {
      @apply rounded-lg bg-slate-50 px-2.5 py-1.5;
    }
    .target-metric-label {
      @apply text-[10px] font-semibold uppercase tracking-wide text-slate-400;
    }
    .target-metric-value {
      @apply mt-0.5 text-sm font-semibold tabular-nums;
    }
  `,
})
export class AvgCalculatorComponent {
  private readonly charges = inject(ChargesService);
  private persisted = loadState();

  fills = signal<AvgFill[]>(this.persisted.fills);
  targets = signal<AvgTarget[]>(this.persisted.targets);
  segment = signal<ChargeSegment>(this.persisted.segment);
  exchange = signal<ChargeExchange>(this.persisted.exchange);

  draftSide = signal<FillSide>('buy');
  draftPrice = '';
  draftQty = '';
  draftTarget = '';
  draftProfit = '';
  targetMode = signal<TargetMode>('price');
  profitUnit = signal<ProfitUnit>('inr');
  addError = signal<string | null>(null);
  targetError = signal<string | null>(null);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;
  readonly segmentLabels = CHARGE_SEGMENT_LABELS;
  readonly segments: ChargeSegment[] = ['delivery', 'intraday'];
  readonly exchanges = CHARGE_EXCHANGES;

  summary = computed(() => summarizeFills(this.fills()));
  position = computed(() => openPosition(this.summary()));
  targetViews = computed(() => evaluateTargets(this.targets(), this.summary(), this.chargeFor));
  hasFills = computed(() => this.fills().length > 0);

  /** Exit price where the open position nets zero after charges. */
  breakeven = computed(() => {
    const position = this.position();
    if (!position) return null;
    return this.charges.breakevenPrice(this.tradeFor(position));
  });

  capital = computed(() => {
    const position = this.position();
    return position ? position.avgPrice * position.quantity : 0;
  });

  setSide(side: FillSide): void {
    this.draftSide.set(side);
  }

  setSegment(segment: ChargeSegment): void {
    this.segment.set(segment);
    this.persist();
  }

  setExchange(exchange: ChargeExchange): void {
    this.exchange.set(exchange);
    this.persist();
  }

  setTargetMode(mode: TargetMode): void {
    this.targetMode.set(mode);
    this.targetError.set(null);
  }

  setProfitUnit(unit: ProfitUnit): void {
    this.profitUnit.set(unit);
  }

  addFill(): void {
    const price = Number(this.draftPrice);
    const quantity = Number(this.draftQty);
    if (!Number.isFinite(price) || price <= 0) {
      this.addError.set('Enter a valid price');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      this.addError.set('Enter a valid quantity');
      return;
    }
    this.addError.set(null);
    this.fills.update((rows) => [...rows, createFill(this.draftSide(), price, quantity)]);
    this.draftPrice = '';
    this.draftQty = '';
    this.persist();
  }

  removeFill(id: string): void {
    this.fills.update((rows) => rows.filter((row) => row.id !== id));
    this.persist();
  }

  addTarget(): void {
    const price = Number(this.draftTarget);
    if (!Number.isFinite(price) || price <= 0) {
      this.targetError.set('Enter a valid target price');
      return;
    }
    this.targetError.set(null);
    this.targets.update((rows) => [...rows, createTarget(price)]);
    this.draftTarget = '';
    this.persist();
  }

  /** Turns "I want ₹X profit" into the exit price that nets exactly that after charges. */
  addProfitTarget(): void {
    const position = this.position();
    if (!position) {
      this.targetError.set('Add fills first so there is a position to target');
      return;
    }
    const goal = Number(this.draftProfit);
    if (!Number.isFinite(goal) || goal <= 0) {
      this.targetError.set('Enter the profit you are aiming for');
      return;
    }

    const profit =
      this.profitUnit() === 'pct' ? (position.avgPrice * position.quantity * goal) / 100 : goal;
    const solved = this.charges.profitTarget(this.tradeFor(position), profit);
    if (!solved) {
      this.targetError.set('That profit is not reachable at a valid price');
      return;
    }

    this.targetError.set(null);
    const price = roundToTick(solved.targetPrice, position.side === 'buy' ? 'up' : 'down');
    this.targets.update((rows) => [...rows, createTarget(price)]);
    this.draftProfit = '';
    this.persist();
  }

  submitTarget(): void {
    if (this.targetMode() === 'profit') this.addProfitTarget();
    else this.addTarget();
  }

  removeTarget(id: string): void {
    this.targets.update((rows) => rows.filter((row) => row.id !== id));
    this.persist();
  }

  clearAll(): void {
    this.fills.set([]);
    this.targets.set([]);
    this.addError.set(null);
    this.targetError.set(null);
    this.persist();
  }

  onFillKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addFill();
    }
  }

  onTargetKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submitTarget();
    }
  }

  remainingLabel(): string {
    const summary = this.summary();
    if (!summary.remainingSide) return 'Flat';
    return summary.remainingSide === 'buy' ? 'Long leftover' : 'Short leftover';
  }

  positionLabel(): string {
    const position = this.position();
    if (!position) return 'No open position';
    const side = position.side === 'buy' ? 'Long' : 'Short';
    return `${side} ${position.quantity} at ${formatPrice(position.avgPrice)}`;
  }

  private tradeFor(position: AvgPosition) {
    return {
      segment: this.segment(),
      exchange: this.exchange(),
      direction: position.side === 'buy' ? ('long' as const) : ('short' as const),
      quantity: position.quantity,
      entryPrice: position.avgPrice,
    };
  }

  private chargeFor: AvgChargeFn = (position, exitPrice) =>
    this.charges.roundTrip({ ...this.tradeFor(position), exitPrice }).charges;

  private persist(): void {
    const payload: PersistedState = {
      fills: this.fills(),
      targets: this.targets(),
      segment: this.segment(),
      exchange: this.exchange(),
    };
    writeJson(STORAGE_KEY, payload);
  }
}
