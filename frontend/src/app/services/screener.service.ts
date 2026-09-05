import { Injectable, inject } from '@angular/core';
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

  async fetchStock(symbol: string): Promise<ScreenerSnapshot> {
    const { data, error } = await this.supabase.client.functions.invoke<ScreenerSnapshot>('screener-fetch', {
      body: { symbol },
    });
    if (error) throw new Error(error.message || 'Screener fetch failed');
    if (!data || typeof data !== 'object') {
      throw new Error('Screener fetch failed');
    }
    const payload = data as ScreenerSnapshot & { error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload;
  }
}
