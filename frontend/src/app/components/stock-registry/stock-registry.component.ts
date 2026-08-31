import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistryStockService } from '../../services/registry-stock.service';
import { UniverseService, UniverseEntry } from '../../services/universe.service';
import { WorkerJobService } from '../../services/worker-job.service';
import { RegistryStock } from '../../models/trading-journal.models';
import { formatCurrency } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

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
  loading = signal(false);
  tableSort = new TableSortState('symbol', 'asc');
  fmt = formatCurrency;

  editingSymbol = signal<string | null>(null);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  busy = signal(false);
  seedBusy = signal(false);
  symbolQuery = signal('');

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

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [stocks, universe] = await Promise.all([
        this.registrySvc.listAll(),
        this.universeSvc.listAll(),
      ]);
      this.stocks.set(stocks);
      this.universe.set(universe);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load registry');
    } finally {
      this.loading.set(false);
    }
  }

  sortedStocks(): RegistryStock[] {
    return this.tableSort.sort(this.stocks(), (stock, col) => {
      switch (col) {
        case 'symbol': return stock.symbol;
        case 'name': return stock.name;
        case 'currentPrice': return stock.currentPrice;
        case 'pe': return stock.pe ?? 0;
        case 'rsi': return stock.rsi ?? 0;
        default: return stock.symbol;
      }
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
    if (this.editingSymbol() === symbol) this.resetForm();
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
      this.success.set(
        `Imported ${job.symbolsIngested ?? 0} NSE/BSE symbols. Search by symbol when adding stocks.`
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Import failed');
    } finally {
      this.seedBusy.set(false);
    }
  }
}
