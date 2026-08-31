import { Injectable, inject, effect } from '@angular/core';
import { NavigationEnd, Router, ActivatedRoute } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ReportStateService } from './report-state.service';
import { TradeType } from '../models/trade.models';
import {
  FILTER_QUERY_KEYS,
  defaultTradeTypesForRoute,
  readGlobalFilters,
  serializeTradeTypes,
} from '../utils/filter-url.utils';

@Injectable({ providedIn: 'root' })
export class FilterUrlService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private state = inject(ReportStateService);
  private syncingFromUrl = false;
  private started = false;

  constructor() {
    effect(() => {
      this.state.report();
      if (this.started) this.syncFromCurrentRoute();
    });
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.syncFromCurrentRoute());
    this.syncFromCurrentRoute();
  }

  syncFromCurrentRoute(): void {
    const url = this.router.url.split('?')[0];
    const params = this.router.routerState.snapshot.root.queryParamMap;
    const defaults = defaultTradeTypesForRoute(url);
    const parsed = readGlobalFilters(params, defaults);
    const report = this.state.report();

    this.syncingFromUrl = true;
    try {
      const start = parsed.startDate ?? report?.dateRange.min ?? this.state.startDate();
      const end = parsed.endDate ?? report?.dateRange.max ?? this.state.endDate();
      this.state.applyFilters(
        start,
        end,
        parsed.tradeTypes,
        parsed.chartPeriod,
        parsed.topStocks,
        { syncUrl: false }
      );
      if (url.includes('/watchlists') && !params.has(FILTER_QUERY_KEYS.types)) {
        this.patchQuery({ [FILTER_QUERY_KEYS.types]: 'intraday' }, true);
      }
    } finally {
      this.syncingFromUrl = false;
    }
  }

  updateTradeTypes(types: TradeType[]): void {
    const report = this.state.report();
    if (!report) return;
    this.state.applyFilters(this.state.startDate(), this.state.endDate(), types, undefined, undefined, {
      syncUrl: false,
    });
    this.patchQuery({ [FILTER_QUERY_KEYS.types]: serializeTradeTypes(types) });
  }

  updateDateRange(start: string, end: string, types: TradeType[], chartPeriod?: 'daily' | 'weekly' | 'monthly', topStocks?: number): void {
    this.state.applyFilters(start, end, types, chartPeriod, topStocks, { syncUrl: false });
    this.patchQuery({
      [FILTER_QUERY_KEYS.from]: start !== this.state.report()?.dateRange.min ? start : null,
      [FILTER_QUERY_KEYS.to]: end !== this.state.report()?.dateRange.max ? end : null,
      [FILTER_QUERY_KEYS.types]: serializeTradeTypes(types),
      [FILTER_QUERY_KEYS.chart]: chartPeriod && chartPeriod !== 'daily' ? chartPeriod : null,
      [FILTER_QUERY_KEYS.top]: topStocks && topStocks !== 10 ? String(topStocks) : null,
    });
  }

  resetFilters(): void {
    const report = this.state.report();
    if (!report) return;
    const defaults = defaultTradeTypesForRoute(this.router.url);
    this.state.resetFilters(defaults);
    this.patchQuery({
      [FILTER_QUERY_KEYS.types]: serializeTradeTypes(defaults),
      [FILTER_QUERY_KEYS.from]: null,
      [FILTER_QUERY_KEYS.to]: null,
      [FILTER_QUERY_KEYS.chart]: null,
      [FILTER_QUERY_KEYS.top]: null,
    });
  }

  patchWatchlistQuery(patch: Record<string, string | null>): void {
    this.patchQuery(patch);
  }

  private patchQuery(patch: Record<string, string | null>, replaceUrl = false): void {
    if (this.syncingFromUrl) return;
    const queryParams: Record<string, string | null> = { ...patch };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
