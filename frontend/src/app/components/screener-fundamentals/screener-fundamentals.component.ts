import { Component, HostListener, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartConfiguration, Plugin } from 'chart.js';
import { RegistryFinancialTable, RegistryStock } from '../../models/trading-journal.models';
import { formatFetchedAt, formatDataAge } from '../../utils/data-age.utils';
import { formatCurrency } from '../../utils/format.utils';
import { CHART_COLORS, isMobileChart } from '../../utils/chart-theme';
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

interface GrowthChartView {
  key: string;
  title: string;
  caption: string;
  config: ChartConfiguration<'bar'>;
}

/** Draws the % change above (or below, for declines) each bar. */
const growthLabelPlugin: Plugin<'bar'> = {
  id: 'screenerGrowthLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const labels = (chart.data.datasets[0] as { growthLabels?: string[] })?.growthLabels ?? [];
    const mobile = isMobileChart();

    ctx.save();
    ctx.font = `600 ${mobile ? 9 : 11}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';

    meta.data.forEach((bar, i) => {
      const text = labels[i];
      if (!text) return;
      const value = Number(chart.data.datasets[0].data[i] ?? 0);
      const up = value >= 0;
      ctx.fillStyle = up ? '#047857' : '#b91c1c';
      ctx.textBaseline = up ? 'bottom' : 'top';
      ctx.fillText(text, bar.x, bar.y + (up ? -5 : 5));
    });

    ctx.restore();
  },
};

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

  /** Bumped on resize so chart sizing/font choices recompute for the new breakpoint. */
  private viewportVersion = signal(0);

  growthChartHeight = computed(() => {
    this.viewportVersion();
    return isMobileChart() ? 210 : 250;
  });

  /** One growth chart per metric per basis (Sales/PAT/OPM × QoQ/YoY). */
  growthCharts = computed<GrowthChartView[]>(() => {
    this.viewportVersion();
    return this.analysis().quarterlyCharts.map((chart) => ({
      key: chart.key,
      title: chart.title,
      caption: chart.caption,
      config: this.buildGrowthChartConfig(chart),
    }));
  });

  @HostListener('window:resize')
  onViewportResize(): void {
    this.viewportVersion.update((v) => v + 1);
  }

  private buildGrowthChartConfig(chart: QuarterlyMetricChart): ChartConfiguration<'bar'> {
    const mobile = isMobileChart();
    const values = chart.bars.map((b) => b.growthPct);
    const unitSuffix = chart.unit === 'percent' ? ' pp' : '%';
    const labelGutter = mobile ? 18 : 22;
    const hasDecline = values.some((v) => v < 0);

    return {
      type: 'bar',
      data: {
        labels: chart.bars.map((b) => b.shortLabel),
        datasets: [
          {
            label: `${chart.metric} ${chart.basis}`,
            data: values,
            growthLabels: chart.bars.map((b) => b.growthLabel),
            backgroundColor: values.map((v) =>
              v >= 0 ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)'
            ),
            hoverBackgroundColor: values.map((v) =>
              v >= 0 ? CHART_COLORS.success : CHART_COLORS.danger
            ),
            borderWidth: 0,
            borderRadius: 3,
            // Bars sit flush against each other.
            categoryPercentage: 1,
            barPercentage: 1,
          } as ChartConfiguration<'bar'>['data']['datasets'][number],
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Gutters so the % labels at the bar ends are never clipped.
        layout: {
          padding: { top: labelGutter, right: 2, bottom: hasDecline ? labelGutter : 0, left: 0 },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CHART_COLORS.ink,
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => chart.bars[items[0]?.dataIndex ?? 0]?.period ?? '',
              label: (ctx) => {
                const bar = chart.bars[ctx.dataIndex];
                if (!bar) return '';
                return [
                  `${chart.basis}: ${bar.growthLabel}`,
                  `${chart.metric}: ${bar.displayValue}`,
                  `vs ${bar.basePeriod}: ${bar.baseDisplayValue}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: CHART_COLORS.border },
            ticks: { font: { size: mobile ? 9 : 10 }, color: CHART_COLORS.muted },
          },
          y: {
            grid: { color: CHART_COLORS.grid },
            border: { display: false },
            grace: '18%',
            ticks: {
              font: { size: mobile ? 9 : 10 },
              color: CHART_COLORS.muted,
              maxTicksLimit: 5,
              callback: (v) => `${Number(v).toFixed(0)}${unitSuffix}`,
            },
          },
        },
      },
      plugins: [growthLabelPlugin],
    };
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
