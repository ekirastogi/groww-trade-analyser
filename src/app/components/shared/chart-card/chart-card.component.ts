import {
  Component,
  ElementRef,
  input,
  viewChild,
  AfterViewInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-chart-card',
  standalone: true,
  template: `
    <div class="card h-full overflow-hidden">
      <div class="relative p-3 sm:p-4" [style.height.px]="height()">
        <canvas #canvas class="max-h-full max-w-full"></canvas>
      </div>
    </div>
  `,
})
export class ChartCardComponent implements AfterViewInit, OnDestroy {
  config = input.required<ChartConfiguration<any, any, any> | null>();
  size = input<'sm' | 'md' | 'lg'>('md');

  canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  height = () => {
    switch (this.size()) {
      case 'sm': return 240;
      case 'lg': return typeof window !== 'undefined' && window.innerWidth < 640 ? 300 : 380;
      default: return typeof window !== 'undefined' && window.innerWidth < 640 ? 260 : 320;
    }
  };

  private chart: Chart | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private ready = false;

  constructor() {
    effect(() => {
      const cfg = this.config();
      if (!this.ready) return;
      if (cfg) this.render(cfg);
      else this.destroyChart();
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
    const el = this.canvasRef()?.nativeElement?.parentElement;
    if (el) {
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(el);
    }
    const cfg = this.config();
    if (cfg) this.render(cfg);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.destroyChart();
  }

  private destroyChart(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private render(config: ChartConfiguration<any, any, any>): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.destroyChart();
    this.chart = new Chart(canvas, config);
  }
}
