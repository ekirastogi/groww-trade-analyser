import {
  Component,
  inject,
  computed,
  signal,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { ReportStateService } from '../../services/report-state.service';
import { TRADE_TYPE_LABELS, TradeType } from '../../models/trade.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';
import {
  CHART_COLORS,
  abbreviateLabel,
  barChartOptions,
  comboChartOptions,
  groupedBarChartOptions,
  lineChartOptions,
  countBarChartOptions,
  doughnutChartOptions,
  scatterChartOptions,
  baseLegendPublic,
  withDecimation,
  isMobileChart,
  buildPnLBarDataset,
  buildLineDataset,
} from '../../utils/chart-theme';
import { FilterPanelComponent } from '../shared/filter-panel/filter-panel.component';
import { ChartCardComponent } from '../shared/chart-card/chart-card.component';
import { ReportHistoryComponent } from '../shared/report-history/report-history.component';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink, FilterPanelComponent, ChartCardComponent, ReportHistoryComponent],
  templateUrl: './analytics.component.html',
})
export class AnalyticsComponent {
  readonly state = inject(ReportStateService);
  readonly formatCurrency = formatCurrency;
  readonly pnlClass = pnlClass;
  readonly tradeTypeLabels = TRADE_TYPE_LABELS;

  private chartVersion = signal(0);
  winRateShowDots = signal(false);

  analysis = computed(() => this.state.analysis());

  bestWorstDays = computed(() => {
    const daily = this.analysis()?.daily ?? [];
    if (!daily.length) return { best: null, worst: null } as const;
    const best = daily.reduce((max, day) => (day.netPnL > max.netPnL ? day : max), daily[0]);
    const worst = daily.reduce((min, day) => (day.netPnL < min.netPnL ? day : min), daily[0]);
    return { best, worst } as const;
  });

  bestWorstTrades = computed(() => {
    const trades = this.analysis()?.filteredTrades ?? [];
    if (!trades.length) return { best: null, worst: null } as const;
    const best = trades.reduce((max, trade) => (trade.realisedPnL > max.realisedPnL ? trade : max), trades[0]);
    const worst = trades.reduce((min, trade) => (trade.realisedPnL < min.realisedPnL ? trade : min), trades[0]);
    return { best, worst } as const;
  });

  avgPnLPerOutcome = computed(() => {
    const trades = this.analysis()?.filteredTrades ?? [];
    const wins = trades.filter((t) => t.realisedPnL > 0);
    const losses = trades.filter((t) => t.realisedPnL < 0);
    const avgWinPerTrade = wins.length
      ? wins.reduce((sum, trade) => sum + trade.realisedPnL, 0) / wins.length
      : 0;
    const avgLossPerTrade = losses.length
      ? losses.reduce((sum, trade) => sum + trade.realisedPnL, 0) / losses.length
      : 0;
    return {
      avgWinPerTrade,
      avgLossPerTrade,
      winTrades: wins.length,
      lossTrades: losses.length,
    };
  });

  stockDayWinLossSummary = computed(() => {
    const trades = this.analysis()?.filteredTrades ?? [];
    const buckets = new Map<string, { date: string; stock: string; netPnL: number }>();
    for (const trade of trades) {
      const stockKey = trade.isin || trade.stockName;
      const key = `${trade.sellDate}::${stockKey}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.netPnL += trade.realisedPnL;
      } else {
        buckets.set(key, { date: trade.sellDate, stock: trade.stockName, netPnL: trade.realisedPnL });
      }
    }

    let winningStockDays = 0;
    let losingStockDays = 0;
    let flatStockDays = 0;
    const byDateMap = new Map<string, { winning: number; losing: number; flat: number }>();

    for (const bucket of buckets.values()) {
      const dateEntry = byDateMap.get(bucket.date) ?? { winning: 0, losing: 0, flat: 0 };
      if (bucket.netPnL > 0) {
        winningStockDays++;
        dateEntry.winning++;
      } else if (bucket.netPnL < 0) {
        losingStockDays++;
        dateEntry.losing++;
      } else {
        flatStockDays++;
        dateEntry.flat++;
      }
      byDateMap.set(bucket.date, dateEntry);
    }

    const byDate = [...byDateMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({ date, ...values }));

    const stockDays = [...buckets.values()];
    const best = stockDays.length
      ? stockDays.reduce((max, stockDay) => (stockDay.netPnL > max.netPnL ? stockDay : max), stockDays[0])
      : null;
    const worst = stockDays.length
      ? stockDays.reduce((min, stockDay) => (stockDay.netPnL < min.netPnL ? stockDay : min), stockDays[0])
      : null;

    return {
      totalStockDays: buckets.size,
      winningStockDays,
      losingStockDays,
      flatStockDays,
      winRate: buckets.size ? (winningStockDays / buckets.size) * 100 : 0,
      byDate,
      best,
      worst,
    };
  });

  chartPeriodLabel = computed(() => {
    const p = this.state.chartPeriod();
    return p.charAt(0).toUpperCase() + p.slice(1);
  });

  dailyChartConfig = computed(() => {
    this.chartVersion();
    return this.buildPeriodChart();
  });

  dailyNetPnLChartConfig = computed(() => {
    this.chartVersion();
    const daily = [...(this.analysis()?.daily ?? [])].sort((a, b) => a.period.localeCompare(b.period));
    if (!daily.length) return null;
    const mobile = isMobileChart();

    let cumulative = 0;
    const cumData = daily.map((d) => { cumulative += d.netPnL; return cumulative; });
    const overallPositive = cumulative >= 0;
    const cumColor = overallPositive ? CHART_COLORS.success : CHART_COLORS.danger;
    const cumFill = overallPositive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';

    return withDecimation({
      type: 'line',
      data: {
        labels: daily.map((d) => abbreviateLabel(d.label, mobile ? 6 : 10)),
        datasets: [
          {
            label: 'Daily Net P&L',
            data: daily.map((d) => d.netPnL),
            borderColor: CHART_COLORS.secondary,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            order: 1,
          },
          {
            label: 'Cumulative',
            data: cumData,
            borderColor: cumColor,
            backgroundColor: cumFill,
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            order: 2,
          },
        ],
      },
      options: {
        ...lineChartOptions(''),
        plugins: {
          ...lineChartOptions('').plugins,
          ...baseLegendPublic(true),
        },
      },
    });
  });

  monthlyChartConfig = computed(() => {
    this.chartVersion();
    const monthly = this.analysis()?.monthly ?? [];
    if (!monthly.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'bar',
      data: {
        labels: monthly.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [buildPnLBarDataset('Net P&L', monthly.map((d) => d.netPnL))],
      },
      options: barChartOptions(''),
    });
  });

  cumulativeChartConfig = computed(() => {
    this.chartVersion();
    const periodData = this.state.chartPeriodData();
    if (!periodData.length) return null;
    let cumulative = 0;
    const cumData = periodData.map((d) => {
      cumulative += d.netPnL;
      return cumulative;
    });
    const overallPositive = cumulative >= 0;
    const lineColor = overallPositive ? CHART_COLORS.success : CHART_COLORS.danger;
    const fillColor = overallPositive ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)';
    const mobile = isMobileChart();
    return withDecimation({
      type: 'line',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [
          buildLineDataset('Cumulative Net P&L', cumData, lineColor, fillColor),
        ],
      },
      options: lineChartOptions(''),
    });
  });

  tradeVolumeChartConfig = computed(() => {
    this.chartVersion();
    const periodData = this.state.chartPeriodData();
    if (!periodData.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'bar',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [{
          label: 'Trades',
          data: periodData.map((d) => d.tradeCount),
          backgroundColor: CHART_COLORS.secondary,
          hoverBackgroundColor: '#4f46e5',
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: countBarChartOptions(''),
    });
  });

  winRateTrendChartConfig = computed(() => {
    this.chartVersion();
    const periodData = this.state.chartPeriodData().filter((d) => d.tradeCount > 0);
    if (!periodData.length) return null;
    const mobile = isMobileChart();
    const showDots = this.winRateShowDots();
    const labels = periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14));
    const netPnLValues = periodData.map((d) => d.netPnL);
    return withDecimation({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            ...buildPnLBarDataset('Net P&L', netPnLValues),
            type: 'bar',
            yAxisID: 'yPnL',
            order: 2,
          },
          {
            ...buildLineDataset('Win Rate', periodData.map((d) => d.winRate), CHART_COLORS.primary),
            type: 'line',
            yAxisID: 'yWin',
            pointRadius: showDots ? (mobile ? 3 : 4) : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index' as const, intersect: false },
        animation: { duration: mobile ? 350 : 550, easing: 'easeOutQuart' },
        layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
        plugins: {
          ...baseLegendPublic(true),
          title: { display: false },
          tooltip: {
            backgroundColor: CHART_COLORS.ink,
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleFont: { size: 12, weight: 'bold' as const },
            bodyFont: { size: 12 },
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.yAxisID === 'yWin') {
                  return `Win Rate: ${Number(ctx.parsed.y).toFixed(1)}%`;
                }
                return `Net P&L: ${formatCurrency(Number(ctx.parsed.y))}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              maxRotation: mobile ? 35 : 0,
              autoSkip: true,
              maxTicksLimit: mobile ? 5 : 14,
              font: { size: mobile ? 9 : 11 },
              color: CHART_COLORS.muted,
            },
          },
          yPnL: {
            position: 'left' as const,
            grid: { color: CHART_COLORS.grid },
            border: { display: false },
            ticks: {
              font: { size: mobile ? 9 : 11 },
              color: CHART_COLORS.muted,
              maxTicksLimit: 5,
              callback: (v) => formatCurrency(Number(v)),
            },
            grace: '8%',
          },
          yWin: {
            position: 'right' as const,
            grid: { display: false },
            border: { display: false },
            min: 0,
            max: 100,
            ticks: {
              font: { size: mobile ? 9 : 11 },
              color: CHART_COLORS.primary,
              maxTicksLimit: 5,
              callback: (v) => `${v}%`,
            },
          },
        },
      },
    });
  });

  pnlVsChargesChartConfig = computed(() => {
    this.chartVersion();
    const periodData = this.state.chartPeriodData();
    if (!periodData.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'bar',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 12)),
        datasets: [
          {
            label: 'Realised P&L',
            data: periodData.map((d) => d.realisedPnL),
            backgroundColor: CHART_COLORS.successSoft,
            borderRadius: 6,
            maxBarThickness: 40,
          },
          {
            label: 'Charges',
            data: periodData.map((d) => d.allocatedCharges),
            backgroundColor: CHART_COLORS.dangerSoft,
            borderRadius: 6,
            maxBarThickness: 40,
          },
        ],
      },
      options: groupedBarChartOptions(''),
    });
  });

  topStocksChartConfig = computed(() => {
    this.chartVersion();
    const stocks = [...(this.analysis()?.stocks ?? [])].sort((a, b) => b.netPnL - a.netPnL);
    const n = this.state.topStocksCount();
    const top = stocks.slice(0, n);
    if (!top.length) return null;
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: top.map((s) => abbreviateLabel(s.stockName, mobile ? 16 : 24)),
        datasets: [buildPnLBarDataset('Net P&L', top.map((s) => s.netPnL))],
      },
      options: barChartOptions('', true),
    };
  });

  bottomStocksChartConfig = computed(() => {
    this.chartVersion();
    const stocks = [...(this.analysis()?.stocks ?? [])].sort((a, b) => a.netPnL - b.netPnL);
    const n = Math.min(this.state.topStocksCount(), stocks.length);
    const bottom = stocks.slice(0, n);
    if (!bottom.length) return null;
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: bottom.map((s) => abbreviateLabel(s.stockName, mobile ? 16 : 24)),
        datasets: [buildPnLBarDataset('Net P&L', bottom.map((s) => s.netPnL))],
      },
      options: barChartOptions('', true),
    };
  });

  chargesChartConfig = computed(() => {
    this.chartVersion();
    const items = (this.analysis()?.charges.items ?? []).filter(
      (i) => i.label !== 'Total' && i.amount > 0
    );
    if (!items.length) return null;
    return {
      type: 'doughnut' as const,
      data: {
        labels: items.map((i) => abbreviateLabel(i.label, isMobileChart() ? 18 : 28)),
        datasets: [{
          data: items.map((i) => i.amount),
          backgroundColor: CHART_COLORS.palette,
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6,
        }],
      },
      options: doughnutChartOptions(''),
    };
  });

  tradeTypeChartConfig = computed(() => {
    this.chartVersion();
    const trades = this.analysis()?.filteredTrades ?? [];
    const map = new Map<TradeType, number>();
    for (const t of trades) {
      map.set(t.tradeType, (map.get(t.tradeType) ?? 0) + 1);
    }
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    if (!entries.length) return null;
    return {
      type: 'doughnut' as const,
      data: {
        labels: entries.map(([t]) => this.tradeTypeLabels[t] || t),
        datasets: [{
          data: entries.map(([, c]) => c),
          backgroundColor: CHART_COLORS.palette,
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6,
        }],
      },
      options: doughnutChartOptions(''),
    };
  });

  // ── Insights ─────────────────────────────────────────────────────────

  tradesVsPnLChartConfig = computed(() => {
    this.chartVersion();
    const stocks = this.analysis()?.stocks ?? [];
    if (stocks.length < 2) return null;
    return {
      type: 'scatter' as const,
      data: {
        datasets: stocks.map((s) => ({
          label: abbreviateLabel(s.stockName, 20),
          data: [{ x: s.tradeCount, y: s.netPnL }],
          backgroundColor: s.netPnL >= 0 ? 'rgba(16,185,129,0.70)' : 'rgba(239,68,68,0.70)',
          borderColor: s.netPnL >= 0 ? CHART_COLORS.success : CHART_COLORS.danger,
          borderWidth: 1,
        })),
      },
      options: scatterChartOptions('Trades', 'Net P&L', false, true),
    };
  });

  holdingVsPnLChartConfig = computed(() => {
    this.chartVersion();
    const trades = this.analysis()?.filteredTrades ?? [];
    if (trades.length < 2) return null;
    const delivery = trades.filter((t) => t.holdingDays > 0);
    if (!delivery.length) return null;
    return {
      type: 'scatter' as const,
      data: {
        datasets: [{
          label: 'Trade',
          data: delivery.map((t) => ({ x: t.holdingDays, y: t.realisedPnL })),
          backgroundColor: delivery.map((t) => t.realisedPnL >= 0 ? 'rgba(16,185,129,0.60)' : 'rgba(239,68,68,0.60)'),
          borderWidth: 0,
        }],
      },
      options: scatterChartOptions('Holding Days', 'P&L', false, true),
    };
  });

  pnlDistributionChartConfig = computed(() => {
    this.chartVersion();
    const trades = this.analysis()?.filteredTrades ?? [];
    if (!trades.length) return null;
    const buckets = [
      { label: '<−5k', min: -Infinity, max: -5000 },
      { label: '−5k–−1k', min: -5000, max: -1000 },
      { label: '−1k–0', min: -1000, max: 0 },
      { label: '0–1k', min: 0, max: 1000 },
      { label: '1k–5k', min: 1000, max: 5000 },
      { label: '>5k', min: 5000, max: Infinity },
    ];
    const counts = buckets.map((b) =>
      trades.filter((t) => t.realisedPnL > b.min && t.realisedPnL <= b.max).length
    );
    return {
      type: 'bar' as const,
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [{
          label: 'Trades',
          data: counts,
          backgroundColor: buckets.map((_, i) => i < 3 ? 'rgba(239,68,68,0.80)' : 'rgba(16,185,129,0.80)'),
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: countBarChartOptions(''),
    };
  });

  pnlEfficiencyChartConfig = computed(() => {
    this.chartVersion();
    const stocks = [...(this.analysis()?.stocks ?? [])]
      .filter((s) => s.tradeCount > 0)
      .map((s) => ({ ...s, pnlPerTrade: s.netPnL / s.tradeCount }))
      .sort((a, b) => Math.abs(b.pnlPerTrade) - Math.abs(a.pnlPerTrade))
      .slice(0, 12);
    if (!stocks.length) return null;
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: stocks.map((s) => abbreviateLabel(s.stockName, mobile ? 12 : 18)),
        datasets: [buildPnLBarDataset('Net P&L / Trade', stocks.map((s) => s.pnlPerTrade))],
      },
      options: barChartOptions('', true),
    };
  });

  winLossByStockChartConfig = computed(() => {
    this.chartVersion();
    const trades = this.analysis()?.filteredTrades ?? [];
    if (!trades.length) return null;
    const map = new Map<string, { wins: number; losses: number }>();
    for (const t of trades) {
      const k = t.stockName;
      if (!map.has(k)) map.set(k, { wins: 0, losses: 0 });
      const entry = map.get(k)!;
      if (t.realisedPnL > 0) entry.wins++; else entry.losses++;
    }
    const sorted = [...map.entries()]
      .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
      .slice(0, 12);
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: sorted.map(([name]) => abbreviateLabel(name, mobile ? 10 : 16)),
        datasets: [
          {
            label: 'Winning',
            data: sorted.map(([, v]) => v.wins),
            backgroundColor: 'rgba(16,185,129,0.82)',
            borderRadius: 4,
            maxBarThickness: 32,
          },
          {
            label: 'Losing',
            data: sorted.map(([, v]) => v.losses),
            backgroundColor: 'rgba(239,68,68,0.82)',
            borderRadius: 4,
            maxBarThickness: 32,
          },
        ],
      },
      options: groupedBarChartOptions(''),
    };
  });

  winLossByDateChartConfig = computed(() => {
    this.chartVersion();
    const days = [...(this.analysis()?.daily ?? [])].sort((a, b) => a.period.localeCompare(b.period));
    if (!days.length) return null;
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: days.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [
          {
            label: 'Winning Trades',
            data: days.map((d) => d.winningTrades),
            backgroundColor: 'rgba(16,185,129,0.82)',
            borderRadius: 4,
            maxBarThickness: 24,
          },
          {
            label: 'Losing Trades',
            data: days.map((d) => d.losingTrades),
            backgroundColor: 'rgba(239,68,68,0.82)',
            borderRadius: 4,
            maxBarThickness: 24,
          },
        ],
      },
      options: groupedBarChartOptions(''),
    };
  });

  winLossByStockDayDateChartConfig = computed(() => {
    this.chartVersion();
    const byDate = this.stockDayWinLossSummary().byDate;
    if (!byDate.length) return null;
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: byDate.map((d) => abbreviateLabel(d.date, mobile ? 8 : 12)),
        datasets: [
          {
            label: 'Winning Stock-Days',
            data: byDate.map((d) => d.winning),
            backgroundColor: 'rgba(59,130,246,0.82)',
            borderRadius: 4,
            maxBarThickness: 24,
          },
          {
            label: 'Losing Stock-Days',
            data: byDate.map((d) => d.losing),
            backgroundColor: 'rgba(249,115,22,0.82)',
            borderRadius: 4,
            maxBarThickness: 24,
          },
        ],
      },
      options: groupedBarChartOptions(''),
    };
  });

  @HostListener('window:resize')
  onResize(): void {
    this.chartVersion.update((v) => v + 1);
  }

  onFiltersChanged(): void {
    this.chartVersion.update((v) => v + 1);
  }

  private buildPeriodChart(): ChartConfiguration | null {
    const periodData = this.state.chartPeriodData();
    if (!periodData.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'bar',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [
          {
            ...buildPnLBarDataset('Realised P&L', periodData.map((d) => d.realisedPnL)),
            order: 2,
          },
          {
            ...buildLineDataset(
              'Net P&L',
              periodData.map((d) => d.netPnL),
              CHART_COLORS.secondary
            ),
            type: 'line',
            order: 1,
          },
        ],
      },
      options: comboChartOptions(''),
    });
  }
}
