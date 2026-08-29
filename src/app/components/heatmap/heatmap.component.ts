import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { ReportStateService } from '../../services/report-state.service';
import { StockSummary } from '../../models/trade.models';
import { formatCurrency } from '../../utils/format.utils';
import { normalizeSymbol } from '../../utils/upload-merge.utils';
import { TradeTypeFilterComponent } from '../shared/trade-type-filter/trade-type-filter.component';

interface HeatmapTile {
  symbol: string;
  name: string;
  netPnL: number;
  winRate: number;
  weight: number;
  background: string;
  borderColor: string;
}

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule, RouterLink, TradeTypeFilterComponent],
  templateUrl: './heatmap.component.html',
})
export class HeatmapComponent {
  private stockSvc = inject(StockFirestoreService);
  readonly reportState = inject(ReportStateService);

  private marketStocks = toSignal(this.stockSvc.watchAllStocks(), { initialValue: [] });

  readonly fmt = formatCurrency;

  private stockRows = computed((): StockSummary[] => {
    return this.reportState.analysis()?.stocks ?? [];
  });

  profitableTiles = computed(() => this.buildTiles(this.stockRows().filter((s) => s.netPnL > 0), true));
  losingTiles = computed(() => this.buildTiles(this.stockRows().filter((s) => s.netPnL < 0), false));

  profitableTotal = computed(() => this.profitableTiles().reduce((sum, t) => sum + t.netPnL, 0));
  losingTotal = computed(() => this.losingTiles().reduce((sum, t) => sum + t.netPnL, 0));

  hasMarketData = computed(() => this.marketStocks().length > 0);

  private buildTiles(stocks: StockSummary[], positive: boolean): HeatmapTile[] {
    if (!stocks.length) return [];

    const magnitudes = stocks.map((s) => Math.abs(s.netPnL));
    const max = Math.max(...magnitudes, 1);

    return stocks
      .map((stock) => {
        const symbol = stock.symbol || normalizeSymbol(stock.stockName);
        const magnitude = Math.abs(stock.netPnL);
        const intensity = 0.28 + (magnitude / max) * 0.62;
        const weight = Math.max(1, Math.round((magnitude / max) * 8));

        return {
          symbol,
          name: stock.stockName,
          netPnL: stock.netPnL,
          winRate: stock.winRate ?? 0,
          weight,
          background: positive
            ? `rgba(16, 185, 129, ${intensity})`
            : `rgba(239, 68, 68, ${intensity})`,
          borderColor: positive ? 'rgba(5, 150, 105, 0.35)' : 'rgba(220, 38, 38, 0.35)',
        };
      })
      .sort((a, b) => b.netPnL - a.netPnL);
  }
}
