import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { StockProfile } from '../models/trade.models';
import { Watchlist } from '../models/watchlist.models';
import { AuthService } from './auth.service';
import { PNL_WATCHLIST_TIERS, symbolsForPnlTier } from '../utils/pnl-watchlist.utils';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  watchAll(): Observable<Watchlist[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const q = query(
          collection(this.firestore, 'users', user.uid, 'watchlists'),
          orderBy('sortOrder', 'asc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<Watchlist[]>;
      })
    );
  }

  async create(watchlist: Omit<Watchlist, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to manage watchlists');
    const now = Date.now();
    const ref = await addDoc(collection(this.firestore, 'users', uid, 'watchlists'), {
      ...watchlist,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  }

  async update(id: string, data: Partial<Watchlist>): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to manage watchlists');
    await updateDoc(doc(this.firestore, 'users', uid, 'watchlists', id), {
      ...data,
      updatedAt: Date.now(),
    });
  }

  async remove(id: string): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to manage watchlists');
    await deleteDoc(doc(this.firestore, 'users', uid, 'watchlists', id));
  }

  async addSymbol(id: string, symbol: string, current: string[]): Promise<void> {
    const sym = symbol.toUpperCase();
    if (current.includes(sym)) return;
    await this.update(id, { stockSymbols: [...current, sym] });
  }

  async removeSymbol(id: string, symbol: string, current: string[]): Promise<void> {
    await this.update(id, {
      stockSymbols: current.filter((s) => s !== symbol.toUpperCase()),
    });
  }

  async syncPnlTierWatchlists(profiles: StockProfile[]): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) return;

    const now = Date.now();
    const batch = writeBatch(this.firestore);
    for (const tier of PNL_WATCHLIST_TIERS) {
      const stockSymbols = symbolsForPnlTier(profiles, tier);
      batch.set(
        doc(this.firestore, 'users', uid, 'watchlists', tier.id),
        {
          name: tier.name,
          type: 'pnl_derived',
          color: tier.color,
          sortOrder: tier.sortOrder,
          stockSymbols,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  async deleteAutoWatchlists(): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) return;

    const batch = writeBatch(this.firestore);
    for (const tier of PNL_WATCHLIST_TIERS) {
      batch.delete(doc(this.firestore, 'users', uid, 'watchlists', tier.id));
    }
    await batch.commit().catch(() => undefined);
  }

  isAutoWatchlist(watchlist: Watchlist): boolean {
    return watchlist.type === 'pnl_derived';
  }
}
