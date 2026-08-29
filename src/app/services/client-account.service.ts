import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { Observable, of, switchMap } from 'rxjs';

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
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  selectedClientCode = signal<string | null>(this.loadSelected());

  watchClients(): Observable<ClientAccount[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const ref = collection(this.firestore, 'users', user.uid, 'clients');
        return collectionData(query(ref, orderBy('lastUploadAt', 'desc')), {
          idField: 'clientCode',
        }) as Observable<ClientAccount[]>;
      })
    );
  }

  async listClients(): Promise<ClientAccount[]> {
    const uid = this.auth.uid;
    if (!uid) return [];
    const ref = collection(this.firestore, 'users', uid, 'clients');
    const snap = await getDocs(query(ref, orderBy('lastUploadAt', 'desc')));
    return snap.docs.map((d) => d.data() as ClientAccount);
  }

  selectClient(clientCode: string): void {
    this.selectedClientCode.set(clientCode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SELECTED_CLIENT_KEY, clientCode);
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
    const uid = this.auth.uid;
    if (!uid) return;
    const now = Date.now();
    await setDoc(
      doc(this.firestore, 'users', uid, 'clients', clientCode),
      {
        clientCode,
        clientName,
        tradeCount,
        lastUploadAt: now,
        updatedAt: now,
        ...summary,
      },
      { merge: true }
    );
    if (!this.selectedClientCode()) {
      this.selectClient(clientCode);
    }
  }

  clientCol(clientCode: string, name: string) {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Not authenticated');
    return collection(this.firestore, 'users', uid, 'clients', clientCode, name);
  }
}
