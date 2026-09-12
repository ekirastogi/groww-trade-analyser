/**
 * TradingView-style drawing layer: trend lines, rays, boxes, fib retracements, measure and
 * text. Shapes are stored in chart space (logical bar index + price) rather than pixels, so
 * they stay pinned to the data through zoom, pan and resize.
 */

export type DrawingKind =
  | 'trend'
  | 'ray'
  | 'horizontal'
  | 'vertical'
  | 'rect'
  | 'fib'
  | 'measure'
  | 'text';

export type DrawingTool = DrawingKind | 'cursor' | 'zoom' | 'erase';

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
  text?: string;
}

export interface DrawingToolMeta {
  value: DrawingTool;
  label: string;
  hint: string;
  /** Shapes that need a second click (or a drag, for zoom) to finish. */
  twoStep: boolean;
  paths: string[];
}

export const DRAWING_TOOLS: DrawingToolMeta[] = [
  { value: 'cursor', label: 'Crosshair', hint: 'Drag to pan · scroll to zoom', twoStep: false, paths: ['M12 3v18', 'M3 12h18'] },
  { value: 'trend', label: 'Trend line', hint: 'Press, drag, and release', twoStep: true, paths: ['M4 18L20 6'] },
  { value: 'ray', label: 'Ray', hint: 'Press, drag, and release', twoStep: true, paths: ['M4 18L16 8', 'M16 8l4-2', 'M16 8l2 4'] },
  { value: 'horizontal', label: 'Horizontal', hint: 'Drag to a price, then release', twoStep: false, paths: ['M3 12h18'] },
  { value: 'vertical', label: 'Vertical', hint: 'Drag to a date, then release', twoStep: false, paths: ['M12 3v18'] },
  { value: 'rect', label: 'Rectangle', hint: 'Press, drag, and release', twoStep: true, paths: ['M5 6h14v12H5z'] },
  { value: 'fib', label: 'Fib retracement', hint: 'Drag from swing low to swing high', twoStep: true, paths: ['M4 7h16', 'M4 12h16', 'M4 17h16', 'M5 19L19 5'] },
  { value: 'text', label: 'Text', hint: 'Click to place a note', twoStep: false, paths: ['M6 6h12', 'M12 6v12', 'M8 18h8'] },
  { value: 'measure', label: 'Measure', hint: 'Press, drag, and release', twoStep: true, paths: ['M4 8h16v8H4z', 'M8 8v8', 'M12 8v8', 'M16 8v8'] },
  { value: 'zoom', label: 'Zoom box', hint: 'Drag a region to zoom in', twoStep: true, paths: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35'] },
  { value: 'erase', label: 'Eraser', hint: 'Click a drawing to delete it', twoStep: false, paths: ['M19 13l-6 6H5l-2-2 12-12 4 4z', 'M16 5l3 3'] },
];

export const DRAWING_COLORS = ['#0d9488', '#6366f1', '#10b981', '#ef4444', '#f59e0b', '#0ea5e9', '#334155'];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const KINDS = new Set<DrawingKind>(['trend', 'ray', 'horizontal', 'vertical', 'rect', 'fib', 'measure', 'text']);

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

export function isDrawingKind(value: string): value is DrawingKind {
  return KINDS.has(value as DrawingKind);
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
  ctx.font = '11px Inter, ui-sans-serif, system-ui, sans-serif';
  const width = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x, y - 10, width + 8, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 4, y);
}

/** Extend a→b until it hits the canvas edge. */
export function extendRay(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return b;
  const candidates: number[] = [];
  if (dx > 0) candidates.push((width - a.x) / dx);
  else if (dx < 0) candidates.push((0 - a.x) / dx);
  if (dy > 0) candidates.push((height - a.y) / dy);
  else if (dy < 0) candidates.push((0 - a.y) / dy);
  const t = candidates.filter((v) => v > 0 && Number.isFinite(v)).sort((x, y) => x - y)[0] ?? 1;
  return { x: a.x + dx * t, y: a.y + dy * t };
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
      drawLabel(ctx, formatPrice(drawing.a.price), 8, a.y - 4, drawing.color);
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

    case 'ray': {
      if (!b) return;
      const end = extendRay(a, b, map.width, map.height);
      strokeLine(ctx, a.x, a.y, end.x, end.y);
      break;
    }

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

    case 'measure': {
      if (!b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.globalAlpha = 0.1;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      const bars = Math.abs(Math.round(drawing.b.logical) - Math.round(drawing.a.logical));
      const delta = drawing.b.price - drawing.a.price;
      const pct = drawing.a.price !== 0 ? (delta / Math.abs(drawing.a.price)) * 100 : 0;
      const sign = delta >= 0 ? '+' : '';
      const lines = [
        `${sign}${formatPrice(delta)}`,
        drawing.a.price !== 0 ? `${sign}${pct.toFixed(2)}%` : '',
        `${bars} bar${bars === 1 ? '' : 's'}`,
      ].filter(Boolean);
      ctx.font = '11px Inter, ui-sans-serif, system-ui, sans-serif';
      const label = lines.join('  ·  ');
      const tw = ctx.measureText(label).width;
      const lx = x + Math.max(4, (w - tw) / 2);
      const ly = y + h / 2 + 4;
      drawLabel(ctx, label, lx, ly, drawing.color);
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

    case 'text': {
      const label = drawing.text?.trim();
      if (!label) return;
      ctx.font = '12px Inter, ui-sans-serif, system-ui, sans-serif';
      const width = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(a.x - 3, a.y - 14, width + 10, 18);
      ctx.strokeStyle = drawing.color;
      ctx.strokeRect(a.x - 3, a.y - 14, width + 10, 18);
      ctx.fillStyle = drawing.color;
      ctx.fillText(label, a.x + 2, a.y);
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
    ctx.globalAlpha = 0.7;
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

function rectDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  if (px >= left && px <= right && py >= top && py <= bottom) return 0;
  return Math.min(
    distanceToSegment(px, py, left, top, right, top),
    distanceToSegment(px, py, right, top, right, bottom),
    distanceToSegment(px, py, right, bottom, left, bottom),
    distanceToSegment(px, py, left, bottom, left, top),
  );
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
    } else if (drawing.kind === 'text') {
      distance = Math.hypot(point.x - a.x, point.y - a.y);
    } else if (drawing.kind === 'ray' && b) {
      const end = extendRay(a, b, map.width, map.height);
      distance = distanceToSegment(point.x, point.y, a.x, a.y, end.x, end.y);
    } else if (b && (drawing.kind === 'rect' || drawing.kind === 'measure')) {
      distance = rectDistance(point.x, point.y, a.x, a.y, b.x, b.y);
    } else if (b && drawing.kind === 'fib') {
      distance = distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y);
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const span = drawing.b.price - drawing.a.price;
      for (const level of FIB_LEVELS) {
        const y = map.y(drawing.a.price + span * level);
        if (y == null) continue;
        distance = Math.min(distance, distanceToSegment(point.x, point.y, left, y, right, y));
      }
    } else if (b) {
      distance = distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y);
    }

    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { id: drawing.id, distance };
    }
  }

  return best?.id ?? null;
}

export function parseDrawings(raw: string | null): Drawing[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is Drawing => {
      if (!d || typeof d !== 'object') return false;
      const drawing = d as Drawing;
      return (
        typeof drawing.id === 'string' &&
        isDrawingKind(drawing.kind) &&
        typeof drawing.color === 'string' &&
        Number.isFinite(drawing.a?.logical) &&
        Number.isFinite(drawing.a?.price)
      );
    });
  } catch {
    return [];
  }
}
