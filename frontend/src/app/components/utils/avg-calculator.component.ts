import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatCurrency, formatPrice, formatPctSigned, pnlClass } from '../../utils/format.utils';
import {
  AvgFill,
  AvgPosition,
  AvgTarget,
  FillSide,
  createFill,
  createTarget,
  openPosition,
  positionDirection,
  summarizeFills,
} from '../../utils/avg-calculator.utils';
import { ChargeSegment } from '../../models/charges.models';
import {
  CHARGE_SEGMENTS,
  CHARGE_SEGMENT_LABELS,
  roundToTick,
  tradeSegmentForCharge,
} from '../../utils/charges.utils';
import { ChargesService } from '../../services/charges.service';
import { TradePlanService } from '../../services/trade-plan.service';
import { readJson, writeJson } from '../../utils/local-store.utils';

const PLANS_KEY = 'kairo-stock-plans-v1';
const LEGACY_SHEETS_KEY = 'kairo-avg-sheets-v1';
const LEGACY_STATE_KEY = 'kairo-avg-calculator-v2';

type ProfitUnit = 'inr' | 'pct';
type RightTab = 'guide' | 'price' | 'profit';

const PROFIT_PRESETS = [1000, 5000, 10000, 25000, 50000] as const;
const STOP_PRESETS = [1000, 5000, 10000] as const;

/** A saved calculator plan. Browser-only — never synced to the backend. */
interface StockPlan {
  id: string;
  symbol: string;
  segment: ChargeSegment;
  fills: AvgFill[];
  targets: AvgTarget[];
  markPrice: number | null;
  updatedAt: number;
}

interface PlansStore {
  plans: StockPlan[];
  activeId: string;
}

function emptyPlan(partial?: Partial<StockPlan>): StockPlan {
  return {
    id: crypto.randomUUID(),
    symbol: '',
    segment: 'delivery',
    fills: [],
    targets: [],
    markPrice: null,
    updatedAt: Date.now(),
    ...partial,
  };
}

function normalizePlan(raw: Partial<StockPlan> & { id?: string }): StockPlan {
  return emptyPlan({
    id: raw.id ?? crypto.randomUUID(),
    symbol: raw.symbol ?? '',
    segment: raw.segment ?? 'delivery',
    fills: Array.isArray(raw.fills) ? raw.fills : [],
    targets: Array.isArray(raw.targets)
      ? raw.targets.map((t) => ({ ...t, quantity: t.quantity ?? 0 }))
      : [],
    markPrice: raw.markPrice ?? null,
    updatedAt: raw.updatedAt ?? Date.now(),
  });
}

function loadStore(): PlansStore {
  const stored = readJson<PlansStore | null>(PLANS_KEY, null);
  if (stored?.plans?.length && stored.activeId) {
    const plans = stored.plans.map(normalizePlan);
    const activeId = plans.some((p) => p.id === stored.activeId) ? stored.activeId : plans[0].id;
    return { plans, activeId };
  }

  const legacySheets = readJson<StockPlan[]>(LEGACY_SHEETS_KEY, []);
  const legacyWorking = readJson<Partial<StockPlan> & { sheetId?: string | null }>(LEGACY_STATE_KEY, {});
  if (legacySheets.length) {
    const plans = legacySheets.map(normalizePlan);
    const activeId =
      plans.find((p) => p.id === legacyWorking.sheetId)?.id ?? plans[0].id;
    return { plans, activeId };
  }

  const migrated = emptyPlan({
    symbol: legacyWorking.symbol ?? '',
    segment: legacyWorking.segment ?? 'delivery',
    fills: Array.isArray(legacyWorking.fills) ? legacyWorking.fills : [],
    targets: Array.isArray(legacyWorking.targets) ? legacyWorking.targets : [],
  });
  return { plans: [migrated], activeId: migrated.id };
}

@Component({
  selector: 'app-avg-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './avg-calculator.component.html',
  styles: `
    .blotter-row {
      @apply grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-[5.5rem_1fr_1fr_auto];
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
    .plan-tab {
      @apply flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white pl-3 pr-1 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300;
    }
    .plan-tab-active {
      @apply border-kairo-500 bg-kairo-50 text-kairo-700;
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
    .qty-input {
      @apply w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm font-semibold tabular-nums text-slate-900 focus:border-kairo-500 focus:outline-none;
    }
    .stat-chip {
      @apply rounded-xl border border-slate-200 bg-white px-3 py-2;
    }
  `,
})
export class AvgCalculatorComponent {
  private readonly charges = inject(ChargesService);
  private readonly tradePlans = inject(TradePlanService);
  private store = loadStore();

  plans = signal<StockPlan[]>(this.store.plans);
  planId = signal<string>(this.store.activeId);

  private activePlan(): StockPlan {
    return this.plans().find((p) => p.id === this.planId()) ?? this.plans()[0];
  }

  symbol = signal<string>(this.activePlan().symbol);
  segment = signal<ChargeSegment>(this.activePlan().segment);
  fills = signal<AvgFill[]>(this.activePlan().fills);
  targets = signal<AvgTarget[]>(this.activePlan().targets);
  markPrice = signal<number | null>(this.activePlan().markPrice);

  draftSide = signal<FillSide>('buy');
  draftPrice = '';
  draftQty = '';
  draftTarget = '';
  draftTargetQty = '';
  draftProfit = '';
  draftGuideProfit = '';
  draftMark = '';
  rightTab = signal<RightTab>('guide');
  profitUnit = signal<ProfitUnit>('inr');
  addError = signal<string | null>(null);
  targetError = signal<string | null>(null);
  notice = signal<string | null>(null);
  savingToBook = signal(false);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPctSigned = formatPctSigned;
  readonly pnlClass = pnlClass;
  readonly segmentLabels = CHARGE_SEGMENT_LABELS;
  readonly segments = CHARGE_SEGMENTS;
  readonly profitPresets = PROFIT_PRESETS;
  readonly stopPresets = STOP_PRESETS;

  summary = computed(() => summarizeFills(this.fills()));
  position = computed(() => openPosition(this.summary()));

  ladder = computed(() => {
    const position = this.position();
    if (!position) return null;
    return this.charges.ladder({
      segment: this.segment(),
      direction: positionDirection(position),
      entryPrice: position.avgPrice,
      totalQuantity: position.quantity,
      slices: this.targets().map((target) => ({ quantity: target.quantity, price: target.price })),
    });
  });

  targetRows = computed(() => {
    const slices = this.ladder()?.slices ?? [];
    return this.targets().map((target, i) => ({ target, slice: slices[i] ?? null }));
  });

  unallocatedQty = computed(() => {
    const position = this.position();
    if (!position) return 0;
    const allocated = this.targets().reduce((sum, t) => sum + Math.max(0, t.quantity || 0), 0);
    return position.quantity - allocated;
  });

  breakeven = computed(() => {
    const position = this.position();
    if (!position) return null;
    return this.charges.breakevenPrice(this.tradeFor(position));
  });

  capital = computed(() => {
    const position = this.position();
    return position ? position.avgPrice * position.quantity : 0;
  });

  leftoverMark = computed(() => {
    const position = this.position();
    const mark = this.markPrice();
    if (!position || mark == null || mark <= 0) return null;
    return this.charges.roundTrip({
      ...this.tradeFor(position),
      exitPrice: mark,
    });
  });

  exitGuideRows = computed(() => {
    const position = this.position();
    if (!position) return [];
    const trade = this.tradeFor(position);
    const tick = position.side === 'buy' ? 'up' : 'down';
    return PROFIT_PRESETS.map((profit) => {
      const solved = this.charges.profitTarget(trade, profit);
      if (!solved) return { profit, price: null as number | null, movePct: null as number | null, charges: null as number | null };
      const price = roundToTick(solved.targetPrice, tick);
      return {
        profit,
        price,
        movePct: solved.movePct,
        charges: solved.roundTrip.charges,
      };
    });
  });

  stopGuideRows = computed(() => {
    const position = this.position();
    if (!position) return [];
    const trade = this.tradeFor(position);
    const tick = position.side === 'buy' ? 'down' : 'up';
    return STOP_PRESETS.map((loss) => {
      const solved = this.charges.profitTarget(trade, -loss);
      if (!solved) return { loss, price: null as number | null, movePct: null as number | null };
      return {
        loss,
        price: roundToTick(solved.targetPrice, tick),
        movePct: solved.movePct,
      };
    });
  });

  canAddToBook = computed(
    () => this.symbol().trim().length > 0 && this.position() != null && this.targets().length > 0
  );

  planLabel(plan: StockPlan): string {
    const symbol = plan.id === this.planId() ? this.symbol().trim() : plan.symbol.trim();
    return symbol || 'New plan';
  }

  setSide(side: FillSide): void {
    this.draftSide.set(side);
  }

  setSegment(segment: ChargeSegment): void {
    this.segment.set(segment);
    this.persist();
  }

  setSymbol(value: string): void {
    this.symbol.set(value.toUpperCase());
    this.persist();
  }

  setRightTab(tab: RightTab): void {
    this.rightTab.set(tab);
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

  setMarkFromDraft(): void {
    const price = Number(this.draftMark);
    this.markPrice.set(Number.isFinite(price) && price > 0 ? price : null);
    this.persist();
  }

  private defaultSliceQty(): number {
    const left = this.unallocatedQty();
    if (left > 0) return left;
    return this.position()?.quantity ?? 0;
  }

  addTarget(): void {
    const price = Number(this.draftTarget);
    if (!Number.isFinite(price) || price <= 0) {
      this.targetError.set('Enter a valid target price');
      return;
    }
    const typedQty = Number(this.draftTargetQty);
    const quantity =
      Number.isFinite(typedQty) && typedQty > 0 ? typedQty : this.defaultSliceQty();
    this.targetError.set(null);
    this.targets.update((rows) => [...rows, createTarget(price, quantity)]);
    this.draftTarget = '';
    this.draftTargetQty = '';
    this.persist();
  }

  addProfitTarget(): void {
    const position = this.position();
    if (!position) {
      this.targetError.set('Add leftover lots first — sells already booked reduce what is left');
      return;
    }
    const goal = Number(this.draftProfit);
    if (!Number.isFinite(goal) || goal <= 0) {
      this.targetError.set('Enter the profit you are aiming for');
      return;
    }
    if (this.addSolvedTarget(goal, Number(this.draftTargetQty))) {
      this.draftProfit = '';
      this.draftTargetQty = '';
    }
  }

  addPresetTarget(profit: number): void {
    this.addSolvedTarget(profit, this.defaultSliceQty());
  }

  addGuideProfit(): void {
    const goal = Number(this.draftGuideProfit);
    if (!Number.isFinite(goal) || goal === 0) {
      this.targetError.set('Enter a profit or loss amount');
      return;
    }
    if (this.addSolvedTarget(goal, this.defaultSliceQty())) {
      this.draftGuideProfit = '';
    }
  }

  private addSolvedTarget(netProfit: number, typedQty: number): boolean {
    const position = this.position();
    if (!position) {
      this.targetError.set('Add buy lots first so there is a leftover position');
      return false;
    }
    const quantity =
      Number.isFinite(typedQty) && typedQty > 0 ? typedQty : this.defaultSliceQty();
    if (quantity <= 0) {
      this.targetError.set('Nothing left to allocate — reduce an existing target first');
      return false;
    }

    const profit =
      this.rightTab() === 'profit' && this.profitUnit() === 'pct'
        ? (position.avgPrice * quantity * netProfit) / 100
        : netProfit;
    const solved = this.charges.profitTarget({ ...this.tradeFor(position), quantity }, profit);
    if (!solved) {
      this.targetError.set('That amount is not reachable at a valid price');
      return false;
    }

    this.targetError.set(null);
    const roundDir =
      (position.side === 'buy' && profit >= 0) || (position.side === 'sell' && profit < 0)
        ? 'up'
        : 'down';
    const price = roundToTick(solved.targetPrice, roundDir);
    this.targets.update((rows) => [...rows, createTarget(price, quantity)]);
    this.persist();
    return true;
  }

  submitTarget(): void {
    if (this.rightTab() === 'guide') this.addGuideProfit();
    else if (this.rightTab() === 'profit') this.addProfitTarget();
    else this.addTarget();
  }

  setTargetQty(id: string, value: unknown): void {
    const quantity = Number(value);
    this.targets.update((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0 } : row
      )
    );
    this.persist();
  }

  setTargetPrice(id: string, value: unknown): void {
    const price = Number(value);
    this.targets.update((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, price: Number.isFinite(price) && price > 0 ? price : 0 } : row
      )
    );
    this.persist();
  }

  splitEvenly(): void {
    const position = this.position();
    const rows = this.targets();
    if (!position || !rows.length) return;
    const each = Math.floor(position.quantity / rows.length);
    const remainder = position.quantity - each * rows.length;
    this.targets.set(rows.map((row, i) => ({ ...row, quantity: each + (i < remainder ? 1 : 0) })));
    this.persist();
  }

  removeTarget(id: string): void {
    this.targets.update((rows) => rows.filter((row) => row.id !== id));
    this.persist();
  }

  newPlan(): void {
    const plan = emptyPlan();
    this.plans.update((rows) => [...rows, plan]);
    this.selectPlan(plan.id);
  }

  duplicatePlan(): void {
    const current = this.snapshot();
    const copy = emptyPlan({
      ...current,
      id: crypto.randomUUID(),
      symbol: current.symbol ? `${current.symbol} copy` : '',
    });
    this.plans.update((rows) => [...rows, copy]);
    this.selectPlan(copy.id);
  }

  selectPlan(id: string): void {
    this.flushToPlans();
    const plan = this.plans().find((row) => row.id === id);
    if (!plan) return;
    this.planId.set(id);
    this.symbol.set(plan.symbol);
    this.segment.set(plan.segment);
    this.fills.set(plan.fills);
    this.targets.set(plan.targets.map((t) => ({ ...t, quantity: t.quantity ?? 0 })));
    this.markPrice.set(plan.markPrice);
    this.draftMark = plan.markPrice != null ? String(plan.markPrice) : '';
    this.notice.set(null);
    this.targetError.set(null);
    this.addError.set(null);
    this.rightTab.set('guide');
    this.writeStore();
  }

  deletePlan(id: string, event: Event): void {
    event.stopPropagation();
    this.flushToPlans();
    const remaining = this.plans().filter((row) => row.id !== id);
    if (!remaining.length) {
      const fresh = emptyPlan();
      this.plans.set([fresh]);
      this.selectPlan(fresh.id);
      return;
    }
    this.plans.set(remaining);
    if (this.planId() === id) this.selectPlan(remaining[0].id);
    else this.writeStore();
  }

  async addToTradeBook(): Promise<void> {
    const position = this.position();
    const symbol = this.symbol().trim().toUpperCase();
    if (!position || !symbol) return;
    const targets = this.targets()
      .filter((target) => target.quantity > 0 && target.price > 0)
      .map((target) => ({ quantity: target.quantity, price: target.price }));
    if (!targets.length) {
      this.notice.set('Add at least one target with a quantity and price');
      return;
    }

    this.savingToBook.set(true);
    try {
      await this.tradePlans.create({
        symbol,
        segment: tradeSegmentForCharge(this.segment()),
        direction: positionDirection(position),
        quantity: position.quantity,
        entryPrice: position.avgPrice,
        targetPrice: position.avgPrice,
        targets,
        pool: 'open',
        notes: 'From stock plan',
      });
      this.notice.set(`${symbol} added to the trade book`);
    } catch (error) {
      this.notice.set(error instanceof Error ? error.message : 'Could not add to trade book');
    } finally {
      this.savingToBook.set(false);
    }
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

  onMarkKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.setMarkFromDraft();
    }
  }

  remainingLabel(): string {
    const summary = this.summary();
    if (!summary.remainingSide) return 'Flat';
    return summary.remainingSide === 'buy' ? 'Left long' : 'Left short';
  }

  positionLabel(): string {
    const position = this.position();
    if (!position) return 'No leftover lots';
    const side = position.side === 'buy' ? 'Long' : 'Short';
    return `${side} ${position.quantity} at ${formatPrice(position.avgPrice)}`;
  }

  private tradeFor(position: AvgPosition) {
    return {
      segment: this.segment(),
      direction: positionDirection(position),
      quantity: position.quantity,
      entryPrice: position.avgPrice,
    };
  }

  private snapshot(): StockPlan {
    return {
      id: this.planId(),
      symbol: this.symbol().trim().toUpperCase(),
      segment: this.segment(),
      fills: this.fills(),
      targets: this.targets(),
      markPrice: this.markPrice(),
      updatedAt: Date.now(),
    };
  }

  private flushToPlans(): void {
    const current = this.snapshot();
    this.plans.update((rows) => rows.map((row) => (row.id === current.id ? current : row)));
  }

  private persist(): void {
    this.flushToPlans();
    this.writeStore();
  }

  private writeStore(): void {
    writeJson(PLANS_KEY, { plans: this.plans(), activeId: this.planId() } satisfies PlansStore);
  }
}
