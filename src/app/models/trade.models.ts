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
  dateRange: DateRange;
  tradeTypes: TradeType[];
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
