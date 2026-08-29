/** Market cap tier based on Indian equity conventions (values in INR). */
export type MarketCapTier = 'large' | 'mid' | 'small' | 'micro';

export const MARKET_CAP_TIERS: MarketCapTier[] = ['large', 'mid', 'small', 'micro'];

export const MARKET_CAP_LABELS: Record<MarketCapTier, string> = {
  large: 'Large',
  mid: 'Mid',
  small: 'Small',
  micro: 'Micro',
};

const CRORE = 1e7;
const LARGE_MIN = 20_000 * CRORE;
const MID_MIN = 5_000 * CRORE;
const SMALL_MIN = 500 * CRORE;

export function getMarketCapTier(marketCap: number): MarketCapTier | null {
  if (!marketCap || marketCap <= 0) return null;
  if (marketCap >= LARGE_MIN) return 'large';
  if (marketCap >= MID_MIN) return 'mid';
  if (marketCap >= SMALL_MIN) return 'small';
  return 'micro';
}

export function matchesMarketCapFilter(
  marketCap: number | undefined | null,
  selected: MarketCapTier[]
): boolean {
  if (!selected.length) return true;
  const tier = getMarketCapTier(marketCap ?? 0);
  return tier ? selected.includes(tier) : false;
}
