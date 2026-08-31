export type TradeType = 'all' | 'intraday' | 'delivery' | 'same_day' | 'mtf' | 'fno';

export const TRADE_TYPE_LABELS: Record<string, string> = {
  all: 'All',
  intraday: 'Intraday',
  delivery: 'Delivery',
  same_day: 'Same Day',
  mtf: 'MTF',
  fno: 'F&O',
};

export interface DateRange {
  min: string;
  max: string;
}

export interface ReportSummary {
  clientName: string;
  clientCode: string;
  period: string;
  realisedPnL: number;
  unrealisedPnL: number;
}

export interface Trade {
  stockName: string;
  isin: string;
  quantity: number;
  buyDate: string;
  buyPrice: number;
  buyValue: number;
  sellDate: string;
  sellPrice: number;
  sellValue: number;
  realisedPnL: number;
  remark: string;
  tradeType: TradeType;
  holdingDays: number;
  allocatedCharges?: number;
  netPnL?: number;
}

export interface ChargeItem {
  label: string;
  amount: number;
}

export interface ChargesSummary {
  items: ChargeItem[];
  total: number;
}

export interface StockSummary {
  stockName: string;
  isin: string;
  symbol?: string;
  quantity: number;
  avgBuyPrice: number;
  buyValue: number;
  avgSellPrice: number;
  sellValue: number;
  realisedPnL: number;
  realisedPnLPct: number;
  tradeCount: number;
  allocatedCharges: number;
  netPnL: number;
  winRate?: number;
  winningTrades?: number;
  losingTrades?: number;
}

/** Pre-aggregated daily bucket stored in Supabase (sell date × trade type). */
export interface DailyAnalyticsRow {
  sellDate: string;
  tradeType: TradeType;
  tradeCount: number;
  totalBuyValue: number;
  totalSellValue: number;
  realisedPnL: number;
  allocatedCharges: number;
  netPnL: number;
  winningTrades: number;
  losingTrades: number;
}

export interface PeriodBucket {
  period: string;
  label: string;
  tradeCount: number;
  totalBuyValue: number;
  totalSellValue: number;
  realisedPnL: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  allocatedCharges: number;
  netPnL: number;
  trades: Trade[];
}

export interface Report {
  summary: ReportSummary;
  charges: ChargesSummary;
  trades: Trade[];
  stockSummary: StockSummary[];
  /** Full profiles with per-trade-type aggregates (source of truth for filtered stock views). */
  stockProfiles?: StockProfile[];
  dateRange: DateRange;
  tradeTypes: TradeType[];
  /** Authoritative trade count from DB (may exceed trades.length while trades load lazily). */
  totalTradeCount?: number;
  tradesLoaded?: boolean;
  /** Pre-aggregated daily rows from Supabase (powers charts without loading all trades). */
  dailyAnalytics?: DailyAnalyticsRow[];
}

export interface ReportHistoryEntry {
  id: string;
  fileName: string;
  uploadedAt: number;
  report: Report;
}

export interface AnalysisResult {
  summary: {
    tradeCount: number;
    totalBuyValue: number;
    totalSellValue: number;
    realisedPnL: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    allocatedCharges: number;
    netPnL: number;
    chargeRatio: number;
  };
  daily: PeriodBucket[];
  weekly: PeriodBucket[];
  monthly: PeriodBucket[];
  stocks: StockSummary[];
  charges: ChargesSummary;
  filteredTrades: Trade[];
  filters: {
    startDate: string;
    endDate: string;
    tradeTypes: TradeType[];
  };
}

export interface AnalysisOptions {
  startDate?: string;
  endDate?: string;
  tradeTypes?: TradeType[];
}

export interface StoredTrade extends Trade {
  dedupeKey: string;
  fingerprint?: string;
  uploadId: string;
  clientCode: string;
  clientName: string;
  symbol: string;
  allocatedCharges: number;
  netPnL: number;
  createdAt: number;
}

export interface TradeTypeStats {
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalBuyValue: number;
  totalSellValue: number;
  realisedPnL: number;
  allocatedCharges: number;
  netPnL: number;
}

export interface StockProfileDateRange {
  first: string;
  last: string;
}

export interface StockProfile {
  symbol: string;
  stockName: string;
  isin: string;
  clientCode: string;
  clientName: string;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  totalBuyValue: number;
  totalSellValue: number;
  grossProfit: number;
  grossLoss: number;
  realisedPnL: number;
  allocatedCharges: number;
  netPnL: number;
  netPnLPct: number;
  avgHoldingDays: number;
  dateRange: StockProfileDateRange;
  byTradeType: Partial<Record<TradeType, TradeTypeStats>>;
  uploadIds: string[];
  updatedAt: number;
}

export interface UploadRecord {
  id: string;
  fileName: string;
  contentHash: string;
  uploadedAt: number;
  clientCode: string;
  clientName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  reportRealisedPnL: number;
  reportUnrealisedPnL: number;
  chargesTotal: number;
  charges: ChargeItem[];
  tradeCount: number;
  newTradesAdded: number;
  duplicatesSkipped: number;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

