import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { TradePlanService } from '../../services/trade-plan.service';
import { PlannedTrade } from '../../models/trading-journal.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-trade-plans',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './trade-plans.component.html',
})
export class TradePlansComponent implements OnInit {
  private planSvc = inject(TradePlanService);
  private route = inject(ActivatedRoute);

  tradeDate = signal(todayIso());

  trades = toSignal(
    toObservable(this.tradeDate).pipe(switchMap((date) => this.planSvc.watchForDate(date))),
    { initialValue: [] as PlannedTrade[] }
  );

  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;
  pnlClass = pnlClass;

  daySummary = computed(() => this.planSvc.summarizeDay(this.tradeDate(), this.trades()));

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
    if (date) this.tradeDate.set(date);
  }

  onDateChange(value: string): void {
    this.tradeDate.set(value);
  }

  async markExecuted(trade: PlannedTrade, executed: boolean): Promise<void> {
    if (executed) {
      const raw = prompt(`Realized P&L for ${trade.symbol} (₹):`, String(trade.estimatedPnL));
      if (raw == null) return;
      const pnl = parseFloat(raw);
      await this.planSvc.updateExecution(trade.id, 'executed', Number.isFinite(pnl) ? pnl : 0);
    } else {
      await this.planSvc.updateExecution(trade.id, 'skipped');
    }
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
