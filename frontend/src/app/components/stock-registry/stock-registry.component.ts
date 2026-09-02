import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistryStockService } from '../../services/registry-stock.service';
import { WorkerJobService } from '../../services/worker-job.service';
import { ScreenerService, ScreenerSnapshot } from '../../services/screener.service';
import { RegistryStock } from '../../models/trading-journal.models';
import { formatCurrency } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './stock-registry.component.html',
})
export class StockRegistryComponent implements OnInit {
  private registrySvc = inject(RegistryStockService);
  private workerJobs = inject(WorkerJobService);
  private screener = inject(ScreenerService);

  stocks = signal<RegistryStock[]>([]);
  stockCount = signal(0);
  loading = signal(false);
  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;

  showAddForm = signal(false);
  searchQuery = signal('');
  pageSize = signal(25);
  currentPage = signal(1);

  editingSymbol = signal<string | null>(null);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  busy = signal(false);
  seedBusy = signal(false);
  fetchingSymbol = signal<string | null>(null);
  expandedSymbol = signal<string | null>(null);
  symbolQuery = signal('');

  readonly columns: { key: RegistryColumnKey; label: string; align?: 'left' | 'right' }[] = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'name', label: 'Name' },
    { key: 'currentPrice', label: 'Price', align: 'right' },
    { key: 'marketCap', label: 'Mkt cap (Cr)', align: 'right' },
    { key: 'pe', label: 'P/E', align: 'right' },
    { key: 'salesGrowth3y', label: 'Sales 3Y', align: 'right' },
    { key: 'profitGrowth3y', label: 'Profit 3Y', align: 'right' },
    { key: 'stockCagr3y', label: 'CAGR 3Y', align: 'right' },
    { key: 'promoterHolding', label: 'Promoter %', align: 'right' },
    { key: 'fiiHolding', label: 'FII %', align: 'right' },
    { key: 'screenerFetchedAt', label: 'Screener fetched', align: 'right' },
    { key: 'updatedAt', label: 'Updated', align: 'right' },
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
    let rows = this.stocks();
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
      ]);

      const deduped = await this.registrySvc.dedupeByIsin();
      const finalStocks = deduped > 0 ? await this.registrySvc.listAll() : stocks;
      const finalCount = deduped > 0 ? await this.registrySvc.count() : stockCount;

      this.stocks.set(finalStocks);
      this.stockCount.set(finalCount);
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
      shareholding: data.shareholding,
      screenerUrl: data.url,
      screenerFetchedAt: data.fetchedAt,
    };
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
      const data = await this.screener.fetchStock(stock.symbol);
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

  async backfillFromYahoo(): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    this.busy.set(true);
    try {
      const result = await this.workerJobs.backfillRegistryFromYahoo(true);
      await this.reload();
      this.success.set(
        `Yahoo backfill complete: updated ${result.updated} of ${result.processed} symbol(s) with CMP, market cap, and P/E (delayed data).`
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Yahoo backfill failed');
    } finally {
      this.busy.set(false);
    }
  }

  async refreshMarketData(): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    this.busy.set(true);
    try {
      const result = await this.registrySvc.enrichFromMarketData();
      await this.reload();
      if (!result.updated) {
        this.success.set(
          'No market data found yet. Run Settings → Worker → Hot ingest (with Groww credentials in backend/.env) then try again.'
        );
      } else {
        const pendingNote =
          result.pending > 0
            ? ` ${result.pending} symbol(s) still need ingest (run Hot ingest in Settings → Worker).`
            : '';
        this.success.set(`Updated market data for ${result.updated} stock(s).${pendingNote}`);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Market data refresh failed');
    } finally {
      this.busy.set(false);
    }
  }

  async importExchangeUniverse(): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    this.seedBusy.set(true);
    try {
      const online = await this.workerJobs.getWorkerOnline();
      if (!online) {
        throw new Error('Worker is offline. Start it with `cd backend && go run .` then retry.');
      }
      const jobId = await this.workerJobs.requestSeedRegistry();
      const job = await this.workerJobs.waitForJob(jobId, 20 * 60 * 1000);
      if (job.status === 'failed') {
        throw new Error(job.error ?? 'Registry import failed');
      }

      const deduped = await this.registrySvc.dedupeByIsin();
      await this.reload();

      const imported = job.symbolsIngested ?? 0;
      const dedupeNote = deduped > 0 ? ` Removed ${deduped} duplicate listing(s) for the same company.` : '';
      this.success.set(
        `Imported ${imported} NSE/BSE symbols into your registry.${dedupeNote} Edit any stock to add price, indicators, and notes.`
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Import failed');
    } finally {
      this.seedBusy.set(false);
    }
  }
}
