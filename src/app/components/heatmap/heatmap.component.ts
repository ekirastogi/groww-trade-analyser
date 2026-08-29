import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { WatchlistService } from '../../services/watchlist.service';
import { ReportStateService } from '../../services/report-state.service';
import { pnlColor } from '../../utils/chart-theme';
import { formatCurrency, formatPct } from '../../utils/format.utils';

interface HeatmapRow {
  symbol: string;
  name: string;
  dayChangePct: number;
  rsi: number;
  netPnL: number;
  winRate: number;
  nearestSupportDist: number;
}

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './heatmap.component.html',
})
export class HeatmapComponent {
  private stockSvc = inject(StockFirestoreService);
  private watchlistSvc = inject(WatchlistService);
  private reportState = inject(ReportStateService);

  private stocks = toSignal(this.stockSvc.watchAllStocks(), { initialValue: [] });
  private watchlists = toSignal(this.watchlistSvc.watchAll(), { initialValue: [] });

  rows = computed((): HeatmapRow[] => {
    const stocks = this.stocks();
    const watchlists = this.watchlists();
    const analysis = this.reportState.analysis();

    const symbols = new Set<string>();
    watchlists.forEach((wl) => wl.stockSymbols.forEach((s) => symbols.add(s)));

    const pnlMap = new Map<string, { netPnL: number; winRate: number }>();
    if (analysis) {
      for (const stock of analysis.stocks) {
        const key = (stock.symbol || stock.stockName.split(' ')[0]).toUpperCase();
        pnlMap.set(key, { netPnL: stock.netPnL, winRate: stock.winRate ?? 0 });
      }
    }

    return stocks
      .filter((s) => symbols.size === 0 || symbols.has(s.symbol))
      .map((s): HeatmapRow => {
        const pnl = pnlMap.get(s.symbol) ?? pnlMap.get(s.symbol.slice(0, 4));
        const support = s.supportLevels?.[0] ?? s.ltp;
        const dist = s.ltp ? (Math.abs(s.ltp - support) / s.ltp) * 100 : 0;
        return {
          symbol: s.symbol,
          name: s.name,
          dayChangePct: s.changePct ?? 0,
          rsi: s.indicators?.rsi ?? 50,
          netPnL: pnl?.netPnL ?? 0,
          winRate: pnl?.winRate ?? 0,
          nearestSupportDist: dist,
        };
      })
      .sort((a, b) => b.dayChangePct - a.dayChangePct);
  });

  fmt = formatCurrency;
  fmtPct = formatPct;
  cellColor = pnlColor;
}
