import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TradeDirection } from '../../models/trading-journal.models';
import { ChargeSegment } from '../../models/charges.models';
import { ChargesService } from '../../services/charges.service';
import { TradePlanService } from '../../services/trade-plan.service';
import { CHARGE_SEGMENTS, CHARGE_SEGMENT_LABELS, roundToTick } from '../../utils/charges.utils';
import { formatCurrency, formatPctSigned, formatPrice, pnlClass } from '../../utils/format.utils';
import { readJson, writeJson } from '../../utils/local-store.utils';

const STATE_KEY = 'kairo-profit-target-v2';
const PLANS_KEY = 'kairo-profit-target-plans-v1';

type GoalUnit = 'inr' | 'pct';

/** One partial exit: book this many shares for this much profit. */
interface PlanSlice {
  id: string;
  quantity: number;
  goal: number;
  unit: GoalUnit;
}

/** A saved profit plan for one stock. Browser-only — never synced to the backend. */
interface ProfitPlan {
  id: string;
  symbol: string;
  segment: ChargeSegment;
  direction: TradeDirection;
  entryPrice: number;
  quantity: number;
  slices: PlanSlice[];
  updatedAt: number;
}

interface WorkingState {
  planId: string | null;
  symbol: string;
  segment: ChargeSegment;
  direction: TradeDirection;
  entryPrice: number;
  quantity: number;
  slices: PlanSlice[];
}

function newSlice(quantity = 0, goal = 0): PlanSlice {
  return { id: crypto.randomUUID(), quantity, goal, unit: 'inr' };
}

const FALLBACK: WorkingState = {
  planId: null,
  symbol: '',
  segment: 'delivery',
  direction: 'long',
  entryPrice: 0,
  quantity: 0,
  slices: [],
};

function loadWorking(): WorkingState {
  const parsed = readJson<Partial<WorkingState>>(STATE_KEY, FALLBACK);
  const slices = Array.isArray(parsed.slices) && parsed.slices.length ? parsed.slices : [newSlice()];
  return {
    planId: parsed.planId ?? null,
    symbol: parsed.symbol ?? '',
    segment: parsed.segment ?? 'delivery',
    direction: parsed.direction ?? 'long',
    entryPrice: parsed.entryPrice ?? 0,
    quantity: parsed.quantity ?? 0,
    slices,
  };
}

@Component({
  selector: 'app-profit-target',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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
    .plan-chip {
      @apply flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300;
    }
    .plan-chip-active {
      @apply border-kairo-500 bg-kairo-50 text-kairo-700;
    }
    .slice-row {
      @apply rounded-xl border border-slate-200 bg-white p-2.5;
    }
    .result-row {
      @apply rounded-xl border border-slate-200 bg-white p-3;
    }
    .result-metric {
      @apply rounded-lg bg-slate-50 px-2.5 py-1.5;
    }
    .result-metric-label {
      @apply text-[10px] font-semibold uppercase tracking-wide text-slate-400;
    }
    .result-metric-value {
      @apply mt-0.5 text-sm font-semibold tabular-nums;
    }
  `,
})
export class ProfitTargetComponent {
  private readonly charges = inject(ChargesService);
  private readonly tradePlans = inject(TradePlanService);
  private working = loadWorking();

  planId = signal<string | null>(this.working.planId);
  symbol = signal<string>(this.working.symbol);
  segment = signal<ChargeSegment>(this.working.segment);
  direction = signal<TradeDirection>(this.working.direction);
  entryPrice = signal<number>(this.working.entryPrice);
  quantity = signal<number>(this.working.quantity);
  slices = signal<PlanSlice[]>(this.working.slices);
  plans = signal<ProfitPlan[]>(readJson<ProfitPlan[]>(PLANS_KEY, []));

  notice = signal<string | null>(null);
  savingToBook = signal(false);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;
  readonly segmentLabels = CHARGE_SEGMENT_LABELS;
  readonly segments = CHARGE_SEGMENTS;

  ready = computed(() => this.entryPrice() > 0 && this.quantity() > 0);

  capital = computed(() => this.entryPrice() * this.quantity());

  unallocatedQty = computed(() => {
    const allocated = this.slices().reduce((sum, s) => sum + Math.max(0, s.quantity || 0), 0);
    return this.quantity() - allocated;
  });

  /** Each slice's goal in rupees plus the exit price that delivers it after charges. */
  solved = computed(() => {
    const entryPrice = this.entryPrice();
    const long = this.direction() === 'long';
    return this.slices().map((slice) => {
      const quantity = Math.max(0, slice.quantity || 0);
      const goalAmount =
        slice.unit === 'pct' ? (entryPrice * quantity * (slice.goal || 0)) / 100 : slice.goal || 0;
      if (!this.ready() || quantity <= 0 || goalAmount <= 0) {
        return { slice, goalAmount, price: null as number | null };
      }
      const result = this.charges.profitTarget(
        { segment: this.segment(), direction: this.direction(), quantity, entryPrice },
        goalAmount
      );
      return {
        slice,
        goalAmount,
        price: result ? roundToTick(result.targetPrice, long ? 'up' : 'down') : null,
      };
    });
  });

  ladder = computed(() => {
    if (!this.ready()) return null;
    return this.charges.ladder({
      segment: this.segment(),
      direction: this.direction(),
      entryPrice: this.entryPrice(),
      totalQuantity: this.quantity(),
      slices: this.solved().map((row) => ({
        quantity: row.price != null ? row.slice.quantity : 0,
        price: row.price ?? 0,
      })),
    });
  });

  /** Solved slices paired with their charge/P&L result. */
  resultRows = computed(() => {
    const ladderSlices = this.ladder()?.slices ?? [];
    return this.solved().map((row, i) => ({ ...row, result: ladderSlices[i] ?? null }));
  });

  breakeven = computed(() => {
    if (!this.ready()) return null;
    return this.charges.breakevenPrice({
      segment: this.segment(),
      direction: this.direction(),
      quantity: this.quantity(),
      entryPrice: this.entryPrice(),
    });
  });

  totalGoal = computed(() => this.solved().reduce((sum, row) => sum + row.goalAmount, 0));

  canSave = computed(() => this.symbol().trim().length > 0 && this.ready());

  canAddToBook = computed(
    () => this.canSave() && this.solved().some((row) => row.price != null)
  );

  setSymbol(value: string): void {
    this.symbol.set(value.toUpperCase());
    this.persist();
  }

  setSegment(segment: ChargeSegment): void {
    this.segment.set(segment);
    this.persist();
  }

  setDirection(direction: TradeDirection): void {
    this.direction.set(direction);
    this.persist();
  }

  setNumber(target: 'entryPrice' | 'quantity', value: unknown): void {
    const parsed = Number(value);
    this[target].set(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    this.persist();
  }

  addSlice(): void {
    const left = this.unallocatedQty();
    this.slices.update((rows) => [...rows, newSlice(left > 0 ? left : 0)]);
    this.persist();
  }

  setSliceQuantity(id: string, value: unknown): void {
    const quantity = Number(value);
    this.slices.update((rows) =>
      rows.map((row) =>
        row.id === id
          ? { ...row, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0 }
          : row
      )
    );
    this.persist();
  }

  setSliceGoal(id: string, value: unknown): void {
    const goal = Number(value);
    this.slices.update((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, goal: Number.isFinite(goal) && goal > 0 ? goal : 0 } : row
      )
    );
    this.persist();
  }

  setSliceUnit(id: string, unit: GoalUnit): void {
    this.slices.update((rows) => rows.map((row) => (row.id === id ? { ...row, unit } : row)));
    this.persist();
  }

  removeSlice(id: string): void {
    this.slices.update((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== id) : rows));
    this.persist();
  }

  /** Spreads the position evenly across slices, keeping each slice's goal. */
  splitEvenly(): void {
    const rows = this.slices();
    const total = this.quantity();
    if (!rows.length || total <= 0) return;
    const each = Math.floor(total / rows.length);
    const remainder = total - each * rows.length;
    this.slices.set(rows.map((row, i) => ({ ...row, quantity: each + (i < remainder ? 1 : 0) })));
    this.persist();
  }

  // ── Saved plans (localStorage only) ──────────────────────────────────

  savePlan(): void {
    const symbol = this.symbol().trim().toUpperCase();
    if (!symbol) {
      this.notice.set('Add a stock name before saving');
      return;
    }
    const id = this.planId() ?? crypto.randomUUID();
    const plan: ProfitPlan = {
      id,
      symbol,
      segment: this.segment(),
      direction: this.direction(),
      entryPrice: this.entryPrice(),
      quantity: this.quantity(),
      slices: this.slices(),
      updatedAt: Date.now(),
    };
    this.plans.update((rows) =>
      [plan, ...rows.filter((row) => row.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt)
    );
    this.planId.set(id);
    writeJson(PLANS_KEY, this.plans());
    this.notice.set(`Saved ${symbol} on this browser`);
    this.persist();
  }

  loadPlan(id: string): void {
    const plan = this.plans().find((row) => row.id === id);
    if (!plan) return;
    this.planId.set(plan.id);
    this.symbol.set(plan.symbol);
    this.segment.set(plan.segment);
    this.direction.set(plan.direction);
    this.entryPrice.set(plan.entryPrice);
    this.quantity.set(plan.quantity);
    this.slices.set(plan.slices.length ? plan.slices : [newSlice()]);
    this.notice.set(null);
    this.persist();
  }

  deletePlan(id: string, event: Event): void {
    event.stopPropagation();
    this.plans.update((rows) => rows.filter((row) => row.id !== id));
    writeJson(PLANS_KEY, this.plans());
    if (this.planId() === id) this.planId.set(null);
    this.persist();
  }

  newPlan(): void {
    this.planId.set(null);
    this.symbol.set('');
    this.entryPrice.set(0);
    this.quantity.set(0);
    this.slices.set([newSlice()]);
    this.notice.set(null);
    this.persist();
  }

  async addToTradeBook(): Promise<void> {
    const symbol = this.symbol().trim().toUpperCase();
    if (!symbol || !this.ready()) return;
    const targets = this.solved()
      .filter((row) => row.price != null && row.slice.quantity > 0)
      .map((row) => ({ quantity: row.slice.quantity, price: row.price as number }));
    if (!targets.length) {
      this.notice.set('Set a quantity and profit goal for at least one slice');
      return;
    }

    this.savingToBook.set(true);
    try {
      await this.tradePlans.create({
        symbol,
        segment: this.segment(),
        direction: this.direction(),
        quantity: this.quantity(),
        entryPrice: this.entryPrice(),
        targetPrice: this.entryPrice(),
        targets,
        pool: 'open',
        notes: 'From profit target calculator',
      });
      this.notice.set(`${symbol} added to the trade book`);
    } catch (error) {
      this.notice.set(error instanceof Error ? error.message : 'Could not add to trade book');
    } finally {
      this.savingToBook.set(false);
    }
  }

  private persist(): void {
    const payload: WorkingState = {
      planId: this.planId(),
      symbol: this.symbol(),
      segment: this.segment(),
      direction: this.direction(),
      entryPrice: this.entryPrice(),
      quantity: this.quantity(),
      slices: this.slices(),
    };
    writeJson(STATE_KEY, payload);
  }
}
