import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { ChartView, MarketCatalogSummary, StockSnapshot } from '../models/market.models';
import { rowToCamel, SupabaseService } from './supabase.service';

function mapStockRow(row: Record<string, unknown>): StockSnapshot {
  const camel = rowToCamel<Record<string, unknown>>(row);
  return {
    symbol: String(camel['symbol'] ?? ''),
    name: String(camel['name'] ?? ''),
    exchange: String(camel['exchange'] ?? 'NSE'),
    isin: camel['isin'] as string | undefined,
    ltp: Number(camel['ltp'] ?? 0),
    change: Number(camel['changeAmt'] ?? 0),
    changePct: Number(camel['changePct'] ?? 0),
    marketCap: Number(camel['marketCap'] ?? 0),
    pe: camel['pe'] as number | undefined,
    week52High: camel['week52High'] as number | undefined,
    week52Low: camel['week52Low'] as number | undefined,
    supportLevels: (camel['supportLevels'] as number[]) ?? [],
    resistanceLevels: (camel['resistanceLevels'] as number[]) ?? [],
    quarterlyPerf: Number(camel['quarterlyPerf'] ?? 0),
    yearlyPerf: Number(camel['yearlyPerf'] ?? 0),
    indicators: camel['indicators'] as StockSnapshot['indicators'],
    peSeries: (camel['peSeries'] as number[]) ?? [],
    vsNiftyPct: camel['vsNiftyPct'] as number | undefined,
    vsCapIndexPct: camel['vsCapIndexPct'] as number | undefined,
    vsSectorPct: camel['vsSectorPct'] as number | undefined,
    capBucket: camel['capBucket'] as string | undefined,
    sector: camel['sector'] as string | undefined,
    volumeRatio: camel['volumeRatio'] as number | undefined,
    lastUpdated: String(camel['lastUpdated'] ?? ''),
    dataSource: String(camel['dataSource'] ?? ''),
  };
}

@Injectable({ providedIn: 'root' })
export class StockFirestoreService {
  private supabase = inject(SupabaseService);

  watchMarketCatalog(): Observable<StockSnapshot[]> {
    return this.supabase.watchTable('market_catalog', () => this.fetchMarketCatalog()).pipe(
      map((rows) =>
        rows
          .slice()
          .sort((a, b) => a.symbol.localeCompare(b.symbol))
      )
    );
  }

  private async fetchMarketCatalog(): Promise<StockSnapshot[]> {
    const { data, error } = await this.supabase.client
      .from('market_catalog')
      .select('stocks')
      .eq('id', 'summary')
      .maybeSingle();
    if (error) throw error;
    const summary = data as { stocks?: MarketCatalogSummary['stocks'] } | null;
    const rows = summary?.stocks ?? [];
    return rows.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      exchange: 'NSE',
      ltp: s.ltp,
      change: 0,
      changePct: s.changePct,
      marketCap: s.marketCap,
      pe: s.pe,
      sector: s.sector,
      quarterlyPerf: 0,
      yearlyPerf: 0,
      lastUpdated: s.lastUpdated,
      dataSource: s.dataSource,
    }));
  }

  watchStock(symbol: string): Observable<StockSnapshot | undefined> {
    const sym = symbol.toUpperCase();
    return this.supabase
      .watchTable(`stocks-${sym}`, () => this.fetchStock(sym))
      .pipe(map((stock) => stock ?? undefined));
  }

  private async fetchStock(symbol: string): Promise<StockSnapshot | null> {
    const { data, error } = await this.supabase.client
      .from('stocks')
      .select('*')
      .eq('symbol', symbol)
      .maybeSingle();
    if (error) throw error;
    return data ? mapStockRow(data) : null;
  }

  watchChart(symbol: string): Observable<ChartView | undefined> {
    const sym = symbol.toUpperCase();
    return this.supabase
      .watchTable(`stock_charts-${sym}`, () => this.fetchChart(sym))
      .pipe(map((chart) => chart ?? undefined));
  }

  private async fetchChart(symbol: string): Promise<ChartView | null> {
    const { data, error } = await this.supabase.client
      .from('stock_charts')
      .select('*')
      .eq('symbol', symbol)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const camel = rowToCamel<ChartView>(data);
    return { ...camel, symbol };
  }

  watchStocksBySymbols(symbols: string[]): Observable<StockSnapshot[]> {
    const upper = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
    if (!upper.length) return of([]);
    return this.supabase
      .watchTable(`stocks-batch-${upper.join(',')}`, () => this.fetchStocksBySymbols(upper))
      .pipe(map((rows) => rows));
  }

  private async fetchStocksBySymbols(symbols: string[]): Promise<StockSnapshot[]> {
    const { data, error } = await this.supabase.client.from('stocks').select('*').in('symbol', symbols);
    if (error) throw error;
    return (data ?? []).map((row) => mapStockRow(row));
  }
}
