import { aggregateCandles, PnlCandle } from './pnl-candle.utils';

/** Four consecutive trading days in the same ISO week (Mon 2026-02-02 .. Thu 2026-02-05). */
const daily: PnlCandle[] = [
  { time: '2026-02-02', open: 0, high: 120, low: -30, close: 100 },
  { time: '2026-02-03', open: 100, high: 180, low: 90, close: 150 },
  { time: '2026-02-04', open: 150, high: 150, low: 40, close: 60 },
  { time: '2026-02-05', open: 60, high: 260, low: 60, close: 250 },
];

describe('aggregateCandles', () => {
  it('returns daily candles untouched', () => {
    expect(aggregateCandles(daily, 'day')).toBe(daily);
  });

  it('is safe on empty input', () => {
    expect(aggregateCandles([], 'week')).toEqual([]);
    expect(aggregateCandles([], 'month')).toEqual([]);
  });

  it('rolls a week up to one candle anchored on the Monday', () => {
    const [week] = aggregateCandles(daily, 'week');
    expect(week.time).toBe('2026-02-02');
    expect(week.open).toBe(0);
    expect(week.close).toBe(250);
    expect(week.high).toBe(260);
    expect(week.low).toBe(-30);
  });

  it('anchors month buckets on the first of the month', () => {
    const [month] = aggregateCandles(daily, 'month');
    expect(month.time).toBe('2026-02-01');
    expect(month.open).toBe(0);
    expect(month.close).toBe(250);
  });

  it('splits candles that fall in different ISO weeks', () => {
    // 2026-02-08 is a Sunday, so it closes the week beginning 2026-02-02;
    // 2026-02-09 is the Monday that starts the next one.
    const spanning: PnlCandle[] = [
      { time: '2026-02-08', open: 0, high: 10, low: 0, close: 10 },
      { time: '2026-02-09', open: 10, high: 40, low: 5, close: 30 },
    ];
    const weeks = aggregateCandles(spanning, 'week');
    expect(weeks.map((w) => w.time)).toEqual(['2026-02-02', '2026-02-09']);
  });

  it('keeps every timeframe ending on the same cumulative total', () => {
    const last = (candles: PnlCandle[]) => candles[candles.length - 1].close;
    expect(last(aggregateCandles(daily, 'week'))).toBe(last(daily));
    expect(last(aggregateCandles(daily, 'month'))).toBe(last(daily));
  });

  it('produces well-formed candles at every timeframe', () => {
    for (const tf of ['day', 'week', 'month'] as const) {
      for (const c of aggregateCandles(daily, tf)) {
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
    }
  });
});
