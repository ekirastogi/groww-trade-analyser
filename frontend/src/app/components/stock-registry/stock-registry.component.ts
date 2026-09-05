import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RegistryStockService } from '../../services/registry-stock.service';
import { StockLabelsStore } from '../../services/stock-labels.store';
import { ScreenerService, ScreenerSnapshot } from '../../services/screener.service';
import { RegistryLabel, RegistryStock } from '../../models/trading-journal.models';
import { StockLabelsManagerComponent } from '../stock-labels/stock-labels-manager.component';
import {
  LabelFilterOption,
  LabelFilterSelectComponent,
} from '../stock-labels/label-filter-select.component';
import { formatCurrency } from '../../utils/format.utils';
import { formatDataAge } from '../../utils/data-age.utils';
import { TableSortState } from '../../utils/table-sort.utils';
import { ScreenerFundamentalsComponent } from '../screener-fundamentals/screener-fundamentals.component';

type RegistryColumnKey =
  | 'symbol'
  | 'name'
  | 'currentPrice'
  | 'marketCap'
  | 'pe'
  | 'salesGrowth3y'
  | 'profitGrowth3y'
  | 'stockCagr3y'
  | 'promoterHolding'
  | 'fiiHolding'
  | 'screenerFetchedAt'
  | 'updatedAt';

@Component({
  selector: 'app-stock-registry',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ScreenerFundamentalsComponent,
    StockLabelsManagerComponent,
    LabelFilterSelectComponent,
  ],
  templateUrl: './stock-registry.component.html',
})
export class StockRegistryComponent implements OnInit {
  private registrySvc = inject(RegistryStockService);
  private labelStore = inject(StockLabelsStore);
  private screener = inject(ScreenerService);

  stocks = signal<RegistryStock[]>([]);
  activeLabelIds = signal<string[]>([]);
  showScreenerPanel = signal(false);
  showLabelPanel = signal(false);
  stockCount = signal(0);
  loading = signal(false);
  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;
  formatDataAge = formatDataAge;

  showAddForm = signal(false);
  searchQuery = signal('');
  pageSize = signal(25);
  currentPage = signal(1);

  editingSymbol = signal<string | null>(null);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  busy = signal(false);
  screenerRefreshBusy = signal(false);
  screenerRefreshDone = signal(0);
  screenerRefreshTotal = signal(0);
  fetchingSymbol = signal<string | null>(null);
  expandedSymbol = signal<string | null>(null);
  symbolQuery = signal('');
  screenerSearchSymbol = signal('');
  previewStock = signal<RegistryStock | null>(null);

  /**
   * Only the columns worth scanning at a glance; `responsive` drops the softer metrics on
   * narrow screens so the table never needs sideways scrolling. Secondary fields live in
   * the expanded row. Keep these classes in sync with the matching cells in the template.
   */
  readonly columns: {
    key: RegistryColumnKey;
    label: string;
    align?: 'left' | 'right';
    responsive?: string;
  }[] = [
    { key: 'symbol', label: 'Stock' },
    { key: 'currentPrice', label: 'CMP', align: 'right' },
    { key: 'marketCap', label: 'Mkt cap', align: 'right', responsive: 'hidden sm:table-cell' },
    { key: 'pe', label: 'P/E', align: 'right', responsive: 'hidden sm:table-cell' },
    { key: 'salesGrowth3y', label: 'Sales 3Y', align: 'right', responsive: 'hidden lg:table-cell' },
    { key: 'profitGrowth3y', label: 'Profit 3Y', align: 'right', responsive: 'hidden lg:table-cell' },
    { key: 'stockCagr3y', label: 'CAGR 3Y', align: 'right', responsive: 'hidden xl:table-cell' },
    { key: 'screenerFetchedAt', label: 'Screener', align: 'right', responsive: 'hidden md:table-cell' },
  ];

  readonly pageSizeOptions = [10, 25, 50, 100];

  form = {
    symbol: '',
    name: '',
    currentPrice: '',
    marketCap: '',
    pe: '',
    rsi: '',
    macd: '',
    macdHist: '',
    macdSignal: '',
    sma20: '',
    sma50: '',
    support1: '',
    support2: '',
    support3: '',
    resistance1: '',
    resistance2: '',
    resistance3: '',
    notes: '',
  };

  symbolOptions = computed(() => {
    const q = this.symbolQuery().trim().toLowerCase();
    const rows = this.stocks();
    if (!q) return rows.slice(0, 30);
    return rows
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  });

  filteredStocks = computed(() => {
    this.tableSort.column();
    this.tableSort.direction();

    const q = this.searchQuery().trim().toLowerCase();
    const labelIds = this.activeLabelIds();
    const assigned = this.labelStore.assignments();
    let rows = this.stocks();
    if (labelIds.length) {
      rows = rows.filter((s) => {
        const ids = assigned.get(s.symbol) ?? [];
        return labelIds.some((id) => ids.includes(id));
      });
    }
    if (q) {
      rows = rows.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name ?? '').toLowerCase().includes(q)
      );
    }
    return this.tableSort.sort(rows, (stock, col) => this.sortValue(stock, col));
  });

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredStocks().length / this.pageSize()))
  );

  paginatedStocks = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.filteredStocks().slice(start, start + this.pageSize());
  });

  pageSummary = computed(() => {
    const total = this.filteredStocks().length;
    if (!total) return 'No stocks';
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize() + 1;
    const end = Math.min(page * this.pageSize(), total);
    return `Showing ${start}–${end} of ${total}`;
  });

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [stocks, stockCount] = await Promise.all([
        this.registrySvc.listAll(),
        this.registrySvc.count(),
        this.labelStore.reload(),
      ]);

      const deduped = await this.registrySvc.dedupeByIsin();
      const finalStocks = deduped > 0 ? await this.registrySvc.listAll() : stocks;
      const finalCount = deduped > 0 ? await this.registrySvc.count() : stockCount;

      this.stocks.set(finalStocks);
      this.stockCount.set(finalCount);
      const known = new Set(this.labelStore.labels().map((l) => l.id));
      this.activeLabelIds.update((ids) => ids.filter((id) => known.has(id)));
      this.currentPage.set(1);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load registry');
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  setLabelFilter(ids: string[]): void {
    this.activeLabelIds.set(ids);
    this.currentPage.set(1);
  }

  labelFilterOptions = computed<LabelFilterOption[]>(() =>
    this.labelStore.labels().map((label) => ({
      id: label.id,
      name: label.name,
      count: this.labelStore.countFor(label.id),
    }))
  );

  labelIdsFor(symbol: string): string[] {
    return this.labelStore.labelIdsFor(symbol);
  }

  rowLabels(symbol: string): RegistryLabel[] {
    const ids = new Set(this.labelStore.labelIdsFor(symbol));
    return this.labelStore.labels().filter((label) => ids.has(label.id));
  }

  onPageSizeChange(value: string): void {
    const size = parseInt(value, 10);
    if (!Number.isFinite(size) || size < 1) return;
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  goToPage(page: number): void {
    const next = Math.max(1, Math.min(page, this.totalPages()));
    this.currentPage.set(next);
  }

  openAddForm(): void {
    this.resetForm();
    this.showAddForm.set(true);
    this.error.set(null);
    this.success.set(null);
  }

  closeAddForm(): void {
    this.showAddForm.set(false);
    this.resetForm();
  }

  formatPrice(price: number | undefined): string {
    if (price == null || price === 0) return '—';
    return this.fmt(price);
  }

  private sortValue(stock: RegistryStock, col: string): string | number {
    switch (col) {
      case 'symbol':
        return stock.symbol;
      case 'name':
        return stock.name;
      case 'currentPrice':
        return stock.currentPrice ?? 0;
      case 'marketCap':
        return stock.marketCap ?? 0;
      case 'pe':
        return stock.pe ?? 0;
      case 'salesGrowth3y':
        return stock.salesGrowth3y ?? 0;
      case 'profitGrowth3y':
        return stock.profitGrowth3y ?? 0;
      case 'stockCagr3y':
        return stock.stockCagr3y ?? 0;
      case 'promoterHolding':
        return stock.promoterHolding ?? 0;
      case 'fiiHolding':
        return stock.fiiHolding ?? 0;
      case 'screenerFetchedAt':
        return stock.screenerFetchedAt ?? 0;
      case 'updatedAt':
        return stock.updatedAt ?? 0;
      default:
        return stock.symbol;
    }
  }

  formatUpdated(ts: number | undefined): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatPct(value: number | undefined): string {
    if (value == null || Number.isNaN(value)) return '—';
    return `${value}%`;
  }

  /** Screener reports market cap in crores; shorten it so the column stays narrow. */
  formatMktCap(value: number | undefined): string {
    if (value == null || value === 0) return '—';
    if (value >= 100000) return `${(value / 100000).toFixed(2)}L Cr`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K Cr`;
    return `${Math.round(value)} Cr`;
  }

  isUp(value: number | undefined): boolean {
    return value != null && value > 0;
  }

  isDown(value: number | undefined): boolean {
    return value != null && value < 0;
  }

  screenerRefreshLabel = computed(() => {
    if (!this.screenerRefreshBusy()) return 'Refresh from Screener';
    const total = this.screenerRefreshTotal();
    return total ? `Refreshing ${this.screenerRefreshDone() + 1}/${total}…` : 'Refreshing…';
  });

  toggleDetails(symbol: string): void {
    this.expandedSymbol.set(this.expandedSymbol() === symbol ? null : symbol);
  }

  private applyScreener(stock: RegistryStock, data: ScreenerSnapshot): RegistryStock {
    return {
      ...stock,
      name: data.name || stock.name,
      currentPrice: data.currentPrice ?? stock.currentPrice,
      marketCap: data.marketCap ?? stock.marketCap,
      pe: data.pe ?? stock.pe,
      bookValue: data.bookValue,
      dividendYield: data.dividendYield,
      roce: data.roce,
      roe: data.roe,
      faceValue: data.faceValue,
      highLow: data.highLow,
      salesGrowth3y: data.salesGrowth3y,
      salesGrowth5y: data.salesGrowth5y,
      salesGrowth10y: data.salesGrowth10y,
      salesGrowthTtm: data.salesGrowthTtm,
      profitGrowth3y: data.profitGrowth3y,
      profitGrowth5y: data.profitGrowth5y,
      profitGrowth10y: data.profitGrowth10y,
      profitGrowthTtm: data.profitGrowthTtm,
      stockCagr1y: data.stockCagr1y,
      stockCagr3y: data.stockCagr3y,
      stockCagr5y: data.stockCagr5y,
      stockCagr10y: data.stockCagr10y,
      promoterHolding: data.promoterHolding,
      fiiHolding: data.fiiHolding,
      diiHolding: data.diiHolding,
      publicHolding: data.publicHolding,
      governmentHolding: data.governmentHolding,
      otherHolding: data.otherHolding,
      quarterlyResults: data.quarterlyResults,
      profitLoss: data.profitLoss,
      balanceSheet: data.balanceSheet,
      cashFlow: data.cashFlow,
      shareholding: data.shareholding,
      screenerUrl: data.url,
      screenerFetchedAt: data.fetchedAt,
    };
  }

  private snapshotToRegistry(data: ScreenerSnapshot, existing?: RegistryStock | null): RegistryStock {
    const base: RegistryStock = existing ?? {
      symbol: data.symbol,
      name: data.name,
      currentPrice: 0,
      supports: [],
      resistances: [],
      updatedAt: Date.now(),
    };
    return this.applyScreener(base, data);
  }

  async searchAndFetchScreener(): Promise<void> {
    const symbol = this.screenerSearchSymbol().trim().toUpperCase();
    if (!symbol) {
      this.error.set('Enter a symbol to fetch from Screener');
      return;
    }
    this.error.set(null);
    this.success.set(null);
    this.fetchingSymbol.set(symbol);
    try {
      const existing = await this.registrySvc.getBySymbol(symbol);
      const data = await this.screener.fetchStock(symbol, existing?.name);
      this.previewStock.set(this.snapshotToRegistry(data, existing));
      this.success.set(`Fetched Screener data for ${symbol}.`);
    } catch (e) {
      this.previewStock.set(null);
      this.error.set(e instanceof Error ? e.message : 'Screener fetch failed');
    } finally {
      this.fetchingSymbol.set(null);
    }
  }

  async savePreviewToRegistry(): Promise<void> {
    const preview = this.previewStock();
    if (!preview) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.registrySvc.save(preview);
      this.success.set(`Saved ${preview.symbol} to registry.`);
      this.previewStock.set(null);
      this.screenerSearchSymbol.set('');
      await this.reload();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async fetchScreenerForEdit(): Promise<void> {
    const symbol = this.editingSymbol();
    if (!symbol) return;
    const stock = this.stocks().find((s) => s.symbol === symbol);
    if (!stock) {
      this.error.set('Save the stock first, then fetch Screener data.');
      return;
    }
    await this.fetchScreener(stock);
  }

  async fetchScreener(stock: RegistryStock): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    this.fetchingSymbol.set(stock.symbol);
    try {
      const data = await this.screener.fetchStock(stock.symbol, stock.name);
      await this.registrySvc.save(this.applyScreener(stock, data));
      this.success.set(`Fetched Screener data for ${stock.symbol}.`);
      this.expandedSymbol.set(stock.symbol);
      await this.reload();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Screener fetch failed');
    } finally {
      this.fetchingSymbol.set(null);
    }
  }

  resetForm(): void {
    this.editingSymbol.set(null);
    this.symbolQuery.set('');
    this.form = {
      symbol: '', name: '', currentPrice: '', marketCap: '', pe: '', rsi: '',
      macd: '', macdHist: '', macdSignal: '', sma20: '', sma50: '',
      support1: '', support2: '', support3: '',
      resistance1: '', resistance2: '', resistance3: '',
      notes: '',
    };
  }

  onSymbolQuery(value: string): void {
    this.symbolQuery.set(value);
    this.form.symbol = value.toUpperCase();
    const match = this.stocks().find((s) => s.symbol === this.form.symbol);
    if (match?.name) {
      this.form.name = match.name;
    }
  }

  edit(stock: RegistryStock): void {
    this.showAddForm.set(true);
    this.editingSymbol.set(stock.symbol);
    this.form.symbol = stock.symbol;
    this.symbolQuery.set(stock.symbol);
    this.form.name = stock.name;
    this.form.currentPrice =
      stock.currentPrice != null && stock.currentPrice > 0 ? String(stock.currentPrice) : '';
    this.form.marketCap = stock.marketCap != null ? String(stock.marketCap) : '';
    this.form.pe = stock.pe != null ? String(stock.pe) : '';
    this.form.rsi = stock.rsi != null ? String(stock.rsi) : '';
    this.form.macd = stock.macd != null ? String(stock.macd) : '';
    this.form.macdHist = stock.macdHist != null ? String(stock.macdHist) : '';
    this.form.macdSignal = stock.macdSignal != null ? String(stock.macdSignal) : '';
    this.form.sma20 = stock.sma20 != null ? String(stock.sma20) : '';
    this.form.sma50 = stock.sma50 != null ? String(stock.sma50) : '';
    this.form.support1 = stock.supports[0] != null ? String(stock.supports[0]) : '';
    this.form.support2 = stock.supports[1] != null ? String(stock.supports[1]) : '';
    this.form.support3 = stock.supports[2] != null ? String(stock.supports[2]) : '';
    this.form.resistance1 = stock.resistances[0] != null ? String(stock.resistances[0]) : '';
    this.form.resistance2 = stock.resistances[1] != null ? String(stock.resistances[1]) : '';
    this.form.resistance3 = stock.resistances[2] != null ? String(stock.resistances[2]) : '';
    this.form.notes = stock.notes ?? '';
    this.error.set(null);
    this.success.set(null);
  }

  private num(v: string): number | undefined {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async save(): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    if (!this.form.symbol.trim()) {
      this.error.set('Symbol is required');
      return;
    }
    this.busy.set(true);
    try {
      const supports = [this.form.support1, this.form.support2, this.form.support3]
        .map((v) => this.num(v))
        .filter((v): v is number => v != null);
      const resistances = [this.form.resistance1, this.form.resistance2, this.form.resistance3]
        .map((v) => this.num(v))
        .filter((v): v is number => v != null);

      await this.registrySvc.save({
        symbol: this.form.symbol,
        name: this.form.name,
        currentPrice: this.num(this.form.currentPrice) ?? 0,
        marketCap: this.num(this.form.marketCap),
        pe: this.num(this.form.pe),
        rsi: this.num(this.form.rsi),
        macd: this.num(this.form.macd),
        macdHist: this.num(this.form.macdHist),
        macdSignal: this.num(this.form.macdSignal),
        sma20: this.num(this.form.sma20),
        sma50: this.num(this.form.sma50),
        supports,
        resistances,
        notes: this.form.notes.trim() || undefined,
      });
      this.success.set(`Saved ${this.form.symbol.toUpperCase()}`);
      this.showAddForm.set(false);
      this.resetForm();
      await this.reload();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(symbol: string): Promise<void> {
    if (!confirm(`Remove ${symbol} from registry?`)) return;
    await this.registrySvc.remove(symbol);
    if (this.editingSymbol() === symbol) this.closeAddForm();
    await this.reload();
  }

  /** Refetches Screener data for every stock that already has it, one symbol at a time. */
  async refreshFromScreener(): Promise<void> {
    const targets = this.stocks().filter((s) => s.screenerFetchedAt);
    this.error.set(null);
    this.success.set(null);

    if (!targets.length) {
      await this.reload();
      this.success.set('No Screener data to refresh yet. Fetch a stock from Screener first.');
      return;
    }

    this.screenerRefreshBusy.set(true);
    const failed: string[] = [];
    let updated = 0;
    try {
      for (const [index, stock] of targets.entries()) {
        this.screenerRefreshDone.set(index);
        this.screenerRefreshTotal.set(targets.length);
        try {
          const data = await this.screener.fetchStock(stock.symbol, stock.name);
          await this.registrySvc.save(this.applyScreener(stock, data));
          updated++;
        } catch {
          failed.push(stock.symbol);
        }
      }
      await this.reload();
      const failNote = failed.length
        ? ` ${failed.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}.`
        : '';
      this.success.set(`Refreshed Screener data for ${updated} stock(s).${failNote}`);
    } finally {
      this.screenerRefreshBusy.set(false);
      this.screenerRefreshDone.set(0);
      this.screenerRefreshTotal.set(0);
    }
  }
}
