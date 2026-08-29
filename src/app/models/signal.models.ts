export type SignalSide = 'BUY' | 'SELL';
export type SuggestionStatus = 'open' | 'pending_approval' | 'hit_target' | 'hit_sl' | 'expired' | 'executed' | 'rejected' | 'executing';

export interface SignalCondition {
  field: string;
  operator: '<' | '>' | 'crosses_above' | 'crosses_below' | 'within_pct';
  value: number;
}

export interface TradeTemplate {
  side: SignalSide;
  entryType: 'market' | 'limit';
  slPct: number;
  targetLevels: number[];
}

export interface SignalRule {
  id: string;
  name: string;
  enabled: boolean;
  watchlistId?: string;
  symbols?: string[];
  conditions: SignalCondition[];
  tradeTemplate: TradeTemplate;
  createdAt: number;
}

export interface TradeSuggestion {
  id: string;
  symbol: string;
  ruleId: string;
  ruleName: string;
  side: SignalSide;
  entry: number;
  sl: number;
  targets: number[];
  confidence: number;
  status: SuggestionStatus;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'executing' | 'executed';
  createdAt: string;
  resolvedAt?: string;
  outcomePct?: number;
  signalSnapshot?: Record<string, number>;
  approvedAt?: string;
  approvedBy?: string;
  platform?: string;
}

export interface TradeOutcome {
  suggestionId: string;
  exitPrice: number;
  exitReason: string;
  pnlPct: number;
  resolvedAt: string;
}
