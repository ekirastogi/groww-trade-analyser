import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import {
  PeriodBucket,
  StockSummary,
  TRADE_TYPE_LABELS,
  TradeType,
} from '../../models/trade.models';
import {
  formatCurrency,
  formatDate,
  formatPct,
  pnlClass,
} from '../../utils/format.utils';
import { groupTradesByStock } from '../../utils/trade.utils';
import { FilterPanelComponent } from '../shared/filter-panel/filter-panel.component';

type SortDir = 'asc' | 'desc';
type TabId = 'daily' | 'weekly' | 'monthly' | 'stocks' | 'charges';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FilterPanelComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly state = inject(ReportStateService);
  readonly tradeTypeLabels = TRADE_TYPE_LABELS;
  readonly formatCurrency = formatCurrency;
  readonly formatPct = formatPct;
  readonly formatDate = formatDate;
  readonly pnlClass = pnlClass;
  readonly groupTradesByStock = groupTradesByStock;

  activeTab = signal<TabId>('daily');
  dragOver = signal(false);
  sortColumn = signal('period');
  sortDirection = signal<SortDir>('asc');
  expandedPeriod = signal<string | null>(null);
  expandedStock = signal<string | null>(null);

  readonly periodColumns = [
    { key: 'period', label: 'Period' },
    { key: 'tradeCount', label: 'Trades' },
    { key: 'totalBuyValue', label: 'Buy Value' },
    { key: 'totalSellValue', label: 'Sell Value' },
    { key: 'realisedPnL', label: 'P&L' },
    { key: 'allocatedCharges', label: 'Charges' },
    { key: 'netPnL', label: 'Net P&L' },
    { key: 'winRate', label: 'Win Rate' },
  ];

  readonly stockColumns = [
    { key: 'stockName', label: 'Stock' },
    { key: 'tradeCount', label: 'Trades' },
    { key: 'quantity', label: 'Qty' },
    { key: 'buyValue', label: 'Buy Value' },
    { key: 'sellValue', label: 'Sell Value' },
    { key: 'realisedPnL', label: 'P&L' },
    { key: 'realisedPnLPct', label: 'P&L %' },
    { key: 'allocatedCharges', label: 'Charges' },
    { key: 'netPnL', label: 'Net P&L' },
  ];

  readonly chargeColumns = [
    { key: 'label', label: 'Charge Type' },
    { key: 'amount', label: 'Amount' },
  ];

  analysis = computed(() => this.state.analysis());

  activePeriodData = computed(() => {
    const data = this.analysis();
    if (!data) return [];
    switch (this.activeTab()) {
      case 'daily': return data.daily;
      case 'weekly': return data.weekly;
      case 'monthly': return data.monthly;
      default: return [];
    }
  });

  sortedPeriodData = computed(() =>
    this.sortRows(this.activePeriodData(), (row, col) => {
      if (col === 'period') return row.period;
      return row[col as keyof PeriodBucket] as number;
    })
  );

  sortedStockData = computed(() => {
    const stocks = this.analysis()?.stocks ?? [];
    return this.sortRows(stocks, (row, col) => {
      if (col === 'stockName') return row.stockName.toLowerCase();
      return row[col as keyof StockSummary] as number;
    });
  });

  sortedChargeData = computed(() => {
    const items = (this.analysis()?.charges.items ?? []).filter((i) => i.label !== 'Total');
    return this.sortRows(items, (row, col) =>
      col === 'label' ? row.label.toLowerCase() : row.amount
    );
  });

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.state.loadFile(input.files[0]);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.state.loadFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  setTab(tab: TabId): void {
    this.activeTab.set(tab);
    this.expandedPeriod.set(null);
    this.expandedStock.set(null);
    this.resetSortForTab(tab);
  }

  togglePeriodExpand(period: string): void {
    if (this.expandedPeriod() === period) {
      this.expandedPeriod.set(null);
      this.expandedStock.set(null);
    } else {
      this.expandedPeriod.set(period);
      this.expandedStock.set(null);
    }
  }

  toggleStockExpand(accKey: string, event: Event): void {
    event.stopPropagation();
    this.expandedStock.set(this.expandedStock() === accKey ? null : accKey);
  }

  stockAccordionKey(period: string, stockKey: string): string {
    return `${period}::${stockKey}`;
  }

  isPeriodExpanded(period: string): boolean {
    return this.expandedPeriod() === period;
  }

  isStockExpanded(period: string, stockKey: string): boolean {
    return this.expandedStock() === this.stockAccordionKey(period, stockKey);
  }

  toggleSort(column: string, event?: Event): void {
    event?.stopPropagation();
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.sortColumn.set(column);
    this.sortDirection.set(this.defaultSortDirection(column));
  }

  sortIndicator(column: string): string {
    if (this.sortColumn() !== column) return '';
    return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  isSortedColumn(column: string): boolean {
    return this.sortColumn() === column;
  }

  tradeTypeLabel(type: TradeType): string {
    return this.tradeTypeLabels[type] || type;
  }

  private resetSortForTab(tab: TabId): void {
    const defaults: Record<TabId, { column: string; direction: SortDir }> = {
      daily: { column: 'period', direction: 'asc' },
      weekly: { column: 'period', direction: 'asc' },
      monthly: { column: 'period', direction: 'asc' },
      stocks: { column: 'realisedPnL', direction: 'desc' },
      charges: { column: 'amount', direction: 'desc' },
    };
    const { column, direction } = defaults[tab];
    this.sortColumn.set(column);
    this.sortDirection.set(direction);
  }

  private defaultSortDirection(column: string): SortDir {
    if (column === 'period' || column === 'stockName' || column === 'label') return 'asc';
    return 'desc';
  }

  private sortRows<T>(
    rows: T[],
    getValue: (row: T, column: string) => string | number
  ): T[] {
    const column = this.sortColumn();
    if (!column || !rows.length) return rows;
    const direction = this.sortDirection();
    return [...rows].sort((a, b) => {
      const av = getValue(a, column);
      const bv = getValue(b, column);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return direction === 'asc' ? cmp : -cmp;
    });
  }
}
