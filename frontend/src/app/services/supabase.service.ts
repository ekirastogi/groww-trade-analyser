import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Observable } from 'rxjs';
import { UI_CACHE_TTL_MS } from '../constants/cache.constants';
import { supabaseConfig } from '../../environments/supabase.config';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private firebaseAuth = inject(Auth);

  readonly client: SupabaseClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    accessToken: async () => {
      const user = this.firebaseAuth.currentUser;
      if (!user) return null;
      return user.getIdToken(false);
    },
  });

  async whenReady(): Promise<void> {
    await this.firebaseAuth.authStateReady();
  }

  /** Live query: initial fetch + postgres_changes + periodic refresh. */
  watchTable<T>(
    table: string,
    fetch: () => Promise<T>,
    refreshMs: number = UI_CACHE_TTL_MS,
    postgresTable = table
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      let channel: RealtimeChannel | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const load = async () => {
        try {
          subscriber.next(await fetch());
        } catch (err) {
          subscriber.error(err);
        }
      };

      void load();

      if (refreshMs > 0) {
        pollTimer = setInterval(() => void load(), refreshMs);
      }

      channel = this.client
        .channel(`watch-${table}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: postgresTable }, () => void load())
        .subscribe();

      return () => {
        if (pollTimer) clearInterval(pollTimer);
        if (channel) void this.client.removeChannel(channel);
      };
    });
  }
}

/** Map Postgres snake_case row to camelCase for Angular models. */
export function rowToCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[snakeToCamel(key)] = value;
  }
  return out as T;
}

export function rowsToCamel<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => rowToCamel<T>(row));
}

export function snakeToCamel(key: string): string {
  const camel = key
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/_([0-9])/g, '$1');
  // Match app models: realised_pnl → realisedPnL (not realisedPnl).
  return camel.replace(/PnlPct/g, 'PnLPct').replace(/Pnl/g, 'PnL');
}

/** Read numeric field with legacy Pnl/PnL key fallbacks after rowToCamel. */
export function numField(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return Number(value);
  }
  return 0;
}

export function camelToSnake(key: string): string {
  return key
    .replace(/PnL/g, 'Pnl')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    // Only split before digit runs followed by a letter (e.g. growth10y → growth_10y).
    // Leave indicator names intact (sma20, week52High → week52_high).
    .replace(/([a-z])([0-9]+)(?=[a-z])/g, '$1_$2')
    .toLowerCase();
}

/** Convert object keys from camelCase to snake_case (shallow). */
export function objectToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    out[camelToSnake(key)] = value;
  }
  return out;
}
