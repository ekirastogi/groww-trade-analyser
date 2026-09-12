import { normalizeSymbol } from './upload-merge.utils';
import {
  applyKnownIsins,
  collectIsinsByName,
  fillMissingIsins,
  normalizeIsin,
  StockIdentityResolver,
  stockIdentityKey,
} from './stock-identity.utils';

describe('stock identity', () => {
  it('normalizes ISIN by trimming and uppercasing', () => {
    expect(normalizeIsin(' ine200m01013 ')).toBe('INE200M01013');
    expect(normalizeIsin('')).toBe('');
    expect(normalizeIsin(null)).toBe('');
  });

  it('uses ISIN as the identity even when names differ', () => {
    expect(
      stockIdentityKey({ isin: 'INE200M01013', stockName: 'VARUN BEVERAGES LIMITED' })
    ).toBe(
      stockIdentityKey({ isin: ' ine200m01013 ', stockName: 'VARUN BEVERAGES LTD' })
    );
  });

  it('does not treat the same name with different ISINs as one stock', () => {
    expect(stockIdentityKey({ isin: 'INE000000001', stockName: 'ACME' })).not.toBe(
      stockIdentityKey({ isin: 'INE000000002', stockName: 'ACME' })
    );
  });

  it('copies a known ISIN onto name-matched rows that arrived without one', () => {
    const rows = fillMissingIsins([
      { isin: 'INE200M01013', stockName: 'VARUN BEVERAGES LIMITED' },
      { isin: '', stockName: 'VARUN BEVERAGES LIMITED' },
    ]);
    expect(rows[1].isin).toBe('INE200M01013');
  });

  it('maps every row of an ISIN onto the NSE ticker, not a name-derived symbol', () => {
    const resolver = StockIdentityResolver.fromHints([
      { symbol: 'VARUNBEVERAGES', name: 'VARUN BEVERAGES LIMITED', isin: 'INE200M01013' },
      { symbol: 'VBL', name: 'Varun Beverages Ltd', isin: 'INE200M01013', exchange: 'NSE' },
    ]);
    expect(resolver.resolve('INE200M01013', 'VARUN BEVERAGES LIMITED').symbol).toBe('VBL');
    expect(resolver.resolve(' ine200m01013 ', 'VARUN BEVERAGES LTD').symbol).toBe('VBL');
  });

  it('strips junk so the same ISIN still matches', () => {
    expect(normalizeIsin('INE200M01013\u200b')).toBe('INE200M01013');
    expect(normalizeIsin('INE-200M-01013')).toBe('INE200M01013');
  });

  it('copies an ISIN from a scrip-sheet name onto trades of that scrip', () => {
    const known = collectIsinsByName([
      { isin: 'INE200M01013', stockName: 'VARUN BEVERAGES LIMITED' },
    ]);
    const trades = applyKnownIsins(
      [{ isin: '', stockName: 'VARUN BEVERAGES LTD' }],
      known
    );
    expect(trades[0].isin).toBe('INE200M01013');
  });

  it('keeps a distinct symbol when two ISINs would share a name-derived ticker', () => {
    const resolver = new StockIdentityResolver();
    const first = resolver.resolve('INE000000001', 'ACME LIMITED');
    const second = resolver.resolve('INE000000002', 'ACME LTD');
    expect(first.symbol).toBe(normalizeSymbol('ACME LIMITED'));
    expect(second.symbol).not.toBe(first.symbol);
    expect(second.isin).toBe('INE000000002');
  });
});
