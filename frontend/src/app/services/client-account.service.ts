import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { objectToSnake, rowToCamel, rowsToCamel, SupabaseService } from './supabase.service';

export interface ClientAccount {
  clientCode: string;
  clientName: string;
  tradeCount: number;
  lastUploadAt: number;
  totalRealisedPnL?: number;
  totalNetPnL?: number;
  totalCharges?: number;
  periodLabel?: string;
}

const SELECTED_CLIENT_KEY = 'kairo-selected-client';

@Injectable({ providedIn: 'root' })
export class ClientAccountService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  selectedClientCode = signal<string | null>(this.loadSelected());

  watchClients(): Observable<ClientAccount[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        return this.supabase.watchTable('client_accounts', () => this.listClients());
      })
    );
  }

  async listClients(): Promise<ClientAccount[]> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('client_accounts')
      .select('*')
      .eq('user_id', uid)
      .order('last_upload_at', { ascending: false });
    if (error) throw error;
    return rowsToCamel<ClientAccount>(data ?? []);
  }

  selectClient(clientCode: string): void {
    this.selectedClientCode.set(clientCode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SELECTED_CLIENT_KEY, clientCode);
    }
  }

  clearSelectedClient(): void {
    this.selectedClientCode.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SELECTED_CLIENT_KEY);
    }
  }

  private loadSelected(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SELECTED_CLIENT_KEY);
  }

  async registerClient(
    clientCode: string,
    clientName: string,
    tradeCount: number,
    summary?: Pick<ClientAccount, 'totalRealisedPnL' | 'totalNetPnL' | 'totalCharges' | 'periodLabel'>
  ): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return;
    const now = Date.now();
    const row = objectToSnake({
      userId: uid,
      clientCode,
      clientName,
      tradeCount,
      lastUploadAt: now,
      updatedAt: now,
      ...summary,
    });
    const { error } = await this.supabase.client.from('client_accounts').upsert(row);
    if (error) throw error;
    if (!this.selectedClientCode()) {
      this.selectClient(clientCode);
    }
  }

  async deleteClient(clientCode: string): Promise<void> {
    const uid = await this.auth.getDataUserId();
    if (!uid) return;
    const { error } = await this.supabase.client
      .from('client_accounts')
      .delete()
      .eq('user_id', uid)
      .eq('client_code', clientCode);
    if (error) throw error;
  }
}
