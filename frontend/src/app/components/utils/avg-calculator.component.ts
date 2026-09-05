import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatCurrency, formatPrice, formatPctSigned, pnlClass } from '../../utils/format.utils';
import {
  AvgFill,
  AvgTarget,
  FillSide,
  createFill,
  createTarget,
  evaluateTargets,
  summarizeFills,
} from '../../utils/avg-calculator.utils';

const STORAGE_KEY = 'kairo-avg-calculator-v1';

interface PersistedState {
  fills: AvgFill[];
  targets: AvgTarget[];
}

function loadState(): PersistedState {
  if (typeof localStorage === 'undefined') return { fills: [], targets: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fills: [], targets: [] };
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      fills: Array.isArray(parsed.fills) ? parsed.fills : [],
      targets: Array.isArray(parsed.targets) ? parsed.targets : [],
    };
  } catch {
    return { fills: [], targets: [] };
  }
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
  `,
})
export class AvgCalculatorComponent {
  private persisted = loadState();

  fills = signal<AvgFill[]>(this.persisted.fills);
  targets = signal<AvgTarget[]>(this.persisted.targets);

  draftSide = signal<FillSide>('buy');
  draftPrice = '';
  draftQty = '';
  draftTarget = '';
  addError = signal<string | null>(null);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;

  summary = computed(() => summarizeFills(this.fills()));
  targetViews = computed(() => evaluateTargets(this.targets(), this.summary()));
  hasFills = computed(() => this.fills().length > 0);

  setSide(side: FillSide): void {
    this.draftSide.set(side);
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
      this.addError.set('Enter a valid target price');
      return;
    }
    this.addError.set(null);
    this.targets.update((rows) => [...rows, createTarget(price)]);
    this.draftTarget = '';
    this.persist();
  }

  removeTarget(id: string): void {
    this.targets.update((rows) => rows.filter((row) => row.id !== id));
    this.persist();
  }

  clearAll(): void {
    this.fills.set([]);
    this.targets.set([]);
    this.addError.set(null);
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
      this.addTarget();
    }
  }

  remainingLabel(): string {
    const summary = this.summary();
    if (!summary.remainingSide) return 'Flat';
    return summary.remainingSide === 'buy' ? 'Long leftover' : 'Short leftover';
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedState = { fills: this.fills(), targets: this.targets() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}
