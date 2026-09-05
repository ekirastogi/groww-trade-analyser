import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartConfiguration } from 'chart.js';
import { RegistryFinancialTable, RegistryStock } from '../../models/trading-journal.models';
import { formatFetchedAt, formatDataAge } from '../../utils/data-age.utils';
import { formatCurrency } from '../../utils/format.utils';
import { ChartCardComponent } from '../shared/chart-card/chart-card.component';
import {
  buildStockAnalysis,
  formatAnalysisChange,
  formatAthDistance,
  formatMetricValue,
  formatPriceValue,
  GrowthComparisonRow,
  HoldingAnalysis,
  priceRangeRawPct as calcPriceRangeRawPct,
  priceRangeDisplayPct as calcPriceRangeDisplayPct,
  QuarterlyMetricChart,
  trendDirection,
  VerdictTone,
} from '../../utils/screener-analysis.utils';

type FinancialTab = 'analysis' | 'quarterly' | 'annual' | 'balance' | 'cashflow' | 'shareholding' | 'growth';

/** Grouped-bar palette: light blue / dark blue / light green with a slate outline. */
const QUARTER_SERIES_COLORS = ['#aecfe4', '#3c76a6', '#b1d884'];
const QUARTER_BAR_BORDER = '#334155';

@Component({
  selector: 'app-screener-fundamentals',
  standalone: true,
  imports: [CommonModule, ChartCardComponent],
  templateUrl: './screener-fundamentals.component.html',
})
export class ScreenerFundamentalsComponent {
  @Input({ required: true }) stock!: RegistryStock;

  activeTab = signal<FinancialTab>('analysis');

  readonly tabs: FinancialTab[] = ['analysis', 'quarterly', 'annual', 'balance', 'cashflow', 'shareholding', 'growth'];

  analysis = computed(() => buildStockAnalysis(this.stock));

  /** Grouped bar chart: one group per quarter, one bar per metric (OPM on the right % axis). */
  quarterlyGroupedChart = computed<ChartConfiguration<'bar'> | null>(() => {
    const charts = this.analysis().quarterlyCharts;
    if (!charts.length) return null;

    const labelSource = charts.reduce((best, chart) =>
      chart.bars.filter((b) => b.hasData).length > best.bars.filter((b) => b.hasData).length
        ? chart
        : best
    );
    const labels = labelSource.bars.map((b) => b.shortLabel);
    if (!labels.some((label) => label !== '—')) return null;

    const datasets = charts.map((chart, index) => ({
      label: chart.metric,
      data: chart.bars.map((b) => b.value),
      backgroundColor: QUARTER_SERIES_COLORS[index % QUARTER_SERIES_COLORS.length],
      borderColor: QUARTER_BAR_BORDER,
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 34,
      yAxisID: chart.unit === 'percent' ? 'yPct' : 'yValue',
    }));

    const hasPercent = charts.some((c) => c.unit === 'percent');
    const hasValue = charts.some((c) => c.unit !== 'percent');

    return {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'start',
            labels: { boxWidth: 10, boxHeight: 10, usePointStyle: false, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                const unit = charts[ctx.datasetIndex]?.unit ?? 'currency';
                const value = Number(ctx.parsed.y);
                return `${ctx.dataset.label}: ${formatMetricValue(value, unit)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#cbd5e1' },
            ticks: { font: { size: 10 }, color: '#64748b' },
          },
          yValue: {
            display: hasValue,
            position: 'left',
            grid: { color: 'rgba(148,163,184,0.25)' },
            border: { display: false },
            ticks: {
              font: { size: 10 },
              color: '#64748b',
              maxTicksLimit: 5,
              callback: (v) => formatMetricValue(Number(v), 'currency'),
            },
            grace: '8%',
          },
          yPct: {
            display: hasPercent,
            position: 'right',
            grid: { display: false },
            border: { display: false },
            ticks: {
              font: { size: 10 },
              color: '#64748b',
              maxTicksLimit: 5,
              callback: (v) => `${Number(v).toFixed(0)}%`,
            },
            grace: '8%',
          },
        },
      },
    };
  });

  quarterlyMetricSummaries = computed<QuarterlyMetricChart[]>(() =>
    this.analysis().quarterlyCharts
  );

  latestBar(chart: QuarterlyMetricChart) {
    return [...chart.bars].reverse().find((b) => b.hasData) ?? null;
  }
  priceRangeRawPct = computed(() => calcPriceRangeRawPct(this.analysis().pricePosition));
  priceRangeDisplayPct = computed(() => calcPriceRangeDisplayPct(this.analysis().pricePosition));

  pctAboveLow(price: { aboveRangeLowPct: number | null }): number | null {
    return price.aboveRangeLowPct;
  }

  pctBelowHigh(price: { belowRangeHighPct: number | null }): number | null {
    if (price.belowRangeHighPct == null) return null;
    return price.belowRangeHighPct < 0 ? Math.abs(price.belowRangeHighPct) : 0;
  }

  formatFetchedAt = formatFetchedAt;
  formatDataAge = formatDataAge;
  formatAnalysisChange = formatAnalysisChange;
  formatAthDistance = formatAthDistance;
  formatMetricValue = formatMetricValue;
  formatPriceValue = formatPriceValue;
  trendDirection = trendDirection;

  formatPct(value: number | undefined | null): string {
    if (value == null || Number.isNaN(value)) return '—';
    return `${value}%`;
  }

  formatPrice(value: number | undefined): string {
    if (value == null || Number.isNaN(value) || value <= 0) return '—';
    return formatCurrency(value);
  }

  formatMarketCap(value: number | undefined): string {
    if (value == null || Number.isNaN(value) || value <= 0) return '—';
    if (value >= 1e7) return `₹${(value / 1e7).toFixed(0)} Cr`;
    return formatCurrency(value);
  }

  setTab(tab: FinancialTab): void {
    this.activeTab.set(tab);
  }

  activeTable(): RegistryFinancialTable | null {
    switch (this.activeTab()) {
      case 'quarterly':
        return this.stock.quarterlyResults?.rows?.length ? this.stock.quarterlyResults : null;
      case 'annual':
        return this.stock.profitLoss?.rows?.length ? this.stock.profitLoss : null;
      case 'balance':
        return this.stock.balanceSheet?.rows?.length ? this.stock.balanceSheet : null;
      case 'cashflow':
        return this.stock.cashFlow?.rows?.length ? this.stock.cashFlow : null;
      case 'shareholding':
        return this.stock.shareholding?.rows?.length ? this.stock.shareholding : null;
      default:
        return null;
    }
  }

  tabLabel(tab: FinancialTab): string {
    switch (tab) {
      case 'analysis':
        return 'Analysis';
      case 'quarterly':
        return 'Quarterly results';
      case 'annual':
        return 'Profit & loss';
      case 'balance':
        return 'Balance sheet';
      case 'cashflow':
        return 'Cash flow';
      case 'shareholding':
        return 'Shareholding';
      case 'growth':
        return 'Growth & holdings';
    }
  }

  hasTabData(tab: FinancialTab): boolean {
    if (tab === 'analysis' || tab === 'growth') return true;
    switch (tab) {
      case 'quarterly':
        return !!this.stock.quarterlyResults?.rows?.length;
      case 'annual':
        return !!this.stock.profitLoss?.rows?.length;
      case 'balance':
        return !!this.stock.balanceSheet?.rows?.length;
      case 'cashflow':
        return !!this.stock.cashFlow?.rows?.length;
      case 'shareholding':
        return !!this.stock.shareholding?.rows?.length;
    }
  }

  stakeLabel(h: HoldingAnalysis): string {
    switch (h.direction) {
      case 'buying':
        return 'Accumulating';
      case 'selling':
        return 'Reducing';
      case 'flat':
        return 'Stable';
      default:
        return '—';
    }
  }

  verdictClass(tone: VerdictTone): string {
    switch (tone) {
      case 'bullish':
        return 'screener-verdict-bullish';
      case 'bearish':
        return 'screener-verdict-bearish';
      case 'caution':
        return 'screener-verdict-caution';
      default:
        return 'screener-verdict-neutral';
    }
  }

  growthCellClass(value: number | null, unit: 'currency' | 'percent'): string {
    const dir = trendDirection(value);
    if (dir === 'up') return 'screener-growth-up';
    if (dir === 'down') return 'screener-growth-down';
    return '';
  }

  formatGrowthCell(row: GrowthComparisonRow, kind: 'qoq' | 'yoy'): string {
    const val = kind === 'qoq' ? row.qoq : row.yoy;
    return formatAnalysisChange(val, row.unit);
  }
}
