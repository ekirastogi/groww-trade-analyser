import { Component, signal, computed, inject, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { LazyTradeLoaderService } from '../../services/lazy-trade-loader.service';
import { FilteredStockService } from '../../services/filtered-stock.service';
import { FilterUrlService } from '../../services/filter-url.service';
import { PageShellService } from '../../services/page-shell.service';
import { ClientAccountService, ClientAccount } from '../../services/client-account.service';
import {
  PeriodBucket,
  StockSummary,
  Trade,
  TRADE_TYPE_LABELS,
  TradeType,
} from '../../models/trade.models';
import {
  formatCurrency,
  formatDate,
  formatPct,
  pnlClass,
} from '../../utils/format.utils';
import { groupTradesByStock, StockTradeGroup } from '../../utils/trade.utils';
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
import { TradeTypeFilterComponent } from '../shared/trade-type-filter/trade-type-filter.component';

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
  imports: [CommonModule, FormsModule, RouterLink, TradeTypeFilterComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  readonly state = inject(ReportStateService);
  readonly filteredStocks = inject(FilteredStockService);
  private filterUrl = inject(FilterUrlService);
  private pageShell = inject(PageShellService);
  private clientSvc = inject(ClientAccountService);
  readonly lazyTrades = inject(LazyTradeLoaderService);
  readonly clients = signal<ClientAccount[]>([]);
  readonly tradeTypeLabels = TRADE_TYPE_LABELS;
  readonly formatCurrency = formatCurrency;
  readonly formatPct = formatPct;
  readonly formatDate = formatDate;
  readonly pnlClass = pnlClass;
  readonly groupTradesByStock = groupTradesByStock;

  private readonly _syncPageHeader = effect((onCleanup) => {
    const report = this.state.report();
    if (report) {
      this.pageShell.setHeader('Dashboard', report.summary.period);
    }
    onCleanup(() => this.pageShell.clearOverride());
  }, { allowSignalWrites: true });

  async ngOnInit(): Promise<void> {
    await this.state.ensureLoadedFromFirebase();
    this.clients.set(await this.clientSvc.listClients());
  }

  activeTab = signal<TabId>('stocks');
  sortColumn = signal('realisedPnL');
  sortDirection = signal<SortDir>('desc');
  expandedPeriod = signal<string | null>(null);
  expandedStock = signal<string | null>(null);
  expandedPerStock = signal<string | null>(null);
  stockColumnsPanelOpen = signal(false);
  stockScenarioPanelOpen = signal(false);
  periodColumnsPanelOpen = signal(false);
  stockFilterRules = signal<StockFilterRule[]>([]);
  stockSearchQuery = signal('');
  savedStockScenarios = signal<StockScenario[]>(loadSavedStockScenarios());
  scenarioNameInput = signal('');
  visibleStockColumns = signal<Set<StockColumnKey>>(new Set(DEFAULT_VISIBLE_STOCK_COLUMNS));
  visiblePeriodColumns = signal<Set<PeriodColumnKey>>(new Set(DEFAULT_VISIBLE_PERIOD_COLUMNS));

  readonly stockFilterColumns = STOCK_FILTER_COLUMNS;
  readonly exampleStockScenarios = EXAMPLE_STOCK_SCENARIOS;

  readonly periodColumns: { key: PeriodColumnKey; label: string }[] = [
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

  visibleTradeDetailColumns = computed(() =>
    this.visibleStockColumnList().filter((col) => col.key !== 'stockName')
  );

  chargeRatio = computed(() => this.analysis()?.summary.chargeRatio ?? 0);

  visiblePeriodColumnList = computed(() =>
    this.periodColumns.filter((col) => this.visiblePeriodColumns().has(col.key))
  );

  analysis = computed(() => this.state.analysis());

  stockDayWinRateSummary = computed(() => {
    const trades = this.analysis()?.filteredTrades ?? [];
    const stockDayNetPnL = new Map<string, number>();

    for (const trade of trades) {
      const stockKey = trade.isin || trade.stockName;
      const key = `${trade.sellDate}::${stockKey}`;
      stockDayNetPnL.set(key, (stockDayNetPnL.get(key) ?? 0) + trade.realisedPnL);
    }

    let winning = 0;
    let losing = 0;
    let flat = 0;
    for (const netPnL of stockDayNetPnL.values()) {
      if (netPnL > 0) winning++;
      else if (netPnL < 0) losing++;
      else flat++;
    }

    const total = stockDayNetPnL.size;
    return {
      total,
      winning,
      losing,
      flat,
      rate: total ? (winning / total) * 100 : 0,
    };
  });

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
    const stocks = this.filteredStocks.stocks();
    const filtered = filterStocksByRules(stocks, this.stockFilterRules());
    const searched = filtered.filter((stock) => this.matchesStockSearch(stock, this.stockSearchQuery()));
    return this.sortRows(searched, (row, col) => {
      if (col === 'stockName') return row.stockName.toLowerCase();
      return row[col as keyof StockSummary] as number;
    });
  });

  hasStockSearch = computed(() => this.stockSearchQuery().trim().length > 0);

  stockScenarioStats = computed(() => {
    const stocks = this.filteredStocks.stocks();
    const afterRules = filterStocksByRules(stocks, this.stockFilterRules());
    const shown = afterRules.filter((stock) => this.matchesStockSearch(stock, this.stockSearchQuery())).length;
    return { total: stocks.length, shown };
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

  async loadClient(clientCode: string): Promise<void> {
    await this.state.loadFromClient(clientCode);
    this.clients.set(await this.clientSvc.listClients());
  }

  onDateFilterChange(which: 'start' | 'end', value: string): void {
    const report = this.state.report();
    if (!report) return;
    const start = which === 'start' ? value : this.state.startDate();
    const end = which === 'end' ? value : this.state.endDate();
    this.filterUrl.updateDateRange(start, end, this.state.selectedTradeTypes());
  }

  resetDateFilters(): void {
    this.filterUrl.resetFilters();
  }

  setTab(tab: TabId): void {
    this.activeTab.set(tab);
    this.expandedPeriod.set(null);
    this.expandedStock.set(null);
    this.expandedPerStock.set(null);
    this.lazyTrades.clear();
    this.resetSortForTab(tab);
  }

  togglePeriodExpand(period: string): void {
    if (this.expandedPeriod() === period) {
      this.expandedPeriod.set(null);
      this.expandedStock.set(null);
      return;
    }
    this.expandedPeriod.set(period);
    this.expandedStock.set(null);
    void this.ensurePeriodTradesLoaded(period);
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

  stockRowKey(stock: StockSummary): string {
    return stock.isin || stock.stockName;
  }

  togglePerStockExpand(stock: StockSummary): void {
    const key = this.stockRowKey(stock);
    const expanding = this.expandedPerStock() !== key;
    this.expandedPerStock.set(expanding ? key : null);
    if (expanding) void this.ensureStockTradesLoaded(stock);
  }

  isPerStockExpanded(stock: StockSummary): boolean {
    return this.expandedPerStock() === this.stockRowKey(stock);
  }

  tradesForStock(stock: StockSummary): Trade[] {
    return this.lazyTrades.tradesForKey(this.lazyTrades.cacheKeyForStock(stock));
  }

  isStockTradesLoading(stock: StockSummary): boolean {
    return this.lazyTrades.isLoading(this.lazyTrades.cacheKeyForStock(stock));
  }

  periodTrades(period: string): Trade[] {
    const tab = this.activeTab();
    if (tab !== 'daily' && tab !== 'weekly' && tab !== 'monthly') return [];
    return this.lazyTrades.tradesForKey(`period:${tab}:${period}`);
  }

  periodStockGroups(period: string) {
    const loaded = this.periodTrades(period);
    if (loaded.length) return this.groupTradesByStock(loaded);
    const row = this.activePeriodData().find((item) => item.period === period);
    return row ? this.groupTradesByStock(row.trades) : [];
  }

  isPeriodTradesLoading(period: string): boolean {
    const tab = this.activeTab();
    if (tab !== 'daily' && tab !== 'weekly' && tab !== 'monthly') return false;
    return this.lazyTrades.isLoading(`period:${tab}:${period}`);
  }

  periodTradeCount(period: string): number {
    const loaded = this.periodTrades(period);
    if (loaded.length) return loaded.length;
    return this.activePeriodData().find((item) => item.period === period)?.tradeCount ?? 0;
  }

  tradeDetailColumnLabel(key: StockColumnKey): string {
    if (key === 'tradeCount') return 'Type';
    return this.stockColumns.find((col) => col.key === key)?.label ?? key;
  }

  tradeAllocatedCharge(trade: Trade): number {
    return trade.allocatedCharges ?? trade.sellValue * this.chargeRatio();
  }

  tradeNetPnL(trade: Trade): number {
    return trade.netPnL ?? trade.realisedPnL - this.tradeAllocatedCharge(trade);
  }

  groupNetPnL(group: StockTradeGroup): number {
    return group.trades.reduce((sum, trade) => sum + this.tradeNetPnL(trade), 0);
  }

  tradeRealisedPnLPct(trade: Trade): number {
    return trade.buyValue > 0 ? trade.realisedPnL / trade.buyValue : 0;
  }

  tradeDetailCellClass(key: StockColumnKey, trade: Trade): string {
    const base = 'text-right tabular-nums';
    switch (key) {
      case 'realisedPnL':
      case 'realisedPnLPct':
        return `${base} ${this.pnlClass(trade.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} font-semibold ${this.pnlClass(this.tradeNetPnL(trade))}`;
      default:
        return base;
    }
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
    if (key === 'period') return 'col-name';
    const base = 'text-right tabular-nums';
    switch (key) {
      case 'realisedPnL':
        return `${base} ${this.pnlClass(row.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} font-semibold ${this.pnlClass(row.netPnL)}`;
      default:
        return base;
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

  stockColumnResponsiveClass(key: StockColumnKey): string {
    if (key === 'stockName' || key === 'netPnL') return '';
    if (key === 'tradeCount' || key === 'realisedPnL') return 'hidden sm:table-cell';
    return 'hidden lg:table-cell';
  }

  periodColumnResponsiveClass(key: PeriodColumnKey): string {
    if (key === 'period' || key === 'netPnL') return '';
    if (key === 'tradeCount' || key === 'realisedPnL' || key === 'winRate') return 'hidden sm:table-cell';
    return 'hidden md:table-cell';
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

  private clientCode(): string | null {
    return this.state.activeClientCode() ?? this.state.report()?.summary.clientCode ?? null;
  }

  private matchesStockSearch(stock: StockSummary, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [stock.stockName, stock.isin, stock.symbol]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  }

  clearStockSearch(): void {
    this.stockSearchQuery.set('');
  }

  private async ensureStockTradesLoaded(stock: StockSummary): Promise<void> {
    const clientCode = this.clientCode();
    if (!clientCode) return;
    await this.lazyTrades.loadForStock(
      clientCode,
      stock,
      this.state.report(),
      this.state.analysisOptions()
    );
  }

  private async ensurePeriodTradesLoaded(period: string): Promise<void> {
    const clientCode = this.clientCode();
    const tab = this.activeTab();
    if (!clientCode || (tab !== 'daily' && tab !== 'weekly' && tab !== 'monthly')) return;
    await this.lazyTrades.loadForPeriod(
      clientCode,
      period,
      tab,
      this.state.report(),
      this.state.analysisOptions()
    );
  }

  private resetSortForTab(tab: TabId): void {
    const defaults: Record<TabId, { column: string; direction: SortDir }> = {
      daily: { column: 'period', direction: 'desc' },
      weekly: { column: 'period', direction: 'desc' },
      monthly: { column: 'period', direction: 'desc' },
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
    if (column === 'stockName' || column === 'label') return 'asc';
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
