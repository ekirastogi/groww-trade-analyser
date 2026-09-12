import { TvCandle } from './tv-chart.models';
import { aggregateCandles, rangeFromDate, smaPoints, snapPriceToCandle } from './tv-chart.utils';
import { extendRay } from './chart-drawings';

const daily: TvCandle[] = [
  { time: '2026-02-02', open: 0, high: 120, low: -30, close: 100, volume: 4 },
  { time: '2026-02-03', open: 100, high: 180, low: 90, close: 150, volume: 2 },
  { time: '2026-02-04', open: 150, high: 150, low: 40, close: 60, volume: 5 },
  { time: '2026-02-05', open: 60, high: 260, low: 60, close: 250, volume: 1 },
];

describe('tv-chart utils', () => {
  it('builds a simple SMA', () => {
    const sma = smaPoints(daily, 2);
    expect(sma).toEqual([
      { time: '2026-02-03', value: 125 },
      { time: '2026-02-04', value: 105 },
      { time: '2026-02-05', value: 155 },
    ]);
  });

  it('returns empty SMA when there is not enough data', () => {
    expect(smaPoints(daily, 10)).toEqual([]);
  });

  it('snaps to the nearest OHLC', () => {
    const candle = daily[0];
    expect(snapPriceToCandle(candle, 118)).toBe(120);
    expect(snapPriceToCandle(candle, 5)).toBe(0);
  });

  it('resolves YTD from the last candle year', () => {
    expect(rangeFromDate(daily, 'ytd')).toBe('2026-01-01');
    expect(rangeFromDate(daily, 'all')).toBe('2026-02-02');
  });

  it('keeps volume when aggregating a week', () => {
    const [week] = aggregateCandles(daily, 'week');
    expect(week.volume).toBe(12);
  });
});

describe('extendRay', () => {
  it('extends rightward to the canvas edge', () => {
    const end = extendRay({ x: 10, y: 10 }, { x: 20, y: 10 }, 100, 50);
    expect(end).toEqual({ x: 100, y: 10 });
  });
});
