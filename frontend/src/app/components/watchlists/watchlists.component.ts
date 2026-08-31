import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { AuthService } from '../../services/auth.service';
import { ReportStateService } from '../../services/report-state.service';
import { Watchlist } from '../../models/watchlist.models';
import { StockSummary, TRADE_TYPE_LABELS } from '../../models/trade.models';
import { StockSnapshot } from '../../models/market.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';
import {
  getPnlWatchlistTier,
  loadPnlTierMode,
  PNL_WATCHLIST_TIERS,
  PnlTierMode,
  savePnlTierMode,
  stockSummariesForPnlTier,
  tierDisplayName,
  tierShortLabel,
} from '../../utils/pnl-watchlist.utils';
import { normalizeSymbol } from '../../utils/upload-merge.utils';
import { TableSortState } from '../../utils/table-sort.utils';
import { TradeTypeFilterComponent } from '../shared/trade-type-filter/trade-type-filter.component';
import { MarketCapFilterComponent } from '../shared/market-cap-filter/market-cap-filter.component';
import { MARKET_CAP_LABELS, MarketCapTier, matchesMarketCapFilter } from '../../utils/market-cap.utils';

const ALL_SUBTAB_ID = '__all__';

type WatchlistTab = 'losing' | 'profitable';

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
  imports: [CommonModule, RouterLink, TradeTypeFilterComponent, MarketCapFilterComponent],
  templateUrl: './watchlists.component.html',
})
export class WatchlistsComponent {
  private stockSvc = inject(StockFirestoreService);
  readonly auth = inject(AuthService);
  readonly state = inject(ReportStateService);

  stocks = toSignal(this.stockSvc.watchMarketCatalog(), { initialValue: [] as StockSnapshot[] });

  readonly mainTabs: { id: WatchlistTab; label: string }[] = [
    { id: 'losing', label: 'Loss making' },
    { id: 'profitable', label: 'Profitable' },
  ];

  readonly allSubtabId = ALL_SUBTAB_ID;

  activeTab = signal<WatchlistTab>('losing');
  tierMode = signal<PnlTierMode>(loadPnlTierMode());
  selectedAutoTierId = signal<string | null>(null);
  expandedStockKey = signal<string | null>(null);
  selectedMarketCapTiers = signal<MarketCapTier[]>([]);
  mobileFiltersOpen = signal(false);

  readonly formatCurrency = formatCurrency;
  readonly pnlClass = pnlClass;
  readonly tableSort = new TableSortState('netPnL');

  readonly tierStockColumns = [
    { key: 'stockName', label: 'Stock', align: 'left' as const, mobile: true },
    { key: 'netPnL', label: 'Net P&L', align: 'right' as const, mobile: true },
    { key: 'realisedPnL', label: 'P&L', align: 'right' as const, mobile: false },
    { key: 'allocatedCharges', label: 'Charges', align: 'right' as const, mobile: false },
    { key: 'winRate', label: 'Win Rate', align: 'right' as const, mobile: false },
  ];

  autoTierTabs = computed((): AutoTierTab[] => {
    const summaries = this.filterByMarketCap(this.state.analysis()?.stocks ?? []);
    const mode = this.tierMode();

    return PNL_WATCHLIST_TIERS.map((tier) => {
      const stocks = stockSummariesForPnlTier(summaries, tier, mode);
      const watchlist: Watchlist = {
        id: tier.id,
        name: tier.name,
        type: 'pnl_derived',
        color: tier.color,
        sortOrder: tier.sortOrder,
        stockSymbols: stocks.map((stock) => this.stockSymbol(stock)),
        createdAt: 0,
        updatedAt: 0,
      };

      return {
        watchlist,
        shortLabel: tierShortLabel(tier, mode),
        fullLabel: tierDisplayName(tier, mode),
        count: stocks.length,
      };
    });
  });

  filterSummary = computed(() => {
    const tradeTypes = this.state.selectedTradeTypes();
    const trade = tradeTypes.includes('all')
      ? 'All trades'
      : tradeTypes.map((type) => TRADE_TYPE_LABELS[type] || type).join(', ');
    const band = this.tierMode() === 'band' ? 'Exclusive' : 'Cumulative';
    const caps = this.selectedMarketCapTiers();
    const cap = caps.length ? caps.map((tier) => MARKET_CAP_LABELS[tier]).join(', ') : 'All caps';
    return `${trade} · ${band} · ${cap}`;
  });

  lossTierTabs = computed(() =>
    this.autoTierTabs().filter((tab) => getPnlWatchlistTier(tab.watchlist.id)?.side === 'loss')
  );

  profitTierTabs = computed(() =>
    this.autoTierTabs().filter((tab) => getPnlWatchlistTier(tab.watchlist.id)?.side === 'profit')
  );

  visibleAutoTierTabs = computed((): AutoTierTab[] => {
    const tiers =
      this.activeTab() === 'profitable' ? this.profitTierTabs() : this.lossTierTabs();
    const summaries = this.filterByMarketCap(this.state.analysis()?.stocks ?? []);
    const allCount = summaries.filter((stock) =>
      this.activeTab() === 'profitable' ? stock.netPnL > 0 : stock.netPnL < 0
    ).length;

    const allTab: AutoTierTab = {
      watchlist: {
        id: ALL_SUBTAB_ID,
        name: 'All',
        type: 'pnl_derived',
        color: this.activeTab() === 'profitable' ? '#22c55e' : '#ef4444',
        sortOrder: -1,
        stockSymbols: [],
        createdAt: 0,
        updatedAt: 0,
      },
      shortLabel: 'All',
      fullLabel:
        this.activeTab() === 'profitable' ? 'All profitable stocks' : 'All loss-making stocks',
      count: allCount,
    };

    return [allTab, ...tiers];
  });

  activeAutoWatchlist = computed(() => {
    const tabs = this.visibleAutoTierTabs();
    const selected = this.selectedAutoTierId() ?? ALL_SUBTAB_ID;
    return tabs.find((tab) => tab.watchlist.id === selected)?.watchlist ?? tabs[0]?.watchlist ?? null;
  });

  activeAutoTierMeta = computed(() => {
    const watchlist = this.activeAutoWatchlist();
    if (!watchlist) return null;
    return this.visibleAutoTierTabs().find((tab) => tab.watchlist.id === watchlist.id) ?? null;
  });

  activeViewLabel = computed(() => this.activeAutoTierMeta()?.fullLabel ?? '');

  tierStocks = computed(() => {
    const stockSummaries = this.filterByMarketCap(this.state.analysis()?.stocks ?? []);
    const watchlist = this.activeAutoWatchlist();
    if (!watchlist) return [] as StockSummary[];

    if (watchlist.id === ALL_SUBTAB_ID) {
      const stocks = stockSummaries
        .filter((stock) =>
          this.activeTab() === 'profitable' ? stock.netPnL > 0 : stock.netPnL < 0
        )
        .sort((a, b) => b.netPnL - a.netPnL);
      return this.tableSort.sort(stocks, (stock, col) => this.tierStockSortValue(stock, col));
    }

    const tier = getPnlWatchlistTier(watchlist.id);
    const stocks = tier
      ? stockSummariesForPnlTier(stockSummaries, tier, this.tierMode())
      : [];

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

  setTab(tab: WatchlistTab): void {
    this.activeTab.set(tab);
    this.selectedAutoTierId.set(null);
  }

  setTierMode(mode: PnlTierMode): void {
    this.tierMode.set(mode);
    savePnlTierMode(mode);
    this.selectedAutoTierId.set(null);
  }

  toggleMobileFilters(): void {
    this.mobileFiltersOpen.update((open) => !open);
  }

  setMarketCapTiers(tiers: MarketCapTier[]): void {
    this.selectedMarketCapTiers.set(tiers);
    this.selectedAutoTierId.set(null);
    this.expandedStockKey.set(null);
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

  tierTabLabel(tab: AutoTierTab): string {
    return `${tab.shortLabel} (${tab.count})`;
  }

  tierColumnClass(col: { align: 'left' | 'right'; mobile: boolean }, stock?: StockSummary, key?: string): string {
    const align = col.align === 'left' ? 'text-left' : 'text-right';
    const visibility = col.mobile ? '' : 'hidden md:table-cell';
    if (!stock || !key) return `${align} ${visibility}`.trim();
    if (key === 'stockName') return `col-name ${visibility}`.trim();
    return `${this.tierStockCellClass(key, stock)} ${visibility}`.trim();
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

  private marketCapForStock(stock: StockSummary): number | undefined {
    const symbol = this.stockSymbol(stock).toUpperCase();
    return this.stocks().find((s) => s.symbol === symbol)?.marketCap;
  }

  private filterByMarketCap(stocks: StockSummary[]): StockSummary[] {
    const selected = this.selectedMarketCapTiers();
    if (!selected.length) return stocks;
    return stocks.filter((stock) =>
      matchesMarketCapFilter(this.marketCapForStock(stock), selected)
    );
  }
}
