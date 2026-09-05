import { RegistryFinancialTable, RegistryStock } from '../models/trading-journal.models';

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';
export type StakeDirection = 'buying' | 'selling' | 'flat' | 'unknown';
export type VerdictTone = 'bullish' | 'bearish' | 'caution' | 'neutral';

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
  atAth: boolean;
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

/** Parsed from Screener high/low text — computed in UI only, never saved. */
export interface PricePosition {
  current: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  belowRangeHighPct: number | null;
  aboveRangeLowPct: number | null;
  rangeLabel: string;
}

export interface GrowthComparisonRow {
  metric: string;
  latest: string;
  qoq: number | null;
  yoy: number | null;
  unit: 'currency' | 'percent';
  atAth: boolean;
  belowAthPct: number | null;
}

export interface AnalysisVerdict {
  tone: VerdictTone;
  title: string;
  body: string;
  upsidePct: number | null;
  downsidePct: number | null;
}

export interface StockFundamentalAnalysis {
  hasQuarterly: boolean;
  hasShareholding: boolean;
  sales: MetricAnalysis | null;
  netProfit: MetricAnalysis | null;
  opm: MetricAnalysis | null;
  holdings: HoldingAnalysis[];
  compoundGrowth: CompoundGrowthRow[];
  growthTable: GrowthComparisonRow[];
  pricePosition: PricePosition | null;
  divergenceNote: string;
  verdicts: AnalysisVerdict[];
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

  const growthTable = buildGrowthTable(sales, netProfit, opm);
  const pricePosition = buildPricePosition(stock.currentPrice, stock.highLow);
  const divergenceNote = buildDivergenceNote(sales, netProfit, opm);
  const verdicts = buildVerdicts(sales, netProfit, opm, pricePosition, holdings, divergenceNote);

  return {
    hasQuarterly: !!quarterly?.rows?.length,
    hasShareholding: !!shareholding?.rows?.length,
    sales,
    netProfit,
    opm,
    holdings,
    compoundGrowth: buildCompoundGrowthRows(stock),
    growthTable,
    pricePosition,
    divergenceNote,
    verdicts,
  };
}

function buildGrowthTable(
  sales: MetricAnalysis | null,
  profit: MetricAnalysis | null,
  opm: MetricAnalysis | null
): GrowthComparisonRow[] {
  const rows: GrowthComparisonRow[] = [];
  if (sales) {
    rows.push({
      metric: 'Sales',
      latest: formatMetricValue(sales.latest, sales.unit),
      qoq: sales.qoqChange,
      yoy: sales.yoyChange,
      unit: sales.unit,
      atAth: sales.atAth,
      belowAthPct: sales.belowAthPct,
    });
  }
  if (profit) {
    rows.push({
      metric: 'Net profit (PAT)',
      latest: formatMetricValue(profit.latest, profit.unit),
      qoq: profit.qoqChange,
      yoy: profit.yoyChange,
      unit: profit.unit,
      atAth: profit.atAth,
      belowAthPct: profit.belowAthPct,
    });
  }
  if (opm) {
    rows.push({
      metric: 'OPM',
      latest: formatMetricValue(opm.latest, opm.unit),
      qoq: opm.qoqChange,
      yoy: opm.yoyChange,
      unit: opm.unit,
      atAth: opm.atAth,
      belowAthPct: opm.belowAthPct,
    });
  }
  return rows;
}

function buildPricePosition(currentPrice: number | undefined, highLow?: string): PricePosition | null {
  const range = parseHighLow(highLow);
  const current = currentPrice && currentPrice > 0 ? currentPrice : null;
  if (!range && !current) return null;

  const rangeHigh = range?.high ?? null;
  const rangeLow = range?.low ?? null;
  let belowRangeHighPct: number | null = null;
  let aboveRangeLowPct: number | null = null;

  if (current != null && rangeHigh != null && rangeHigh > 0) {
    belowRangeHighPct = ((current - rangeHigh) / rangeHigh) * 100;
  }
  if (current != null && rangeLow != null && rangeLow > 0) {
    aboveRangeLowPct = ((current - rangeLow) / rangeLow) * 100;
  }

  return {
    current,
    rangeHigh,
    rangeLow,
    belowRangeHighPct,
    aboveRangeLowPct,
    rangeLabel: '52-week range (from Screener)',
  };
}

function parseHighLow(raw?: string): { high: number; low: number } | null {
  if (!raw) return null;
  const nums = raw.match(/[\d,]+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const high = Number(nums[0].replace(/,/g, ''));
  const low = Number(nums[1].replace(/,/g, ''));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high: Math.max(high, low), low: Math.min(high, low) };
}

function buildDivergenceNote(sales: MetricAnalysis | null, profit: MetricAnalysis | null, opm: MetricAnalysis | null): string {
  if (!sales || !profit) return 'Insufficient quarterly data to compare sales vs profit trends.';

  const salesYoy = sales.yoyChange;
  const profitYoy = profit.yoyChange;
  if (salesYoy == null || profitYoy == null) {
    return 'YoY comparison needs at least five quarters of results.';
  }

  const gap = salesYoy - profitYoy;
  if (salesYoy < -2 && profitYoy < -2) {
    return 'Both sales and profit are declining YoY — fundamentals are weakening together.';
  }
  if (salesYoy > 5 && profitYoy > 5 && sales.atAth && profit.atAth) {
    return 'Sales and profit are growing YoY and both sit at quarterly highs — strong aligned momentum.';
  }
  if (gap > 8) {
    return `Sales growing ${salesYoy.toFixed(1)}% YoY vs profit ${profitYoy.toFixed(1)}% — revenue is outpacing earnings (margin pressure or rising costs).`;
  }
  if (gap < -8) {
    return `Profit growing ${profitYoy.toFixed(1)}% YoY vs sales ${salesYoy.toFixed(1)}% — earnings are expanding faster than revenue (margin improvement).`;
  }
  if (Math.abs(gap) <= 3) {
    return `Sales and profit are moving in sync (YoY ${salesYoy.toFixed(1)}% vs ${profitYoy.toFixed(1)}%).`;
  }
  if (opm?.yoyChange != null && opm.yoyChange < -2) {
    return 'OPM is contracting YoY while sales may still be growing — watch profitability quality.';
  }
  return `Sales YoY ${salesYoy.toFixed(1)}%, profit YoY ${profitYoy.toFixed(1)}% — moderate divergence.`;
}

function buildVerdicts(
  sales: MetricAnalysis | null,
  profit: MetricAnalysis | null,
  opm: MetricAnalysis | null,
  price: PricePosition | null,
  holdings: HoldingAnalysis[],
  divergence: string
): AnalysisVerdict[] {
  const verdicts: AnalysisVerdict[] = [];

  if (sales && profit) {
    const strongFundamentals =
      (sales.yoyChange ?? 0) > 10 &&
      (profit.yoyChange ?? 0) > 10 &&
      trendDirection(sales.qoqChange) !== 'down' &&
      trendDirection(profit.qoqChange) !== 'down';

    const weakFundamentals =
      (sales.yoyChange ?? 0) < -5 && (profit.yoyChange ?? 0) < -5;

    const fundAtAth = sales.atAth && profit.atAth;
    const priceBelowHigh = price?.belowRangeHighPct != null && price.belowRangeHighPct < -3;

    if (strongFundamentals && fundAtAth && priceBelowHigh && price?.belowRangeHighPct != null) {
      verdicts.push({
        tone: 'bullish',
        title: 'Fundamentals strong, price below recent high',
        body: `Sales and profit are growing double-digit YoY at quarterly highs, but price is ${Math.abs(price.belowRangeHighPct).toFixed(1)}% below the 52-week high. Re-rating toward the range high is plausible if momentum continues.`,
        upsidePct: Math.abs(price.belowRangeHighPct),
        downsidePct: null,
      });
    } else if (strongFundamentals && priceBelowHigh) {
      verdicts.push({
        tone: 'bullish',
        title: 'Earnings momentum with price lag',
        body: `Healthy YoY growth in sales and profit while price trades below the 52-week high — potential catch-up if trends sustain.`,
        upsidePct: price?.belowRangeHighPct != null ? Math.abs(price.belowRangeHighPct) : null,
        downsidePct: null,
      });
    } else if (weakFundamentals && price && price.belowRangeHighPct != null && price.belowRangeHighPct > -15) {
      const toLow =
        price.current != null && price.rangeLow != null && price.current > 0
          ? ((price.rangeLow - price.current) / price.current) * 100
          : null;
      verdicts.push({
        tone: 'bearish',
        title: 'Weak fundamentals, price not yet at lows',
        body: `Sales and profit are declining YoY but price is only ${Math.abs(price.belowRangeHighPct).toFixed(1)}% off the 52-week high. Downside toward the 52-week low is a risk if earnings keep slipping.`,
        upsidePct: null,
        downsidePct: toLow != null ? Math.abs(toLow) : null,
      });
    } else if (weakFundamentals) {
      verdicts.push({
        tone: 'bearish',
        title: 'Contracting fundamentals',
        body: 'Both sales and profit are down YoY — avoid assuming price support until trends stabilise.',
        upsidePct: null,
        downsidePct: null,
      });
    }
  }

  verdicts.push({
    tone: 'neutral',
    title: 'Sales vs profit',
    body: divergence,
    upsidePct: null,
    downsidePct: null,
  });

  if (opm && opm.yoyChange != null) {
    const tone: VerdictTone =
      opm.yoyChange > 1 ? 'bullish' : opm.yoyChange < -1 ? 'caution' : 'neutral';
    verdicts.push({
      tone,
      title: 'Operating margin (OPM)',
      body: `Latest OPM ${formatMetricValue(opm.latest, 'percent')} — ${formatAnalysisChange(opm.yoyChange, 'percent')} YoY. ${formatAthDistance(opm.belowAthPct)}.`,
      upsidePct: null,
      downsidePct: null,
    });
  }

  const fii = holdings.find((h) => h.label.startsWith('FII'));
  const dii = holdings.find((h) => h.label.startsWith('DII'));
  const promo = holdings.find((h) => h.label.startsWith('Promoter'));
  const institutionalBuying = [fii, dii].filter((h) => h?.direction === 'buying').length;
  const institutionalSelling = [fii, dii].filter((h) => h?.direction === 'selling').length;
  if (fii || dii || promo) {
    let body = '';
    if (institutionalBuying >= 2) body = 'FIIs and DIIs increased stakes over recent quarters — supportive flow.';
    else if (institutionalSelling >= 2) body = 'FIIs and DIIs reduced stakes over recent quarters — watch supply pressure.';
    else if (promo?.direction === 'buying') body = 'Promoters increased holding — alignment with minority shareholders.';
    else if (promo?.direction === 'selling') body = 'Promoters reduced holding — monitor governance and supply.';
    else body = 'Shareholding broadly stable over the last few quarters.';
    verdicts.push({
      tone: institutionalSelling >= 2 ? 'caution' : institutionalBuying >= 2 ? 'bullish' : 'neutral',
      title: 'Shareholding flow',
      body,
      upsidePct: null,
      downsidePct: null,
    });
  }

  return verdicts;
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
  const atAth = belowAthPct != null && Math.abs(belowAthPct) < 0.5;

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
    atAth,
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
  if (Math.abs(value) < 0.05) return 'At quarterly high';
  if (value < 0) return `${Math.abs(value).toFixed(1)}% below quarterly high`;
  return `${value.toFixed(1)}% above quarterly high`;
}

export function formatMetricValue(value: number | null, unit: 'currency' | 'percent'): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return `₹${value.toLocaleString('en-IN')} Cr`;
}

export function formatPriceValue(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `₹${value.toLocaleString('en-IN')}`;
}

export function growthBarWidth(value: number | null): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.min(Math.abs(value) / 50, 1) * 100;
}

export function growthMetricSummary(row: GrowthComparisonRow): string {
  const qoq = row.qoq;
  const yoy = row.yoy;
  const ath = row.atAth
    ? 'Latest quarter is at the highest level in the available history.'
    : row.belowAthPct != null
      ? `${Math.abs(row.belowAthPct).toFixed(1)}% below the quarterly high.`
      : '';

  if (qoq == null && yoy == null) {
    return `${row.metric} is ${row.latest}. Not enough quarters for QoQ/YoY comparison.`;
  }

  const qoqText =
    qoq == null
      ? 'QoQ change unavailable'
      : row.unit === 'percent'
        ? `QoQ ${qoq >= 0 ? 'expanded' : 'contracted'} by ${Math.abs(qoq).toFixed(1)} percentage points`
        : `QoQ ${qoq >= 0 ? 'up' : 'down'} ${Math.abs(qoq).toFixed(1)}%`;

  const yoyText =
    yoy == null
      ? 'YoY change unavailable'
      : row.unit === 'percent'
        ? `YoY ${yoy >= 0 ? 'expanded' : 'contracted'} by ${Math.abs(yoy).toFixed(1)} percentage points`
        : `YoY ${yoy >= 0 ? 'up' : 'down'} ${Math.abs(yoy).toFixed(1)}%`;

  return `${row.metric} at ${row.latest}. ${qoqText}; ${yoyText}. ${ath}`.trim();
}

export function priceRangePosition(price: PricePosition | null): number {
  if (!price?.current || !price.rangeHigh || !price.rangeLow) return 50;
  const range = price.rangeHigh - price.rangeLow;
  if (range <= 0) return 50;
  return ((price.current - price.rangeLow) / range) * 100;
}
