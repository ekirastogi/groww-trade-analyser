import { UnrealisedHolding } from '../models/trade.models';
import { mergeHoldingsWithLots, mergeUnrealisedHoldings } from './holdings.utils';

function holding(partial: Partial<UnrealisedHolding>): UnrealisedHolding {
  return {
    stockName: 'VARUN BEVERAGES LIMITED',
    isin: 'INE200M01013',
    symbol: 'VARUNBEVERAGES',
    quantity: 10,
    avgBuyPrice: 100,
    buyValue: 1000,
    closingPrice: 110,
    closingValue: 1100,
    unrealisedPnL: 100,
    unrealisedPnLPct: 0.1,
    asOfDate: '2026-09-12',
    lots: [],
    ...partial,
  };
}

describe('mergeUnrealisedHoldings', () => {
  it('collapses two scrip rows that share an ISIN onto one ticker', () => {
    const merged = mergeUnrealisedHoldings([
      holding({ symbol: 'VARUNBEVERAGES', quantity: 10, buyValue: 1000, closingValue: 1100, unrealisedPnL: 100 }),
      holding({ symbol: 'VBL', quantity: 5, buyValue: 500, closingValue: 600, unrealisedPnL: 100 }),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].symbol).toBe('VBL');
    expect(merged[0].quantity).toBe(15);
    expect(merged[0].buyValue).toBe(1500);
    expect(merged[0].isin).toBe('INE200M01013');
  });

  it('collapses two rows that already resolved to the same ticker', () => {
    const merged = mergeUnrealisedHoldings([
      holding({ isin: 'INE200M01013', symbol: 'VBL', quantity: 10 }),
      holding({ isin: '', symbol: 'VBL', stockName: 'VARUN BEV', quantity: 2 }),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].symbol).toBe('VBL');
    expect(merged[0].quantity).toBe(12);
  });
});

describe('mergeHoldingsWithLots', () => {
  it('merges duplicate scrip holdings before attaching lots', () => {
    const merged = mergeHoldingsWithLots(
      [
        holding({ symbol: 'VARUNBEVERAGES', quantity: 10 }),
        holding({ symbol: 'VBL', quantity: 5 }),
      ],
      [],
      '2026-09-12'
    );
    expect(merged.length).toBe(1);
    expect(merged[0].quantity).toBe(15);
  });
});
