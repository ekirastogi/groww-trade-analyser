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
  lineChartOptions,
  doughnutChartOptions,
  pieChartOptions,
  withDecimation,
  isMobileChart,
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

  monthlyChartConfig = computed(() => {
    this.chartVersion();
    const monthly = this.analysis()?.monthly ?? [];
    return withDecimation({
      type: 'bar',
      data: {
        labels: monthly.map((d) => abbreviateLabel(d.label, isMobileChart() ? 8 : 14)),
        datasets: [{
          label: 'Net P&L',
          data: monthly.map((d) => d.netPnL),
          backgroundColor: monthly.map((d) =>
            d.netPnL >= 0 ? CHART_COLORS.successAlpha : CHART_COLORS.dangerAlpha
          ),
          borderRadius: 4,
        }],
      },
      options: barChartOptions('Monthly Net P&L'),
    });
  });

  cumulativeChartConfig = computed(() => {
    this.chartVersion();
    const periodData = this.state.chartPeriodData();
    let cumulative = 0;
    const cumData = periodData.map((d) => {
      cumulative += d.netPnL;
      return cumulative;
    });
    return withDecimation({
      type: 'line',
      data: {
        labels: periodData.map((d) => abbreviateLabel(d.label, isMobileChart() ? 8 : 14)),
        datasets: [{
          label: 'Cumulative Net P&L',
          data: cumData,
          borderColor: CHART_COLORS.secondary,
          backgroundColor: CHART_COLORS.primaryLight,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: CHART_COLORS.secondary,
        }],
      },
      options: lineChartOptions(`Cumulative Net P&L (${this.chartPeriodLabel()})`),
    });
  });

  winLossChartConfig = computed(() => {
    this.chartVersion();
    const summary = this.analysis()?.summary;
    if (!summary) return null;
    const breakeven = summary.tradeCount - summary.winningTrades - summary.losingTrades;
    return {
      type: 'doughnut' as const,
      data: {
        labels: ['Winning', 'Losing', 'Break-even'],
        datasets: [{
          data: [summary.winningTrades, summary.losingTrades, breakeven],
          backgroundColor: [CHART_COLORS.success, CHART_COLORS.danger, '#adb5bd'],
          borderWidth: 0,
        }],
      },
      options: doughnutChartOptions('Win / Loss Ratio'),
    };
  });

  topStocksChartConfig = computed(() => {
    this.chartVersion();
    const stocks = [...(this.analysis()?.stocks ?? [])].sort((a, b) => b.netPnL - a.netPnL);
    const n = this.state.topStocksCount();
    const top = stocks.slice(0, n);
    const mobile = isMobileChart();
    return {
      type: 'bar' as const,
      data: {
        labels: top.map((s) => abbreviateLabel(s.stockName, mobile ? 14 : 22)),
        datasets: [{
          label: 'Net P&L',
          data: top.map((s) => s.netPnL),
          backgroundColor: top.map((s) =>
            s.netPnL >= 0 ? CHART_COLORS.successAlpha : CHART_COLORS.dangerAlpha
          ),
          borderRadius: 4,
        }],
      },
      options: barChartOptions(`Top ${n} Stocks by Net P&L`, true),
    };
  });

  chargesChartConfig = computed(() => {
    this.chartVersion();
    const items = (this.analysis()?.charges.items ?? []).filter(
      (i) => i.label !== 'Total' && i.amount > 0
    );
    return {
      type: 'pie' as const,
      data: {
        labels: items.map((i) => abbreviateLabel(i.label, isMobileChart() ? 16 : 24)),
        datasets: [{
          data: items.map((i) => i.amount),
          backgroundColor: CHART_COLORS.palette,
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: pieChartOptions('Charges Breakdown'),
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
    return {
      type: 'doughnut' as const,
      data: {
        labels: entries.map(([t]) => this.tradeTypeLabels[t] || t),
        datasets: [{
          data: entries.map(([, c]) => c),
          backgroundColor: CHART_COLORS.palette,
          borderWidth: 0,
        }],
      },
      options: doughnutChartOptions('Trade Types'),
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
            label: 'Realised P&L',
            data: periodData.map((d) => d.realisedPnL),
            backgroundColor: periodData.map((d) =>
              d.realisedPnL >= 0 ? CHART_COLORS.successAlpha : CHART_COLORS.dangerAlpha
            ),
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Net P&L',
            data: periodData.map((d) => d.netPnL),
            type: 'line',
            borderColor: CHART_COLORS.secondary,
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: mobile ? 2 : 3,
            order: 1,
          },
        ],
      },
      options: comboChartOptions(`${this.chartPeriodLabel()} P&L`),
    });
  }
}
