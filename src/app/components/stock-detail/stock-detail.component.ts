import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { ReportStateService } from '../../services/report-state.service';
import { TradingChartComponent } from '../trading-chart/trading-chart.component';
import { formatCurrency, formatPct } from '../../utils/format.utils';

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TradingChartComponent],
  templateUrl: './stock-detail.component.html',
})
export class StockDetailComponent {
  private route = inject(ActivatedRoute);
  private stockSvc = inject(StockFirestoreService);
  readonly reportState = inject(ReportStateService);

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

  myTrades() {
    const sym = this.symbol();
    const report = this.reportState.report();
    if (!report || !sym) return [];
    return report.trades.filter((t) => t.stockName.toUpperCase().includes(sym.slice(0, 4)) || sym.includes(t.stockName.split(' ')[0].toUpperCase()));
  }

  myStockSummary() {
    const trades = this.myTrades();
    if (!trades.length) return null;
    const realisedPnL = trades.reduce((s, t) => s + t.realisedPnL, 0);
    const wins = trades.filter((t) => t.realisedPnL > 0).length;
    return { tradeCount: trades.length, realisedPnL, winRate: (wins / trades.length) * 100 };
  }

  rsi(s: { indicators?: { rsi?: number } }): number {
    return s.indicators?.rsi ?? 0;
  }

  macdHist(s: { indicators?: { macdHist?: number } }): number {
    return s.indicators?.macdHist ?? 0;
  }
}
