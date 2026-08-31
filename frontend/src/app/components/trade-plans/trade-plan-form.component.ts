import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RegistryStockService } from '../../services/registry-stock.service';
import { TradePlanService } from '../../services/trade-plan.service';
import { UniverseService } from '../../services/universe.service';
import { TradeDirection, TradeSegment } from '../../models/trading-journal.models';
import { formatCurrency, formatPctSigned, pnlClass } from '../../utils/format.utils';
import {
  clampToUpcomingPlanDate,
  planDateTabLabel,
  todayIso,
  upcomingPlanDates,
} from '../../utils/trade-plan-date.utils';

@Component({
  selector: 'app-trade-plan-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './trade-plan-form.component.html',
})
export class TradePlanFormComponent implements OnInit {
  private registrySvc = inject(RegistryStockService);
  private planSvc = inject(TradePlanService);
  private universeSvc = inject(UniverseService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  registry = toSignal(this.registrySvc.watchAll(), { initialValue: [] });
  universe = toSignal(this.universeSvc.watchAll(), { initialValue: [] });

  tradeDate = signal(todayIso());
  dateTabs = computed(() =>
    upcomingPlanDates().map((iso) => ({ iso, label: planDateTabLabel(iso) }))
  );
  activeTab = signal<'manual' | 'auto'>('manual');
  symbolQuery = signal('');

  fmt = formatCurrency;
  fmtPct = formatPctSigned;
  pnlClass = pnlClass;
  error = signal<string | null>(null);
  busy = signal(false);

  form = {
    symbol: '',
    name: '',
    segment: 'intraday' as TradeSegment,
    direction: 'long' as TradeDirection,
    quantity: '',
    cmp: '',
    entryPrice: '',
    targetPrice: '',
    stopLoss: '',
    notes: '',
  };

  entryPctPreview = computed(() => {
    const cmp = parseFloat(this.form.cmp);
    const entry = parseFloat(this.form.entryPrice);
    return TradePlanService.pctVsCmp(entry, cmp);
  });

  exitPctPreview = computed(() => {
    const entry = parseFloat(this.form.entryPrice);
    const target = parseFloat(this.form.targetPrice);
    return TradePlanService.exitPctVsEntry(entry, target, this.form.segment, this.form.direction);
  });

  symbolOptions = computed(() => {
    const q = this.symbolQuery().trim().toLowerCase();
    const rows = this.universe();
    if (!q) return rows.slice(0, 30);
    return rows
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  });

  estimatedPreview = computed(() => {
    const qty = parseFloat(this.form.quantity);
    const entry = parseFloat(this.form.entryPrice);
    const target = parseFloat(this.form.targetPrice);
    if (!qty || !entry || !target) return 0;
    return TradePlanService.estimatePnL(this.form.segment, this.form.direction, qty, entry, target);
  });

  ngOnInit(): void {
    const date = clampToUpcomingPlanDate(this.route.snapshot.queryParamMap.get('date'));
    this.tradeDate.set(date);
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'auto') this.activeTab.set('auto');
    const symbol = this.route.snapshot.queryParamMap.get('symbol');
    if (symbol) this.pickSymbol(symbol);
  }

  setTab(tab: 'manual' | 'auto'): void {
    this.activeTab.set(tab);
  }

  selectDate(iso: string): void {
    this.tradeDate.set(iso);
  }

  onSegmentChange(segment: TradeSegment): void {
    this.form.segment = segment;
    if (segment === 'delivery') {
      this.form.direction = 'long';
    }
  }

  onSymbolQuery(value: string): void {
    this.symbolQuery.set(value);
    this.form.symbol = value.toUpperCase();
  }

  pickSymbol(symbol: string): void {
    const entry = this.universe().find((s) => s.symbol === symbol.toUpperCase());
    this.form.symbol = symbol.toUpperCase();
    this.form.name = entry?.name ?? symbol.toUpperCase();
    this.symbolQuery.set(this.form.symbol);
    const reg = this.registry().find((s) => s.symbol === this.form.symbol);
    if (reg) {
      this.form.cmp = String(reg.currentPrice);
      this.form.entryPrice = String(reg.currentPrice);
      if (reg.resistances[0]) this.form.targetPrice = String(reg.resistances[0]);
      if (reg.supports[0]) this.form.stopLoss = String(reg.supports[0]);
    }
    this.activeTab.set('manual');
  }

  async save(source: 'manual' | 'auto' = 'manual'): Promise<void> {
    this.error.set(null);
    const qty = parseFloat(this.form.quantity);
    const cmp = parseFloat(this.form.cmp);
    const entry = parseFloat(this.form.entryPrice);
    const target = parseFloat(this.form.targetPrice);
    if (!this.form.symbol || !qty || !cmp || !entry || !target) {
      this.error.set('Symbol, quantity, CMP, entry, and target are required');
      return;
    }
    const stock = this.registry().find((s) => s.symbol === this.form.symbol.toUpperCase());
    const universeEntry = this.universe().find((s) => s.symbol === this.form.symbol.toUpperCase());
    this.busy.set(true);
    try {
      await this.planSvc.create({
        symbol: this.form.symbol,
        stockName: stock?.name ?? universeEntry?.name ?? this.form.name,
        tradeDate: this.tradeDate(),
        segment: this.form.segment,
        direction: this.form.direction,
        quantity: qty,
        cmp,
        entryPrice: entry,
        targetPrice: target,
        stopLoss: parseFloat(this.form.stopLoss) || undefined,
        source,
        notes: this.form.notes,
      });
      await this.router.navigate(['/trade-plans'], { queryParams: { date: this.tradeDate() } });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add trade');
    } finally {
      this.busy.set(false);
    }
  }
}
