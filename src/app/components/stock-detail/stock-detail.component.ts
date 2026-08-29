import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { ReportStateService } from '../../services/report-state.service';
import { PageShellService } from '../../services/page-shell.service';
import { TradingChartComponent } from '../trading-chart/trading-chart.component';
import { formatCurrency, formatPct } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';
import { Trade } from '../../models/trade.models';

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TradingChartComponent],
  templateUrl: './stock-detail.component.html',
})
export class StockDetailComponent {
  private route = inject(ActivatedRoute);
  private stockSvc = inject(StockFirestoreService);
  private location = inject(Location);
  private pageShell = inject(PageShellService);
  readonly reportState = inject(ReportStateService);

  readonly tableSort = new TableSortState('sellDate', 'desc');

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

  activeTab = signal<'market' | 'my-trades'>('market');
  fmt = formatCurrency;
  fmtPct = formatPct;

  private readonly _syncPageHeader = effect(() => {
    const sym = this.symbol();
    const s = this.stock();
    const subtitle = s ? `${s.name} · ${s.exchange}` : 'Market data and your trades';
    this.pageShell.setHeader(sym || 'Stock', subtitle);
  });

  myTrades = computed(() => {
    const sym = this.symbol();
    const report = this.reportState.report();
    if (!report || !sym) return [] as Trade[];
    const trades = report.trades.filter(
      (t) => t.stockName.toUpperCase().includes(sym.slice(0, 4)) || sym.includes(t.stockName.split(' ')[0].toUpperCase())
    );
    return this.tableSort.sort(trades, (trade, col) => {
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
    });
  });

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

  rsi(s: { indicators?: { rsi?: number } }): number {
    return s.indicators?.rsi ?? 0;
  }

  macdHist(s: { indicators?: { macdHist?: number } }): number {
    return s.indicators?.macdHist ?? 0;
  }
}
