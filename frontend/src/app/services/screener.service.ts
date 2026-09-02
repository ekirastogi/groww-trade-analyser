import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseError } from 'firebase/app';
import { RegistryFinancialTable } from '../models/trading-journal.models';

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
  private functions = inject(Functions);

  async fetchStock(symbol: string): Promise<ScreenerSnapshot> {
    const callable = httpsCallable<{ symbol: string }, ScreenerSnapshot>(
      this.functions,
      'fetchScreenerStock'
    );
    try {
      const result = await callable({ symbol });
      return result.data;
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : '';
      if (code === 'functions/not-found' || code === 'functions/unavailable' || code === 'functions/internal') {
        throw new Error(
          'Screener Cloud Function is not deployed. Upgrade Firebase project kairo-trade to the Blaze plan, then run firebase deploy --only functions.'
        );
      }
      throw err instanceof Error ? err : new Error('Screener fetch failed');
    }
  }
}
