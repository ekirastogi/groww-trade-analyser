import { Component, input } from '@angular/core';
import { TvChartComponent } from '../tv-chart/tv-chart.component';
import { PnlCandle } from './pnl-candle.utils';

export type { PnlCandle } from './pnl-candle.utils';

/**
 * Cumulative P&L as a TradingView-style candlestick chart. Daily candles are aggregated
 * to week/month inside the shared chart; break-even is marked at zero and volume is trade count.
 */
@Component({
  selector: 'app-pnl-candle-chart',
  standalone: true,
  imports: [TvChartComponent],
  template: `
    <app-tv-chart
      [candles]="candles()"
      [symbol]="title()"
      [exchange]="exchange()"
      [emptyMessage]="emptyMessage()"
      [breakEvenPrice]="0"
      volumeLabel="Trades"
      storageKey="pnl-candles"
    />
  `,
})
export class PnlCandleChartComponent {
  candles = input.required<PnlCandle[]>();
  title = input('Cumulative P&L');
  exchange = input('NET');
  emptyMessage = input('No daily data for current filters');
}
