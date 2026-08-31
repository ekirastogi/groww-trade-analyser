import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { RegistryStock } from '../models/trading-journal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowsToCamel, SupabaseService } from './supabase.service';

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
    const { data, error } = await this.supabase.client
      .from('registry_stocks')
      .select('*')
      .eq('user_id', uid)
      .order('symbol', { ascending: true });
    if (error) throw error;
    return rowsToCamel<RegistryStock>(data ?? []);
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
      currentPrice: stock.currentPrice,
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
