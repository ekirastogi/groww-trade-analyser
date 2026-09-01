export interface RegistryStock {
  symbol: string;
  name: string;
  currentPrice: number;
  isin?: string;
  exchange?: string;
  source?: 'pnl_upload' | 'seed' | 'manual' | 'exchange_seed';
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

export interface ExecutionLeg {
  quantity: number;
  price: number;
}

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
  estimatedStopLossPnL?: number;
  realizedPnL?: number;
  executedQuantity?: number;
  executedBuyPrice?: number;
  executedSellPrice?: number;
  buyLegs?: ExecutionLeg[];
  sellLegs?: ExecutionLeg[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TradeExecutionInput {
  buyLegs: ExecutionLeg[];
  sellLegs: ExecutionLeg[];
}

export interface DayTradeSummary {
  tradeDate: string;
  tradeCount: number;
  estimatedPnL: number;
  estimatedStopLossPnL: number;
  realizedPnL: number;
  executedCount: number;
  skippedCount: number;
}
