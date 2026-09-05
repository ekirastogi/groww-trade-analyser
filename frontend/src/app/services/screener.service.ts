import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabaseConfig } from '../../environments/supabase.config';
import { RegistryFinancialTable } from '../models/trading-journal.models';
import { SupabaseService } from './supabase.service';

export interface ScreenerSnapshot {
  symbol: string;
  name: string;
  url: string;
  currentPrice?: number;
  marketCap?: number;
  pe?: number;
  bookValue?: number;
  dividendYield?: number;
  roce?: number;
  roe?: number;
  faceValue?: number;
  highLow?: string;
  salesGrowth3y?: number;
  salesGrowth5y?: number;
  salesGrowth10y?: number;
  salesGrowthTtm?: number;
  profitGrowth3y?: number;
  profitGrowth5y?: number;
  profitGrowth10y?: number;
  profitGrowthTtm?: number;
  stockCagr1y?: number;
  stockCagr3y?: number;
  stockCagr5y?: number;
  stockCagr10y?: number;
  promoterHolding?: number;
  fiiHolding?: number;
  diiHolding?: number;
  publicHolding?: number;
  governmentHolding?: number;
  otherHolding?: number;
  quarterlyResults: RegistryFinancialTable;
  profitLoss: RegistryFinancialTable;
  shareholding: RegistryFinancialTable;
  fetchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ScreenerService {
  private supabase = inject(SupabaseService);

  async fetchStock(symbol: string, name?: string): Promise<ScreenerSnapshot> {
    const { data, error } = await this.supabase.client.functions.invoke<ScreenerSnapshot>('screener-fetch', {
      body: { symbol, name: name?.trim() || undefined },
      // Edge Functions verify Supabase JWTs; use publishable anon key (Firebase auth is app-side).
      headers: {
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
      },
    });

    if (error) {
      if (error instanceof FunctionsHttpError) {
        let message = error.message;
        try {
          const payload = (await error.context.json()) as { error?: string; message?: string };
          message = payload.error ?? payload.message ?? message;
        } catch {
          // Response body may not be JSON.
        }
        throw new Error(message || 'Screener fetch failed');
      }
      throw new Error(error.message || 'Screener fetch failed');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Screener fetch failed');
    }
    const payload = data as ScreenerSnapshot & { error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload;
  }
}
