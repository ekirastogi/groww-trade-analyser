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

  analysis = computed(() => this.state.analysis());

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
    const daily = this.analysis()?.daily ?? [];
    if (!daily.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'bar',
      data: {
        labels: daily.map((d) => abbreviateLabel(d.label, mobile ? 8 : 12)),
        datasets: [buildPnLBarDataset('Net P&L', daily.map((d) => d.netPnL))],
      },
      options: barChartOptions(''),
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
    const mobile = isMobileChart();
    return withDecimation({
      type: 'line',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [
          buildLineDataset('Cumulative Net P&L', cumData, CHART_COLORS.secondary, CHART_COLORS.secondaryLight),
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
    const periodData = this.state.chartPeriodData();
    if (!periodData.length) return null;
    const mobile = isMobileChart();
    return withDecimation({
      type: 'line',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, mobile ? 8 : 14)),
        datasets: [
          buildLineDataset('Win Rate', periodData.map((d) => d.winRate), CHART_COLORS.primary, CHART_COLORS.primaryLight),
        ],
      },
      options: lineChartOptions('', true),
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
