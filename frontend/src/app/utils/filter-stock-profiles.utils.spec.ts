import { StockSummary } from '../models/trade.models';
import { mergeStockSummaries } from './filter-stock-profiles.utils';

function summary(partial: Partial<StockSummary>): StockSummary {
  return {
    stockName: 'VARUN BEVERAGES LIMITED',
    isin: 'INE200M01013',
    symbol: 'VARUNBEVERAGES',
    quantity: 1,
    avgBuyPrice: 0,
    buyValue: 100,
    avgSellPrice: 0,
    sellValue: 110,
    realisedPnL: 10,
    realisedPnLPct: 0.1,
    tradeCount: 1,
    allocatedCharges: 1,
    netPnL: 9,
    ...partial,
  };
}

describe('mergeStockSummaries', () => {
  it('collapses two rows that share an ISIN into one', () => {
    const merged = mergeStockSummaries([
      summary({ symbol: 'VARUNBEVERAGES', tradeCount: 22, buyValue: 220, sellValue: 200, realisedPnL: -20, allocatedCharges: 2, netPnL: -22 }),
      summary({ symbol: 'VBL', tradeCount: 123, buyValue: 1230, sellValue: 1500, realisedPnL: 270, allocatedCharges: 10, netPnL: 260 }),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].symbol).toBe('VBL');
    expect(merged[0].tradeCount).toBe(145);
    expect(merged[0].isin).toBe('INE200M01013');
  });

  it('merges a named duplicate that is missing ISIN with the row that has it', () => {
    const merged = mergeStockSummaries([
      summary({ isin: 'INE200M01013', symbol: 'VBL', tradeCount: 10, netPnL: 50 }),
      summary({ isin: '', symbol: 'VARUNBEVERAGES', tradeCount: 5, netPnL: 20 }),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].tradeCount).toBe(15);
  });
});
