import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Observable } from 'rxjs';
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

  /** Live query: initial fetch + postgres_changes on table. */
  watchTable<T>(table: string, fetch: () => Promise<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      let channel: RealtimeChannel | null = null;

      const load = async () => {
        try {
          subscriber.next(await fetch());
        } catch (err) {
          subscriber.error(err);
        }
      };

      void load();
      channel = this.client
        .channel(`watch-${table}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => void load())
        .subscribe();

      return () => {
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
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function camelToSnake(key: string): string {
  // Keep PnL as one word (reportRealisedPnL → report_realised_pnl, not report_realised_pn_l).
  return key
    .replace(/PnL/g, 'Pnl')
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
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
