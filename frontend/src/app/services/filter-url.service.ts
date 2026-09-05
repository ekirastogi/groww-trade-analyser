import { Injectable, inject, effect } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ReportStateService } from './report-state.service';
import { TradeType } from '../models/trade.models';
import {
  FILTER_QUERY_KEYS,
  defaultTradeTypesForRoute,
  readGlobalFilters,
  serializeTradeTypes,
} from '../utils/filter-url.utils';
import { routeNeedsDefaultTypes } from '../utils/trade-type-filter.utils';
import {
  defaultDateRangeForRoute,
  routeNeedsDefaultDateRange,
} from '../utils/date-range-preset.utils';

@Injectable({ providedIn: 'root' })
export class FilterUrlService {
  private router = inject(Router);
  private state = inject(ReportStateService);
  private started = false;
  private writingUrl = false;

  constructor() {
    effect(() => {
      // Read the signal before any guard so the effect always tracks report loads.
      const report = this.state.report();
      if (this.started && report) {
        this.syncFromUrl();
      }
    });
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.syncFromUrl());
    this.syncFromUrl();
  }

  syncFromUrl(): void {
    if (this.writingUrl) return;

    const path = this.router.url.split('?')[0];
    const paramMap = this.router.routerState.snapshot.root.queryParamMap;
    const defaults = defaultTradeTypesForRoute(path);
    const report = this.state.report();
    const isWatchlist = path.includes('/watchlists');

    const needsDefaultTypes = routeNeedsDefaultTypes(path, paramMap.has(FILTER_QUERY_KEYS.types));
    const needsDefaultBands = isWatchlist && !paramMap.has(FILTER_QUERY_KEYS.bands);
    const needsDefaultDateRange =
      !!report &&
      routeNeedsDefaultDateRange(
        path,
        paramMap.has(FILTER_QUERY_KEYS.from),
        paramMap.has(FILTER_QUERY_KEYS.to)
      );

    const bounds = report ? { min: report.dateRange.min, max: report.dateRange.max } : null;
    const dateDefaults = needsDefaultDateRange && bounds
      ? defaultDateRangeForRoute(path, bounds)
      : null;

    if (report && bounds) {
      const parsed = readGlobalFilters(paramMap, defaults);
      this.applyParsedFilters(
        {
          ...parsed,
          startDate: dateDefaults?.start ?? parsed.startDate,
          endDate: dateDefaults?.end ?? parsed.endDate,
        },
        bounds.min,
        bounds.max
      );
    }

    if (needsDefaultTypes || needsDefaultBands || dateDefaults) {
      const patch: Record<string, string | null> = {};
      if (needsDefaultTypes) {
        patch[FILTER_QUERY_KEYS.types] = serializeTradeTypes(defaults);
      }
      if (needsDefaultBands) {
        patch[FILTER_QUERY_KEYS.bands] = 'band';
      }
      if (dateDefaults) {
        patch[FILTER_QUERY_KEYS.from] = dateDefaults.start;
        patch[FILTER_QUERY_KEYS.to] = dateDefaults.end;
      }
      this.replaceQuery(patch, true);
    }
  }

  updateTradeTypes(types: TradeType[]): void {
    const report = this.state.report();
    if (!report) return;
    this.state.applyFilters(this.state.startDate(), this.state.endDate(), types);
    this.replaceQuery({ [FILTER_QUERY_KEYS.types]: serializeTradeTypes(types) });
  }

  updateDateRange(
    start: string,
    end: string,
    types: TradeType[],
    chartPeriod?: 'daily' | 'weekly' | 'monthly',
    topStocks?: number
  ): void {
    const report = this.state.report();
    if (!report) return;
    this.state.applyFilters(start, end, types, chartPeriod, topStocks);
    this.replaceQuery({
      [FILTER_QUERY_KEYS.from]: start,
      [FILTER_QUERY_KEYS.to]: end,
      [FILTER_QUERY_KEYS.types]: serializeTradeTypes(types),
      [FILTER_QUERY_KEYS.chart]: chartPeriod && chartPeriod !== 'daily' ? chartPeriod : null,
      [FILTER_QUERY_KEYS.top]: topStocks && topStocks !== 10 ? String(topStocks) : null,
    });
  }

  resetFilters(): void {
    const report = this.state.report();
    if (!report) return;
    const path = this.router.url.split('?')[0];
    const defaults = defaultTradeTypesForRoute(path);
    const bounds = { min: report.dateRange.min, max: report.dateRange.max };
    const dateDefaults = defaultDateRangeForRoute(path, bounds);
    const start = dateDefaults?.start ?? bounds.min;
    const end = dateDefaults?.end ?? bounds.max;
    this.state.applyFilters(start, end, defaults);
    this.replaceQuery({
      [FILTER_QUERY_KEYS.types]: serializeTradeTypes(defaults),
      [FILTER_QUERY_KEYS.from]: start,
      [FILTER_QUERY_KEYS.to]: end,
      [FILTER_QUERY_KEYS.chart]: null,
      [FILTER_QUERY_KEYS.top]: null,
    });
  }

  patchWatchlistQuery(patch: Record<string, string | null>): void {
    this.replaceQuery(patch);
  }

  private applyParsedFilters(
    parsed: ReturnType<typeof readGlobalFilters>,
    minDate: string,
    maxDate: string
  ): void {
    this.state.applyFilters(
      parsed.startDate ?? minDate,
      parsed.endDate ?? maxDate,
      parsed.tradeTypes,
      parsed.chartPeriod,
      parsed.topStocks,
      { syncUrl: false }
    );
  }

  private replaceQuery(patch: Record<string, string | null>, replaceUrl = false): void {
    this.writingUrl = true;
    const tree = this.router.parseUrl(this.router.url);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') {
        delete tree.queryParams[key];
      } else {
        tree.queryParams[key] = value;
      }
    }
    void this.router.navigateByUrl(tree, { replaceUrl }).finally(() => {
      this.writingUrl = false;
    });
  }
}
