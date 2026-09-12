import { RegistryStock } from '../models/trading-journal.models';
import { buildStockAnalysis } from './screener-analysis.utils';

function stock(partial: Partial<RegistryStock> = {}): RegistryStock {
  return {
    symbol: 'JSWSTEEL',
    name: 'JSW Steel',
    currentPrice: 0,
    supports: [],
    resistances: [],
    ...partial,
  };
}

describe('buildStockAnalysis', () => {
  it('does not throw when quarterly results exist without rows', () => {
    const analysis = buildStockAnalysis(
      stock({
        quarterlyResults: { headers: ['Mar 2024'] } as RegistryStock['quarterlyResults'],
        profitLoss: { headers: ['Mar 2024'] } as RegistryStock['profitLoss'],
      })
    );
    expect(analysis.hasQuarterly).toBe(false);
    expect(analysis.sales).toBeNull();
  });

  it('returns an empty analysis when stock is missing', () => {
    expect(buildStockAnalysis(undefined).hasQuarterly).toBe(false);
    expect(buildStockAnalysis(null).verdicts).toEqual([]);
  });
});
