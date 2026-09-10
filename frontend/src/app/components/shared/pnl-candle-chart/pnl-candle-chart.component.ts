import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CandlestickData,
  CandlestickSeries,
  IChartApi,
  ISeriesApi,
  Logical,
  Time,
  createChart,
} from 'lightweight-charts';
import { formatCompactCurrency, formatCurrency } from '../../../utils/format.utils';
import {
  CANDLE_TIMEFRAMES,
  CANDLE_TIMEFRAME_LABELS,
  CandleTimeframe,
  PnlCandle,
  aggregateCandles,
} from './pnl-candle.utils';
import {
  CoordMapper,
  DRAWING_COLORS,
  DRAWING_TOOLS,
  Drawing,
  DrawingKind,
  DrawingPoint,
  DrawingTool,
  hitTest,
  isTwoStep,
  renderDrawings,
} from './chart-drawings';

export type { PnlCandle } from './pnl-candle.utils';

const TIMEFRAME_KEY = 'pnl-candles:timeframe';
const DRAWINGS_KEY = 'pnl-candles:drawings:v1';

/**
 * Cumulative P&L rendered as a candlestick chart, with day/week/month timeframes and a
 * TradingView-style drawing layer. Input candles are daily; coarser timeframes are rolled
 * up here so callers only ever build the daily series.
 */
@Component({
  selector: 'app-pnl-candle-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold tracking-tight text-slate-900">{{ title() }}</h3>
            <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{{ subtitle() }}</p>
          </div>
          <div class="pill-tabs shrink-0">
            @for (tf of timeframes; track tf.value) {
              <button
                type="button"
                class="pill-tab px-3 py-1.5 text-xs"
                [class.pill-tab-active]="timeframe() === tf.value"
                [attr.aria-pressed]="timeframe() === tf.value"
                [title]="'Group candles by ' + labels[tf.value]"
                (click)="setTimeframe(tf.value)"
              >
                {{ tf.label }}
              </button>
            }
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="pill-tabs">
            @for (t of tools; track t.value) {
              <button
                type="button"
                class="pill-tab px-2.5 py-1.5 text-xs"
                [class.pill-tab-active]="tool() === t.value"
                [attr.aria-pressed]="tool() === t.value"
                [title]="t.hint"
                (click)="setTool(t.value)"
              >
                {{ t.label }}
              </button>
            }
          </div>

          <div class="flex items-center gap-1.5">
            @for (c of colors; track c) {
              <button
                type="button"
                class="h-5 w-5 rounded-full border-2 transition"
                [style.background-color]="c"
                [style.border-color]="color() === c ? '#0f172a' : 'transparent'"
                [attr.aria-label]="'Use colour ' + c"
                [attr.aria-pressed]="color() === c"
                (click)="color.set(c)"
              ></button>
            }
          </div>

          <div class="ml-auto flex items-center gap-2">
            @if (drawings().length) {
              <span class="text-xs text-slate-400">{{ drawings().length }} drawn</span>
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="undo()">Undo</button>
              <button type="button" class="btn-ghost px-2 py-1 text-xs" (click)="clearDrawings()">Clear</button>
            }
          </div>
        </div>

        @if (activeHint(); as hint) {
          <p class="text-xs text-indigo-600">{{ hint }}</p>
        }
      </div>

      <div class="p-3 sm:p-4">
        <div class="relative h-72 w-full sm:h-96">
          <div #container class="absolute inset-0"></div>
          <canvas
            #overlay
            class="absolute inset-0 h-full w-full"
            [class.pointer-events-none]="tool() === 'none'"
            [style.cursor]="tool() === 'none' ? null : 'crosshair'"
            (pointerdown)="onPointerDown($event)"
            (pointermove)="onPointerMove($event)"
            (pointerleave)="onPointerLeave()"
          ></canvas>
          @if (!view().length) {
            <div
              class="absolute inset-0 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center"
            >
              <p class="text-sm text-slate-500">{{ emptyMessage() }}</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class PnlCandleChartComponent implements OnDestroy {
  /** Daily candles, sorted ascending. Coarser timeframes are aggregated internally. */
  candles = input.required<PnlCandle[]>();
  title = input('Cumulative P&L candles');
  subtitle = input('Your running P&L as a candlestick chart');
  emptyMessage = input('No daily data for current filters');

  readonly timeframes = CANDLE_TIMEFRAMES;
  readonly labels = CANDLE_TIMEFRAME_LABELS;
  readonly tools = DRAWING_TOOLS;
  readonly colors = DRAWING_COLORS;

  timeframe = signal<CandleTimeframe>(readTimeframe());
  tool = signal<DrawingTool>('none');
  color = signal<string>(DRAWING_COLORS[0]);
  drawings = signal<Drawing[]>([]);

  /** First click of a two-step shape, waiting for its second. */
  private anchor = signal<DrawingPoint | null>(null);
  private cursor = signal<DrawingPoint | null>(null);

  view = computed(() => aggregateCandles(this.candles(), this.timeframe()));

  activeHint = computed(() => {
    const tool = this.tool();
    if (tool === 'none') return null;
    const meta = DRAWING_TOOLS.find((t) => t.value === tool);
    if (!meta) return null;
    if (this.anchor()) return 'Click again to finish, or press Escape to cancel';
    return meta.hint;
  });

  private container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private overlay = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');

  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private resizeObserver?: ResizeObserver;
  private detachChart?: () => void;

  constructor() {
    this.drawings.set(readDrawings(this.timeframe()));

    effect(() => {
      const data = this.view();
      this.ensureChart();
      this.series?.setData(
        data.map<CandlestickData>((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
      if (data.length) this.chart?.timeScale().fitContent();
      this.paint();
    });

    // Redraw the overlay whenever the shapes or the in-progress preview change.
    effect(() => {
      this.drawings();
      this.anchor();
      this.cursor();
      this.color();
      this.tool();
      this.paint();
    });
  }

  ngOnDestroy(): void {
    this.detachChart?.();
    this.resizeObserver?.disconnect();
    this.chart?.remove();
    this.chart = undefined;
    window.removeEventListener('keydown', this.onKeyDown);
  }

  setTimeframe(timeframe: CandleTimeframe): void {
    if (timeframe === this.timeframe()) return;
    this.cancelPending();
    this.timeframe.set(timeframe);
    // Shapes are anchored to bar indices, which mean different dates per timeframe,
    // so each timeframe keeps its own set.
    this.drawings.set(readDrawings(timeframe));
    safeWrite(TIMEFRAME_KEY, timeframe);
  }

  setTool(tool: DrawingTool): void {
    this.cancelPending();
    this.tool.set(tool);
    // Let the chart pan/zoom only when no drawing tool is armed.
    this.chart?.applyOptions({ handleScroll: tool === 'none', handleScale: tool === 'none' });
  }

  undo(): void {
    this.commit(this.drawings().slice(0, -1));
  }

  clearDrawings(): void {
    this.cancelPending();
    this.commit([]);
  }

  onPointerDown(event: PointerEvent): void {
    const tool = this.tool();
    if (tool === 'none') return;

    const point = this.toChartPoint(event);
    if (!point) return;

    if (tool === 'erase') {
      const map = this.mapper();
      if (!map) return;
      const id = hitTest(this.drawings(), this.toPixel(event), map);
      if (id) this.commit(this.drawings().filter((d) => d.id !== id));
      return;
    }

    if (!isTwoStep(tool)) {
      this.addDrawing(tool, point, point);
      return;
    }

    const anchor = this.anchor();
    if (!anchor) {
      this.anchor.set(point);
      this.cursor.set(point);
      return;
    }
    this.addDrawing(tool, anchor, point);
    this.cancelPending();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.tool() === 'none' || !this.anchor()) return;
    this.cursor.set(this.toChartPoint(event));
  }

  onPointerLeave(): void {
    if (this.anchor()) this.cursor.set(null);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.cancelPending();
  };

  private cancelPending(): void {
    this.anchor.set(null);
    this.cursor.set(null);
  }

  private addDrawing(kind: DrawingTool, a: DrawingPoint, b: DrawingPoint): void {
    if (kind === 'none' || kind === 'erase') return;
    const drawing: Drawing = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: kind as DrawingKind,
      a,
      b,
      color: this.color(),
    };
    this.commit([...this.drawings(), drawing]);
  }

  private commit(drawings: Drawing[]): void {
    this.drawings.set(drawings);
    safeWrite(drawingsKey(this.timeframe()), JSON.stringify(drawings));
  }

  private ensureChart(): void {
    if (this.chart) return;
    const host = this.container().nativeElement;

    this.chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: '#ffffff' }, textColor: '#334155', attributionLogo: false },
      grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
      rightPriceScale: { borderColor: '#e2e8f0' },
      timeScale: { borderColor: '#e2e8f0', rightOffset: 4 },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (price: number) => formatCompactCurrency(price) },
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Break-even marker, so stretches spent underwater are obvious.
    this.series.createPriceLine({
      price: 0,
      color: '#94a3b8',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'Break-even',
    });

    const repaint = () => this.paint();
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(repaint);
    this.detachChart = () => this.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(repaint);

    this.resizeObserver = new ResizeObserver(() => this.paint());
    this.resizeObserver.observe(host);

    window.addEventListener('keydown', this.onKeyDown);
  }

  private mapper(): CoordMapper | null {
    if (!this.chart || !this.series) return null;
    const canvas = this.overlay().nativeElement;
    const timeScale = this.chart.timeScale();
    return {
      x: (logical) => timeScale.logicalToCoordinate(logical as Logical),
      y: (price) => this.series?.priceToCoordinate(price) ?? null,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  }

  private toPixel(event: PointerEvent): { x: number; y: number } {
    const rect = this.overlay().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toChartPoint(event: PointerEvent): DrawingPoint | null {
    if (!this.chart || !this.series) return null;
    const { x, y } = this.toPixel(event);
    const logical = this.chart.timeScale().coordinateToLogical(x);
    const price = this.series.coordinateToPrice(y);
    if (logical == null || price == null) return null;
    return { logical, price };
  }

  private paint(): void {
    const canvas = this.overlay()?.nativeElement;
    const map = this.mapper();
    if (!canvas || !map || !map.width || !map.height) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== map.width * dpr || canvas.height !== map.height * dpr) {
      canvas.width = map.width * dpr;
      canvas.height = map.height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderDrawings(ctx, this.drawings(), this.previewShape(), map, (v) => formatCurrency(v));
  }

  private previewShape(): Drawing | null {
    const anchor = this.anchor();
    const cursor = this.cursor();
    const tool = this.tool();
    if (!anchor || !cursor || tool === 'none' || tool === 'erase') return null;
    return { id: 'preview', kind: tool as DrawingKind, a: anchor, b: cursor, color: this.color() };
  }
}

function drawingsKey(timeframe: CandleTimeframe): string {
  return `${DRAWINGS_KEY}:${timeframe}`;
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage disabled or full: drawings simply won't persist.
  }
}

function readTimeframe(): CandleTimeframe {
  try {
    const raw = localStorage.getItem(TIMEFRAME_KEY);
    if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  } catch {
    // ignore
  }
  return 'day';
}

function readDrawings(timeframe: CandleTimeframe): Drawing[] {
  try {
    const raw = localStorage.getItem(drawingsKey(timeframe));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is Drawing =>
        !!d &&
        typeof d === 'object' &&
        typeof (d as Drawing).id === 'string' &&
        typeof (d as Drawing).color === 'string' &&
        Number.isFinite((d as Drawing).a?.logical) &&
        Number.isFinite((d as Drawing).a?.price),
    );
  } catch {
    return [];
  }
}
