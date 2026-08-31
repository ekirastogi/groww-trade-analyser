import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ReportStateService } from './report-state.service';
import { TradeLedgerService } from './trade-ledger.service';
import { AnalysisOptions, StockSummary } from '../models/trade.models';

function isUnfiltered(
  report: NonNullable<ReturnType<ReportStateService['report']>>,
  opts: AnalysisOptions
): boolean {
  const allTypes = !opts.tradeTypes?.length || opts.tradeTypes.includes('all');
  const start = opts.startDate || report.dateRange.min;
  const end = opts.endDate || report.dateRange.max;
  return allTypes && start === report.dateRange.min && end === report.dateRange.max;
}

@Injectable({ providedIn: 'root' })
export class FilteredStockService {
  private state = inject(ReportStateService);
  private ledger = inject(TradeLedgerService);

  private summaries = signal<StockSummary[]>([]);
  loading = signal(false);

  /** Stocks after applying current global filters (trade type + date range). */
  stocks = computed(() => {
    const report = this.state.report();
    const opts = this.state.analysisOptions();
    if (!report) return [] as StockSummary[];
    if (isUnfiltered(report, opts)) return report.stockSummary ?? [];
    return this.summaries();
  });

  private loadSeq = 0;

  constructor() {
    effect(() => {
      const report = this.state.report();
      const opts = this.state.analysisOptions();
      if (!report) {
        this.summaries.set([]);
        return;
      }
      if (isUnfiltered(report, opts)) {
        this.summaries.set(report.stockSummary ?? []);
        this.loading.set(false);
        return;
      }
      void this.reload(report.summary.clientCode, report, opts);
    });
  }

  private async reload(
    clientCode: string,
    report: NonNullable<ReturnType<ReportStateService['report']>>,
    opts: AnalysisOptions
  ): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const stocks = await this.ledger.getFilteredStockSummaries(clientCode, {
        startDate: opts.startDate || report.dateRange.min,
        endDate: opts.endDate || report.dateRange.max,
        tradeTypes: opts.tradeTypes,
      });
      if (seq === this.loadSeq) {
        this.summaries.set(stocks);
      }
    } catch {
      if (seq === this.loadSeq) {
        this.summaries.set([]);
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading.set(false);
      }
    }
  }
}
