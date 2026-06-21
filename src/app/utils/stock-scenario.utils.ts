import { StockSummary } from '../models/trade.models';

export type StockFilterColumn =
  | 'stockName'
  | 'tradeCount'
  | 'quantity'
  | 'buyValue'
  | 'sellValue'
  | 'realisedPnL'
  | 'realisedPnLPct'
  | 'allocatedCharges'
  | 'netPnL';

export type StockFilterOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains';

export interface StockFilterRule {
  id: string;
  column: StockFilterColumn;
  operator: StockFilterOperator;
  value: string;
}

export interface StockScenario {
  id: string;
  name: string;
  rules: StockFilterRule[];
  createdAt: number;
}

export const STOCK_SCENARIO_STORAGE_KEY = 'groww-pl-stock-scenarios';

export const STOCK_FILTER_COLUMNS: { key: StockFilterColumn; label: string; type: 'number' | 'text' }[] = [
  { key: 'stockName', label: 'Stock', type: 'text' },
  { key: 'tradeCount', label: 'Trades', type: 'number' },
  { key: 'quantity', label: 'Qty', type: 'number' },
  { key: 'buyValue', label: 'Buy Value', type: 'number' },
  { key: 'sellValue', label: 'Sell Value', type: 'number' },
  { key: 'realisedPnL', label: 'P&L', type: 'number' },
  { key: 'realisedPnLPct', label: 'P&L %', type: 'number' },
  { key: 'allocatedCharges', label: 'Charges', type: 'number' },
  { key: 'netPnL', label: 'Net P&L', type: 'number' },
];

export const NUMERIC_OPERATORS: { key: StockFilterOperator; label: string }[] = [
  { key: 'gt', label: '>' },
  { key: 'gte', label: '≥' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '≤' },
  { key: 'eq', label: '=' },
  { key: 'neq', label: '≠' },
];

export const TEXT_OPERATORS: { key: StockFilterOperator; label: string }[] = [
  { key: 'contains', label: 'contains' },
  { key: 'eq', label: 'equals' },
];

export const EXAMPLE_STOCK_SCENARIOS: { name: string; rules: Omit<StockFilterRule, 'id'>[] }[] = [
  {
    name: 'Profitable stocks',
    rules: [{ column: 'netPnL', operator: 'gt', value: '0' }],
  },
  {
    name: 'Loss-making stocks',
    rules: [{ column: 'netPnL', operator: 'lt', value: '0' }],
  },
  {
    name: '+ve P&L, net loss',
    rules: [
      { column: 'realisedPnL', operator: 'gt', value: '0' },
      { column: 'netPnL', operator: 'lt', value: '0' },
    ],
  },
  {
    name: 'Winners (+ve P&L & Net)',
    rules: [
      { column: 'realisedPnL', operator: 'gt', value: '0' },
      { column: 'netPnL', operator: 'gt', value: '0' },
    ],
  },
  {
    name: 'Losers (-ve P&L & Net)',
    rules: [
      { column: 'realisedPnL', operator: 'lt', value: '0' },
      { column: 'netPnL', operator: 'lt', value: '0' },
    ],
  },
];

export function createStockFilterRule(
  partial: Partial<StockFilterRule> = {}
): StockFilterRule {
  return {
    id: createId(),
    column: partial.column ?? 'netPnL',
    operator: partial.operator ?? 'gt',
    value: partial.value ?? '0',
  };
}

export function operatorsForColumn(column: StockFilterColumn): { key: StockFilterOperator; label: string }[] {
  const meta = STOCK_FILTER_COLUMNS.find((c) => c.key === column);
  return meta?.type === 'text' ? TEXT_OPERATORS : NUMERIC_OPERATORS;
}

export function defaultOperatorForColumn(column: StockFilterColumn): StockFilterOperator {
  return operatorsForColumn(column)[0].key;
}

export function matchesStockRule(stock: StockSummary, rule: StockFilterRule): boolean {
  const columnMeta = STOCK_FILTER_COLUMNS.find((c) => c.key === rule.column);
  if (!columnMeta) return true;

  if (columnMeta.type === 'text') {
    const haystack = String(stock.stockName ?? '').toLowerCase();
    const needle = rule.value.trim().toLowerCase();
    if (!needle) return true;
    if (rule.operator === 'eq') return haystack === needle;
    return haystack.includes(needle);
  }

  const actual = getNumericStockValue(stock, rule.column);
  const expected = parseNumericFilterValue(rule.column, rule.value);
  if (expected === null || Number.isNaN(actual)) return false;

  switch (rule.operator) {
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    default: return true;
  }
}

export function filterStocksByRules(stocks: StockSummary[], rules: StockFilterRule[]): StockSummary[] {
  const active = rules.filter((rule) => rule.value.trim() !== '');
  if (!active.length) return stocks;
  return stocks.filter((stock) => active.every((rule) => matchesStockRule(stock, rule)));
}

export function loadSavedStockScenarios(): StockScenario[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STOCK_SCENARIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StockScenario[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistStockScenarios(scenarios: StockScenario[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STOCK_SCENARIO_STORAGE_KEY, JSON.stringify(scenarios));
  } catch {
    // ignore storage errors
  }
}

function getNumericStockValue(stock: StockSummary, column: StockFilterColumn): number {
  if (column === 'realisedPnLPct') return stock.realisedPnLPct * 100;
  return stock[column as keyof StockSummary] as number;
}

/** P&L % rules are entered as percentage points (e.g. 5 for 5%). */
function parseNumericFilterValue(column: StockFilterColumn, raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
