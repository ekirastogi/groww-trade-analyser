import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
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

  rows = toSignal(
    combineLatest([this.stockSvc.watchAllStocks(), this.watchlistSvc.watchAll()]).pipe(
      map(([stocks, watchlists]) => {
        const symbols = new Set<string>();
        watchlists.forEach((wl) => wl.stockSymbols.forEach((s) => symbols.add(s)));
        const pnlMap = new Map<string, { netPnL: number; winRate: number }>();
        const report = this.reportState.report();
        if (report) {
          const chargeRatio = report.charges.total / report.trades.reduce((s, t) => s + t.sellValue, 0) || 0;
          const byStock = new Map<string, { pnl: number; wins: number; count: number }>();
          for (const t of report.trades) {
            const key = t.stockName.split(' ')[0].toUpperCase();
            const e = byStock.get(key) ?? { pnl: 0, wins: 0, count: 0 };
            e.pnl += t.realisedPnL - t.sellValue * chargeRatio;
            if (t.realisedPnL > 0) e.wins++;
            e.count++;
            byStock.set(key, e);
          }
          byStock.forEach((v, k) => pnlMap.set(k, { netPnL: v.pnl, winRate: v.count ? (v.wins / v.count) * 100 : 0 }));
        }

        return stocks
          .filter((s) => symbols.size === 0 || symbols.has(s.symbol))
          .map((s): HeatmapRow => {
            const pnl = pnlMap.get(s.symbol) ?? pnlMap.get(s.symbol.slice(0, 4));
            const support = s.supportLevels?.[0] ?? s.ltp;
            const dist = s.ltp ? Math.abs(s.ltp - support) / s.ltp * 100 : 0;
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
      })
    ),
    { initialValue: [] as HeatmapRow[] }
  );

  fmt = formatCurrency;
  fmtPct = formatPct;
  cellColor = pnlColor;
}
