import { Component, computed, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { StockLevelsService } from '../../services/stock-levels.service';
import { AuthService } from '../../services/auth.service';
import { TradeLedgerService } from '../../services/trade-ledger.service';
import { ReportStateService } from '../../services/report-state.service';
import { PageShellService } from '../../services/page-shell.service';
import { RegistryStockService } from '../../services/registry-stock.service';
import { ScreenerService } from '../../services/screener.service';
import { TradingChartComponent } from '../trading-chart/trading-chart.component';
import { ScreenerFundamentalsComponent } from '../screener-fundamentals/screener-fundamentals.component';
import { RegistryStock } from '../../models/trading-journal.models';
import { formatCurrency, formatPct } from '../../utils/format.utils';
import { formatDataAge, formatFetchedAt } from '../../utils/data-age.utils';
import { TableSortState } from '../../utils/table-sort.utils';
import { Trade } from '../../models/trade.models';

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TradingChartComponent, ScreenerFundamentalsComponent],
  templateUrl: './stock-detail.component.html',
})
export class StockDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private stockSvc = inject(StockFirestoreService);
  private levelsSvc = inject(StockLevelsService);
  readonly auth = inject(AuthService);
  private location = inject(Location);
  private pageShell = inject(PageShellService);
  readonly reportState = inject(ReportStateService);
  private ledger = inject(TradeLedgerService);
  private registrySvc = inject(RegistryStockService);
  private screenerSvc = inject(ScreenerService);

  readonly tableSort = new TableSortState('sellDate', 'desc');
  newLevelPrice = '';
  newLevelLabel = '';
  newLevelType: 'support' | 'resistance' = 'support';
  levelError = signal<string | null>(null);

  screenerBusy = signal(false);
  screenerError = signal<string | null>(null);
  screenerSuccess = signal<string | null>(null);
  registryStock = signal<RegistryStock | null>(null);

  formatFetchedAt = formatFetchedAt;
  formatDataAge = formatDataAge;

  readonly tradeColumns = [
    { key: 'buyDate', label: 'Buy', align: 'left' as const },
    { key: 'sellDate', label: 'Sell', align: 'left' as const },
    { key: 'quantity', label: 'Qty', align: 'right' as const },
    { key: 'tradeType', label: 'Type', align: 'left' as const },
    { key: 'realisedPnL', label: 'P&L', align: 'right' as const },
  ];

  symbol = toSignal(this.route.paramMap.pipe(switchMap((p) => of(p.get('symbol')?.toUpperCase() ?? ''))), { initialValue: '' });

  stock = toSignal(
    this.route.paramMap.pipe(
      switchMap((p) => {
        const sym = p.get('symbol')?.toUpperCase() ?? '';
        return sym ? this.stockSvc.watchStock(sym) : of(undefined);
      })
    ),
    { initialValue: undefined }
  );

  chartView = toSignal(
    this.route.paramMap.pipe(
      switchMap((p) => {
        const sym = p.get('symbol')?.toUpperCase() ?? '';
        return sym ? this.stockSvc.watchChart(sym) : of(undefined);
      })
    ),
    { initialValue: undefined }
  );

  userLevels = toSignal(
    this.route.paramMap.pipe(
      switchMap((p) => {
        const sym = p.get('symbol')?.toUpperCase() ?? '';
        return sym ? this.levelsSvc.watch(sym) : of(undefined);
      })
    ),
    { initialValue: undefined }
  );

  activeTab = signal<'market' | 'fundamentals' | 'my-trades'>('market');
  fmt = formatCurrency;
  fmtPct = formatPct;

  week52Position = computed(() => {
    const s = this.stock();
    if (!s?.week52High || !s?.week52Low || !s.ltp) return 50;
    const range = s.week52High - s.week52Low;
    if (range <= 0) return 50;
    return ((s.ltp - s.week52Low) / range) * 100;
  });

  private readonly _syncPageHeader = effect((onCleanup) => {
    const sym = this.symbol();
    const s = this.stock();
    const subtitle = s ? `${s.name} · ${s.exchange}` : 'Market data and your trades';
    this.pageShell.setHeader(sym || 'Stock', subtitle);
    onCleanup(() => this.pageShell.clearOverride());
  }, { allowSignalWrites: true });

  private readonly _loadRegistryStock = effect(() => {
    const sym = this.symbol();
    if (!sym) {
      this.registryStock.set(null);
      return;
    }
    void this.registrySvc.getBySymbol(sym).then((row) => this.registryStock.set(row));
  }, { allowSignalWrites: true });

  myTrades = signal<Trade[]>([]);
  tradesLoading = signal(false);

  private readonly _loadMyTrades = effect(() => {
    const sym = this.symbol();
    const clientCode = this.reportState.activeClientCode();
    if (!sym || !clientCode) {
      this.myTrades.set([]);
      return;
    }

    this.tradesLoading.set(true);
    void this.ledger.getTradesForSymbol(clientCode, sym).then((rows) => {
      const trades: Trade[] = rows.map(
        ({
          stockName,
          isin,
          quantity,
          buyDate,
          buyPrice,
          buyValue,
          sellDate,
          sellPrice,
          sellValue,
          realisedPnL,
          remark,
          tradeType,
          holdingDays,
          allocatedCharges,
          netPnL,
        }) => ({
          stockName,
          isin,
          quantity,
          buyDate,
          buyPrice,
          buyValue,
          sellDate,
          sellPrice,
          sellValue,
          realisedPnL,
          remark,
          tradeType,
          holdingDays,
          allocatedCharges,
          netPnL,
        })
      );
      this.myTrades.set(
        this.tableSort.sort(trades, (trade, col) => {
          switch (col) {
            case 'buyDate':
              return trade.buyDate;
            case 'sellDate':
              return trade.sellDate;
            case 'quantity':
              return trade.quantity;
            case 'tradeType':
              return trade.tradeType;
            case 'realisedPnL':
              return trade.realisedPnL;
            default:
              return 0;
          }
        })
      );
    }).finally(() => this.tradesLoading.set(false));
  }, { allowSignalWrites: true });

  myStockSummary = computed(() => {
    const trades = this.myTrades();
    if (!trades.length) return null;
    const realisedPnL = trades.reduce((s, t) => s + t.realisedPnL, 0);
    const wins = trades.filter((t) => t.realisedPnL > 0).length;
    return { tradeCount: trades.length, realisedPnL, winRate: (wins / trades.length) * 100 };
  });

  goBack(): void {
    this.location.back();
  }

  ngOnInit(): void {
    void this.reportState.ensureLoadedFromFirebase();
  }

  async fetchScreener(): Promise<void> {
    const sym = this.symbol();
    if (!sym || this.screenerBusy()) return;

    this.screenerBusy.set(true);
    this.screenerError.set(null);
    this.screenerSuccess.set(null);

    try {
      const data = await this.screenerSvc.fetchStock(sym, this.registryStock()?.name ?? this.stock()?.name);
      const existing = this.registryStock() ?? {
        symbol: sym,
        name: data.name,
        currentPrice: 0,
        supports: [],
        resistances: [],
        updatedAt: Date.now(),
      };
      const updated: RegistryStock = {
        ...existing,
        name: data.name || existing.name,
        currentPrice: data.currentPrice ?? existing.currentPrice,
        marketCap: data.marketCap ?? existing.marketCap,
        pe: data.pe ?? existing.pe,
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
      await this.registrySvc.save(updated);
      this.registryStock.set(updated);
      this.screenerSuccess.set(`Fetched Screener data for ${sym}.`);
      this.activeTab.set('fundamentals');
    } catch (e) {
      this.screenerError.set(e instanceof Error ? e.message : 'Screener fetch failed');
    } finally {
      this.screenerBusy.set(false);
    }
  }

  rsi(s: { indicators?: { rsi?: number } }): number {
    return s.indicators?.rsi ?? 0;
  }

  macdHist(s: { indicators?: { macdHist?: number } }): number {
    return s.indicators?.macdHist ?? 0;
  }

  marketDataAge(lastUpdated: string): string {
    if (!lastUpdated) return 'unknown age';
    const ts = new Date(lastUpdated).getTime();
    if (!Number.isFinite(ts)) return 'unknown age';
    return formatDataAge(ts);
  }

  async addUserLevel(): Promise<void> {
    const price = parseFloat(this.newLevelPrice);
    if (!price || price <= 0) {
      this.levelError.set('Enter a valid price');
      return;
    }
    this.levelError.set(null);
    try {
      await this.levelsSvc.addLevel(this.symbol(), this.newLevelType, price, this.newLevelLabel || (this.newLevelType === 'support' ? 'Support' : 'Resistance'));
      this.newLevelPrice = '';
      this.newLevelLabel = '';
    } catch (e) {
      this.levelError.set(e instanceof Error ? e.message : 'Failed to save level');
    }
  }
}
