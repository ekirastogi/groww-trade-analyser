import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { RegistryStock } from '../models/trading-journal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowsToCamel, SupabaseService } from './supabase.service';
import { UniverseService } from './universe.service';

const UPSERT_BATCH_LIMIT = 400;

@Injectable({ providedIn: 'root' })
export class RegistryStockService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private universe = inject(UniverseService);

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

  /** Add universe symbols to registry without overwriting existing rows. */
  async syncFromUniverse(): Promise<{ added: number; total: number }> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to sync registry');

    const [entries, existing] = await Promise.all([this.universe.listAll(), this.listAll()]);
    const existingSymbols = new Set(existing.map((stock) => stock.symbol));
    const now = Date.now();
    const rows: Record<string, unknown>[] = [];

    for (const entry of entries) {
      const symbol = entry.symbol.toUpperCase();
      if (!symbol || existingSymbols.has(symbol)) continue;
      rows.push(
        objectToSnake({
          userId: uid,
          symbol,
          name: entry.name?.trim() || symbol,
          currentPrice: 0,
          supports: [],
          resistances: [],
          notes: '',
          updatedAt: now,
        })
      );
    }

    for (let i = 0; i < rows.length; i += UPSERT_BATCH_LIMIT) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_LIMIT);
      const { error } = await this.supabase.client
        .from('registry_stocks')
        .upsert(chunk, { onConflict: 'user_id,symbol', ignoreDuplicates: true });
      if (error) throw error;
    }

    return { added: rows.length, total: existing.length + rows.length };
  }

  /** Remove registry rows that duplicate the same ISIN (keeps NSE symbol when listed). */
  async dedupeByIsin(): Promise<number> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;

    const [entries, stocks] = await Promise.all([this.universe.listAll(), this.listAll()]);
    const stockSymbols = new Set(stocks.map((stock) => stock.symbol));
    const canonicalByIsin = new Map<string, string>();

    for (const entry of entries) {
      const isin = entry.isin?.trim();
      if (!isin) continue;
      const existing = canonicalByIsin.get(isin);
      if (!existing || entry.exchange === 'NSE') {
        canonicalByIsin.set(isin, entry.symbol);
      }
    }

    const symbolsToRemove = new Set<string>();
    for (const entry of entries) {
      const isin = entry.isin?.trim();
      if (!isin) continue;
      const canonical = canonicalByIsin.get(isin);
      if (!canonical || canonical === entry.symbol || !stockSymbols.has(canonical)) continue;
      if (stockSymbols.has(entry.symbol) && entry.symbol !== canonical) {
        symbolsToRemove.add(entry.symbol);
      }
    }

    for (const symbol of symbolsToRemove) {
      await this.remove(symbol);
    }
    return symbolsToRemove.size;
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
    const { data, error: selectError } = await this.supabase.client
      .from('registry_stocks')
      .select('symbol')
      .eq('user_id', uid);
    if (selectError) throw selectError;
    if (!data?.length) return 0;
    const { error } = await this.supabase.client
      .from('registry_stocks')
      .delete()
      .eq('user_id', uid);
    if (error) throw error;
    return data.length;
  }
}
