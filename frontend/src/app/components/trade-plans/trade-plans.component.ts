import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { TradePlanService } from '../../services/trade-plan.service';
import { PlannedTrade } from '../../models/trading-journal.models';
import { formatCurrency, formatPctSigned, pnlClass, pnlBadgeClass } from '../../utils/format.utils';
import {
  isPastPlanDate,
  isUpcomingPlanDate,
  isWeekend,
  normalizePlanViewDate,
  planDateHeading,
  planDateTabLabel,
  todayIso,
  upcomingPlanDates,
} from '../../utils/trade-plan-date.utils';

type SortKey = 'symbol' | 'estimatedPnL' | 'realizedPnL';

interface PriceLevel {
  key: 'cmp' | 'entry' | 'exit' | 'sl';
  label: string;
  price: number;
  pct: number | null;
  labelClass: string;
  markerClass: string;
}

@Component({
  selector: 'app-trade-plans',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './trade-plans.component.html',
  styles: `
    .plan-date-tab {
      @apply shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800;
    }
    .plan-date-tab-active {
      @apply bg-slate-900 text-white shadow-sm hover:bg-slate-900 hover:text-white;
    }
    .trade-item {
      @apply transition hover:bg-slate-50/60;
    }
    .price-ribbon {
      @apply relative h-2 rounded-full bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100;
    }
    .price-marker {
      @apply absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white;
    }
    .action-menu {
      @apply fixed z-50 min-w-[9rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg;
    }
    .action-menu-item {
      @apply flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50;
    }
  `,
})
export class TradePlansComponent implements OnInit {
  private planSvc = inject(TradePlanService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  tradeDate = signal(normalizePlanViewDate(todayIso()));
  calendarOpen = signal(false);
  sortKey = signal<SortKey>('symbol');
  executingTrade = signal<PlannedTrade | null>(null);
  execForm = { quantity: '', buyPrice: '', sellPrice: '' };
  execError = signal<string | null>(null);
  execBusy = signal(false);
  menuOpenId = signal<string | null>(null);
  menuPosition = signal<{ top: number; right: number; openUp: boolean } | null>(null);

  upcomingTabs = computed(() =>
    upcomingPlanDates().map((iso) => ({ iso, label: planDateTabLabel(iso) }))
  );

  pastDateMax = computed(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  viewingPast = computed(() => isPastPlanDate(this.tradeDate()));
  dateHeading = computed(() => planDateHeading(this.tradeDate()));

  trades = toSignal(
    toObservable(this.tradeDate).pipe(switchMap((date) => this.planSvc.watchForDate(date))),
    { initialValue: [] as PlannedTrade[] }
  );

  fmt = formatCurrency;
  fmtPct = formatPctSigned;
  pnlClass = pnlClass;
  pnlBadgeClass = pnlBadgeClass;

  daySummary = computed(() => this.planSvc.summarizeDay(this.tradeDate(), this.trades()));

  execPreviewPnL = computed(() => {
    const qty = parseFloat(this.execForm.quantity);
    const buy = parseFloat(this.execForm.buyPrice);
    const sell = parseFloat(this.execForm.sellPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    return TradePlanService.realizedPnLFromPrices(qty, buy, sell);
  });

  sortedTrades = computed(() => {
    const key = this.sortKey();
    const rows = [...this.trades()];
    rows.sort((a, b) => {
      switch (key) {
        case 'estimatedPnL':
          return b.estimatedPnL - a.estimatedPnL;
        case 'realizedPnL':
          return (b.realizedPnL ?? 0) - (a.realizedPnL ?? 0);
        default:
          return a.symbol.localeCompare(b.symbol);
      }
    });
    return rows;
  });

  menuTrade = computed(() => {
    const id = this.menuOpenId();
    if (!id) return null;
    return this.trades().find((t) => t.id === id) ?? null;
  });

  ngOnInit(): void {
    const date = this.route.snapshot.queryParamMap.get('date');
    if (date) this.setTradeDate(normalizePlanViewDate(date), false);
  }

  selectTab(iso: string): void {
    this.setTradeDate(iso);
    this.calendarOpen.set(false);
  }

  onPastDatePick(value: string): void {
    if (!value || isWeekend(value) || !isPastPlanDate(value)) return;
    this.setTradeDate(value);
    this.calendarOpen.set(false);
  }

  toggleCalendar(): void {
    this.calendarOpen.update((v) => !v);
  }

  setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  canAddPlan(): boolean {
    return isUpcomingPlanDate(this.tradeDate());
  }

  private setTradeDate(iso: string, syncRoute = true): void {
    this.tradeDate.set(iso);
    if (syncRoute) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { date: iso },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  entryPct(t: PlannedTrade): number | null {
    return TradePlanService.pctVsCmp(t.entryPrice, t.cmp);
  }

  exitPct(t: PlannedTrade): number | null {
    return TradePlanService.exitPctVsEntry(t.entryPrice, t.targetPrice, t.segment, t.direction);
  }

  stopLossPnL(t: PlannedTrade): number | null {
    return TradePlanService.stopLossPnL(t);
  }

  stopLossPct(t: PlannedTrade): number | null {
    return TradePlanService.stopLossPctVsEntry(t.entryPrice, t.stopLoss, t.segment, t.direction);
  }

  hasStopLoss(t: PlannedTrade): boolean {
    return this.stopLossPnL(t) != null;
  }

  displayPnL(t: PlannedTrade): number {
    if (t.status === 'executed' && t.realizedPnL != null) return t.realizedPnL;
    return t.estimatedPnL;
  }

  pnlLabel(t: PlannedTrade): string {
    return t.status === 'executed' ? 'Realized' : 'Est. P&L';
  }

  statusLabel(t: PlannedTrade): string {
    switch (t.status) {
      case 'executed': return 'Executed';
      case 'skipped': return 'Skipped';
      default: return 'Planned';
    }
  }

  statusBadgeClass(t: PlannedTrade): string {
    switch (t.status) {
      case 'executed': return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
      case 'skipped': return 'bg-slate-100 text-slate-600 ring-slate-200';
      default: return 'bg-amber-50 text-amber-800 ring-amber-200';
    }
  }

  typeBadgeClass(t: PlannedTrade): string {
    if (t.segment === 'delivery') return 'bg-indigo-50 text-indigo-700';
    return t.direction === 'short' ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700';
  }

  openExecuteModal(trade: PlannedTrade): void {
    this.executingTrade.set(trade);
    this.execError.set(null);
    const qty = trade.executedQuantity ?? trade.quantity;
    if (trade.executedBuyPrice != null && trade.executedSellPrice != null) {
      this.execForm = {
        quantity: String(qty),
        buyPrice: String(trade.executedBuyPrice),
        sellPrice: String(trade.executedSellPrice),
      };
      return;
    }
    if (trade.segment === 'intraday' && trade.direction === 'short') {
      this.execForm = {
        quantity: String(qty),
        buyPrice: String(trade.targetPrice),
        sellPrice: String(trade.entryPrice),
      };
    } else {
      this.execForm = {
        quantity: String(qty),
        buyPrice: String(trade.entryPrice),
        sellPrice: String(trade.targetPrice),
      };
    }
  }

  closeExecuteModal(): void {
    this.executingTrade.set(null);
    this.execError.set(null);
    this.execForm = { quantity: '', buyPrice: '', sellPrice: '' };
  }

  async confirmExecuted(): Promise<void> {
    const trade = this.executingTrade();
    if (!trade) return;

    const quantity = parseFloat(this.execForm.quantity);
    const buyPrice = parseFloat(this.execForm.buyPrice);
    const sellPrice = parseFloat(this.execForm.sellPrice);
    if (!quantity || !buyPrice || !sellPrice) {
      this.execError.set('Quantity, buy price, and sell price are required');
      return;
    }

    this.execBusy.set(true);
    this.execError.set(null);
    try {
      await this.planSvc.updateExecution(trade.id, 'executed', { quantity, buyPrice, sellPrice });
      this.closeExecuteModal();
    } catch (e) {
      this.execError.set(e instanceof Error ? e.message : 'Failed to save execution');
    } finally {
      this.execBusy.set(false);
    }
  }

  async markSkipped(trade: PlannedTrade): Promise<void> {
    await this.planSvc.updateExecution(trade.id, 'skipped');
  }

  async resetPlanned(trade: PlannedTrade): Promise<void> {
    await this.planSvc.updateExecution(trade.id, 'planned');
  }

  async removeTrade(id: string): Promise<void> {
    if (!confirm('Remove this planned trade?')) return;
    await this.planSvc.remove(id);
  }

  segmentLabel(t: PlannedTrade): string {
    if (t.segment === 'delivery') return 'Delivery';
    return t.direction === 'short' ? 'Short' : 'Long';
  }

  segmentDetail(t: PlannedTrade): string {
    if (t.segment === 'delivery') return 'Delivery';
    return `Intraday · ${t.direction === 'short' ? 'Short' : 'Long'}`;
  }

  accentClass(t: PlannedTrade): string {
    if (t.segment === 'delivery') return 'bg-indigo-500';
    return t.direction === 'short' ? 'bg-rose-500' : 'bg-sky-500';
  }

  priceRange(t: PlannedTrade): { min: number; max: number } {
    const prices = [t.cmp, t.entryPrice, t.targetPrice, t.stopLoss].filter(
      (p): p is number => p != null && p > 0
    );
    if (!prices.length) return { min: 0, max: 1 };
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return { min: min * 0.99, max: max * 1.01 };
    return { min, max };
  }

  markerLeft(value: number | undefined, t: PlannedTrade): number {
    if (value == null || value <= 0) return 0;
    const { min, max } = this.priceRange(t);
    return ((value - min) / (max - min)) * 100;
  }

  isShort(t: PlannedTrade): boolean {
    return t.segment === 'intraday' && t.direction === 'short';
  }

  exitLabel(t: PlannedTrade): string {
    return this.isShort(t) ? 'Exit' : 'Target';
  }

  flowArrow(t: PlannedTrade): string {
    if (t.targetPrice === t.entryPrice) return '→';
    if (this.isShort(t)) return t.targetPrice < t.entryPrice ? '↓' : '↑';
    return t.targetPrice > t.entryPrice ? '↑' : '↓';
  }

  flowArrowClass(t: PlannedTrade): string {
    const profitable = this.isShort(t)
      ? t.targetPrice < t.entryPrice
      : t.targetPrice > t.entryPrice;
    if (t.targetPrice === t.entryPrice) return 'text-slate-400';
    return profitable ? 'text-emerald-600' : 'text-red-600';
  }

  /** Fixed display order: CMP → Entry → Exit → SL (trade sequence, not price sort). */
  priceLevels(t: PlannedTrade): PriceLevel[] {
    const levels: PriceLevel[] = [];
    if (t.cmp != null) {
      levels.push({
        key: 'cmp',
        label: 'CMP',
        price: t.cmp,
        pct: null,
        labelClass: 'text-slate-400',
        markerClass: 'bg-slate-400',
      });
    }
    levels.push({
      key: 'entry',
      label: 'Entry',
      price: t.entryPrice,
      pct: this.entryPct(t),
      labelClass: 'text-kairo-600',
      markerClass: 'bg-kairo-600',
    });
    levels.push({
      key: 'exit',
      label: this.exitLabel(t),
      price: t.targetPrice,
      pct: this.exitPct(t),
      labelClass: 'text-emerald-600',
      markerClass: 'bg-emerald-500',
    });
    if (t.stopLoss != null) {
      levels.push({
        key: 'sl',
        label: 'SL',
        price: t.stopLoss,
        pct: this.stopLossPct(t),
        labelClass: 'text-red-500',
        markerClass: 'bg-red-500',
      });
    }
    return levels;
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    if (this.menuOpenId() === id) {
      this.closeMenu();
      return;
    }
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const menuHeight = 120;
    const openUp = rect.bottom + menuHeight > window.innerHeight - 16;
    this.menuPosition.set({
      top: openUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
      openUp,
    });
    this.menuOpenId.set(id);
  }

  closeMenu(): void {
    this.menuOpenId.set(null);
    this.menuPosition.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeMenu();
  }
}
