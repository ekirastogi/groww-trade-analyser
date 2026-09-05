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

export interface QuarterlyMetricChart {
  /** Stable id, e.g. `sales-qoq`. */
  key: string;
  metric: string;
  basis: 'QoQ' | 'YoY';
  title: string;
  caption: string;
  unit: 'currency' | 'percent';
  bars: QuarterBar[];
  summary: string;
}

export interface QuarterBar {
  period: string;
  shortLabel: string;
  value: number | null;
  displayValue: string;
  /** Indian shorthand shown under the bar, e.g. `₹1,500 Cr`. */
  compactValue: string;
  /** Percent change vs the preceding period, or null for the oldest bar shown. */
  growthPct: number | null;
  /** Empty when there is no preceding period to compare against. */
  growthLabel: string;
  basePeriod: string;
  baseDisplayValue: string;
  isLatest: boolean;
  hasData: boolean;
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
  quarterlyCharts: QuarterlyMetricChart[];
  pricePosition: PricePosition | null;
  divergenceNote: string;
  verdicts: AnalysisVerdict[];
}

const SALES_HINTS = ['Sales', 'Revenue'];
const PROFIT_HINTS = ['Net Profit', 'Profit after tax'];
const OPM_HINTS = ['OPM %', 'OPM'];

export function buildStockAnalysis(stock: RegistryStock): StockFundamentalAnalysis {
  const quarterly = stock.quarterlyResults;
  const annual = stock.profitLoss;
  const shareholding = stock.shareholding;

  const sales = quarterly ? analyzeMetric(quarterly, SALES_HINTS, 'currency', stock.salesGrowth3y, stock.salesGrowth5y, stock.salesGrowth10y) : null;
  const netProfit = quarterly
    ? analyzeMetric(quarterly, PROFIT_HINTS, 'currency', stock.profitGrowth3y, stock.profitGrowth5y, stock.profitGrowth10y)
    : null;
  const opm = quarterly ? analyzeMetric(quarterly, OPM_HINTS, 'percent') : null;

  // Annual P&L drives the yearly (YoY) charts.
  const salesAnnual = annual ? analyzeMetric(annual, SALES_HINTS, 'currency') : null;
  const profitAnnual = annual ? analyzeMetric(annual, PROFIT_HINTS, 'currency') : null;
  const opmAnnual = annual ? analyzeMetric(annual, OPM_HINTS, 'percent') : null;

  const holdings: HoldingAnalysis[] = [];
  if (shareholding?.rows?.length) {
    for (const key of ['Promoters', 'FIIs', 'DIIs']) {
      const row = shareholding.rows.find((r) => r.label.toLowerCase().startsWith(key.toLowerCase()));
      if (row) holdings.push(analyzeHolding(shareholding.headers, row));
    }
  }

  const growthTable = buildGrowthTable(sales, netProfit, opm);
  const quarterlyCharts = buildQuarterlyCharts([
    { title: 'Sales', key: 'sales', quarterly: sales, annual: salesAnnual },
    { title: 'Net profit (PAT)', key: 'pat', quarterly: netProfit, annual: profitAnnual },
    { title: 'OPM', key: 'opm', quarterly: opm, annual: opmAnnual },
  ]);
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
    quarterlyCharts,
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

const QUARTER_BAR_COUNT = 5;

interface MetricPair {
  title: string;
  key: string;
  quarterly: MetricAnalysis | null;
  annual: MetricAnalysis | null;
}

type PeriodLabelStyle = 'quarter' | 'quarter-year' | 'year';

/** Indian fiscal quarter ends, in fiscal-year order (Q1…Q4). */
const FISCAL_QUARTER_MONTHS = ['Jun', 'Sep', 'Dec', 'Mar'];

/**
 * Per metric: consecutive quarters, then one chart per fiscal quarter compared across
 * years (Jun 2022 → Jun 2026, Sep 2022 → Sep 2026, …), then financial years.
 */
function buildQuarterlyCharts(pairs: MetricPair[]): QuarterlyMetricChart[] {
  const charts: QuarterlyMetricChart[] = [];

  for (const pair of pairs) {
    const quarterly = pair.quarterly;
    if (quarterly) {
      pushChart(
        charts,
        buildGrowthChart(quarterly, pair, {
          suffix: 'qoq',
          basis: 'QoQ',
          titleSuffix: 'Quarterly (QoQ)',
          caption: 'Consecutive quarters · % vs previous quarter',
          labelStyle: 'quarter',
          points: quarterly.series,
        })
      );

      for (const month of quarterMonthsInSeries(quarterly.series)) {
        const points = quarterly.series.filter((p) => periodMonth(p.period) === month);
        pushChart(
          charts,
          buildGrowthChart(quarterly, pair, {
            suffix: `q-${month.toLowerCase()}`,
            basis: 'YoY',
            titleSuffix: `${month} quarter (YoY)`,
            caption: `${month} quarter each year · % vs previous year`,
            labelStyle: 'quarter-year',
            points,
          })
        );
      }
    }

    if (pair.annual) {
      pushChart(
        charts,
        buildGrowthChart(pair.annual, pair, {
          suffix: 'yoy',
          basis: 'YoY',
          titleSuffix: 'Yearly (YoY)',
          caption: 'Financial years · % vs previous year',
          labelStyle: 'year',
          // Annual tables end with a TTM column, which is not a comparable full year.
          points: pair.annual.series.filter((p) => !/ttm/i.test(p.period)),
        })
      );
    }
  }

  return charts;
}

function pushChart(charts: QuarterlyMetricChart[], chart: QuarterlyMetricChart): void {
  if (chart.bars.length) charts.push(chart);
}

/** Distinct quarter-end months present in the data, ordered Q1→Q4 where recognised. */
function quarterMonthsInSeries(series: { period: string }[]): string[] {
  const seen = new Set<string>();
  for (const point of series) {
    const month = periodMonth(point.period);
    if (month) seen.add(month);
  }
  const known = FISCAL_QUARTER_MONTHS.filter((m) => seen.has(m));
  const others = [...seen].filter((m) => !FISCAL_QUARTER_MONTHS.includes(m));
  return [...known, ...others];
}

function periodMonth(period: string): string {
  return period.trim().split(/\s+/)[0] ?? '';
}

/**
 * Bars for the last {@link QUARTER_BAR_COUNT} points, oldest first. Each bar carries its
 * own value and the percentage change against the point preceding it in `points`, so the
 * comparison follows whatever cadence the caller selected (quarter, same quarter, year).
 */
function buildGrowthChart(
  metric: MetricAnalysis,
  pair: MetricPair,
  spec: {
    suffix: string;
    basis: 'QoQ' | 'YoY';
    titleSuffix: string;
    caption: string;
    labelStyle: PeriodLabelStyle;
    points: { period: string; value: number }[];
  }
): QuarterlyMetricChart {
  const points = spec.points;
  const computed: QuarterBar[] = [];

  // Growth spans the whole list, so a bar keeps its % even when its base scrolls out of view.
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const base = i > 0 ? points[i - 1] : null;
    const growthPct = base ? relativeChange(point.value, base.value) : null;
    computed.push({
      period: point.period,
      shortLabel: periodLabel(point.period, spec.labelStyle),
      value: point.value,
      displayValue: formatMetricValue(point.value, metric.unit),
      compactValue: formatIndianCompact(point.value, metric.unit),
      growthPct,
      growthLabel: growthPct == null ? '' : formatRelativeChange(growthPct),
      basePeriod: base?.period ?? '—',
      baseDisplayValue: formatMetricValue(base?.value ?? null, metric.unit),
      isLatest: i === points.length - 1,
      hasData: true,
    });
  }

  const row = {
    metric: pair.title,
    latest: formatMetricValue(metric.latest, metric.unit),
    qoq: metric.qoqChange,
    yoy: metric.yoyChange,
    unit: metric.unit,
    atAth: metric.atAth,
    belowAthPct: metric.belowAthPct,
  };

  return {
    key: `${pair.key}-${spec.suffix}`,
    metric: pair.title,
    basis: spec.basis,
    title: `${pair.title} · ${spec.titleSuffix}`,
    caption: spec.caption,
    unit: metric.unit,
    bars: computed.slice(-QUARTER_BAR_COUNT),
    summary: growthMetricSummary(row),
  };
}

function periodLabel(period: string, style: PeriodLabelStyle): string {
  switch (style) {
    case 'year':
      return shortYearLabel(period);
    // Bars span several years, so keep the full year to avoid ambiguity.
    case 'quarter-year':
      return period.trim().replace(/\s+/g, ' ');
    default:
      return shortPeriodLabel(period);
  }
}

/** "Mar 2022" -> "2022"; falls back to the raw header when there is no year. */
function shortYearLabel(period: string): string {
  const year = period.match(/(19|20)\d{2}/);
  return year ? year[0] : period.trim();
}

function shortPeriodLabel(period: string): string {
  const parts = period.trim().split(/\s+/);
  if (parts.length >= 2) {
    const year = parts[1].length >= 2 ? parts[1].slice(-2) : parts[1];
    return `${parts[0]} '${year}`;
  }
  return period;
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
    series,
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

/**
 * Relative change used by the growth charts. Unlike {@link pctChange} this is always a
 * percentage, so an OPM move from 6% to 7% reads "+16.7%" rather than "+1 pp".
 */
function relativeChange(current: number, base: number | null): number | null {
  if (base == null || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

function formatRelativeChange(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
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

/**
 * Screener reports currency rows in ₹ crore. Render them in Indian shorthand
 * (₹1,500 Cr / ₹45 L / ₹12 K) so small-cap figures stay readable.
 */
export function formatIndianCompact(value: number | null, unit: 'currency' | 'percent'): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (unit === 'percent') return `${value.toFixed(1)}%`;

  const rupees = value * 1e7;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';

  if (abs >= 1e7) return `${sign}₹${scaleIndian(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${scaleIndian(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${scaleIndian(abs / 1e3)} K`;
  return `${sign}₹${Math.round(abs)}`;
}

function scaleIndian(scaled: number): string {
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return scaled.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
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

/** Horizontal inset (%) so 52W low/high markers and bar ends stay inside the card. */
export const PRICE_RANGE_EDGE_INSET_PCT = 8;

/** 0–100 position of current price between range low and high (for bar segment widths). */
export function priceRangeRawPct(price: PricePosition | null): number {
  if (!price?.current || !price.rangeHigh || !price.rangeLow) return 50;
  const range = price.rangeHigh - price.rangeLow;
  if (range <= 0) return 50;
  const raw = ((price.current - price.rangeLow) / range) * 100;
  return Math.min(100, Math.max(0, raw));
}

/** Marker position on the full chart width, with equal padding before low and after high. */
export function priceRangeDisplayPct(
  price: PricePosition | null,
  insetPct = PRICE_RANGE_EDGE_INSET_PCT,
): number {
  const raw = priceRangeRawPct(price);
  const inner = 100 - 2 * insetPct;
  return insetPct + (raw / 100) * inner;
}

/** @deprecated Use priceRangeDisplayPct for markers and priceRangeRawPct for bar widths. */
export function priceRangePosition(price: PricePosition | null): number {
  return priceRangeDisplayPct(price);
}
