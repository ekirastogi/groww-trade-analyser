import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { RegistryStock } from '../models/trading-journal.models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class RegistryStockService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  watchAll(): Observable<RegistryStock[]> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const q = query(
          collection(this.firestore, 'users', user.uid, 'registryStocks'),
          orderBy('symbol', 'asc')
        );
        return collectionData(q, { idField: 'symbol' }) as Observable<RegistryStock[]>;
      })
    );
  }

  async listAll(): Promise<RegistryStock[]> {
    await this.auth.whenReady();
    const uid = this.auth.uid;
    if (!uid) return [];
    const q = query(
      collection(this.firestore, 'users', uid, 'registryStocks'),
      orderBy('symbol', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ symbol: d.id, ...d.data() }) as RegistryStock);
  }

  async save(stock: Omit<RegistryStock, 'updatedAt'>): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to save stocks');
    const symbol = stock.symbol.trim().toUpperCase();
    if (!symbol) throw new Error('Symbol is required');

    const payload: RegistryStock = {
      ...stock,
      symbol,
      name: stock.name.trim() || symbol,
      supports: (stock.supports ?? []).slice(0, 3).map(Number),
      resistances: (stock.resistances ?? []).slice(0, 3).map(Number),
      updatedAt: Date.now(),
    };
    await setDoc(doc(this.firestore, 'users', uid, 'registryStocks', symbol), payload);
  }

  async remove(symbol: string): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to delete stocks');
    await deleteDoc(doc(this.firestore, 'users', uid, 'registryStocks', symbol.toUpperCase()));
  }

  async deleteAll(): Promise<number> {
    const uid = this.auth.uid;
    if (!uid) return 0;
    const snap = await getDocs(collection(this.firestore, 'users', uid, 'registryStocks'));
    if (snap.empty) return 0;
    const batch = writeBatch(this.firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }
}
