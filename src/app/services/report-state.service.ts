import { Injectable, signal, computed } from '@angular/core';
import {
  AnalysisOptions,
  AnalysisResult,
  PeriodBucket,
  Report,
  ReportHistoryEntry,
  TradeType,
} from '../models/trade.models';
import { AnalysisService } from './analysis.service';
import { ParserService } from './parser.service';

const MAX_REPORT_HISTORY = 5;
const HISTORY_STORAGE_KEY = 'groww-pl-report-history';
const DEFAULT_TRADE_TYPES: TradeType[] = ['intraday'];

function defaultTradeTypesForReport(report: Report): TradeType[] {
  return report.tradeTypes.includes('intraday') ? DEFAULT_TRADE_TYPES : ['all'];
}

@Injectable({ providedIn: 'root' })
export class ReportStateService {
  report = signal<Report | null>(null);
  reportHistory = signal<ReportHistoryEntry[]>(this.loadHistoryFromStorage());
  activeHistoryId = signal<string | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  startDate = signal('');
  endDate = signal('');
  selectedTradeTypes = signal<TradeType[]>(DEFAULT_TRADE_TYPES);
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
  hasHistory = computed(() => this.reportHistory().length > 0);

  constructor(
    private parser: ParserService,
    private analysisService: AnalysisService
  ) {}

  async loadFile(file: File): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await this.parser.parseFile(file);
      this.addToHistory(file.name, report);
      this.applyReport(report);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to parse file');
      this.report.set(null);
      this.activeHistoryId.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  selectHistoryReport(id: string): void {
    const entry = this.reportHistory().find((item) => item.id === id);
    if (!entry) return;
    this.activeHistoryId.set(id);
    this.applyReport(entry.report);
    this.error.set(null);
  }

  private addToHistory(fileName: string, report: Report): void {
    const id = this.createHistoryId();
    const entry: ReportHistoryEntry = {
      id,
      fileName,
      uploadedAt: Date.now(),
      report,
    };
    this.reportHistory.update((list) => {
      const next = [entry, ...list.filter((item) => item.id !== id)].slice(0, MAX_REPORT_HISTORY);
      this.saveHistoryToStorage(next);
      return next;
    });
    this.activeHistoryId.set(id);
  }

  private loadHistoryFromStorage(): ReportHistoryEntry[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ReportHistoryEntry[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry?.id && entry?.fileName && entry?.report)
        .slice(0, MAX_REPORT_HISTORY);
    } catch {
      return [];
    }
  }

  private saveHistoryToStorage(history: ReportHistoryEntry[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Storage full or unavailable — keep in-memory history for this session.
    }
  }

  private createHistoryId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private applyReport(report: Report): void {
    this.report.set(report);
    this.startDate.set(report.dateRange.min);
    this.endDate.set(report.dateRange.max);
    this.selectedTradeTypes.set(defaultTradeTypesForReport(report));
    this.chartPeriod.set('daily');
    this.topStocksCount.set(10);
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
    this.selectedTradeTypes.set(report ? defaultTradeTypesForReport(report) : DEFAULT_TRADE_TYPES);
    this.chartPeriod.set('daily');
    this.topStocksCount.set(10);
  }

  clear(): void {
    this.report.set(null);
    this.activeHistoryId.set(null);
    this.error.set(null);
  }
}
