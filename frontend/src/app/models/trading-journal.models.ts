export interface RegistryFinancialTable {
  headers: string[];
  rows: Array<{ label: string; values: string[] }>;
}

export interface RegistryLabel {
  id: string;
  name: string;
  createdAt: number;
}

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
  bookValue?: number;
  dividendYield?: number;
  roce?: number;
  roe?: number;
  faceValue?: number;
  highLow?: string;
  salesGrowth3y?: number;
  salesGrowth5y?: number;
  salesGrowth10y?: number;
  salesGrowthTtm?: number;
  profitGrowth3y?: number;
  profitGrowth5y?: number;
  profitGrowth10y?: number;
  profitGrowthTtm?: number;
  stockCagr1y?: number;
  stockCagr3y?: number;
  stockCagr5y?: number;
  stockCagr10y?: number;
  promoterHolding?: number;
  fiiHolding?: number;
  diiHolding?: number;
  publicHolding?: number;
  governmentHolding?: number;
  otherHolding?: number;
  quarterlyResults?: RegistryFinancialTable;
  profitLoss?: RegistryFinancialTable;
  balanceSheet?: RegistryFinancialTable;
  cashFlow?: RegistryFinancialTable;
  shareholding?: RegistryFinancialTable;
  screenerUrl?: string;
  screenerFetchedAt?: number;
  updatedAt: number;
}

export type TradeSegment = 'intraday' | 'delivery';
export type TradeDirection = 'long' | 'short';
export type TradePlanSource = 'manual' | 'auto' | 'momentum';
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

export type MomentumCatalyst =
  | 'earnings_beat'
  | 'guidance_raise'
  | 'result_surprise'
  | 'sector_momentum'
  | 'breakout'
  | 'other';

export interface MomentumStock {
  id: string;
  symbol: string;
  stockName?: string;
  cmp?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  quantity: number;
  catalyst?: MomentumCatalyst;
  resultDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
