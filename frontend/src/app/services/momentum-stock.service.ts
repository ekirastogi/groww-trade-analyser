import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { MomentumCatalyst, MomentumStock } from '../models/trading-journal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowToCamel, SupabaseService } from './supabase.service';

export interface SaveMomentumStockInput {
  symbol: string;
  stockName?: string;
  cmp?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  quantity?: number;
  catalyst?: MomentumCatalyst;
  resultDate?: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class MomentumStockService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watchAll(): Observable<MomentumStock[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable('momentum_stocks', () => this.listAll(), undefined, 'momentum_stocks');
      })
    );
  }

  async listAll(): Promise<MomentumStock[]> {
    await this.auth.whenReady();
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('momentum_stocks')
      .select('*')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => rowToMomentumStock(row));
  }

  async save(input: SaveMomentumStockInput, id?: string): Promise<string> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to save momentum stocks');
    const symbol = input.symbol.toUpperCase().trim();
    if (!symbol) throw new Error('Symbol is required');
    if (!input.targetPrice || input.targetPrice <= 0) {
      throw new Error('Target price is required');
    }

    const now = Date.now();
    const rowId = id ?? crypto.randomUUID();
    const row = objectToSnake({
      id: rowId,
      userId: uid,
      symbol,
      stockName: input.stockName?.trim() || symbol,
      cmp: input.cmp ?? null,
      entryPrice: input.entryPrice ?? input.cmp ?? null,
      targetPrice: input.targetPrice,
      stopLoss: input.stopLoss ?? null,
      quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
      catalyst: input.catalyst ?? null,
      resultDate: input.resultDate?.trim() || null,
      notes: input.notes?.trim() ?? '',
      updatedAt: now,
      payload: { updatedAt: now },
    });

    if (id) {
      const { error } = await this.supabase.client
        .from('momentum_stocks')
        .update(row)
        .eq('id', id)
        .eq('user_id', uid);
      if (error) throw error;
      return rowId;
    }

    const insertRow = { ...row, createdAt: now };
    const { error } = await this.supabase.client.from('momentum_stocks').insert(insertRow);
    if (error) {
      if (error.code === '23505') throw new Error(`${symbol} is already on your momentum list`);
      throw error;
    }
    return rowId;
  }

  async remove(id: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to remove stocks');
    const { error } = await this.supabase.client
      .from('momentum_stocks')
      .delete()
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
  }

  async deleteAll(): Promise<number> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return 0;
    const { data, error: selectError } = await this.supabase.client
      .from('momentum_stocks')
      .select('id')
      .eq('user_id', uid);
    if (selectError) throw selectError;
    if (!data?.length) return 0;
    const { error } = await this.supabase.client.from('momentum_stocks').delete().eq('user_id', uid);
    if (error) throw error;
    return data.length;
  }

  async refreshCmp(id: string, cmp: number): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) throw new Error('Sign in to update stocks');
    const { error } = await this.supabase.client
      .from('momentum_stocks')
      .update(
        objectToSnake({
          cmp,
          updatedAt: Date.now(),
          payload: { updatedAt: Date.now() },
        })
      )
      .eq('id', id)
      .eq('user_id', uid);
    if (error) throw error;
  }
}

function rowToMomentumStock(row: Record<string, unknown>): MomentumStock {
  const camel = rowToCamel<Record<string, unknown>>(row);
  return {
    id: String(camel['id'] ?? ''),
    symbol: String(camel['symbol'] ?? ''),
    stockName: camel['stockName'] as string | undefined,
    cmp: camel['cmp'] as number | undefined,
    entryPrice: camel['entryPrice'] as number | undefined,
    targetPrice: camel['targetPrice'] as number | undefined,
    stopLoss: camel['stopLoss'] as number | undefined,
    quantity: Number(camel['quantity'] ?? 1),
    catalyst: camel['catalyst'] as MomentumCatalyst | undefined,
    resultDate: camel['resultDate'] as string | undefined,
    notes: camel['notes'] as string | undefined,
    createdAt: Number(camel['createdAt'] ?? 0),
    updatedAt: Number(camel['updatedAt'] ?? 0),
  };
}
