import { parseStatementPeriod } from './parser.service';

describe('parseStatementPeriod', () => {
  it('reads Groww statement window into ISO bounds', () => {
    expect(
      parseStatementPeriod('P&L Statement for stocks from 01-08-2019 TO 13-09-2026')
    ).toEqual({ min: '2019-08-01', max: '2026-09-13' });
  });

  it('returns null when the label has no dates', () => {
    expect(parseStatementPeriod('P&L Statement')).toBeNull();
  });
});
