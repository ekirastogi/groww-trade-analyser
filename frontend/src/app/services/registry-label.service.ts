import { Injectable, inject } from '@angular/core';
import { RegistryLabel } from '../models/trading-journal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowsToCamel, SupabaseService } from './supabase.service';

export type StockLabelMap = Map<string, string[]>;

/** Auto-managed label applied to every symbol found in the user's trade ledger. */
export const TRADED_LABEL_NAME = 'traded';

const ASSIGN_BATCH_LIMIT = 500;

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

function missingLabelsMessage(): Error {
  return new Error(
    'Stock labels are not set up in the database yet. Apply supabase/migrations/012_registry_labels.sql, then retry.'
  );
}

@Injectable({ providedIn: 'root' })
export class RegistryLabelService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  async listLabels(): Promise<RegistryLabel[]> {
    const uid = await this.requireUid();
    const { data, error } = await this.supabase.client
      .from('registry_labels')
      .select('id, name, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) this.throwQueryError(error);
    return rowsToCamel<RegistryLabel>(data ?? []);
  }

  async listAssignments(): Promise<StockLabelMap> {
    const uid = await this.requireUid();
    const { data, error } = await this.supabase.client
      .from('registry_stock_labels')
      .select('symbol, label_id')
      .eq('user_id', uid);
    if (error) this.throwQueryError(error);

    const map: StockLabelMap = new Map();
    for (const row of data ?? []) {
      const symbol = String(row['symbol'] ?? '').toUpperCase();
      const labelId = String(row['label_id'] ?? '');
      if (!symbol || !labelId) continue;
      const current = map.get(symbol) ?? [];
      current.push(labelId);
      map.set(symbol, current);
    }
    return map;
  }

  async createLabel(rawName: string): Promise<RegistryLabel> {
    const uid = await this.requireUid();
    const name = rawName.trim();
    if (!name) throw new Error('Label name is required');
    if (name.length > 40) throw new Error('Label name must be 40 characters or fewer');

    const { data, error } = await this.supabase.client
      .from('registry_labels')
      .insert(objectToSnake({ userId: uid, name, createdAt: Date.now() }))
      .select('id, name, created_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error(`Label “${name}” already exists`);
      }
      this.throwQueryError(error);
    }
    return rowsToCamel<RegistryLabel>([data as Record<string, unknown>])[0];
  }

  /** Returns the label with this name, creating it if needed. Name match is case-insensitive. */
  async ensureLabel(name: string): Promise<RegistryLabel> {
    const wanted = name.trim().toLowerCase();
    const existing = (await this.listLabels()).find((l) => l.name.trim().toLowerCase() === wanted);
    if (existing) return existing;
    try {
      return await this.createLabel(name);
    } catch (err) {
      // Another tab may have created it first; fall back to whatever is stored now.
      const retry = (await this.listLabels()).find((l) => l.name.trim().toLowerCase() === wanted);
      if (retry) return retry;
      throw err;
    }
  }

  /**
   * Tags every traded symbol with the shared "traded" label. Idempotent, so it is safe to
   * run after each upload and as a backfill for ledgers imported before labels existed.
   */
  async syncTradedSymbols(symbols: string[]): Promise<number> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (!unique.length) return 0;
    const label = await this.ensureLabel(TRADED_LABEL_NAME);
    return this.addManyToStocks(unique, label.id);
  }

  async addManyToStocks(symbols: string[], labelId: string): Promise<number> {
    const uid = await this.requireUid();
    const rows = symbols.map((symbol) => objectToSnake({ userId: uid, symbol, labelId }));
    for (let i = 0; i < rows.length; i += ASSIGN_BATCH_LIMIT) {
      const { error } = await this.supabase.client
        .from('registry_stock_labels')
        .upsert(rows.slice(i, i + ASSIGN_BATCH_LIMIT), {
          onConflict: 'user_id,symbol,label_id',
          ignoreDuplicates: true,
        });
      if (error) this.throwQueryError(error);
    }
    return rows.length;
  }

  async deleteLabel(id: string): Promise<void> {
    const uid = await this.requireUid();
    const { error } = await this.supabase.client
      .from('registry_labels')
      .delete()
      .eq('user_id', uid)
      .eq('id', id);
    if (error) this.throwQueryError(error);
  }

  async addToStock(symbol: string, labelId: string): Promise<void> {
    const uid = await this.requireUid();
    const sym = symbol.trim().toUpperCase();
    if (!sym || !labelId) return;
    const { error } = await this.supabase.client.from('registry_stock_labels').upsert(
      objectToSnake({ userId: uid, symbol: sym, labelId }),
      { onConflict: 'user_id,symbol,label_id' }
    );
    if (error) this.throwQueryError(error);
  }

  async removeFromStock(symbol: string, labelId: string): Promise<void> {
    const uid = await this.requireUid();
    const { error } = await this.supabase.client
      .from('registry_stock_labels')
      .delete()
      .eq('user_id', uid)
      .eq('symbol', symbol.trim().toUpperCase())
      .eq('label_id', labelId);
    if (error) this.throwQueryError(error);
  }

  async deleteAll(): Promise<number> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;
    const { count, error: countError } = await this.supabase.client
      .from('registry_labels')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (countError) {
      if (isMissingTableError(countError)) return 0;
      throw countError;
    }
    const { error } = await this.supabase.client.from('registry_labels').delete().eq('user_id', uid);
    if (error) {
      if (isMissingTableError(error)) return 0;
      throw error;
    }
    return count ?? 0;
  }

  private async requireUid(): Promise<string> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to manage labels');
    return uid;
  }

  private throwQueryError(error: { message?: string; code?: string }): never {
    if (isMissingTableError(error)) throw missingLabelsMessage();
    throw new Error(error.message || 'Label request failed');
  }
}
