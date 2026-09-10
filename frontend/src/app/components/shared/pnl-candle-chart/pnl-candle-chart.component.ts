import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CandlestickData,
  CandlestickSeries,
  IChartApi,
  Time,
  createChart,
} from 'lightweight-charts';
import { formatCompactCurrency } from '../../../utils/format.utils';

export interface PnlCandle {
  /** Trading day as an ISO date, e.g. 2026-03-14. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Renders cumulative P&L as a candlestick chart, treating the running total like a price.
 * Each candle is one trading day: it opens where the previous day closed and closes at the
 * new running total, so the series reads exactly like a stock chart of your equity.
 */
@Component({
  selector: 'app-pnl-candle-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
        <h3 class="text-sm font-semibold tracking-tight text-slate-900">{{ title() }}</h3>
        <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{{ subtitle() }}</p>
      </div>
      <div class="relative p-3 sm:p-4">
        <div #container class="h-72 w-full sm:h-80"></div>
        @if (!candles().length) {
          <div
            class="absolute inset-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center sm:inset-4"
          >
            <p class="text-sm text-slate-500">{{ emptyMessage() }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class PnlCandleChartComponent implements OnDestroy {
  candles = input.required<PnlCandle[]>();
  title = input('Cumulative P&L candles');
  subtitle = input('Each candle is one trading day of your running P&L');
  emptyMessage = input('No daily data for current filters');

  private container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart?: IChartApi;
  private series?: ReturnType<IChartApi['addSeries']>;

  constructor() {
    effect(() => this.render(this.candles()));
  }

  ngOnDestroy(): void {
    this.chart?.remove();
    this.chart = undefined;
  }

  private render(candles: PnlCandle[]): void {
    const host = this.container().nativeElement;
    if (!host) return;

    if (!this.chart) {
      this.chart = createChart(host, {
        autoSize: true,
        layout: { background: { color: '#ffffff' }, textColor: '#334155' },
        grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
        rightPriceScale: { borderColor: '#e2e8f0' },
        timeScale: { borderColor: '#e2e8f0' },
        localization: { priceFormatter: (price: number) => formatCompactCurrency(price) },
      });
      this.series = this.chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });
      // Break-even marker, so time spent underwater is obvious at a glance.
      this.series.createPriceLine({
        price: 0,
        color: '#94a3b8',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Break-even',
      });
    }

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    this.series?.setData(data);
    if (data.length) this.chart.timeScale().fitContent();
  }
}
