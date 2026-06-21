import { Component, signal, computed, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import {
  StockFilterColumn,
  StockFilterRule,
  StockScenario,
  STOCK_FILTER_COLUMNS,
  EXAMPLE_STOCK_SCENARIOS,
  createStockFilterRule,
  defaultOperatorForColumn,
  filterStocksByRules,
  loadSavedStockScenarios,
  operatorsForColumn,
  persistStockScenarios,
} from '../../utils/stock-scenario.utils';
import { FilterPanelComponent } from '../shared/filter-panel/filter-panel.component';
import { ReportHistoryComponent } from '../shared/report-history/report-history.component';
import { ChartCardComponent } from '../shared/chart-card/chart-card.component';
import {
  abbreviateLabel,
  sparklineChartOptions,
  CHART_COLORS,
  isMobileChart,
  withDecimation,
  buildPnLBarDataset,
} from '../../utils/chart-theme';

type PeriodColumnKey = 'period' | 'tradeCount' | 'totalBuyValue' | 'totalSellValue' | 'realisedPnL' | 'allocatedCharges' | 'netPnL' | 'winRate';

const DEFAULT_VISIBLE_PERIOD_COLUMNS: PeriodColumnKey[] = [
  'period', 'tradeCount', 'realisedPnL', 'allocatedCharges', 'netPnL', 'winRate',
];
type SortDir = 'asc' | 'desc';
type TabId = 'daily' | 'weekly' | 'monthly' | 'stocks';
type StockColumnKey =
  | 'stockName'
  | 'tradeCount'
  | 'quantity'
  | 'buyValue'
  | 'sellValue'
  | 'realisedPnL'
  | 'realisedPnLPct'
  | 'allocatedCharges'
  | 'netPnL';

const DEFAULT_VISIBLE_STOCK_COLUMNS: StockColumnKey[] = [
  'stockName',
  'tradeCount',
  'quantity',
  'realisedPnL',
  'allocatedCharges',
  'netPnL',
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, FilterPanelComponent, ReportHistoryComponent, ChartCardComponent],
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

  activeTab = signal<TabId>('stocks');
  dragOver = signal(false);
  sortColumn = signal('realisedPnL');
  sortDirection = signal<SortDir>('desc');
  expandedPeriod = signal<string | null>(null);
  expandedStock = signal<string | null>(null);
  stockColumnsPanelOpen = signal(false);
  stockScenarioPanelOpen = signal(false);
  periodColumnsPanelOpen = signal(false);
  stockFilterRules = signal<StockFilterRule[]>([]);
  savedStockScenarios = signal<StockScenario[]>(loadSavedStockScenarios());
  scenarioNameInput = signal('');
  visibleStockColumns = signal<Set<StockColumnKey>>(new Set(DEFAULT_VISIBLE_STOCK_COLUMNS));
  visiblePeriodColumns = signal<Set<PeriodColumnKey>>(new Set(DEFAULT_VISIBLE_PERIOD_COLUMNS));
  private chartVersion = signal(0);

  readonly stockFilterColumns = STOCK_FILTER_COLUMNS;
  readonly exampleStockScenarios = EXAMPLE_STOCK_SCENARIOS;

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

  readonly stockColumns: { key: StockColumnKey; label: string; required?: boolean }[] = [
    { key: 'stockName', label: 'Stock', required: true },
    { key: 'tradeCount', label: 'Trades' },
    { key: 'quantity', label: 'Qty' },
    { key: 'buyValue', label: 'Buy Value' },
    { key: 'sellValue', label: 'Sell Value' },
    { key: 'realisedPnL', label: 'P&L' },
    { key: 'realisedPnLPct', label: 'P&L %' },
    { key: 'allocatedCharges', label: 'Charges' },
    { key: 'netPnL', label: 'Net P&L' },
  ];

  readonly stockSortOptions: { key: StockColumnKey; label: string }[] = [
    { key: 'netPnL', label: 'Net P&L' },
    { key: 'realisedPnL', label: 'P&L' },
    { key: 'stockName', label: 'Stock name' },
    { key: 'tradeCount', label: 'Trades' },
    { key: 'quantity', label: 'Qty' },
    { key: 'allocatedCharges', label: 'Charges' },
  ];

  visibleStockColumnList = computed(() =>
    this.stockColumns.filter((col) => this.visibleStockColumns().has(col.key))
  );

  visiblePeriodColumnList = computed(() =>
    this.periodColumns.filter((col) => this.visiblePeriodColumns().has(col.key as PeriodColumnKey))
  );

  topStats = computed(() => {
    const report = this.state.report();
    const summary = this.analysis()?.summary;
    if (!report) return [];
    return [
      { label: 'Client', value: report.summary.clientName, cls: 'text-slate-900' },
      { label: 'Trades', value: String(report.trades.length), cls: 'text-slate-900' },
      { label: 'Stocks', value: String(report.stockSummary.length), cls: 'text-slate-900' },
      {
        label: 'Win Rate',
        value: summary ? `${summary.winRate.toFixed(1)}%` : '—',
        cls: 'text-slate-900',
        sub: summary ? `${summary.winningTrades}W / ${summary.losingTrades}L` : undefined,
      },
    ];
  });

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

  periodChartData = computed(() =>
    [...this.activePeriodData()].sort((a, b) => a.period.localeCompare(b.period))
  );

  periodChartConfig = computed(() => {
    this.chartVersion();
    const tab = this.activeTab();
    if (tab !== 'daily' && tab !== 'weekly' && tab !== 'monthly') return null;

    const periods = this.periodChartData();
    if (!periods.length) return null;

    const mobile = isMobileChart();
    const netValues = periods.map((d) => d.netPnL);
    const overallPositive = netValues.reduce((s, v) => s + v, 0) >= 0;
    const lineColor = overallPositive ? CHART_COLORS.success : CHART_COLORS.danger;
    const fillColor = overallPositive ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)';

    const formatLabel = (label: string): string => {
      if (tab === 'monthly') {
        // "Jun 2025" → "Jun '25"
        const parts = label.split(' ');
        return parts.length >= 2 ? `${parts[0]} '${parts[1].slice(2)}` : label;
      }
      if (tab === 'weekly') {
        // "02–08 Jun 2025" → take the month part e.g. "Jun"
        const m = label.match(/([A-Za-z]+)/);
        return m ? m[1] : label.slice(0, 6);
      }
      // daily: "02 Jun 2025" → "02 Jun"
      const parts = label.split(' ');
      return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : label;
    };

    return withDecimation({
      type: 'line',
      data: {
        labels: periods.map((d) => formatLabel(d.label)),
        datasets: [
          {
            label: 'Net P&L',
            data: netValues,
            borderColor: lineColor,
            backgroundColor: fillColor,
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: sparklineChartOptions(),
    });
  });

  sortedStockData = computed(() => {
    const stocks = filterStocksByRules(this.analysis()?.stocks ?? [], this.stockFilterRules());
    return this.sortRows(stocks, (row, col) => {
      if (col === 'stockName') return row.stockName.toLowerCase();
      return row[col as keyof StockSummary] as number;
    });
  });

  stockScenarioStats = computed(() => {
    const total = this.analysis()?.stocks.length ?? 0;
    const shown = this.sortedStockData().length;
    return { total, shown };
  });

  stockTableTotals = computed(() => {
    const stocks = this.sortedStockData();
    if (!stocks.length) return null;

    const sum = (pick: (s: StockSummary) => number) =>
      stocks.reduce((acc, stock) => acc + pick(stock), 0);

    const buyValue = sum((s) => s.buyValue);
    const realisedPnL = sum((s) => s.realisedPnL);

    return {
      stockCount: stocks.length,
      tradeCount: sum((s) => s.tradeCount),
      quantity: sum((s) => s.quantity),
      buyValue,
      sellValue: sum((s) => s.sellValue),
      realisedPnL,
      realisedPnLPct: buyValue > 0 ? realisedPnL / buyValue : 0,
      allocatedCharges: sum((s) => s.allocatedCharges),
      netPnL: sum((s) => s.netPnL),
    };
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

  openRecentUploads(): void {
    this.state.clear();
  }

  setTab(tab: TabId): void {
    this.activeTab.set(tab);
    this.expandedPeriod.set(null);
    this.expandedStock.set(null);
    this.resetSortForTab(tab);
    this.chartVersion.update((v) => v + 1);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.chartVersion.update((v) => v + 1);
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

  toggleStockColumnsPanel(): void {
    this.stockColumnsPanelOpen.update((open) => !open);
    if (this.stockColumnsPanelOpen()) this.periodColumnsPanelOpen.set(false);
  }

  togglePeriodColumnsPanel(): void {
    this.periodColumnsPanelOpen.update((open) => !open);
  }

  isPeriodColumnVisible(key: string): boolean {
    return this.visiblePeriodColumns().has(key as PeriodColumnKey);
  }

  togglePeriodColumn(key: string): void {
    if (key === 'period') return;
    const k = key as PeriodColumnKey;
    this.visiblePeriodColumns.update((current) => {
      const next = new Set(current);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  periodCellClass(key: string, row: PeriodBucket): string {
    switch (key) {
      case 'realisedPnL': return this.pnlClass(row.realisedPnL);
      case 'netPnL': return this.pnlClass(row.netPnL);
      default: return '';
    }
  }

  toggleStockScenarioPanel(): void {
    this.stockScenarioPanelOpen.update((open) => !open);
  }

  stockRuleOperators(column: StockFilterColumn) {
    return operatorsForColumn(column);
  }

  stockRulePlaceholder(column: StockFilterColumn): string {
    if (column === 'stockName') return 'e.g. RELIANCE';
    if (column === 'realisedPnLPct') return 'e.g. 5 for 5%';
    return 'e.g. 0';
  }

  addStockFilterRule(): void {
    this.stockFilterRules.update((rules) => [...rules, createStockFilterRule()]);
  }

  removeStockFilterRule(id: string): void {
    this.stockFilterRules.update((rules) => rules.filter((rule) => rule.id !== id));
  }

  updateStockFilterRule(id: string, patch: Partial<Pick<StockFilterRule, 'column' | 'operator' | 'value'>>): void {
    this.stockFilterRules.update((rules) =>
      rules.map((rule) => {
        if (rule.id !== id) return rule;
        const next = { ...rule, ...patch };
        if (patch.column && patch.column !== rule.column) {
          next.operator = defaultOperatorForColumn(patch.column);
          if (patch.column === 'stockName') next.value = '';
        }
        return next;
      })
    );
  }

  clearStockFilterRules(): void {
    this.stockFilterRules.set([]);
    this.scenarioNameInput.set('');
  }

  loadExampleStockScenario(index: number): void {
    const example = this.exampleStockScenarios[index];
    if (!example) return;
    this.stockFilterRules.set(example.rules.map((rule) => createStockFilterRule(rule)));
    this.scenarioNameInput.set(example.name);
  }

  saveStockScenario(): void {
    const name = this.scenarioNameInput().trim();
    if (!name || !this.stockFilterRules().length) return;
    const scenario: StockScenario = {
      id: createStockFilterRule().id,
      name,
      rules: this.stockFilterRules().map((rule) => ({ ...rule })),
      createdAt: Date.now(),
    };
    this.savedStockScenarios.update((scenarios) => {
      const withoutDuplicate = scenarios.filter(
        (item) => item.name.toLowerCase() !== name.toLowerCase()
      );
      const next = [scenario, ...withoutDuplicate].slice(0, 10);
      persistStockScenarios(next);
      return next;
    });
  }

  loadSavedStockScenario(id: string): void {
    const scenario = this.savedStockScenarios().find((item) => item.id === id);
    if (!scenario) return;
    this.stockFilterRules.set(scenario.rules.map((rule) => createStockFilterRule(rule)));
    this.scenarioNameInput.set(scenario.name);
  }

  deleteSavedStockScenario(id: string): void {
    this.savedStockScenarios.update((scenarios) => {
      const next = scenarios.filter((item) => item.id !== id);
      persistStockScenarios(next);
      return next;
    });
  }

  hasActiveStockScenario(): boolean {
    return this.stockFilterRules().some((rule) => rule.value.trim() !== '');
  }

  setStockSortColumn(column: StockColumnKey): void {
    this.sortColumn.set(column);
    this.sortDirection.set(this.defaultSortDirection(column));
  }

  toggleStockSortDirection(): void {
    this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
  }

  isStockColumnVisible(key: StockColumnKey): boolean {
    return this.visibleStockColumns().has(key);
  }

  isStockColumnRequired(key: StockColumnKey): boolean {
    return this.stockColumns.find((col) => col.key === key)?.required ?? false;
  }

  toggleStockColumn(key: StockColumnKey): void {
    if (this.isStockColumnRequired(key)) return;
    this.visibleStockColumns.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size <= 1) return current;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  stockColumnCellClass(key: StockColumnKey, stock: StockSummary): string {
    const base = 'text-right tabular-nums';
    switch (key) {
      case 'realisedPnL':
      case 'realisedPnLPct':
        return `${base} ${this.pnlClass(stock.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} font-semibold ${this.pnlClass(stock.netPnL)}`;
      default:
        return base;
    }
  }

  stockTotalsCellClass(key: StockColumnKey, totals: NonNullable<ReturnType<typeof this.stockTableTotals>>): string {
    const base = 'text-right tabular-nums font-semibold';
    switch (key) {
      case 'realisedPnL':
      case 'realisedPnLPct':
        return `${base} ${this.pnlClass(totals.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} ${this.pnlClass(totals.netPnL)}`;
      default:
        return base;
    }
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
    };
    const { column, direction } = defaults[tab];
    this.sortColumn.set(column);
    this.sortDirection.set(direction);
    if (tab === 'stocks') {
      this.stockFilterRules.set([]);
      this.scenarioNameInput.set('');
    }
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
