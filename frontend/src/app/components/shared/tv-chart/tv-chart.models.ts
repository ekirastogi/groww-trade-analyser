export interface TvCandle {
  /** Bucket start as an ISO date, e.g. 2026-03-14. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Optional histogram value (trade count, volume, etc.). */
  volume?: number;
}

export type CandleTimeframe = 'day' | 'week' | 'month';

export type ChartRange = 'all' | 'ytd' | '1y' | '6m' | '3m' | '1m';

export type PriceScaleKind = 'normal' | 'percent' | 'log';

export interface TimeframeOption {
  value: CandleTimeframe;
  label: string;
}

export const CANDLE_TIMEFRAMES: TimeframeOption[] = [
  { value: 'day', label: 'D' },
  { value: 'week', label: 'W' },
  { value: 'month', label: 'M' },
];

export const CANDLE_TIMEFRAME_LABELS: Record<CandleTimeframe, string> = {
  day: 'D',
  week: 'W',
  month: 'M',
};

export const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '6m', label: '6M' },
  { value: '3m', label: '3M' },
  { value: '1m', label: '1M' },
];
