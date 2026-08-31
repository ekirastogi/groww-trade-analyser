import { Injectable } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Observable } from 'rxjs';
import { supabaseConfig } from '../../environments/supabase.config';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  async whenReady(): Promise<void> {
    await this.client.auth.getSession();
  }

  async getUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    return data.user?.id ?? null;
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
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
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
