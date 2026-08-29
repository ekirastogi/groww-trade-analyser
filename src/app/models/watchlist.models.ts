export type WatchlistType = 'manual' | 'pnl_derived' | 'heatmap';

export interface Watchlist {
  id: string;
  name: string;
  type: WatchlistType;
  color: string;
  sortOrder: number;
  stockSymbols: string[];
  createdAt: number;
  updatedAt: number;
}
