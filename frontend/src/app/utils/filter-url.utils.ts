import { ParamMap } from '@angular/router';
import { TradeType } from '../models/trade.models';
import { MarketCapTier } from './market-cap.utils';
import { PnlTierMode } from './pnl-watchlist.utils';

export const FILTER_QUERY_KEYS = {
  types: 'types',
  from: 'from',
  to: 'to',
  chart: 'chart',
  top: 'top',
  cap: 'cap',
  side: 'side',
  bands: 'bands',
  tier: 'tier',
} as const;

export interface GlobalFilterParams {
  tradeTypes: TradeType[];
  startDate?: string;
  endDate?: string;
  chartPeriod?: 'daily' | 'weekly' | 'monthly';
  topStocks?: number;
}

export interface WatchlistFilterParams {
  side?: 'losing' | 'profitable';
  bands?: PnlTierMode;
  tier?: string | null;
  marketCapTiers: MarketCapTier[];
}

export function parseTradeTypes(raw: string | null, fallback: TradeType[]): TradeType[] {
  if (!raw) return fallback;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean) as TradeType[];
  if (!parts.length) return fallback;
  if (parts.includes('all')) return ['all'];
  return parts;
}

export function serializeTradeTypes(types: TradeType[]): string | null {
  if (!types.length || types.includes('all')) return null;
  return types.join(',');
}

export function parseMarketCapTiers(raw: string | null): MarketCapTier[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is MarketCapTier =>
      part === 'large' || part === 'mid' || part === 'small' || part === 'micro'
    );
}

export function serializeMarketCapTiers(tiers: MarketCapTier[]): string | null {
  return tiers.length ? tiers.join(',') : null;
}

export function readGlobalFilters(params: ParamMap, defaultTypes: TradeType[]): GlobalFilterParams {
  const tradeTypes = parseTradeTypes(params.get(FILTER_QUERY_KEYS.types), defaultTypes);
  const startDate = params.get(FILTER_QUERY_KEYS.from) ?? undefined;
  const endDate = params.get(FILTER_QUERY_KEYS.to) ?? undefined;
  const chartRaw = params.get(FILTER_QUERY_KEYS.chart);
  const chartPeriod =
    chartRaw === 'weekly' || chartRaw === 'monthly' || chartRaw === 'daily' ? chartRaw : undefined;
  const topRaw = params.get(FILTER_QUERY_KEYS.top);
  const topStocks = topRaw ? Number(topRaw) : undefined;

  return {
    tradeTypes,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    chartPeriod,
    topStocks: Number.isFinite(topStocks) && topStocks! > 0 ? topStocks : undefined,
  };
}

export function readWatchlistFilters(params: ParamMap): WatchlistFilterParams {
  const sideRaw = params.get(FILTER_QUERY_KEYS.side);
  const side = sideRaw === 'profitable' || sideRaw === 'losing' ? sideRaw : undefined;
  const bandsRaw = params.get(FILTER_QUERY_KEYS.bands);
  const bands = bandsRaw === 'band' || bandsRaw === 'cumulative' ? bandsRaw : undefined;
  const tier = params.get(FILTER_QUERY_KEYS.tier);
  return {
    side,
    bands,
    tier: tier || null,
    marketCapTiers: parseMarketCapTiers(params.get(FILTER_QUERY_KEYS.cap)),
  };
}

export function defaultTradeTypesForRoute(url: string): TradeType[] {
  return url.includes('/watchlists') ? ['intraday'] : ['all'];
}
