import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { WatchlistService } from '../../services/watchlist.service';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { AuthService } from '../../services/auth.service';
import { ReportStateService } from '../../services/report-state.service';
import { Watchlist } from '../../models/watchlist.models';
import { StockSummary } from '../../models/trade.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';
import {
  getPnlWatchlistTier,
  loadPnlTierMode,
  PnlTierMode,
  savePnlTierMode,
  stockSummariesForPnlTier,
  tierDisplayName,
  tierShortLabel,
} from '../../utils/pnl-watchlist.utils';
import { normalizeSymbol } from '../../utils/upload-merge.utils';
import { TableSortState } from '../../utils/table-sort.utils';
import { TradeTypeFilterComponent } from '../shared/trade-type-filter/trade-type-filter.component';

type WatchlistTab = 'profitable' | 'losing' | 'custom';

interface TierSummary {
  stockCount: number;
  tradeCount: number;
  buyValue: number;
  sellValue: number;
  realisedPnL: number;
  allocatedCharges: number;
  netPnL: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
}

interface AutoTierTab {
  watchlist: Watchlist;
  shortLabel: string;
  fullLabel: string;
  count: number;
}

@Component({
  selector: 'app-watchlists',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TradeTypeFilterComponent],
  templateUrl: './watchlists.component.html',
})
export class WatchlistsComponent {
  private watchlistSvc = inject(WatchlistService);
  private stockSvc = inject(StockFirestoreService);
  readonly auth = inject(AuthService);
  readonly state = inject(ReportStateService);

  watchlists = toSignal(this.watchlistSvc.watchAll(), { initialValue: [] as Watchlist[] });
  stocks = toSignal(this.stockSvc.watchAllStocks(), { initialValue: [] });

  readonly mainTabs: { id: WatchlistTab; label: string }[] = [
    { id: 'profitable', label: 'Profitable' },
    { id: 'losing', label: 'Loss making' },
    { id: 'custom', label: 'Custom' },
  ];

  activeTab = signal<WatchlistTab>('losing');
  tierMode = signal<PnlTierMode>(loadPnlTierMode());
  selectedAutoTierId = signal<string | null>(null);
  selectedCustomWatchlistId = signal<string | null>(null);
  expandedStockKey = signal<string | null>(null);
  newName = '';
  newSymbol = '';
  error = signal<string | null>(null);

  readonly formatCurrency = formatCurrency;
  readonly pnlClass = pnlClass;
  readonly tableSort = new TableSortState('netPnL');

  readonly tierStockColumns = [
    { key: 'stockName', label: 'Stock', align: 'left' as const },
    { key: 'realisedPnL', label: 'P&L', align: 'right' as const },
    { key: 'allocatedCharges', label: 'Charges', align: 'right' as const },
    { key: 'netPnL', label: 'Net P&L', align: 'right' as const },
    { key: 'winRate', label: 'Win Rate', align: 'right' as const },
  ];

  isPnlTab = computed(() => this.activeTab() === 'profitable' || this.activeTab() === 'losing');

  customWatchlists = computed(() =>
    this.watchlists()
      .filter((wl) => !this.watchlistSvc.isAutoWatchlist(wl))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );

  autoWatchlists = computed(() =>
    this.watchlists()
      .filter((wl) => this.watchlistSvc.isAutoWatchlist(wl))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );

  autoTierTabs = computed((): AutoTierTab[] => {
    const summaries = this.state.analysis()?.stocks ?? [];
    const mode = this.tierMode();

    return this.autoWatchlists().map((watchlist) => {
      const tier = getPnlWatchlistTier(watchlist.id);
      if (!tier) {
        return {
          watchlist,
          shortLabel: watchlist.name,
          fullLabel: watchlist.name,
          count: watchlist.stockSymbols.length,
        };
      }

      const stocks = stockSummariesForPnlTier(summaries, tier, mode);
      return {
        watchlist,
        shortLabel: tierShortLabel(tier, mode),
        fullLabel: tierDisplayName(tier, mode),
        count: stocks.length,
      };
    });
  });

  lossTierTabs = computed(() =>
    this.autoTierTabs().filter((tab) => getPnlWatchlistTier(tab.watchlist.id)?.side === 'loss')
  );

  profitTierTabs = computed(() =>
    this.autoTierTabs().filter((tab) => getPnlWatchlistTier(tab.watchlist.id)?.side === 'profit')
  );

  visibleAutoTierTabs = computed(() =>
    this.activeTab() === 'profitable' ? this.profitTierTabs() : this.lossTierTabs()
  );

  activeAutoWatchlist = computed(() => {
    if (!this.isPnlTab()) return null;

    const tabs = this.visibleAutoTierTabs();
    const selected = this.selectedAutoTierId();
    if (selected) {
      const match = tabs.find((tab) => tab.watchlist.id === selected);
      if (match) return match.watchlist;
    }
    return tabs.find((tab) => tab.count > 0)?.watchlist ?? tabs[0]?.watchlist ?? null;
  });

  activeAutoTierMeta = computed(() => {
    const watchlist = this.activeAutoWatchlist();
    if (!watchlist) return null;
    return this.autoTierTabs().find((tab) => tab.watchlist.id === watchlist.id) ?? null;
  });

  activeCustomWatchlist = computed(() => {
    const lists = this.customWatchlists();
    const selected = this.selectedCustomWatchlistId();
    if (selected) {
      const match = lists.find((wl) => wl.id === selected);
      if (match) return match;
    }
    return lists[0] ?? null;
  });

  tierStocks = computed(() => {
    const watchlist = this.activeAutoWatchlist();
    const stockSummaries = this.state.analysis()?.stocks ?? [];
    if (!watchlist) return [] as StockSummary[];

    const tier = getPnlWatchlistTier(watchlist.id);
    let stocks: StockSummary[];
    if (tier) {
      stocks = stockSummariesForPnlTier(stockSummaries, tier, this.tierMode());
    } else {
      stocks = watchlist.stockSymbols
        .map((symbol) => this.findStockSummary(stockSummaries, symbol))
        .filter((stock): stock is StockSummary => !!stock)
        .sort((a, b) => b.netPnL - a.netPnL);
    }

    return this.tableSort.sort(stocks, (stock, col) => this.tierStockSortValue(stock, col));
  });

  tierSummary = computed((): TierSummary | null => {
    const stocks = this.tierStocks();
    if (!stocks.length) return null;

    const symbolSet = new Set(stocks.map((stock) => this.stockSymbol(stock).toUpperCase()));
    const trades = (this.state.analysis()?.filteredTrades ?? []).filter((trade) => {
      const symbol = normalizeSymbol(trade.stockName);
      return symbolSet.has(symbol);
    });

    let winningTrades = 0;
    let losingTrades = 0;
    for (const trade of trades) {
      if (trade.realisedPnL > 0) winningTrades++;
      else if (trade.realisedPnL < 0) losingTrades++;
    }

    const tradeCount = trades.length || stocks.reduce((sum, stock) => sum + stock.tradeCount, 0);

    return {
      stockCount: stocks.length,
      tradeCount,
      buyValue: stocks.reduce((sum, stock) => sum + stock.buyValue, 0),
      sellValue: stocks.reduce((sum, stock) => sum + stock.sellValue, 0),
      realisedPnL: stocks.reduce((sum, stock) => sum + stock.realisedPnL, 0),
      allocatedCharges: stocks.reduce((sum, stock) => sum + stock.allocatedCharges, 0),
      netPnL: stocks.reduce((sum, stock) => sum + stock.netPnL, 0),
      winningTrades,
      losingTrades,
      winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
    };
  });

  tierSummaryStats = computed(() => {
    const summary = this.tierSummary();
    if (!summary) return [];
    return [
      { label: 'Realised P&L', value: formatCurrency(summary.realisedPnL), cls: pnlClass(summary.realisedPnL) },
      { label: 'Charges', value: formatCurrency(summary.allocatedCharges), cls: 'text-red-500' },
      { label: 'Trades', value: String(summary.tradeCount), cls: 'text-white' },
      { label: 'Stocks', value: String(summary.stockCount), cls: 'text-white' },
    ];
  });

  tierModeDescription = computed(() =>
    this.tierMode() === 'cumulative'
      ? 'Each tier includes every stock up to that P&L level.'
      : 'Each stock appears in exactly one band — no repeats across tiers.'
  );

  setTab(tab: WatchlistTab): void {
    this.activeTab.set(tab);
    this.selectedAutoTierId.set(null);
    this.error.set(null);
  }

  setTierMode(mode: PnlTierMode): void {
    this.tierMode.set(mode);
    savePnlTierMode(mode);
  }

  selectAutoTier(id: string): void {
    this.selectedAutoTierId.set(id);
    this.expandedStockKey.set(null);
  }

  stockRowKey(stock: StockSummary): string {
    return stock.isin || stock.stockName;
  }

  isStockExpanded(stock: StockSummary): boolean {
    return this.expandedStockKey() === this.stockRowKey(stock);
  }

  toggleStockExpand(stock: StockSummary, event?: Event): void {
    event?.stopPropagation();
    const key = this.stockRowKey(stock);
    this.expandedStockKey.set(this.expandedStockKey() === key ? null : key);
  }

  tierModeLabel(): string {
    return this.tierMode() === 'cumulative' ? 'Cumulative' : 'Exclusive bands';
  }

  selectCustomWatchlist(id: string): void {
    this.selectedCustomWatchlistId.set(id);
  }

  tierTabLabel(tab: AutoTierTab): string {
    return `${tab.shortLabel} (${tab.count})`;
  }

  async createWatchlist(): Promise<void> {
    if (!this.newName.trim()) return;
    try {
      const lists = this.customWatchlists();
      const id = await this.watchlistSvc.create({
        name: this.newName.trim(),
        type: 'manual',
        color: '#6366f1',
        sortOrder: lists.length,
        stockSymbols: [],
      });
      this.newName = '';
      this.activeTab.set('custom');
      this.selectedCustomWatchlistId.set(id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to create watchlist');
    }
  }

  async addSymbol(wl: Watchlist): Promise<void> {
    if (!this.newSymbol.trim()) return;
    try {
      await this.watchlistSvc.addSymbol(wl.id, this.newSymbol.trim(), wl.stockSymbols);
      this.newSymbol = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add symbol');
    }
  }

  async removeSymbol(wl: Watchlist, symbol: string): Promise<void> {
    await this.watchlistSvc.removeSymbol(wl.id, symbol, wl.stockSymbols);
  }

  async deleteWatchlist(id: string): Promise<void> {
    await this.watchlistSvc.remove(id);
    if (this.selectedCustomWatchlistId() === id) {
      this.selectedCustomWatchlistId.set(null);
    }
  }

  stockPrice(symbol: string): string {
    const s = this.stocks().find((x) => x.symbol === symbol);
    return s ? `₹${s.ltp?.toFixed(2)} (${s.changePct?.toFixed(2)}%)` : '—';
  }

  tierStockCellClass(key: string, stock: StockSummary): string {
    const base = 'text-right tabular-nums';
    switch (key) {
      case 'realisedPnL':
        return `${base} ${this.pnlClass(stock.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} font-semibold ${this.pnlClass(stock.netPnL)}`;
      case 'ltp':
        return 'text-right text-slate-500';
      default:
        return base;
    }
  }

  private tierStockSortValue(stock: StockSummary, col: string): string | number {
    switch (col) {
      case 'stockName':
        return stock.stockName.toLowerCase();
      case 'realisedPnL':
        return stock.realisedPnL;
      case 'allocatedCharges':
        return stock.allocatedCharges;
      case 'netPnL':
        return stock.netPnL;
      case 'winRate':
        return stock.winRate ?? -1;
      default:
        return 0;
    }
  }

  stockSymbol(stock: StockSummary): string {
    return stock.symbol || normalizeSymbol(stock.stockName);
  }

  private findStockSummary(stocks: StockSummary[], symbol: string): StockSummary | undefined {
    const key = symbol.toUpperCase();
    return stocks.find(
      (stock) =>
        stock.symbol?.toUpperCase() === key ||
        normalizeSymbol(stock.stockName) === key ||
        stock.stockName.split(' ')[0].toUpperCase() === key
    );
  }
}
