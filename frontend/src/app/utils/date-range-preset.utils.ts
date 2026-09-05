export type DateRangePresetId = 'inception' | 'year' | 'month' | 'week' | '30d';

export interface DateRangeBounds {
  min: string;
  max: string;
}

export interface DateRangeValue {
  start: string;
  end: string;
}

export const DATE_RANGE_PRESETS: {
  id: DateRangePresetId;
  shortLabel: string;
  label: string;
}[] = [
  { id: 'inception', shortLabel: 'All', label: 'From inception' },
  { id: 'year', shortLabel: 'YTD', label: 'This year' },
  { id: 'month', shortLabel: 'MTD', label: 'This month' },
  { id: 'week', shortLabel: 'WTD', label: 'This week' },
  { id: '30d', shortLabel: '30D', label: 'Last 30 days' },
];

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function mondayOfWeek(iso: string): string {
  const date = parseIsoDate(iso);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - offset);
  return toIsoDate(date);
}

export function clampIsoDate(iso: string, min: string, max: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export function asOfDate(bounds: DateRangeBounds, today = new Date()): string {
  const todayIso = toIsoDate(today);
  if (bounds.max && todayIso > bounds.max) return bounds.max;
  if (bounds.min && todayIso < bounds.min) return bounds.min;
  return todayIso;
}

export function rangeForPreset(
  id: DateRangePresetId,
  bounds: DateRangeBounds,
  today = new Date()
): DateRangeValue {
  const asOf = asOfDate(bounds, today);
  let start = bounds.min;
  let end = bounds.max || asOf;

  switch (id) {
    case 'inception':
      start = bounds.min;
      end = bounds.max || asOf;
      break;
    case 'year':
      start = `${parseIsoDate(asOf).getFullYear()}-01-01`;
      end = asOf;
      break;
    case 'month': {
      const d = parseIsoDate(asOf);
      start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      end = asOf;
      break;
    }
    case 'week':
      start = mondayOfWeek(asOf);
      end = asOf;
      break;
    case '30d':
      start = addDays(asOf, -29);
      end = asOf;
      break;
  }

  return {
    start: clampIsoDate(start, bounds.min, bounds.max || end),
    end: clampIsoDate(end, bounds.min, bounds.max || end),
  };
}

export function detectDateRangePreset(
  start: string,
  end: string,
  bounds: DateRangeBounds,
  today = new Date()
): DateRangePresetId | 'custom' {
  if (!start || !end) return 'custom';
  const order: DateRangePresetId[] = ['week', '30d', 'month', 'year', 'inception'];
  for (const id of order) {
    const range = rangeForPreset(id, bounds, today);
    if (range.start === start && range.end === end) return id;
  }
  return 'custom';
}
