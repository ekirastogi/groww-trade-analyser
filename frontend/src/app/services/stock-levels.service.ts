import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { objectToSnake, rowToCamel, SupabaseService } from './supabase.service';

export interface UserLevel {
  id: string;
  price: number;
  label: string;
}

export interface UserStockLevels {
  symbol: string;
  supports: UserLevel[];
  resistances: UserLevel[];
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class StockLevelsService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watch(symbol: string): Observable<UserStockLevels | undefined> {
    const sym = symbol.toUpperCase();
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of(undefined);
        return this.supabase
          .watchTable(`user_stock_levels-${sym}`, () => this.fetchLevels(sym))
          .pipe(map((levels) => levels ?? undefined));
      })
    );
  }

  private async fetchLevels(symbol: string): Promise<UserStockLevels | null> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return null;
    const { data, error } = await this.supabase.client
      .from('user_stock_levels')
      .select('*')
      .eq('user_id', uid)
      .eq('symbol', symbol)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToCamel<UserStockLevels>(data) : null;
  }

  async save(symbol: string, levels: Pick<UserStockLevels, 'supports' | 'resistances'>): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to save levels');
    const row = objectToSnake({
      userId: uid,
      symbol: symbol.toUpperCase(),
      supports: levels.supports,
      resistances: levels.resistances,
      updatedAt: Date.now(),
    });
    const { error } = await this.supabase.client.from('user_stock_levels').upsert(row);
    if (error) throw error;
  }

  async addLevel(symbol: string, type: 'support' | 'resistance', price: number, label: string): Promise<void> {
    const current = await this.get(symbol);
    const supports = [...(current?.supports ?? [])];
    const resistances = [...(current?.resistances ?? [])];
    const level: UserLevel = { id: crypto.randomUUID(), price, label };
    if (type === 'support') supports.push(level);
    else resistances.push(level);
    await this.save(symbol, { supports, resistances });
  }

  async removeLevel(symbol: string, type: 'support' | 'resistance', id: string): Promise<void> {
    const current = await this.get(symbol);
    if (!current) return;
    const supports =
      type === 'support' ? current.supports.filter((l) => l.id !== id) : current.supports;
    const resistances =
      type === 'resistance' ? current.resistances.filter((l) => l.id !== id) : current.resistances;
    await this.save(symbol, { supports, resistances });
  }

  private async get(symbol: string): Promise<UserStockLevels | undefined> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return undefined;
    const levels = await this.fetchLevels(symbol.toUpperCase());
    return levels ?? undefined;
  }
}

export interface VolumeShockerActive {
  symbols: Array<{ symbol: string; rank: number; ratio: number; daysRemaining: number }>;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class VolumeShockerService {
  private supabase = inject(SupabaseService);

  watchActive(): Observable<VolumeShockerActive | undefined> {
    return this.supabase
      .watchTable('volume_shockers_active', () => this.fetchActive())
      .pipe(map((data) => data ?? undefined));
  }

  async fetchActive(): Promise<VolumeShockerActive | undefined> {
    const { data, error } = await this.supabase.client
      .from('volume_shockers_active')
      .select('symbols, updated_at')
      .eq('id', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    return {
      symbols: (data.symbols as VolumeShockerActive['symbols']) ?? [],
      updatedAt: data.updated_at as string | undefined,
    };
  }
}
