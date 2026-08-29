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
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Watchlist } from '../models/watchlist.models';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private firestore = inject(Firestore);
  private col = collection(this.firestore, 'watchlists');

  watchAll(): Observable<Watchlist[]> {
    const q = query(this.col, orderBy('sortOrder', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<Watchlist[]>;
  }

  async create(watchlist: Omit<Watchlist, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const now = Date.now();
    const ref = await addDoc(this.col, { ...watchlist, createdAt: now, updatedAt: now });
    return ref.id;
  }

  async update(id: string, data: Partial<Watchlist>): Promise<void> {
    await updateDoc(doc(this.firestore, 'watchlists', id), { ...data, updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'watchlists', id));
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

  async seedDefaults(profitable: string[], lossMaking: string[]): Promise<void> {
    const now = Date.now();
    await setDoc(doc(this.firestore, 'watchlists', 'profitable'), {
      name: 'Profitable',
      type: 'pnl_derived',
      color: '#10b981',
      sortOrder: 0,
      stockSymbols: profitable,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    await setDoc(doc(this.firestore, 'watchlists', 'loss-making'), {
      name: 'Loss Making',
      type: 'pnl_derived',
      color: '#ef4444',
      sortOrder: 1,
      stockSymbols: lossMaking,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
  }
}
