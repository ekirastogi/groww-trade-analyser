import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ReportStateService } from './report-state.service';
import { TradeLedgerService } from './trade-ledger.service';
import { StockSummary } from '../models/trade.models';
import {
  filterProfilesToSummaries,
  isFullReportDateRange,
  profilesHaveTypeBreakdown,
} from '../utils/filter-stock-profiles.utils';

@Injectable({ providedIn: 'root' })
export class FilteredStockService {
  private state = inject(ReportStateService);
  private ledger = inject(TradeLedgerService);

  private dateFiltered = signal<StockSummary[]>([]);
  loading = signal(false);
  /** Set when the last filtered load failed, so pages can distinguish an outage from no data. */
  error = signal<string | null>(null);
  private loadSeq = 0;

  /**
   * Filtered stock list.
   * Type filters use persisted per-type aggregates on stock profiles (no trade re-fetch).
   * Date narrowing falls back to a one-time trade query.
   */
  stocks = computed((): StockSummary[] => {
    const report = this.state.report();
    const opts = this.state.analysisOptions();
    if (!report) return [];

    // When individual trades are in memory, use the same filtered aggregates as dashboard/analytics.
    if (report.trades.length > 0) {
      return this.state.analysis()?.stocks ?? [];
    }

    const profiles = report.stockProfiles ?? [];
    const canUseProfiles =
      profiles.length > 0 &&
      profilesHaveTypeBreakdown(profiles) &&
      isFullReportDateRange(report.dateRange, opts);

    if (canUseProfiles) {
      return filterProfilesToSummaries(profiles, opts);
    }

    if (!isFullReportDateRange(report.dateRange, opts)) {
      return this.dateFiltered();
    }

    return report.stockSummary ?? [];
  });

  constructor() {
    effect(
      () => {
        const report = this.state.report();
        const opts = this.state.analysisOptions();
        if (!report) {
          this.dateFiltered.set([]);
          return;
        }

        const profiles = report.stockProfiles ?? [];
        const needsTradeQuery =
          !isFullReportDateRange(report.dateRange, opts) ||
          (profiles.length > 0 && !profilesHaveTypeBreakdown(profiles));

        if (!needsTradeQuery) {
          this.dateFiltered.set([]);
          this.loading.set(false);
          return;
        }

        void this.reloadFromTrades(report.summary.clientCode, report.dateRange, opts);
      },
      { allowSignalWrites: true }
    );
  }

  private async reloadFromTrades(
    clientCode: string,
    dateRange: { min: string; max: string },
    opts: ReturnType<ReportStateService['analysisOptions']>
  ): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const stocks = await this.ledger.getFilteredStockSummaries(clientCode, {
        startDate: opts.startDate || dateRange.min,
        endDate: opts.endDate || dateRange.max,
        tradeTypes: opts.tradeTypes,
      });
      if (seq === this.loadSeq) {
        this.dateFiltered.set(stocks);
        this.error.set(null);
      }
    } catch (e) {
      // Record the failure rather than only clearing the list: an empty array is
      // indistinguishable from "this user has no trades", and the pages that render it were
      // telling people to re-upload their statement during a transient outage.
      if (seq === this.loadSeq) {
        this.dateFiltered.set([]);
        this.error.set(e instanceof Error ? e.message : 'Could not load trades for this filter');
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading.set(false);
      }
    }
  }
}
