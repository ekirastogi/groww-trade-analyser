import { Trade } from '../models/trade.models';
import { tradeAllocatedCharge, tradeChargeFns, tradeNetPnL } from './trade-charges.utils';

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    stockName: 'ACME',
    isin: 'INE000000001',
    quantity: 10,
    buyDate: '2026-01-01',
    buyPrice: 100,
    buyValue: 1000,
    sellDate: '2026-01-10',
    sellPrice: 120,
    sellValue: 1200,
    realisedPnL: 200,
    remark: '',
    tradeType: 'delivery',
    holdingDays: 9,
    ...overrides,
  } as Trade;
}

describe('trade charge helpers', () => {
  it('prefers the charge allocated to the trade', () => {
    expect(tradeAllocatedCharge(trade({ allocatedCharges: 15 }), 0.01)).toBe(15);
  });

  it('falls back to the blended charge ratio when the trade carries no charge', () => {
    // This is the case that used to differ between pages: watchlists returned 0 here,
    // so its Net P&L read high while the dashboard showed the pro-rated figure.
    expect(tradeAllocatedCharge(trade(), 0.01)).toBeCloseTo(12, 10);
  });

  it('treats an explicitly zero allocated charge as real, not missing', () => {
    expect(tradeAllocatedCharge(trade({ allocatedCharges: 0 }), 0.01)).toBe(0);
  });

  it('derives net P&L from the fallback charge when netPnL is absent', () => {
    expect(tradeNetPnL(trade(), 0.01)).toBeCloseTo(188, 10);
  });

  it('prefers a stored netPnL over recomputing it', () => {
    expect(tradeNetPnL(trade({ netPnL: 191 }), 0.01)).toBe(191);
  });

  it('keeps a loss negative after charges', () => {
    const losing = trade({ realisedPnL: -50, sellValue: 950 });
    expect(tradeNetPnL(losing, 0.01)).toBeCloseTo(-59.5, 10);
  });

  it('binds both callbacks to one ratio', () => {
    const { chargeForTrade, netPnLForTrade } = tradeChargeFns(0.02);
    expect(chargeForTrade(trade())).toBeCloseTo(24, 10);
    expect(netPnLForTrade(trade())).toBeCloseTo(176, 10);
  });
});
