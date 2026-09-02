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
export type TradeExecutionStatus = 'planned' | 'executed' | 'skipped' | 'open';

export interface ExecutionLeg {
  quantity: number;
  price: number;
}

/** Planned entry levels — initial entry plus optional scale-ins at other prices. */
export type PlannedEntryLeg = ExecutionLeg;

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
  entryLegs?: PlannedEntryLeg[];
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
  /** Original plan date when moved to the open pool. */
  openedFromDate?: string;
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
