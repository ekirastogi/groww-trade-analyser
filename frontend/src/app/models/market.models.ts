export interface Quote {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  marketCap: number;
  exchange: string;
  updatedAt: string;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Fundamentals {
  symbol: string;
  marketCap: number;
  quarterlyPerf: number;
  yearlyPerf: number;
  targets: { high: number; low: number; avg: number };
  sector: string;
  pe: number;
}

export interface NewsItem {
  id: string;
  symbol: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  isin?: string;
}

export interface IndicatorSnapshot {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  sma20: number;
  sma50: number;
  sma200: number;
}

export interface StockSnapshot {
  symbol: string;
  name: string;
  exchange: string;
  isin?: string;
  ltp: number;
  change: number;
  changePct: number;
  marketCap: number;
  pe?: number;
  week52High?: number;
  week52Low?: number;
  supportLevels?: number[];
  resistanceLevels?: number[];
  targets?: { high: number; low: number; avg: number };
  quarterlyPerf: number;
  yearlyPerf: number;
  indicators?: IndicatorSnapshot;
  peSeries?: number[];
  vsNiftyPct?: number;
  vsCapIndexPct?: number;
  vsSectorPct?: number;
  capBucket?: string;
  sector?: string;
  volumeRatio?: number;
  news?: NewsItem[];
  lastUpdated: string;
  dataSource: string;
}

export interface MarketCatalogEntry {
  symbol: string;
  name: string;
  ltp: number;
  changePct: number;
  marketCap: number;
  pe?: number;
  sector?: string;
  lastUpdated: string;
  dataSource: string;
}

export interface MarketCatalogSummary {
  updatedAt: number;
  count: number;
  stocks: MarketCatalogEntry[];
}

export interface ChartView {
  symbol: string;
  candles: Candle[];
  sma20?: number[];
  sma50?: number[];
  sma200?: number[];
  updatedAt?: string;
}

export interface OHLCResponse {
  symbol: string;
  interval: string;
  candles: Candle[];
  indicators: IndicatorSnapshot[];
}
