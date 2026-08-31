import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { RegistryStock } from '../models/trading-journal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowToCamel, rowsToCamel, SupabaseService } from './supabase.service';

const UPSERT_BATCH_LIMIT = 400;

export type RegistryStockSource = NonNullable<RegistryStock['source']>;

@Injectable({ providedIn: 'root' })
export class RegistryStockService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watchAll(): Observable<RegistryStock[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable('registry_stocks', () => this.listAll());
      })
    );
  }

  async listAll(): Promise<RegistryStock[]> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];

    const pageSize = 1000;
    const all: RegistryStock[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.supabase.client
        .from('registry_stocks')
        .select('*')
        .eq('user_id', uid)
        .order('symbol', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...rowsToCamel<RegistryStock>(data));
      if (data.length < pageSize) break;
    }
    return all;
  }

  async count(): Promise<number> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;
    const { count, error } = await this.supabase.client
      .from('registry_stocks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (error) throw error;
    return count ?? 0;
  }

  async syncSymbols(
    symbols: Array<{ symbol: string; name?: string; isin?: string }>,
    source: RegistryStockSource = 'pnl_upload'
  ): Promise<number> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;

    const now = Date.now();
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const entry of symbols) {
      const sym = entry.symbol.toUpperCase().trim();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      rows.push(
        objectToSnake({
          userId: uid,
          symbol: sym,
          name: entry.name ?? sym,
          isin: entry.isin ?? '',
          exchange: 'NSE',
          source,
          currentPrice: 0,
          supports: [],
          resistances: [],
          notes: '',
          updatedAt: now,
        })
      );
    }

    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_LIMIT) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_LIMIT);
      const { error } = await this.supabase.client
        .from('registry_stocks')
        .upsert(chunk, { onConflict: 'user_id,symbol', ignoreDuplicates: true });
      if (error) throw error;
    }
    return rows.length;
  }

  /** Remove registry rows that duplicate the same ISIN (keeps NSE symbol when listed). */
  async dedupeByIsin(): Promise<number> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;

    const stocks = await this.listAll();
    const stockSymbols = new Set(stocks.map((stock) => stock.symbol));
    const canonicalByIsin = new Map<string, string>();

    for (const stock of stocks) {
      const isin = stock.isin?.trim();
      if (!isin) continue;
      const existing = canonicalByIsin.get(isin);
      if (!existing || stock.exchange === 'NSE') {
        canonicalByIsin.set(isin, stock.symbol);
      }
    }

    const symbolsToRemove = new Set<string>();
    for (const stock of stocks) {
      const isin = stock.isin?.trim();
      if (!isin) continue;
      const canonical = canonicalByIsin.get(isin);
      if (!canonical || canonical === stock.symbol || !stockSymbols.has(canonical)) continue;
      if (stockSymbols.has(stock.symbol) && stock.symbol !== canonical) {
        symbolsToRemove.add(stock.symbol);
      }
    }

    for (const symbol of symbolsToRemove) {
      await this.remove(symbol);
    }
    return symbolsToRemove.size;
  }

  /**
   * Copy CMP, market cap, P/E, and indicators from the worker `stocks` table
   * (populated by Groww ingest) into the user's registry rows.
   */
  async enrichFromMarketData(): Promise<{ updated: number; pending: number }> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to refresh market data');

    const registry = await this.listAll();
    if (!registry.length) return { updated: 0, pending: 0 };

    const bySymbol = new Map(registry.map((stock) => [stock.symbol, stock]));
    const symbols = [...bySymbol.keys()];
    const marketBySymbol = new Map<string, Record<string, unknown>>();
    const chunkSize = 200;

    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const { data, error } = await this.supabase.client.from('stocks').select('*').in('symbol', chunk);
      if (error) throw error;
      for (const row of data ?? []) {
        const camel = rowToCamel<Record<string, unknown>>(row);
        marketBySymbol.set(String(camel['symbol'] ?? '').toUpperCase(), camel);
      }
    }

    let updated = 0;

    for (const stock of registry) {
      const market = marketBySymbol.get(stock.symbol);
      if (!market) continue;

      const ltp = Number(market['ltp'] ?? 0);
      const marketCap = Number(market['marketCap'] ?? 0);
      const pe = Number(market['pe'] ?? 0);
      const indicators = (market['indicators'] as Record<string, number> | undefined) ?? {};
      const supports = ((market['supportLevels'] as number[]) ?? []).filter((v) => v > 0).slice(0, 3);
      const resistances = ((market['resistanceLevels'] as number[]) ?? []).filter((v) => v > 0).slice(0, 3);

      const hasData =
        ltp > 0 ||
        marketCap > 0 ||
        pe > 0 ||
        indicators['rsi'] != null ||
        supports.length > 0 ||
        resistances.length > 0;
      if (!hasData) continue;

      await this.save({
        ...stock,
        name: String(market['name'] ?? stock.name),
        currentPrice: ltp > 0 ? ltp : stock.currentPrice,
        marketCap: marketCap > 0 ? marketCap : stock.marketCap,
        pe: pe > 0 ? pe : stock.pe,
        rsi: indicators['rsi'] ?? stock.rsi,
        macd: indicators['macd'] ?? stock.macd,
        macdHist: indicators['macdHist'] ?? stock.macdHist,
        macdSignal: indicators['macdSignal'] ?? stock.macdSignal,
        sma20: indicators['sma20'] ?? stock.sma20,
        sma50: indicators['sma50'] ?? stock.sma50,
        supports: supports.length ? supports : stock.supports,
        resistances: resistances.length ? resistances : stock.resistances,
      });
      updated++;
    }

    return { updated, pending: registry.length - updated };
  }

  async save(stock: Omit<RegistryStock, 'updatedAt'>): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to save stocks');
    const symbol = stock.symbol.trim().toUpperCase();
    if (!symbol) throw new Error('Symbol is required');

    const row = objectToSnake({
      userId: uid,
      symbol,
      name: stock.name.trim() || symbol,
      isin: stock.isin ?? '',
      exchange: stock.exchange ?? 'NSE',
      source: stock.source ?? 'manual',
      currentPrice: stock.currentPrice ?? 0,
      marketCap: stock.marketCap,
      pe: stock.pe,
      rsi: stock.rsi,
      macd: stock.macd,
      macdHist: stock.macdHist,
      macdSignal: stock.macdSignal,
      sma20: stock.sma20,
      sma50: stock.sma50,
      supports: (stock.supports ?? []).slice(0, 3).map(Number),
      resistances: (stock.resistances ?? []).slice(0, 3).map(Number),
      notes: stock.notes ?? '',
      updatedAt: Date.now(),
    });
    const { error } = await this.supabase.client.from('registry_stocks').upsert(row);
    if (error) throw error;
  }

  async remove(symbol: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to delete stocks');
    const { error } = await this.supabase.client
      .from('registry_stocks')
      .delete()
      .eq('user_id', uid)
      .eq('symbol', symbol.toUpperCase());
    if (error) throw error;
  }

  async deleteAll(): Promise<number> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;
    const { count, error: countError } = await this.supabase.client
      .from('registry_stocks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (countError) throw countError;
    const { error } = await this.supabase.client.from('registry_stocks').delete().eq('user_id', uid);
    if (error) throw error;
    return count ?? 0;
  }
}
