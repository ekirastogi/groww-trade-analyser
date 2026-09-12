import { TradeType } from '../models/trade.models';
import { effectiveTradeType } from './trade-type-filter.utils';

function source(overrides: {
  tradeType?: TradeType;
  buyDate?: string;
  sellDate?: string;
  remark?: string;
  holdingDays?: number;
}) {
  return {
    tradeType: 'all' as TradeType,
    buyDate: '2026-01-01',
    sellDate: '2026-02-01',
    ...overrides,
  };
}

describe('effectiveTradeType', () => {
  it('reads intraday, MTF and F&O out of the remark', () => {
    expect(effectiveTradeType(source({ remark: 'Intraday square-off' }))).toBe('intraday');
    expect(effectiveTradeType(source({ remark: 'MTF position' }))).toBe('mtf');
    expect(effectiveTradeType(source({ remark: 'NIFTY option' }))).toBe('fno');
  });

  it('prefers the remark over the dates', () => {
    expect(
      effectiveTradeType(source({ remark: 'Intraday', buyDate: '2026-01-01', sellDate: '2026-03-01' }))
    ).toBe('intraday');
  });

  it('classifies a same-date round trip as same_day', () => {
    expect(effectiveTradeType(source({ buyDate: '2026-02-05', sellDate: '2026-02-05' }))).toBe(
      'same_day'
    );
  });

  it('classifies a zero holding period as same_day even when the dates disagree', () => {
    // The drift case: stored rows can carry holdingDays 0 with mismatched dates. The parser
    // used to miss this branch, so such a trade was stored as delivery but filtered as same_day.
    expect(effectiveTradeType(source({ holdingDays: 0 }))).toBe('same_day');
  });

  it('keeps an already-stored specific type', () => {
    expect(effectiveTradeType(source({ tradeType: 'mtf' }))).toBe('mtf');
  });

  it('falls back to delivery when nothing else applies', () => {
    expect(effectiveTradeType(source({}))).toBe('delivery');
  });
});
