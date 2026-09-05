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

const STATE_KEY = 'kairo-avg-calculator-v2';
const SHEETS_KEY = 'kairo-avg-sheets-v1';

type TargetMode = 'price' | 'profit';
type ProfitUnit = 'inr' | 'pct';

/** A saved calculator sheet. Browser-only — never synced to the backend. */
interface AvgSheet {
  id: string;
  symbol: string;
  segment: ChargeSegment;
  fills: AvgFill[];
  targets: AvgTarget[];
  updatedAt: number;
}

interface WorkingState {
  sheetId: string | null;
  symbol: string;
  segment: ChargeSegment;
  fills: AvgFill[];
  targets: AvgTarget[];
}

const FALLBACK: WorkingState = {
  sheetId: null,
  symbol: '',
  segment: 'delivery',
  fills: [],
  targets: [],
};

function loadWorking(): WorkingState {
  const parsed = readJson<Partial<WorkingState>>(STATE_KEY, FALLBACK);
  return {
    sheetId: parsed.sheetId ?? null,
    symbol: parsed.symbol ?? '',
    segment: parsed.segment ?? 'delivery',
    fills: Array.isArray(parsed.fills) ? parsed.fills : [],
    // Targets gained a quantity; older saved rows default to the whole position.
    targets: Array.isArray(parsed.targets)
      ? parsed.targets.map((t) => ({ ...t, quantity: t.quantity ?? 0 }))
      : [],
  };
}

@Component({
  selector: 'app-avg-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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
      @apply rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800;
    }
    .mini-toggle-active {
      @apply bg-slate-900 text-white hover:text-white;
    }
    .sheet-chip {
      @apply flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white pl-2.5 pr-1 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300;
    }
    .sheet-chip-active {
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
  `,
})
export class AvgCalculatorComponent {
  private readonly charges = inject(ChargesService);
  private readonly tradePlans = inject(TradePlanService);
  private working = loadWorking();

  sheetId = signal<string | null>(this.working.sheetId);
  symbol = signal<string>(this.working.symbol);
  segment = signal<ChargeSegment>(this.working.segment);
  fills = signal<AvgFill[]>(this.working.fills);
  targets = signal<AvgTarget[]>(this.working.targets);
  sheets = signal<AvgSheet[]>(readJson<AvgSheet[]>(SHEETS_KEY, []));

  draftSide = signal<FillSide>('buy');
  draftPrice = '';
  draftQty = '';
  draftTarget = '';
  draftTargetQty = '';
  draftProfit = '';
  targetMode = signal<TargetMode>('price');
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

  summary = computed(() => summarizeFills(this.fills()));
  position = computed(() => openPosition(this.summary()));
  hasFills = computed(() => this.fills().length > 0);

  /** Per-target and blended P&L for the partial exit ladder. */
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

  /** Targets paired with their ladder result; indexes line up by construction. */
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

  canSave = computed(() => this.symbol().trim().length > 0 && this.hasFills());

  canAddToBook = computed(
    () => this.symbol().trim().length > 0 && this.position() != null && this.targets().length > 0
  );

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

  /** Quantity a new target should default to: whatever is still unallocated. */
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

  /** Turns "I want ₹X from this slice" into the exit price that nets exactly that. */
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
    const typedQty = Number(this.draftTargetQty);
    const quantity =
      Number.isFinite(typedQty) && typedQty > 0 ? typedQty : this.defaultSliceQty();
    if (quantity <= 0) {
      this.targetError.set('Nothing left to allocate — reduce an existing target first');
      return;
    }

    const profit = this.profitUnit() === 'pct' ? (position.avgPrice * quantity * goal) / 100 : goal;
    const solved = this.charges.profitTarget(
      { ...this.tradeFor(position), quantity },
      profit
    );
    if (!solved) {
      this.targetError.set('That profit is not reachable at a valid price');
      return;
    }

    this.targetError.set(null);
    const price = roundToTick(solved.targetPrice, position.side === 'buy' ? 'up' : 'down');
    this.targets.update((rows) => [...rows, createTarget(price, quantity)]);
    this.draftProfit = '';
    this.draftTargetQty = '';
    this.persist();
  }

  submitTarget(): void {
    if (this.targetMode() === 'profit') this.addProfitTarget();
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

  /** Splits the position evenly across the existing targets. */
  splitEvenly(): void {
    const position = this.position();
    const rows = this.targets();
    if (!position || !rows.length) return;
    const each = Math.floor(position.quantity / rows.length);
    const remainder = position.quantity - each * rows.length;
    this.targets.set(
      rows.map((row, i) => ({ ...row, quantity: each + (i < remainder ? 1 : 0) }))
    );
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
    this.targetError.set(null);
    this.notice.set(null);
    this.persist();
  }

  // ── Saved sheets (localStorage only) ─────────────────────────────────

  saveSheet(): void {
    const symbol = this.symbol().trim().toUpperCase();
    if (!symbol) {
      this.notice.set('Add a stock name before saving');
      return;
    }
    const id = this.sheetId() ?? crypto.randomUUID();
    const sheet: AvgSheet = {
      id,
      symbol,
      segment: this.segment(),
      fills: this.fills(),
      targets: this.targets(),
      updatedAt: Date.now(),
    };
    this.sheets.update((rows) => {
      const rest = rows.filter((row) => row.id !== id);
      return [sheet, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    this.sheetId.set(id);
    writeJson(SHEETS_KEY, this.sheets());
    this.notice.set(`Saved ${symbol} on this browser`);
    this.persist();
  }

  loadSheet(id: string): void {
    const sheet = this.sheets().find((row) => row.id === id);
    if (!sheet) return;
    this.sheetId.set(sheet.id);
    this.symbol.set(sheet.symbol);
    this.segment.set(sheet.segment);
    this.fills.set(sheet.fills);
    this.targets.set(sheet.targets.map((t) => ({ ...t, quantity: t.quantity ?? 0 })));
    this.notice.set(null);
    this.targetError.set(null);
    this.persist();
  }

  deleteSheet(id: string, event: Event): void {
    event.stopPropagation();
    this.sheets.update((rows) => rows.filter((row) => row.id !== id));
    writeJson(SHEETS_KEY, this.sheets());
    if (this.sheetId() === id) this.sheetId.set(null);
    this.persist();
  }

  newSheet(): void {
    this.sheetId.set(null);
    this.symbol.set('');
    this.fills.set([]);
    this.targets.set([]);
    this.notice.set(null);
    this.targetError.set(null);
    this.persist();
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
        notes: 'From avg calculator',
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
      direction: positionDirection(position),
      quantity: position.quantity,
      entryPrice: position.avgPrice,
    };
  }

  private persist(): void {
    const payload: WorkingState = {
      sheetId: this.sheetId(),
      symbol: this.symbol(),
      segment: this.segment(),
      fills: this.fills(),
      targets: this.targets(),
    };
    writeJson(STATE_KEY, payload);
  }
}
