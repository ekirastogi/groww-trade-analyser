import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { createChart, IChartApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { Candle } from '../../models/market.models';

@Component({
  selector: 'app-trading-chart',
  standalone: true,
  imports: [CommonModule],
  template: `<div #chartContainer class="h-80 w-full rounded-lg border border-slate-200 bg-white"></div>`,
})
export class TradingChartComponent implements OnChanges, OnDestroy {
  @ViewChild('chartContainer', { static: true }) container!: ElementRef<HTMLDivElement>;
  @Input() candles: Candle[] = [];
  @Input() supportLevels: number[] = [];
  @Input() resistanceLevels: number[] = [];

  private chart?: IChartApi;
  private series?: ReturnType<IChartApi['addSeries']>;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['candles'] && this.candles.length) {
      this.render();
    }
  }

  ngOnDestroy(): void {
    this.chart?.remove();
  }

  private render(): void {
    if (!this.container?.nativeElement) return;

    if (!this.chart) {
      this.chart = createChart(this.container.nativeElement, {
        layout: { background: { color: '#ffffff' }, textColor: '#334155' },
        grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
        rightPriceScale: { borderColor: '#e2e8f0' },
        timeScale: { borderColor: '#e2e8f0' },
      });
      this.series = this.chart.addSeries(CandlestickSeries, {
        upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
        wickUpColor: '#10b981', wickDownColor: '#ef4444',
      });
    }

    const data: CandlestickData[] = this.candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    this.series!.setData(data);
    this.chart.timeScale().fitContent();
  }
}
