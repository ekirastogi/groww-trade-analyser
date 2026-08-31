import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistryStockService } from '../../services/registry-stock.service';
import { UniverseService, UniverseEntry } from '../../services/universe.service';
import { WorkerJobService } from '../../services/worker-job.service';
import { RegistryStock } from '../../models/trading-journal.models';
import { formatCurrency } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

type RegistryColumnKey =
  | 'symbol'
  | 'name'
  | 'currentPrice'
  | 'marketCap'
  | 'pe'
  | 'rsi'
  | 'updatedAt';

type UniverseColumnKey = 'symbol' | 'name' | 'exchange' | 'source' | 'updatedAt';

type RegistryView = 'registry' | 'universe';

@Component({
  selector: 'app-stock-registry',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stock-registry.component.html',
})
export class StockRegistryComponent implements OnInit {
  private registrySvc = inject(RegistryStockService);
  private universeSvc = inject(UniverseService);
  private workerJobs = inject(WorkerJobService);

  stocks = signal<RegistryStock[]>([]);
  universe = signal<UniverseEntry[]>([]);
  universeCount = signal(0);
  loading = signal(false);
  viewMode = signal<RegistryView>('registry');
  tableSort = new TableSortState('symbol', 'asc');
  universeSort = new TableSortState('symbol', 'asc');
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
  symbolQuery = signal('');

  readonly columns: { key: RegistryColumnKey; label: string; align?: 'left' | 'right' }[] = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'name', label: 'Name' },
    { key: 'currentPrice', label: 'Price', align: 'right' },
    { key: 'marketCap', label: 'Mkt cap', align: 'right' },
    { key: 'pe', label: 'P/E', align: 'right' },
    { key: 'rsi', label: 'RSI', align: 'right' },
    { key: 'updatedAt', label: 'Updated', align: 'right' },
  ];

  readonly universeColumns: { key: UniverseColumnKey; label: string; align?: 'left' | 'right' }[] = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'name', label: 'Name' },
    { key: 'exchange', label: 'Exchange' },
    { key: 'source', label: 'Source' },
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

  filteredUniverse = computed(() => {
    this.universeSort.column();
    this.universeSort.direction();

    const q = this.searchQuery().trim().toLowerCase();
    let rows = this.universe();
    if (q) {
      rows = rows.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name ?? '').toLowerCase().includes(q) ||
          (s.exchange ?? '').toLowerCase().includes(q)
      );
    }
    return this.universeSort.sort(rows, (entry, col) => this.universeSortValue(entry, col));
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

  totalPages = computed(() => {
    const total =
      this.viewMode() === 'universe' ? this.filteredUniverse().length : this.filteredStocks().length;
    return Math.max(1, Math.ceil(total / this.pageSize()));
  });

  paginatedStocks = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.filteredStocks().slice(start, start + this.pageSize());
  });

  paginatedUniverse = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.filteredUniverse().slice(start, start + this.pageSize());
  });

  pageSummary = computed(() => {
    const total =
      this.viewMode() === 'universe' ? this.filteredUniverse().length : this.filteredStocks().length;
    if (!total) return this.viewMode() === 'universe' ? 'No symbols' : 'No stocks';
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
      const [stocks, universe, universeCount] = await Promise.all([
        this.registrySvc.listAll(),
        this.universeSvc.listAll(),
        this.universeSvc.count(),
      ]);
      this.stocks.set(stocks);
      this.universe.set(universe);
      this.universeCount.set(universeCount);
      this.currentPage.set(1);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load registry');
    } finally {
      this.loading.set(false);
    }
  }

  setViewMode(mode: RegistryView): void {
    this.viewMode.set(mode);
    this.currentPage.set(1);
    this.searchQuery.set('');
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

  private universeSortValue(entry: UniverseEntry, col: string): string | number {
    switch (col) {
      case 'symbol':
        return entry.symbol;
      case 'name':
        return entry.name ?? '';
      case 'exchange':
        return entry.exchange ?? '';
      case 'source':
        return entry.source;
      case 'updatedAt':
        return entry.updatedAt ?? 0;
      default:
        return entry.symbol;
    }
  }

  formatSource(source: UniverseEntry['source']): string {
    switch (source) {
      case 'exchange_seed':
        return 'NSE/BSE';
      case 'pnl_upload':
        return 'P&L upload';
      case 'seed':
        return 'Seed';
      default:
        return 'Manual';
    }
  }

  isInRegistry(symbol: string): boolean {
    return this.stocks().some((s) => s.symbol === symbol.toUpperCase());
  }

  addFromUniverse(entry: UniverseEntry): void {
    this.openAddForm();
    this.form.symbol = entry.symbol;
    this.symbolQuery.set(entry.symbol);
    this.form.name = entry.name ?? entry.symbol;
  }

  private sortValue(stock: RegistryStock, col: string): string | number {
    switch (col) {
      case 'symbol':
        return stock.symbol;
      case 'name':
        return stock.name;
      case 'currentPrice':
        return stock.currentPrice;
      case 'marketCap':
        return stock.marketCap ?? 0;
      case 'pe':
        return stock.pe ?? 0;
      case 'rsi':
        return stock.rsi ?? 0;
      case 'updatedAt':
        return stock.updatedAt ?? 0;
      default:
        return stock.symbol;
    }
  }

  formatUpdated(ts: number | undefined): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
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
    const match = this.universe().find((s) => s.symbol === this.form.symbol);
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
    this.form.currentPrice = String(stock.currentPrice ?? '');
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
    const price = this.num(this.form.currentPrice);
    if (!this.form.symbol.trim() || price == null) {
      this.error.set('Symbol and current price are required');
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
        currentPrice: price,
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

  async importExchangeUniverse(): Promise<void> {
    this.error.set(null);
    this.success.set(null);
    this.seedBusy.set(true);
    try {
      const online = await this.workerJobs.getWorkerOnline();
      if (!online) {
        throw new Error('Worker is offline. Start it with `cd backend && go run .` then retry.');
      }
      const jobId = await this.workerJobs.requestSeedUniverse();
      const job = await this.workerJobs.waitForJob(jobId, 20 * 60 * 1000);
      if (job.status === 'failed') {
        throw new Error(job.error ?? 'Universe import failed');
      }
      await this.reload();
      const count = job.symbolsIngested ?? this.universeCount();
      this.viewMode.set('universe');
      this.success.set(
        `Imported ${count} NSE/BSE symbols into the symbol universe. Open the Imported symbols tab to browse them.`
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Import failed');
    } finally {
      this.seedBusy.set(false);
    }
  }
}
