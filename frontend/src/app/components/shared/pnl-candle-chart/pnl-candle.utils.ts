export interface PnlCandle {
  /** Bucket start as an ISO date, e.g. 2026-03-14. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleTimeframe = 'day' | 'week' | 'month';

export const CANDLE_TIMEFRAMES: { value: CandleTimeframe; label: string }[] = [
  { value: 'day', label: 'D' },
  { value: 'week', label: 'W' },
  { value: 'month', label: 'M' },
];

export const CANDLE_TIMEFRAME_LABELS: Record<CandleTimeframe, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

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
 * extremes of every day inside it. Expects `daily` sorted ascending by time.
 */
export function aggregateCandles(daily: PnlCandle[], timeframe: CandleTimeframe): PnlCandle[] {
  if (timeframe === 'day') return daily;

  const buckets = new Map<string, PnlCandle>();
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
  }

  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
}
