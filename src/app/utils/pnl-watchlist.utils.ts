import { StockProfile } from '../models/trade.models';

export interface PnlWatchlistTier {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  side: 'loss' | 'profit';
  /** Inclusive bound for matching stock net PnL */
  threshold: number;
}

export const PNL_WATCHLIST_TIERS: PnlWatchlistTier[] = [
  { id: 'loss-upto-5k', name: 'Loss up to ₹5K', color: '#fca5a5', sortOrder: 0, side: 'loss', threshold: 5_000 },
  { id: 'loss-upto-10k', name: 'Loss up to ₹10K', color: '#f87171', sortOrder: 1, side: 'loss', threshold: 10_000 },
  { id: 'loss-upto-50k', name: 'Loss up to ₹50K', color: '#ef4444', sortOrder: 2, side: 'loss', threshold: 50_000 },
  { id: 'loss-upto-100k', name: 'Loss up to ₹100K', color: '#dc2626', sortOrder: 3, side: 'loss', threshold: 100_000 },
  { id: 'loss-upto-200k', name: 'Loss up to ₹200K', color: '#b91c1c', sortOrder: 4, side: 'loss', threshold: 200_000 },
  { id: 'profit-upto-5k', name: 'Profit up to ₹5K', color: '#86efac', sortOrder: 10, side: 'profit', threshold: 5_000 },
  { id: 'profit-upto-10k', name: 'Profit up to ₹10K', color: '#4ade80', sortOrder: 11, side: 'profit', threshold: 10_000 },
  { id: 'profit-upto-50k', name: 'Profit up to ₹50K', color: '#22c55e', sortOrder: 12, side: 'profit', threshold: 50_000 },
  { id: 'profit-upto-100k', name: 'Profit up to ₹100K', color: '#16a34a', sortOrder: 13, side: 'profit', threshold: 100_000 },
  { id: 'profit-upto-200k', name: 'Profit up to ₹200K', color: '#15803d', sortOrder: 14, side: 'profit', threshold: 200_000 },
];

export function symbolsForPnlTier(profiles: StockProfile[], tier: PnlWatchlistTier): string[] {
  return profiles
    .filter((profile) => {
      const pnl = profile.netPnL;
      if (tier.side === 'loss') {
        return pnl < 0 && Math.abs(pnl) <= tier.threshold;
      }
      return pnl > 0 && pnl <= tier.threshold;
    })
    .map((profile) => profile.symbol)
    .sort();
}
