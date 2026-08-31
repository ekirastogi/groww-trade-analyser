import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { RegistryStockService } from '../../services/registry-stock.service';
import { TradePlanService } from '../../services/trade-plan.service';
import { PlannedTrade, TradeDirection, TradeSegment } from '../../models/trading-journal.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-trade-plans',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trade-plans.component.html',
})
export class TradePlansComponent implements OnInit {
  private registrySvc = inject(RegistryStockService);
  private planSvc = inject(TradePlanService);
  private route = inject(ActivatedRoute);

  registry = toSignal(this.registrySvc.watchAll(), { initialValue: [] });
  tradeDate = signal(todayIso());
  activeTab = signal<'manual' | 'auto'>('manual');

  trades = toSignal(
    toObservable(this.tradeDate).pipe(switchMap((date) => this.planSvc.watchForDate(date))),
    { initialValue: [] as PlannedTrade[] }
  );

  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;
  pnlClass = pnlClass;
  error = signal<string | null>(null);
  busy = signal(false);

  form = {
    symbol: '',
    segment: 'intraday' as TradeSegment,
    direction: 'long' as TradeDirection,
    quantity: '',
    entryPrice: '',
    targetPrice: '',
    stopLoss: '',
    notes: '',
  };

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

  estimatedPreview = computed(() => {
    const qty = parseFloat(this.form.quantity);
    const entry = parseFloat(this.form.entryPrice);
    const target = parseFloat(this.form.targetPrice);
    if (!qty || !entry || !target) return 0;
    return TradePlanService.estimatePnL(this.form.segment, this.form.direction, qty, entry, target);
  });

  ngOnInit(): void {
    const date = this.route.snapshot.queryParamMap.get('date');
    if (date) this.tradeDate.set(date);
  }

  onDateChange(value: string): void {
    this.tradeDate.set(value);
  }

  setTab(tab: 'manual' | 'auto'): void {
    this.activeTab.set(tab);
  }

  onSegmentChange(segment: TradeSegment): void {
    this.form.segment = segment;
    if (segment === 'delivery') {
      this.form.direction = 'long';
    }
  }

  selectRegistrySymbol(symbol: string): void {
    this.form.symbol = symbol;
    const stock = this.registry().find((s) => s.symbol === symbol);
    if (stock) {
      this.form.entryPrice = String(stock.currentPrice);
      if (stock.resistances[0]) this.form.targetPrice = String(stock.resistances[0]);
      if (stock.supports[0]) this.form.stopLoss = String(stock.supports[0]);
    }
    this.activeTab.set('manual');
  }

  async addTrade(source: 'manual' | 'auto' = 'manual'): Promise<void> {
    this.error.set(null);
    const qty = parseFloat(this.form.quantity);
    const entry = parseFloat(this.form.entryPrice);
    const target = parseFloat(this.form.targetPrice);
    if (!this.form.symbol || !qty || !entry || !target) {
      this.error.set('Symbol, quantity, entry, and target are required');
      return;
    }
    const stock = this.registry().find((s) => s.symbol === this.form.symbol.toUpperCase());
    this.busy.set(true);
    try {
      await this.planSvc.create({
        symbol: this.form.symbol,
        stockName: stock?.name,
        tradeDate: this.tradeDate(),
        segment: this.form.segment,
        direction: this.form.direction,
        quantity: qty,
        entryPrice: entry,
        targetPrice: target,
        stopLoss: parseFloat(this.form.stopLoss) || undefined,
        source,
        notes: this.form.notes,
      });
      this.form.quantity = '';
      this.form.notes = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add trade');
    } finally {
      this.busy.set(false);
    }
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
