import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TradeSuggestion } from '../models/signal.models';
import { AuthService } from './auth.service';
import { objectToSnake, rowsToCamel, SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class RecommendationService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  watchTopPending(limitCount = 20): Observable<TradeSuggestion[]> {
    return this.supabase.watchTable('recommendations', () => this.fetchTopPending(limitCount));
  }

  async fetchTopPending(limitCount = 30): Promise<TradeSuggestion[]> {
    const { data, error } = await this.supabase.client
      .from('recommendations')
      .select('*')
      .eq('approval_status', 'pending')
      .order('confidence', { ascending: false })
      .limit(limitCount);
    if (error) throw error;
    return rowsToCamel<TradeSuggestion>(data ?? []);
  }

  watchByHorizon(horizon: 'intraday' | 'btst', limitCount = 20): Observable<TradeSuggestion[]> {
    return this.supabase.watchTable('recommendations', () => this.fetchByHorizon(horizon, limitCount));
  }

  private async fetchByHorizon(
    horizon: 'intraday' | 'btst',
    limitCount: number
  ): Promise<TradeSuggestion[]> {
    const { data, error } = await this.supabase.client
      .from('recommendations')
      .select('*')
      .eq('approval_status', 'pending')
      .eq('horizon', horizon)
      .order('confidence', { ascending: false })
      .limit(limitCount);
    if (error) throw error;
    return rowsToCamel<TradeSuggestion>(data ?? []);
  }

  watchAll(): Observable<TradeSuggestion[]> {
    return this.supabase.watchTable('recommendations', () => this.fetchAll());
  }

  private async fetchAll(): Promise<TradeSuggestion[]> {
    const { data, error } = await this.supabase.client
      .from('recommendations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return rowsToCamel<TradeSuggestion>(data ?? []);
  }

  watchPending(): Observable<TradeSuggestion[]> {
    return this.watchTopPending(50);
  }

  watchHistory(): Observable<TradeSuggestion[]> {
    return this.supabase.watchTable('recommendations', () => this.fetchHistory());
  }

  private async fetchHistory(): Promise<TradeSuggestion[]> {
    const { data, error } = await this.supabase.client
      .from('recommendations')
      .select('*')
      .or(
        'status.in.(executed,rejected,expired),approval_status.eq.rejected,exit_reason.in.(hit_target,hit_sl,executed_on_groww)'
      )
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return rowsToCamel<TradeSuggestion>(data ?? []);
  }

  async approve(id: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    const { error } = await this.supabase.client
      .from('recommendations')
      .update(
        objectToSnake({
          approvalStatus: 'approved',
          status: 'pending_approval',
          approvedAt: new Date().toISOString(),
          approvedBy: uid,
        })
      )
      .eq('id', id);
    if (error) throw error;
  }

  async reject(id: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    const { error } = await this.supabase.client
      .from('recommendations')
      .update(
        objectToSnake({
          approvalStatus: 'rejected',
          status: 'rejected',
          rejectedAt: new Date().toISOString(),
          rejectedBy: uid,
        })
      )
      .eq('id', id);
    if (error) throw error;
  }
}
