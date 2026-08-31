import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { TradePlanService } from '../../services/trade-plan.service';
import { PlannedTrade } from '../../models/trading-journal.models';
import { formatCurrency, formatPctSigned, pnlClass } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';
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

@Component({
  selector: 'app-trade-plans',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './trade-plans.component.html',
})
export class TradePlansComponent implements OnInit {
  private planSvc = inject(TradePlanService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  tradeDate = signal(normalizePlanViewDate(todayIso()));
  calendarOpen = signal(false);
  executingTrade = signal<PlannedTrade | null>(null);
  execForm = { quantity: '', buyValue: '', sellValue: '' };
  execError = signal<string | null>(null);
  execBusy = signal(false);

  upcomingTabs = computed(() =>
    upcomingPlanDates().map((iso) => ({ iso, label: planDateTabLabel(iso) }))
  );

  readonly todayIso = todayIso;
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

  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;
  fmtPct = formatPctSigned;
  pnlClass = pnlClass;

  daySummary = computed(() => this.planSvc.summarizeDay(this.tradeDate(), this.trades()));

  execPreviewPnL = computed(() => {
    const buy = parseFloat(this.execForm.buyValue);
    const sell = parseFloat(this.execForm.sellValue);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    return TradePlanService.realizedPnLFromValues(buy, sell);
  });

  sortedTrades = computed(() =>
    this.tableSort.sort(this.trades(), (t, col) => {
      switch (col) {
        case 'symbol': return t.symbol;
        case 'estimatedPnL': return t.estimatedPnL;
        case 'realizedPnL': return t.realizedPnL ?? 0;
        default: return t.symbol;
      }
    })
  );

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

  openExecuteModal(trade: PlannedTrade): void {
    this.executingTrade.set(trade);
    this.execError.set(null);
    const qty = trade.quantity;
    const entryTotal = trade.entryPrice * qty;
    const exitTotal = trade.targetPrice * qty;
    if (trade.segment === 'intraday' && trade.direction === 'short') {
      this.execForm = {
        quantity: String(qty),
        buyValue: String(exitTotal),
        sellValue: String(entryTotal),
      };
    } else {
      this.execForm = {
        quantity: String(qty),
        buyValue: String(entryTotal),
        sellValue: String(exitTotal),
      };
    }
  }

  closeExecuteModal(): void {
    this.executingTrade.set(null);
    this.execError.set(null);
    this.execForm = { quantity: '', buyValue: '', sellValue: '' };
  }

  async confirmExecuted(): Promise<void> {
    const trade = this.executingTrade();
    if (!trade) return;

    const quantity = parseFloat(this.execForm.quantity);
    const buyValue = parseFloat(this.execForm.buyValue);
    const sellValue = parseFloat(this.execForm.sellValue);
    if (!quantity || !buyValue || !sellValue) {
      this.execError.set('Quantity, buy value, and sell value are required');
      return;
    }

    this.execBusy.set(true);
    this.execError.set(null);
    try {
      await this.planSvc.updateExecution(trade.id, 'executed', { quantity, buyValue, sellValue });
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
    return t.direction === 'short' ? 'Intraday short' : 'Intraday long';
  }
}
