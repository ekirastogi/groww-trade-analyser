import { Injectable, effect, inject, signal } from '@angular/core';
import { ReportStateService } from './report-state.service';
import { TradeLedgerService } from './trade-ledger.service';
import { AnalysisOptions, StockSummary } from '../models/trade.models';

@Injectable({ providedIn: 'root' })
export class FilteredStockService {
  private state = inject(ReportStateService);
  private ledger = inject(TradeLedgerService);

  summaries = signal<StockSummary[]>([]);
  loading = signal(false);

  private loadSeq = 0;

  constructor() {
    effect(() => {
      const report = this.state.report();
      const opts = this.state.analysisOptions();
      if (!report) {
        this.summaries.set([]);
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
    const fullRange =
      (!opts.startDate || opts.startDate === report.dateRange.min) &&
      (!opts.endDate || opts.endDate === report.dateRange.max);
    const allTypes = !opts.tradeTypes?.length || opts.tradeTypes.includes('all');

    if (allTypes && fullRange && report.stockSummary?.length) {
      this.summaries.set(report.stockSummary);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    try {
      const stocks = await this.ledger.getFilteredStockSummaries(clientCode, opts);
      if (seq === this.loadSeq) {
        this.summaries.set(stocks);
      }
    } catch {
      if (seq === this.loadSeq) {
        this.summaries.set(report.stockSummary ?? []);
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading.set(false);
      }
    }
  }
}
