import { Injectable, computed, inject, signal } from '@angular/core';
import { StockSummary } from '../models/trade.models';
import { Watchlist } from '../models/watchlist.models';
import { LazyTradeLoaderService } from './lazy-trade-loader.service';
import { WatchlistService } from './watchlist.service';

const SELECTED_ID_KEY = 'kairo.dashboard.customListId';

@Injectable({ providedIn: 'root' })
export class CustomStockListService {
  private watchlists = inject(WatchlistService);
  private lazyTrades = inject(LazyTradeLoaderService);

  readonly lists = signal<Watchlist[]>([]);
  readonly listsLoading = signal(false);
  readonly selectedListId = signal<string | null>(this.readStoredId());
  readonly error = signal<string | null>(null);

  private loaded = false;
  private inFlight: Promise<Watchlist[]> | null = null;
  private readonly stockViewCache = new Map<string, StockSummary[]>();

  readonly selectedList = computed(() => {
    const id = this.selectedListId();
    if (!id) return null;
    return this.lists().find((list) => list.id === id) ?? null;
  });

  async ensureLoaded(): Promise<Watchlist[]> {
    if (this.loaded) return this.lists();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.reload();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async reload(): Promise<Watchlist[]> {
    this.listsLoading.set(true);
    this.error.set(null);
    try {
      const lists = await this.watchlists.listManual();
      this.lists.set(lists);
      this.loaded = true;
      this.stockViewCache.clear();
      this.ensureSelection(lists);
      return lists;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load custom lists');
      return this.lists();
    } finally {
      this.listsLoading.set(false);
    }
  }

  select(id: string | null): void {
    this.selectedListId.set(id);
    this.storeId(id);
  }

  stocksForList(list: Watchlist, universe: StockSummary[]): StockSummary[] {
    const fingerprint = `${list.id}|${list.updatedAt}|${universe.length}|${this.universeFingerprint(universe)}`;
    const cached = this.stockViewCache.get(fingerprint);
    if (cached) return cached;

    const symbols = new Set(list.stockSymbols.map((symbol) => symbol.toUpperCase()));
    const rows = universe.filter((stock) => symbols.has(this.lazyTrades.stockSymbol(stock)));
    for (const key of [...this.stockViewCache.keys()]) {
      if (key.startsWith(`${list.id}|`) && key !== fingerprint) this.stockViewCache.delete(key);
    }
    this.stockViewCache.set(fingerprint, rows);
    return rows;
  }

  async create(name: string, symbols: string[]): Promise<string> {
    const id = await this.watchlists.create({
      name: name.trim(),
      type: 'manual',
      color: '#6366f1',
      sortOrder: Date.now(),
      stockSymbols: this.normalizeSymbols(symbols),
    });
    this.loaded = false;
    await this.reload();
    this.select(id);
    return id;
  }

  async update(id: string, name: string, symbols: string[]): Promise<void> {
    await this.watchlists.update(id, {
      name: name.trim(),
      stockSymbols: this.normalizeSymbols(symbols),
    });
    this.loaded = false;
    await this.reload();
    this.select(id);
  }

  async remove(id: string): Promise<void> {
    await this.watchlists.remove(id);
    this.loaded = false;
    const lists = await this.reload();
    if (this.selectedListId() === id) {
      this.select(lists[0]?.id ?? null);
    }
  }

  async getById(id: string): Promise<Watchlist | null> {
    const lists = await this.ensureLoaded();
    return lists.find((list) => list.id === id) ?? null;
  }

  private ensureSelection(lists: Watchlist[]): void {
    const current = this.selectedListId();
    if (current && lists.some((list) => list.id === current)) return;
    this.select(lists[0]?.id ?? null);
  }

  private universeFingerprint(universe: StockSummary[]): string {
    let net = 0;
    let trades = 0;
    for (const stock of universe) {
      net += stock.netPnL;
      trades += stock.tradeCount;
    }
    return `${net.toFixed(2)}:${trades}`;
  }

  private normalizeSymbols(symbols: string[]): string[] {
    return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  }

  private readStoredId(): string | null {
    try {
      return localStorage.getItem(SELECTED_ID_KEY);
    } catch {
      return null;
    }
  }

  private storeId(id: string | null): void {
    try {
      if (id) localStorage.setItem(SELECTED_ID_KEY, id);
      else localStorage.removeItem(SELECTED_ID_KEY);
    } catch {
      /* ignore quota / private mode */
    }
  }
}
