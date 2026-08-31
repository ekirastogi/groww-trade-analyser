import { TradeType } from '../models/trade.models';

/** DB/UI trade types included when the user picks "Intraday". */
export const INTRADAY_TRADE_TYPES: TradeType[] = ['intraday', 'same_day'];

const ROUTES_WITH_INTRADAY_DEFAULT = [
  '/dashboard',
  '/watchlists',
  '/heatmap',
  '/analytics',
  '/charges',
];

export function defaultTradeTypesForRoute(url: string): TradeType[] {
  return ROUTES_WITH_INTRADAY_DEFAULT.some((route) => url.includes(route)) ? ['intraday'] : ['all'];
}

export function routeNeedsDefaultTypes(url: string, hasTypesParam: boolean): boolean {
  return ROUTES_WITH_INTRADAY_DEFAULT.some((route) => url.includes(route)) && !hasTypesParam;
}

/** Expand UI filter types to the trade_type values stored in the database. */
export function expandTradeTypes(types?: TradeType[]): TradeType[] | undefined {
  if (!types?.length || types.includes('all')) return types;
  const expanded = new Set<TradeType>();
  for (const type of types) {
    if (type === 'intraday') {
      INTRADAY_TRADE_TYPES.forEach((t) => expanded.add(t));
    } else {
      expanded.add(type);
    }
  }
  return [...expanded];
}

export function buildTradeTypeFilter(types?: TradeType[]): Set<TradeType> | null {
  const expanded = expandTradeTypes(types);
  if (!expanded?.length || expanded.includes('all')) return null;
  return new Set(expanded);
}

export function matchesTradeTypeFilter(tradeType: TradeType, types?: TradeType[]): boolean {
  const filter = buildTradeTypeFilter(types);
  if (!filter) return true;
  return filter.has(tradeType);
}
