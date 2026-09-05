import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegistryFinancialTable, RegistryStock } from '../../models/trading-journal.models';
import { formatFetchedAt, formatDataAge } from '../../utils/data-age.utils';
import { formatCurrency } from '../../utils/format.utils';
import {
  buildStockAnalysis,
  formatAnalysisChange,
  formatAthDistance,
  formatMetricValue,
  HoldingAnalysis,
  MetricAnalysis,
  trendDirection,
} from '../../utils/screener-analysis.utils';

type FinancialTab = 'analysis' | 'quarterly' | 'annual' | 'balance' | 'cashflow' | 'shareholding' | 'growth';

@Component({
  selector: 'app-screener-fundamentals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './screener-fundamentals.component.html',
})
export class ScreenerFundamentalsComponent {
  @Input({ required: true }) stock!: RegistryStock;

  activeTab = signal<FinancialTab>('analysis');

  readonly tabs: FinancialTab[] = ['analysis', 'quarterly', 'annual', 'balance', 'cashflow', 'shareholding', 'growth'];

  analysis = computed(() => buildStockAnalysis(this.stock));

  formatFetchedAt = formatFetchedAt;
  formatDataAge = formatDataAge;
  formatAnalysisChange = formatAnalysisChange;
  formatAthDistance = formatAthDistance;
  formatMetricValue = formatMetricValue;
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

  metricSparkMax(metric: MetricAnalysis): number {
    const max = Math.max(...metric.series.map((p) => p.value), 1);
    return max;
  }
}
