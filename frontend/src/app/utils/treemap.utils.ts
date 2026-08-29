export interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function equalRects(count: number, x: number, y: number, w: number, h: number, gap: number): TreemapRect[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;
  const rects: TreemapRect[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    rects.push({
      x: x + col * (cellW + gap),
      y: y + row * (cellH + gap),
      width: Math.max(0, cellW),
      height: Math.max(0, cellH),
    });
  }

  return rects;
}

function layoutSlice(
  values: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number
): TreemapRect[] {
  if (!values.length || w <= 0 || h <= 0) return [];
  if (values.length === 1) {
    return [{ x, y, width: Math.max(0, w - gap), height: Math.max(0, h - gap) }];
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return equalRects(values.length, x, y, w, h, gap);

  let leftSum = 0;
  let splitAt = 1;
  for (let i = 0; i < values.length - 1; i++) {
    leftSum += values[i];
    splitAt = i + 1;
    if (leftSum >= total / 2) break;
  }

  const left = values.slice(0, splitAt);
  const right = values.slice(splitAt);
  const ratio = leftSum / total;
  const vertical = w >= h;

  if (vertical) {
    const leftW = Math.max(0, w * ratio - gap / 2);
    const rightW = Math.max(0, w - leftW - gap);
    return [
      ...layoutSlice(left, x, y, leftW, h, gap),
      ...layoutSlice(right, x + leftW + gap, y, rightW, h, gap),
    ];
  }

  const topH = Math.max(0, h * ratio - gap / 2);
  const bottomH = Math.max(0, h - topH - gap);
  return [
    ...layoutSlice(left, x, y, w, topH, gap),
    ...layoutSlice(right, x, y + topH + gap, w, bottomH, gap),
  ];
}

/** Value-proportional treemap layout. */
export function layoutTreemap(values: number[], width: number, height: number, gap = 4): TreemapRect[] {
  if (!values.length || width <= 0 || height <= 0) return [];
  return layoutSlice(values, 0, 0, width, height, gap);
}

export function rectToPercentStyle(rect: TreemapRect, containerW: number, containerH: number): Record<string, string> {
  return {
    left: `${(rect.x / containerW) * 100}%`,
    top: `${(rect.y / containerH) * 100}%`,
    width: `${(rect.width / containerW) * 100}%`,
    height: `${(rect.height / containerH) * 100}%`,
  };
}

export function minRectDimension(rect: TreemapRect): number {
  return Math.min(rect.width, rect.height);
}
