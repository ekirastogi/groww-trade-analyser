import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { objectToSnake, rowsToCamel, SupabaseService } from './supabase.service';

export interface UniverseEntry {
  symbol: string;
  name?: string;
  isin?: string;
  exchange?: string;
  source: 'pnl_upload' | 'seed' | 'manual' | 'exchange_seed';
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class UniverseService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watchAll(): Observable<UniverseEntry[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable('universe', () => this.listAll());
      })
    );
  }

  async listAll(): Promise<UniverseEntry[]> {
    await this.auth.whenReady();
    if (!(await this.auth.getDataUserId())) return [];

    const pageSize = 1000;
    const all: UniverseEntry[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.supabase.client
        .from('universe')
        .select('*')
        .order('symbol', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...rowsToCamel<UniverseEntry>(data));
      if (data.length < pageSize) break;
    }
    return all;
  }

  async count(): Promise<number> {
    await this.auth.whenReady();
    if (!(await this.auth.getDataUserId())) return 0;
    const { count, error } = await this.supabase.client
      .from('universe')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }

  async syncSymbols(
    symbols: Array<{ symbol: string; name?: string; isin?: string }>,
    source: UniverseEntry['source'] = 'pnl_upload'
  ): Promise<number> {
    await this.auth.whenReady();
    if (!(await this.auth.getDataUserId())) return 0;

    const now = Date.now();
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const entry of symbols) {
      const sym = entry.symbol.toUpperCase().trim();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      rows.push(
        objectToSnake({
          symbol: sym,
          name: entry.name ?? sym,
          isin: entry.isin ?? '',
          exchange: 'NSE',
          source,
          updatedAt: now,
        })
      );
    }

    if (!rows.length) return 0;
    const { error } = await this.supabase.client.from('universe').upsert(rows);
    if (error) throw error;
    return rows.length;
  }
}
