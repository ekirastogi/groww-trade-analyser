/**
 * Freehand drawing layer for the P&L candle chart: trend lines, rays, boxes and Fibonacci
 * retracements, TradingView style. Shapes are stored in chart space (logical bar index +
 * price) rather than pixels, so they stay pinned to the data through zoom, pan and resize.
 */

export type DrawingKind = 'trend' | 'horizontal' | 'vertical' | 'rect' | 'fib';
export type DrawingTool = DrawingKind | 'none' | 'erase';

export interface DrawingPoint {
  logical: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  a: DrawingPoint;
  b: DrawingPoint;
  color: string;
}

export interface DrawingToolMeta {
  value: DrawingTool;
  label: string;
  hint: string;
  /** Shapes that need a second click to finish. */
  twoStep: boolean;
}

export const DRAWING_TOOLS: DrawingToolMeta[] = [
  { value: 'none', label: 'Cursor', hint: 'Pan and zoom the chart', twoStep: false },
  { value: 'trend', label: 'Trend line', hint: 'Click the start, then the end', twoStep: true },
  { value: 'horizontal', label: 'Horizontal', hint: 'Click to place a price level', twoStep: false },
  { value: 'vertical', label: 'Vertical', hint: 'Click to mark a date', twoStep: false },
  { value: 'rect', label: 'Box', hint: 'Click one corner, then the opposite', twoStep: true },
  { value: 'fib', label: 'Fib retracement', hint: 'Click the swing low, then the swing high', twoStep: true },
  { value: 'erase', label: 'Erase', hint: 'Click a drawing to delete it', twoStep: false },
];

export const DRAWING_COLORS = ['#6366f1', '#10b981', '#ef4444', '#f59e0b', '#0ea5e9', '#334155'];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Maps between chart space (logical index, price) and canvas pixels. */
export interface CoordMapper {
  x(logical: number): number | null;
  y(price: number): number | null;
  width: number;
  height: number;
}

export function isTwoStep(tool: DrawingTool): boolean {
  return DRAWING_TOOLS.find((t) => t.value === tool)?.twoStep ?? false;
}

function resolve(map: CoordMapper, point: DrawingPoint): { x: number; y: number } | null {
  const x = map.x(point.logical);
  const y = map.y(point.price);
  return x == null || y == null ? null : { x, y };
}

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  const width = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x, y - 9, width + 6, 12);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 3, y);
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  map: CoordMapper,
  formatPrice: (value: number) => string,
): void {
  const a = resolve(map, drawing.a);
  const b = resolve(map, drawing.b);
  if (!a) return;

  ctx.strokeStyle = drawing.color;
  ctx.fillStyle = drawing.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);

  switch (drawing.kind) {
    case 'horizontal':
      ctx.setLineDash([5, 4]);
      strokeLine(ctx, 0, a.y, map.width, a.y);
      ctx.setLineDash([]);
      drawLabel(ctx, formatPrice(drawing.a.price), 4, a.y - 3, drawing.color);
      break;

    case 'vertical':
      ctx.setLineDash([5, 4]);
      strokeLine(ctx, a.x, 0, a.x, map.height);
      ctx.setLineDash([]);
      break;

    case 'trend':
      if (!b) return;
      strokeLine(ctx, a.x, a.y, b.x, b.y);
      break;

    case 'rect': {
      if (!b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x, y, w, h);
      break;
    }

    case 'fib': {
      if (!b) return;
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const span = drawing.b.price - drawing.a.price;
      for (const level of FIB_LEVELS) {
        const price = drawing.a.price + span * level;
        const y = map.y(price);
        if (y == null) continue;
        ctx.globalAlpha = level === 0 || level === 1 ? 1 : 0.55;
        strokeLine(ctx, left, y, right, y);
        ctx.globalAlpha = 1;
        drawLabel(ctx, `${(level * 100).toFixed(1)}%  ${formatPrice(price)}`, left + 4, y - 3, drawing.color);
      }
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([3, 3]);
      strokeLine(ctx, a.x, a.y, b.x, b.y);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      break;
    }
  }
}

export function renderDrawings(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  preview: Drawing | null,
  map: CoordMapper,
  formatPrice: (value: number) => string,
): void {
  ctx.clearRect(0, 0, map.width, map.height);
  for (const drawing of drawings) drawOne(ctx, drawing, map, formatPrice);
  if (preview) {
    ctx.globalAlpha = 0.65;
    drawOne(ctx, preview, map, formatPrice);
    ctx.globalAlpha = 1;
  }
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Id of the drawing closest to a pixel, within `threshold` px. */
export function hitTest(
  drawings: Drawing[],
  point: { x: number; y: number },
  map: CoordMapper,
  threshold = 8,
): string | null {
  let best: { id: string; distance: number } | null = null;

  for (const drawing of drawings) {
    const a = resolve(map, drawing.a);
    const b = resolve(map, drawing.b);
    if (!a) continue;

    let distance = Number.POSITIVE_INFINITY;
    if (drawing.kind === 'horizontal') {
      distance = Math.abs(point.y - a.y);
    } else if (drawing.kind === 'vertical') {
      distance = Math.abs(point.x - a.x);
    } else if (b && drawing.kind === 'rect') {
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const y2 = Math.max(a.y, b.y);
      distance = Math.min(
        distanceToSegment(point.x, point.y, x1, y1, x2, y1),
        distanceToSegment(point.x, point.y, x2, y1, x2, y2),
        distanceToSegment(point.x, point.y, x2, y2, x1, y2),
        distanceToSegment(point.x, point.y, x1, y2, x1, y1),
      );
    } else if (b) {
      distance = distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y);
    }

    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { id: drawing.id, distance };
    }
  }

  return best?.id ?? null;
}
