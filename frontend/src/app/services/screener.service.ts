import { Injectable, inject } from '@angular/core';
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
    // Use fetch directly — supabase.functions.invoke always attaches the Firebase JWT
    // from accessToken, which the Edge gateway rejects even when JWT verify is off.
    const res = await fetch(`${supabaseConfig.url}/functions/v1/screener-fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
      },
      body: JSON.stringify({ symbol, name: name?.trim() || undefined }),
    });

    let payload: ScreenerSnapshot & { error?: string; message?: string } | null = null;
    try {
      payload = (await res.json()) as ScreenerSnapshot & { error?: string; message?: string };
    } catch {
      payload = null;
    }

    if (!res.ok) {
      throw new Error(payload?.error ?? payload?.message ?? `Screener fetch failed (${res.status})`);
    }
    if (!payload || payload.error) {
      throw new Error(payload?.error ?? 'Screener fetch failed');
    }
    return payload;
  }
}
