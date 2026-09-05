import { RegistryFinancialTable, RegistryStock } from '../models/trading-journal.models';

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';
export type StakeDirection = 'buying' | 'selling' | 'flat' | 'unknown';

export interface MetricAnalysis {
  label: string;
  unit: 'currency' | 'percent';
  latest: number | null;
  latestPeriod: string;
  qoqChange: number | null;
  yoyChange: number | null;
  ath: number | null;
  athPeriod: string;
  belowAthPct: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  series: { period: string; value: number }[];
}

export interface HoldingAnalysis {
  label: string;
  latest: number | null;
  latestPeriod: string;
  change4q: number | null;
  direction: StakeDirection;
  series: { period: string; value: number }[];
}

export interface CompoundGrowthRow {
  label: string;
  y10: number | null;
  y5: number | null;
  y3: number | null;
  ttm: number | null;
}

export interface StockFundamentalAnalysis {
  hasQuarterly: boolean;
  hasShareholding: boolean;
  sales: MetricAnalysis | null;
  netProfit: MetricAnalysis | null;
  opm: MetricAnalysis | null;
  holdings: HoldingAnalysis[];
  compoundGrowth: CompoundGrowthRow[];
}

export function buildStockAnalysis(stock: RegistryStock): StockFundamentalAnalysis {
  const quarterly = stock.quarterlyResults;
  const shareholding = stock.shareholding;

  const sales = quarterly ? analyzeMetric(quarterly, ['Sales'], 'currency', stock.salesGrowth3y, stock.salesGrowth5y, stock.salesGrowth10y) : null;
  const netProfit = quarterly
    ? analyzeMetric(quarterly, ['Net Profit', 'Profit after tax'], 'currency', stock.profitGrowth3y, stock.profitGrowth5y, stock.profitGrowth10y)
    : null;
  const opm = quarterly ? analyzeMetric(quarterly, ['OPM %', 'OPM'], 'percent') : null;

  const holdings: HoldingAnalysis[] = [];
  if (shareholding?.rows?.length) {
    for (const key of ['Promoters', 'FIIs', 'DIIs']) {
      const row = shareholding.rows.find((r) => r.label.toLowerCase().startsWith(key.toLowerCase()));
      if (row) holdings.push(analyzeHolding(shareholding.headers, row));
    }
  }

  return {
    hasQuarterly: !!quarterly?.rows?.length,
    hasShareholding: !!shareholding?.rows?.length,
    sales,
    netProfit,
    opm,
    holdings,
    compoundGrowth: buildCompoundGrowthRows(stock),
  };
}

function buildCompoundGrowthRows(stock: RegistryStock): CompoundGrowthRow[] {
  return [
    {
      label: 'Sales',
      y10: stock.salesGrowth10y ?? null,
      y5: stock.salesGrowth5y ?? null,
      y3: stock.salesGrowth3y ?? null,
      ttm: stock.salesGrowthTtm ?? null,
    },
    {
      label: 'Profit',
      y10: stock.profitGrowth10y ?? null,
      y5: stock.profitGrowth5y ?? null,
      y3: stock.profitGrowth3y ?? null,
      ttm: stock.profitGrowthTtm ?? null,
    },
    {
      label: 'Stock price',
      y10: stock.stockCagr10y ?? null,
      y5: stock.stockCagr5y ?? null,
      y3: stock.stockCagr3y ?? null,
      ttm: stock.stockCagr1y ?? null,
    },
  ];
}

function analyzeMetric(
  table: RegistryFinancialTable,
  labelHints: string[],
  unit: 'currency' | 'percent',
  cagr3y?: number,
  cagr5y?: number,
  cagr10y?: number
): MetricAnalysis | null {
  const row = findRow(table, labelHints);
  if (!row) return null;

  const series = buildSeries(table.headers, row.values);
  if (!series.length) return null;

  const latest = series[series.length - 1];
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const yoyBase = series.length >= 5 ? series[series.length - 5] : null;

  let ath = series[0];
  for (const point of series) {
    if (point.value > ath.value) ath = point;
  }

  const qoqChange = pctChange(latest.value, prev?.value ?? null, unit);
  const yoyChange = pctChange(latest.value, yoyBase?.value ?? null, unit);
  const belowAthPct =
    latest.value != null && ath.value != null && ath.value !== 0
      ? ((latest.value - ath.value) / Math.abs(ath.value)) * 100
      : null;

  return {
    label: row.label,
    unit,
    latest: latest.value,
    latestPeriod: latest.period,
    qoqChange,
    yoyChange,
    ath: ath.value,
    athPeriod: ath.period,
    belowAthPct,
    cagr3y: cagr3y ?? null,
    cagr5y: cagr5y ?? null,
    cagr10y: cagr10y ?? null,
    series: series.slice(-8),
  };
}

function analyzeHolding(headers: string[], row: { label: string; values: string[] }): HoldingAnalysis {
  const series = buildSeries(headers, row.values).map((p) => ({
    period: p.period,
    value: p.value,
  }));
  const latest = series[series.length - 1];
  const baseIdx = Math.max(0, series.length - 5);
  const base = series[baseIdx];
  const change4q = latest && base ? latest.value - base.value : null;
  let direction: StakeDirection = 'unknown';
  if (change4q != null) {
    if (change4q > 0.15) direction = 'buying';
    else if (change4q < -0.15) direction = 'selling';
    else direction = 'flat';
  }

  return {
    label: row.label,
    latest: latest?.value ?? null,
    latestPeriod: latest?.period ?? '—',
    change4q,
    direction,
    series: series.slice(-6),
  };
}

function findRow(table: RegistryFinancialTable, hints: string[]) {
  for (const hint of hints) {
    const row = table.rows.find((r) => r.label.toLowerCase().includes(hint.toLowerCase()));
    if (row) return row;
  }
  return null;
}

function buildSeries(headers: string[], values: string[]) {
  const out: { period: string; value: number }[] = [];
  const len = Math.min(headers.length, values.length);
  for (let i = 0; i < len; i++) {
    const value = parseFinancialValue(values[i]);
    if (value == null) continue;
    out.push({ period: headers[i], value });
  }
  return out;
}

function parseFinancialValue(raw: string): number | null {
  const text = raw?.replace(/\s+/g, ' ').trim();
  if (!text || text === '—' || text === '-') return null;
  const cleaned = text.replace(/,/g, '').replace(/%/g, '').replace(/₹/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pctChange(current: number, base: number | null, unit: 'currency' | 'percent'): number | null {
  if (base == null || base === 0) return null;
  if (unit === 'percent') return current - base;
  return ((current - base) / Math.abs(base)) * 100;
}

export function trendDirection(value: number | null): TrendDirection {
  if (value == null || Number.isNaN(value)) return 'unknown';
  if (value > 0.5) return 'up';
  if (value < -0.5) return 'down';
  return 'flat';
}

export function formatAnalysisChange(value: number | null, unit: 'currency' | 'percent'): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  if (unit === 'percent') return `${sign}${value.toFixed(1)} pp`;
  return `${sign}${value.toFixed(1)}%`;
}

export function formatAthDistance(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) < 0.05) return 'At all-time high';
  if (value < 0) return `${Math.abs(value).toFixed(1)}% below ATH`;
  return `${value.toFixed(1)}% above ATH`;
}

export function formatMetricValue(value: number | null, unit: 'currency' | 'percent'): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return `₹${value.toLocaleString('en-IN')} Cr`;
}
