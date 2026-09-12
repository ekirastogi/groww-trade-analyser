import { CandleTimeframe, ChartRange, TvCandle } from './tv-chart.models';

/** Monday of the ISO week containing the given date. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

function bucketKey(iso: string, timeframe: CandleTimeframe): string {
  if (timeframe === 'week') return weekStart(iso);
  if (timeframe === 'month') return `${iso.slice(0, 7)}-01`;
  return iso;
}

/**
 * Rolls daily candles up into weekly or monthly ones. Standard OHLC aggregation: the bucket
 * opens where its first day opened, closes where its last day closed, and the wicks span the
 * extremes of every day inside it. Volume is summed. Expects `daily` sorted ascending by time.
 */
export function aggregateCandles(daily: TvCandle[], timeframe: CandleTimeframe): TvCandle[] {
  if (timeframe === 'day') return daily;

  const buckets = new Map<string, TvCandle>();
  for (const candle of daily) {
    const key = bucketKey(candle.time, timeframe);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { ...candle, time: key });
      continue;
    }
    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume = (bucket.volume ?? 0) + (candle.volume ?? 0);
  }

  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function smaPoints(candles: TvCandle[], period: number): { time: string; value: number }[] {
  if (period < 1 || candles.length < period) return [];
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function addCalendarMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function rangeFromDate(candles: TvCandle[], range: ChartRange): string | null {
  if (!candles.length) return null;
  if (range === 'all') return candles[0].time;
  const last = candles[candles.length - 1].time;
  if (range === 'ytd') return `${last.slice(0, 4)}-01-01`;
  const months = range === '1y' ? -12 : range === '6m' ? -6 : range === '3m' ? -3 : -1;
  return addCalendarMonths(last, months);
}

export function firstCandleOnOrAfter(candles: TvCandle[], iso: string): TvCandle {
  return candles.find((c) => c.time >= iso) ?? candles[0];
}

export function snapPriceToCandle(candle: TvCandle, price: number): number {
  const levels = [candle.open, candle.high, candle.low, candle.close];
  let best = levels[0];
  let bestDist = Math.abs(price - best);
  for (let i = 1; i < levels.length; i++) {
    const dist = Math.abs(price - levels[i]);
    if (dist < bestDist) {
      best = levels[i];
      bestDist = dist;
    }
  }
  return best;
}

export function hasNegativePrices(candles: TvCandle[]): boolean {
  return candles.some((c) => c.low < 0);
}

export function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage disabled or full: state simply won't persist.
  }
}
