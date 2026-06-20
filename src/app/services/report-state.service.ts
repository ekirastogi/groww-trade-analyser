import { Injectable, signal, computed } from '@angular/core';
import {
  AnalysisOptions,
  AnalysisResult,
  PeriodBucket,
  Report,
  TradeType,
} from '../models/trade.models';
import { AnalysisService } from './analysis.service';
import { ParserService } from './parser.service';

@Injectable({ providedIn: 'root' })
export class ReportStateService {
  report = signal<Report | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  startDate = signal('');
  endDate = signal('');
  selectedTradeTypes = signal<TradeType[]>(['all']);
  chartPeriod = signal<'daily' | 'weekly' | 'monthly'>('daily');
  topStocksCount = signal(10);

  analysisOptions = computed<AnalysisOptions>(() => ({
    startDate: this.startDate(),
    endDate: this.endDate(),
    tradeTypes: this.selectedTradeTypes(),
  }));

  analysis = computed<AnalysisResult | null>(() => {
    const report = this.report();
    if (!report) return null;
    return this.analysisService.analyze(report, this.analysisOptions());
  });

  /** Period buckets for charts based on chartPeriod filter */
  chartPeriodData = computed<PeriodBucket[]>(() => {
    const analysis = this.analysis();
    if (!analysis) return [];
    switch (this.chartPeriod()) {
      case 'weekly': return analysis.weekly;
      case 'monthly': return analysis.monthly;
      default: return analysis.daily;
    }
  });

  hasReport = computed(() => !!this.report());

  constructor(
    private parser: ParserService,
    private analysisService: AnalysisService
  ) {}

  async loadFile(file: File): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await this.parser.parseFile(file);
      this.report.set(report);
      this.startDate.set(report.dateRange.min);
      this.endDate.set(report.dateRange.max);
      this.selectedTradeTypes.set(['all']);
      this.chartPeriod.set('daily');
      this.topStocksCount.set(10);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to parse file');
      this.report.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  applyFilters(
    start: string,
    end: string,
    types: TradeType[],
    chartPeriod?: 'daily' | 'weekly' | 'monthly',
    topStocks?: number
  ): void {
    this.startDate.set(start);
    this.endDate.set(end);
    this.selectedTradeTypes.set(types);
    if (chartPeriod) this.chartPeriod.set(chartPeriod);
    if (topStocks) this.topStocksCount.set(topStocks);
  }

  resetFilters(): void {
    const report = this.report();
    if (report) {
      this.startDate.set(report.dateRange.min);
      this.endDate.set(report.dateRange.max);
    }
    this.selectedTradeTypes.set(['all']);
    this.chartPeriod.set('daily');
    this.topStocksCount.set(10);
  }

  clear(): void {
    this.report.set(null);
    this.error.set(null);
  }
}
