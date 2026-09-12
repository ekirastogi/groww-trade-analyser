import {
  Component,
  ElementRef,
  HostListener,
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
  CrosshairMode,
  HistogramData,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  Logical,
  MouseEventParams,
  PriceScaleMode,
  Time,
  createChart,
} from 'lightweight-charts';
import { formatCompactCurrency, formatCurrency } from '../../../utils/format.utils';
import { CHART_COLORS } from '../../../utils/chart-theme';
import {
  CANDLE_TIMEFRAMES,
  CANDLE_TIMEFRAME_LABELS,
  CHART_RANGES,
  CandleTimeframe,
  ChartRange,
  PriceScaleKind,
  TvCandle,
} from './tv-chart.models';
import {
  aggregateCandles,
  firstCandleOnOrAfter,
  hasNegativePrices,
  rangeFromDate,
  safeRead,
  safeWrite,
  smaPoints,
  snapPriceToCandle,
} from './tv-chart.utils';
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
  parseDrawings,
  renderDrawings,
} from './chart-drawings';

export type { TvCandle } from './tv-chart.models';

const UP = CHART_COLORS.primary;
const DOWN = CHART_COLORS.danger;
const SMA20 = '#6366f1';
const SMA50 = '#f59e0b';

export interface RailItem {
  id: string;
  kind: 'tool' | 'toggle' | 'action' | 'gap';
  value?: DrawingTool | 'magnet' | 'lock' | 'hide' | 'clear';
  hint: string;
  paths: string[];
  pathsOn?: string[];
}

const RAIL: RailItem[] = [
  { id: 'cursor', kind: 'tool', value: 'cursor', hint: 'Crosshair · pan and zoom', paths: ['M12 3v18', 'M3 12h18'] },
  { id: 'trend', kind: 'tool', value: 'trend', hint: 'Trend line', paths: ['M4 18L20 6'] },
  { id: 'ray', kind: 'tool', value: 'ray', hint: 'Ray', paths: ['M4 18L16 8', 'M16 8l4-2', 'M16 8l2 4'] },
  { id: 'horizontal', kind: 'tool', value: 'horizontal', hint: 'Horizontal line', paths: ['M3 12h18'] },
  { id: 'vertical', kind: 'tool', value: 'vertical', hint: 'Vertical line', paths: ['M12 3v18'] },
  { id: 'gap-1', kind: 'gap', hint: '', paths: [] },
  { id: 'rect', kind: 'tool', value: 'rect', hint: 'Rectangle', paths: ['M5 6h14v12H5z'] },
  { id: 'fib', kind: 'tool', value: 'fib', hint: 'Fib retracement', paths: ['M4 7h16', 'M4 12h16', 'M4 17h16', 'M5 19L19 5'] },
  { id: 'text', kind: 'tool', value: 'text', hint: 'Text note', paths: ['M6 6h12', 'M12 6v12', 'M8 18h8'] },
  { id: 'measure', kind: 'tool', value: 'measure', hint: 'Measure', paths: ['M4 8h16v8H4z', 'M8 8v8', 'M12 8v8', 'M16 8v8'] },
  { id: 'zoom', kind: 'tool', value: 'zoom', hint: 'Zoom box · drag a region', paths: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35'] },
  { id: 'erase', kind: 'tool', value: 'erase', hint: 'Eraser · click a drawing', paths: ['M19 13l-6 6H5l-2-2 12-12 4 4z'] },
  { id: 'gap-2', kind: 'gap', hint: '', paths: [] },
  {
    id: 'magnet',
    kind: 'toggle',
    value: 'magnet',
    hint: 'Magnet · snap to OHLC',
    paths: ['M7 13v-3a5 5 0 0110 0v3', 'M7 13v4h3v-4H7z', 'M14 13v4h3v-4h-3z'],
  },
  {
    id: 'lock',
    kind: 'toggle',
    value: 'lock',
    hint: 'Lock drawings',
    paths: ['M8 11V8a4 4 0 118 0v3', 'M7 11h10v9H7z'],
    pathsOn: ['M8 11V8a4 4 0 018 0', 'M7 11h10v9H7z'],
  },
  {
    id: 'hide',
    kind: 'toggle',
    value: 'hide',
    hint: 'Hide drawings',
    paths: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],
    pathsOn: ['M3 3l18 18', 'M10.6 10.6A3 3 0 0112 9c1.7 0 3 1.3 3 3', 'M9.9 5.2A11 11 0 0112 5c6.5 0 10 7 10 7a18 18 0 01-4.2 4.8M6.1 6.1A18 18 0 002 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8'],
  },
  { id: 'clear', kind: 'action', value: 'clear', hint: 'Remove all drawings', paths: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 12h10l1-12'] },
];

/**
 * Reusable TradingView-style candlestick chart: left drawing rail, interval bar, overlays,
 * volume histogram, and visible-range controls. Pass daily candles; coarser timeframes are
 * aggregated internally.
 */
@Component({
  selector: 'app-tv-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tv-chart.component.html',
  styleUrl: './tv-chart.component.scss',
})
export class TvChartComponent implements OnDestroy {
  candles = input.required<TvCandle[]>();
  symbol = input('Chart');
  exchange = input('');
  emptyMessage = input('No data for current filters');
  volumeLabel = input('Volume');
  breakEvenPrice = input<number | null>(null);
  storageKey = input('tv-chart');
  formatLegendValue = input<(value: number) => string>(formatCurrency);
  formatAxisValue = input<(value: number) => string>(formatCompactCurrency);

  readonly timeframes = CANDLE_TIMEFRAMES;
  readonly ranges = CHART_RANGES;
  readonly colors = DRAWING_COLORS;
  readonly railItems = RAIL;

  timeframe = signal<CandleTimeframe>('day');
  tool = signal<DrawingTool>('cursor');
  color = signal<string>(DRAWING_COLORS[0]);
  drawings = signal<Drawing[]>([]);
  magnet = signal(false);
  locked = signal(false);
  hidden = signal(false);
  fullscreen = signal(false);
  indicatorsOpen = signal(false);
  showSma20 = signal(false);
  showSma50 = signal(false);
  showVolume = signal(true);
  showBreakEven = signal(true);
  scaleMode = signal<PriceScaleKind>('normal');
  range = signal<ChartRange>('all');
  hover = signal<TvCandle | null>(null);
  textDraft = signal<{ x: number; y: number; point: DrawingPoint; value: string } | null>(null);

  private undoStack: Drawing[][] = [];
  private redoStack: Drawing[][] = [];
  private zoomStart: DrawingPoint | null = null;
  private zoomPixel: { x: number; y: number } | null = null;

  private anchor = signal<DrawingPoint | null>(null);
  private cursorPt = signal<DrawingPoint | null>(null);

  view = computed(() => aggregateCandles(this.candles(), this.timeframe()));

  legend = computed(() => this.hover() ?? this.view().at(-1) ?? null);

  logDisabled = computed(() => hasNegativePrices(this.view()));

  overlayArmed = computed(() => {
    if (this.locked() && this.tool() !== 'erase' && this.tool() !== 'zoom') return false;
    return this.tool() !== 'cursor';
  });

  overlayCursor = computed(() => {
    const tool = this.tool();
    if (tool === 'cursor') return null;
    if (tool === 'zoom') return 'zoom-in';
    if (tool === 'erase') return 'pointer';
    if (tool === 'text') return 'text';
    return 'crosshair';
  });

  timeframeLabel = computed(() => CANDLE_TIMEFRAME_LABELS[this.timeframe()]);

  activeHint = computed(() => {
    const tool = this.tool();
    if (tool === 'cursor') return null;
    const meta = DRAWING_TOOLS.find((t) => t.value === tool);
    if (!meta) return null;
    if (this.anchor()) return 'Click again to finish, or press Escape to cancel';
    if (this.zoomStart) return 'Drag to select a region, then release';
    return meta.hint;
  });

  canUndo = computed(() => {
    this.drawings();
    return this.undoStack.length > 0;
  });

  canRedo = computed(() => {
    this.drawings();
    return this.redoStack.length > 0;
  });

  private container = viewChild<ElementRef<HTMLDivElement>>('container');
  private overlay = viewChild<ElementRef<HTMLCanvasElement>>('overlay');
  private textInput = viewChild<ElementRef<HTMLInputElement>>('textInput');
  private shell = viewChild<ElementRef<HTMLDivElement>>('shell');

  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private sma20Series?: ISeriesApi<'Line'>;
  private sma50Series?: ISeriesApi<'Line'>;
  private breakEvenLine?: IPriceLine;
  private resizeObserver?: ResizeObserver;
  private detach: Array<() => void> = [];

  constructor(private readonly host: ElementRef<HTMLElement>) {
    effect(() => {
      this.hydrate(this.storageKey());
    });

    effect(() => {
      const data = this.view();
      this.container();
      this.overlay();
      this.ensureChart();
      this.pushSeries(data);
      if (hasNegativePrices(data) && this.scaleMode() === 'log') {
        this.scaleMode.set('normal');
      }
      this.applyVisibleRange(this.range(), data);
      this.paint();
    });

    effect(() => {
      this.drawings();
      this.anchor();
      this.cursorPt();
      this.color();
      this.tool();
      this.hidden();
      this.paint();
    });

    effect(() => {
      this.applyScaleMode(this.scaleMode());
    });

    effect(() => {
      this.applyCrosshair(this.magnet());
    });

    effect(() => {
      const armed = this.overlayArmed();
      this.chart?.applyOptions({ handleScroll: !armed, handleScale: !armed });
    });

    effect(() => {
      this.sma20Series?.applyOptions({ visible: this.showSma20() });
      this.sma50Series?.applyOptions({ visible: this.showSma50() });
      this.volumeSeries?.applyOptions({ visible: this.showVolume() });
    });

    effect(() => {
      const price = this.breakEvenPrice();
      const visible = this.showBreakEven() && price != null;
      if (!this.breakEvenLine) return;
      this.breakEvenLine.applyOptions({
        price: price ?? 0,
        lineVisible: visible,
        axisLabelVisible: visible,
      });
    });
  }

  ngOnDestroy(): void {
    this.detach.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.chart?.remove();
    this.chart = undefined;
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  formatLegend(value: number): string {
    return this.formatLegendValue()(value);
  }

  formatVolume(value: number): string {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}K`;
    return String(Math.round(value));
  }

  changeText(row: TvCandle): string {
    const delta = row.close - row.open;
    const sign = delta > 0 ? '+' : '';
    const abs = this.formatLegend(Math.abs(delta));
    const signed = delta < 0 ? `-${abs}` : `${sign}${abs}`;
    if (row.open === 0) return signed;
    const pct = (delta / Math.abs(row.open)) * 100;
    const pctSign = pct > 0 ? '+' : '';
    return `${signed} (${pctSign}${pct.toFixed(2)}%)`;
  }

  changeClass(row: TvCandle): string {
    if (row.close > row.open) return 'text-emerald-600';
    if (row.close < row.open) return 'text-red-600';
    return 'text-slate-500';
  }

  isRailActive(item: RailItem): boolean {
    if (item.kind === 'tool') return this.tool() === item.value;
    if (item.value === 'magnet') return this.magnet();
    if (item.value === 'lock') return this.locked();
    if (item.value === 'hide') return this.hidden();
    return false;
  }

  railPaths(item: RailItem): string[] {
    if (item.value === 'lock' && this.locked() && item.pathsOn) return item.pathsOn;
    if (item.value === 'hide' && this.hidden() && item.pathsOn) return item.pathsOn;
    return item.paths;
  }

  onRailClick(item: RailItem): void {
    if (item.kind === 'tool' && item.value) {
      this.setTool(item.value as DrawingTool);
      return;
    }
    if (item.value === 'magnet') this.magnet.update((v) => !v);
    if (item.value === 'lock') {
      this.locked.update((v) => !v);
      if (this.locked()) this.setTool('cursor');
    }
    if (item.value === 'hide') this.hidden.update((v) => !v);
    if (item.value === 'clear') this.clearDrawings();
  }

  setTimeframe(timeframe: CandleTimeframe): void {
    if (timeframe === this.timeframe()) return;
    this.cancelPending();
    this.timeframe.set(timeframe);
    this.drawings.set(this.readDrawings(timeframe));
    this.undoStack = [];
    this.redoStack = [];
    safeWrite(this.key('timeframe'), timeframe);
  }

  setTool(tool: DrawingTool): void {
    if (this.locked() && tool !== 'cursor' && tool !== 'erase' && tool !== 'zoom') return;
    this.cancelPending();
    this.tool.set(tool);
  }

  setRange(range: ChartRange): void {
    this.range.set(range);
    this.applyVisibleRange(range, this.view());
  }

  fitContent(): void {
    this.range.set('all');
    this.chart?.timeScale().fitContent();
  }

  togglePercentScale(): void {
    this.scaleMode.update((mode) => (mode === 'percent' ? 'normal' : 'percent'));
  }

  toggleLogScale(): void {
    if (this.logDisabled()) return;
    this.scaleMode.update((mode) => (mode === 'log' ? 'normal' : 'log'));
  }

  toggleIndicators(event: Event): void {
    event.stopPropagation();
    this.indicatorsOpen.update((v) => !v);
  }

  toggleSma20(): void {
    this.showSma20.update((v) => !v);
    this.persistIndicators();
  }

  toggleSma50(): void {
    this.showSma50.update((v) => !v);
    this.persistIndicators();
  }

  toggleVolume(): void {
    this.showVolume.update((v) => !v);
    this.persistIndicators();
  }

  toggleBreakEven(): void {
    this.showBreakEven.update((v) => !v);
    this.persistIndicators();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.drawings());
    this.drawings.set(prev);
    this.persistDrawings();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.drawings());
    this.drawings.set(next);
    this.persistDrawings();
  }

  clearDrawings(): void {
    this.cancelPending();
    this.commitDrawings([]);
  }

  downloadScreenshot(): void {
    if (!this.chart) return;
    const shot = this.chart.takeScreenshot(true);
    const overlay = this.overlay()?.nativeElement;
    const out = document.createElement('canvas');
    out.width = shot.width;
    out.height = shot.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(shot, 0, 0);
    if (overlay && overlay.width && overlay.height) {
      ctx.drawImage(overlay, 0, 0, out.width, out.height);
    }
    const name = `${this.symbol().replace(/\s+/g, '-').toLowerCase()}-${this.timeframe()}.png`;
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  toggleFullscreen(): void {
    const root = this.shell()?.nativeElement ?? this.host.nativeElement;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void root.requestFullscreen();
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.overlayArmed()) return;
    const tool = this.tool();
    const point = this.toChartPoint(event);
    if (!point) return;

    if (tool === 'zoom') {
      this.zoomStart = point;
      this.zoomPixel = this.toPixel(event);
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }

    if (tool === 'erase') {
      if (this.hidden()) return;
      const map = this.mapper();
      if (!map) return;
      const id = hitTest(this.drawings(), this.toPixel(event), map);
      if (id) this.commitDrawings(this.drawings().filter((d) => d.id !== id));
      return;
    }

    if (tool === 'text') {
      const pixel = this.toPixel(event);
      this.textDraft.set({ x: pixel.x, y: pixel.y - 10, point, value: '' });
      queueMicrotask(() => this.textInput()?.nativeElement.focus());
      return;
    }

    if (!isTwoStep(tool)) {
      this.addDrawing(tool, point, point);
      return;
    }

    const anchor = this.anchor();
    if (!anchor) {
      this.anchor.set(point);
      this.cursorPt.set(point);
      return;
    }
    this.addDrawing(tool, anchor, point);
    this.cancelPending();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.tool() === 'zoom' && this.zoomStart) {
      this.cursorPt.set(this.toChartPoint(event));
      this.zoomPixel = this.toPixel(event);
      this.paint();
      return;
    }
    if (this.tool() === 'cursor' || !this.anchor()) return;
    this.cursorPt.set(this.toChartPoint(event));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.tool() !== 'zoom' || !this.zoomStart) return;
    const end = this.toChartPoint(event);
    const start = this.zoomStart;
    this.zoomStart = null;
    this.zoomPixel = null;
    this.cursorPt.set(null);
    if (!end || !this.chart) {
      this.paint();
      return;
    }
    const from = Math.min(start.logical, end.logical);
    const to = Math.max(start.logical, end.logical);
    if (to - from < 1) {
      this.paint();
      return;
    }
    this.chart.timeScale().setVisibleLogicalRange({ from, to });
    this.range.set('all');
    this.setTool('cursor');
  }

  onPointerLeave(): void {
    if (this.anchor()) this.cursorPt.set(null);
  }

  onTextInput(event: Event): void {
    const draft = this.textDraft();
    if (!draft) return;
    this.textDraft.set({ ...draft, value: (event.target as HTMLInputElement).value });
  }

  commitText(): void {
    const draft = this.textDraft();
    if (!draft) return;
    const text = draft.value.trim();
    this.textDraft.set(null);
    if (!text) return;
    this.addDrawing('text', draft.point, draft.point, text);
  }

  cancelText(): void {
    this.textDraft.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.indicatorsOpen.set(false);
  }

  private hydrate(storageKey: string): void {
    const tf = safeRead(`${storageKey}:timeframe`);
    if (tf === 'day' || tf === 'week' || tf === 'month') this.timeframe.set(tf);
    this.drawings.set(this.readDrawings(this.timeframe()));
    this.undoStack = [];
    this.redoStack = [];
    try {
      const raw = safeRead(`${storageKey}:indicators`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          sma20: boolean;
          sma50: boolean;
          volume: boolean;
          breakEven: boolean;
        }>;
        if (typeof parsed.sma20 === 'boolean') this.showSma20.set(parsed.sma20);
        if (typeof parsed.sma50 === 'boolean') this.showSma50.set(parsed.sma50);
        if (typeof parsed.volume === 'boolean') this.showVolume.set(parsed.volume);
        if (typeof parsed.breakEven === 'boolean') this.showBreakEven.set(parsed.breakEven);
      }
    } catch {
      // ignore
    }
  }

  private key(suffix: string): string {
    return `${this.storageKey()}:${suffix}`;
  }

  private readDrawings(timeframe: CandleTimeframe): Drawing[] {
    return parseDrawings(safeRead(`${this.storageKey()}:drawings:v1:${timeframe}`));
  }

  private persistDrawings(): void {
    safeWrite(`${this.storageKey()}:drawings:v1:${this.timeframe()}`, JSON.stringify(this.drawings()));
  }

  private persistIndicators(): void {
    safeWrite(
      this.key('indicators'),
      JSON.stringify({
        sma20: this.showSma20(),
        sma50: this.showSma50(),
        volume: this.showVolume(),
        breakEven: this.showBreakEven(),
      }),
    );
  }

  private commitDrawings(drawings: Drawing[]): void {
    this.undoStack.push(this.drawings());
    this.redoStack = [];
    this.drawings.set(drawings);
    this.persistDrawings();
  }

  private cancelPending(): void {
    this.anchor.set(null);
    this.cursorPt.set(null);
    this.zoomStart = null;
    this.zoomPixel = null;
    this.textDraft.set(null);
  }

  private addDrawing(kind: DrawingTool, a: DrawingPoint, b: DrawingPoint, text?: string): void {
    if (kind === 'cursor' || kind === 'erase' || kind === 'zoom') return;
    const drawing: Drawing = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: kind as DrawingKind,
      a,
      b,
      color: this.color(),
      text,
    };
    this.commitDrawings([...this.drawings(), drawing]);
  }

  private ensureChart(): void {
    if (this.chart) return;
    const host = this.container()?.nativeElement;
    if (!host) return;

    this.chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#64748b',
        attributionLogo: false,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        fontSize: 11,
      },
      grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
      rightPriceScale: { borderColor: '#e2e8f0', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: '#e2e8f0', rightOffset: 4, minBarSpacing: 4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#94a3b8', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
        horzLine: { color: '#94a3b8', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
      },
      localization: { priceFormatter: (price: number) => this.formatAxisValue()(price) },
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    this.sma20Series = this.chart.addSeries(LineSeries, {
      color: SMA20,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: this.showSma20(),
    });
    this.sma50Series = this.chart.addSeries(LineSeries, {
      color: SMA50,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: this.showSma50(),
    });

    if (this.breakEvenPrice() != null) {
      this.breakEvenLine = this.series.createPriceLine({
        price: this.breakEvenPrice() ?? 0,
        color: '#94a3b8',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'BE',
      });
    }

    const onRange = () => this.paint();
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    this.detach.push(() => this.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !this.series) {
        this.hover.set(null);
        return;
      }
      const candle = param.seriesData.get(this.series) as CandlestickData | undefined;
      const volume = this.volumeSeries
        ? (param.seriesData.get(this.volumeSeries) as HistogramData | undefined)
        : undefined;
      if (!candle || typeof candle.open !== 'number') {
        this.hover.set(null);
        return;
      }
      this.hover.set({
        time: String(param.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: typeof volume?.value === 'number' ? volume.value : undefined,
      });
    };
    this.chart.subscribeCrosshairMove(onMove);
    this.detach.push(() => this.chart?.unsubscribeCrosshairMove(onMove));

    this.resizeObserver = new ResizeObserver(() => this.paint());
    this.resizeObserver.observe(host);

    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private pushSeries(data: TvCandle[]): void {
    this.series?.setData(
      data.map<CandlestickData>((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    this.volumeSeries?.setData(
      data.map<HistogramData>((c) => ({
        time: c.time as Time,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(0, 208, 156, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      })),
    );
    this.sma20Series?.setData(smaPoints(data, 20).map((p) => ({ time: p.time as Time, value: p.value })));
    this.sma50Series?.setData(smaPoints(data, 50).map((p) => ({ time: p.time as Time, value: p.value })));
  }

  private applyVisibleRange(range: ChartRange, data: TvCandle[]): void {
    if (!this.chart || !data.length) return;
    if (range === 'all') {
      this.chart.timeScale().fitContent();
      return;
    }
    const from = rangeFromDate(data, range);
    if (!from) return;
    const start = firstCandleOnOrAfter(data, from);
    this.chart.timeScale().setVisibleRange({
      from: start.time as Time,
      to: data[data.length - 1].time as Time,
    });
  }

  private applyScaleMode(mode: PriceScaleKind): void {
    if (!this.chart) return;
    const next =
      mode === 'percent' ? PriceScaleMode.Percentage : mode === 'log' ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;
    this.chart.priceScale('right').applyOptions({ mode: next });
  }

  private applyCrosshair(magnet: boolean): void {
    this.chart?.applyOptions({
      crosshair: { mode: magnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal },
    });
  }

  private mapper(): CoordMapper | null {
    if (!this.chart || !this.series) return null;
    const canvas = this.overlay()?.nativeElement;
    if (!canvas) return null;
    const timeScale = this.chart.timeScale();
    return {
      x: (logical) => timeScale.logicalToCoordinate(logical as Logical),
      y: (price) => this.series?.priceToCoordinate(price) ?? null,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  }

  private toPixel(event: PointerEvent): { x: number; y: number } {
    const rect = this.overlay()!.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toChartPoint(event: PointerEvent): DrawingPoint | null {
    if (!this.chart || !this.series) return null;
    const { x, y } = this.toPixel(event);
    const logicalRaw = this.chart.timeScale().coordinateToLogical(x);
    const priceRaw = this.series.coordinateToPrice(y);
    if (logicalRaw == null || priceRaw == null) return null;
    const logical = Math.round(logicalRaw);
    const candles = this.view();
    const candle = candles[logical];
    const price = this.magnet() && candle ? snapPriceToCandle(candle, priceRaw) : priceRaw;
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

    const drawings = this.hidden() ? [] : this.drawings();
    renderDrawings(ctx, drawings, this.hidden() ? null : this.previewShape(), map, (v) => this.formatLegend(v));

    if (this.tool() === 'zoom' && this.zoomStart && this.zoomPixel && this.anchorPixel(this.zoomStart)) {
      const a = this.anchorPixel(this.zoomStart)!;
      const b = this.zoomPixel;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      ctx.fillStyle = 'rgba(13, 148, 136, 0.12)';
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  }

  private anchorPixel(point: DrawingPoint): { x: number; y: number } | null {
    const map = this.mapper();
    if (!map) return null;
    const x = map.x(point.logical);
    const y = map.y(point.price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  private previewShape(): Drawing | null {
    const anchor = this.anchor();
    const cursor = this.cursorPt();
    const tool = this.tool();
    if (!anchor || !cursor || tool === 'cursor' || tool === 'erase' || tool === 'zoom' || tool === 'text') return null;
    return { id: 'preview', kind: tool as DrawingKind, a: anchor, b: cursor, color: this.color() };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (event.key === 'Escape') {
      this.cancelPending();
      this.indicatorsOpen.set(false);
      if (this.tool() !== 'cursor') this.setTool('cursor');
      return;
    }
    if (typing) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    }
  };

  private onFullscreenChange = (): void => {
    this.fullscreen.set(!!document.fullscreenElement);
  };
}
