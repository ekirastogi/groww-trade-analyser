export interface RegistryStock {
  symbol: string;
  name: string;
  currentPrice: number;
  marketCap?: number;
  pe?: number;
  rsi?: number;
  macd?: number;
  macdHist?: number;
  macdSignal?: number;
  sma20?: number;
  sma50?: number;
  supports: number[];
  resistances: number[];
  notes?: string;
  updatedAt: number;
}

export type TradeSegment = 'intraday' | 'delivery';
export type TradeDirection = 'long' | 'short';
export type TradePlanSource = 'manual' | 'auto';
export type TradeExecutionStatus = 'planned' | 'executed' | 'skipped';

export interface PlannedTrade {
  id: string;
  symbol: string;
  stockName?: string;
  tradeDate: string;
  segment: TradeSegment;
  direction: TradeDirection;
  quantity: number;
  cmp?: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss?: number;
  source: TradePlanSource;
  status: TradeExecutionStatus;
  estimatedPnL: number;
  realizedPnL?: number;
  executedQuantity?: number;
  executedBuyValue?: number;
  executedSellValue?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TradeExecutionInput {
  quantity: number;
  buyValue: number;
  sellValue: number;
}

export interface DayTradeSummary {
  tradeDate: string;
  tradeCount: number;
  estimatedPnL: number;
  realizedPnL: number;
  executedCount: number;
  skippedCount: number;
}
