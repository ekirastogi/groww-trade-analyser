import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { WatchlistService } from '../../services/watchlist.service';
import { ReportStateService } from '../../services/report-state.service';
import { StockSummary } from '../../models/trade.models';
import { pnlColor } from '../../utils/chart-theme';
import { formatCurrency, formatPct } from '../../utils/format.utils';
import { normalizeSymbol } from '../../utils/upload-merge.utils';
import { TableSortState } from '../../utils/table-sort.utils';

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
  readonly reportState = inject(ReportStateService);

  private marketStocks = toSignal(this.stockSvc.watchAllStocks(), { initialValue: [] });
  private watchlists = toSignal(this.watchlistSvc.watchAll(), { initialValue: [] });

  readonly tableSort = new TableSortState('netPnL');

  readonly heatmapColumns = [
    { key: 'symbol', label: 'Symbol', align: 'left' as const },
    { key: 'dayChangePct', label: 'Day %', align: 'right' as const },
    { key: 'rsi', label: 'RSI', align: 'right' as const },
    { key: 'netPnL', label: 'My Net P&L', align: 'right' as const },
    { key: 'winRate', label: 'Win Rate', align: 'right' as const },
    { key: 'nearestSupportDist', label: 'Dist to S1', align: 'right' as const },
  ];

  rows = computed((): HeatmapRow[] => {
    const marketMap = new Map(this.marketStocks().map((stock) => [stock.symbol.toUpperCase(), stock]));
    const watchlists = this.watchlists();
    const analysisStocks = this.reportState.analysis()?.stocks ?? [];

    const watchlistSymbols = new Set<string>();
    watchlists.forEach((watchlist) =>
      watchlist.stockSymbols.forEach((symbol) => watchlistSymbols.add(symbol.toUpperCase()))
    );

    let stocksToShow: StockSummary[] = analysisStocks;
    if (watchlistSymbols.size > 0 && analysisStocks.length) {
      stocksToShow = analysisStocks.filter((stock) => {
        const symbol = this.stockSymbol(stock).toUpperCase();
        return watchlistSymbols.has(symbol);
      });
    }

    if (!stocksToShow.length && watchlistSymbols.size) {
      stocksToShow = [...watchlistSymbols].map((symbol) => ({
        stockName: symbol,
        isin: symbol,
        symbol,
        quantity: 0,
        avgBuyPrice: 0,
        buyValue: 0,
        avgSellPrice: 0,
        sellValue: 0,
        realisedPnL: 0,
        realisedPnLPct: 0,
        tradeCount: 0,
        allocatedCharges: 0,
        netPnL: 0,
      }));
    }

    return this.tableSort.sort(
      stocksToShow.map((stock): HeatmapRow => {
        const symbol = this.stockSymbol(stock);
        const market = marketMap.get(symbol.toUpperCase());
        const support = market?.supportLevels?.[0] ?? market?.ltp ?? 0;
        const ltp = market?.ltp ?? 0;
        const dist = ltp ? (Math.abs(ltp - support) / ltp) * 100 : 0;

        return {
          symbol,
          name: stock.stockName,
          dayChangePct: market?.changePct ?? 0,
          rsi: market?.indicators?.rsi ?? 50,
          netPnL: stock.netPnL,
          winRate: stock.winRate ?? 0,
          nearestSupportDist: dist,
        };
      }),
      (row, col) => {
        switch (col) {
          case 'symbol':
            return row.symbol.toLowerCase();
          case 'dayChangePct':
            return row.dayChangePct;
          case 'rsi':
            return row.rsi;
          case 'netPnL':
            return row.netPnL;
          case 'winRate':
            return row.winRate;
          case 'nearestSupportDist':
            return row.nearestSupportDist;
          default:
            return 0;
        }
      }
    );
  });

  hasMarketData = computed(() => this.marketStocks().length > 0);

  fmt = formatCurrency;
  fmtPct = formatPct;
  cellColor = pnlColor;

  private stockSymbol(stock: StockSummary): string {
    return stock.symbol || normalizeSymbol(stock.stockName);
  }
}
