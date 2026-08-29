import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

export interface UserLevel {
  id: string;
  price: number;
  label: string;
}

export interface UserStockLevels {
  symbol: string;
  supports: UserLevel[];
  resistances: UserLevel[];
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class StockLevelsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  watch(symbol: string): Observable<UserStockLevels | undefined> {
    return this.auth.user$.pipe(
      switchMap((user) => {
        if (!user) return of(undefined);
        const ref = doc(this.firestore, 'users', user.uid, 'levels', symbol.toUpperCase());
        return docData(ref, { idField: 'symbol' }) as Observable<UserStockLevels | undefined>;
      })
    );
  }

  async save(symbol: string, levels: Pick<UserStockLevels, 'supports' | 'resistances'>): Promise<void> {
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to save levels');
    await setDoc(
      doc(this.firestore, 'users', uid, 'levels', symbol.toUpperCase()),
      {
        symbol: symbol.toUpperCase(),
        supports: levels.supports,
        resistances: levels.resistances,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  }

  async addLevel(symbol: string, type: 'support' | 'resistance', price: number, label: string): Promise<void> {
    const current = await this.get(symbol);
    const supports = [...(current?.supports ?? [])];
    const resistances = [...(current?.resistances ?? [])];
    const level: UserLevel = { id: crypto.randomUUID(), price, label };
    if (type === 'support') supports.push(level);
    else resistances.push(level);
    await this.save(symbol, { supports, resistances });
  }

  async removeLevel(symbol: string, type: 'support' | 'resistance', id: string): Promise<void> {
    const current = await this.get(symbol);
    if (!current) return;
    const supports =
      type === 'support' ? current.supports.filter((l) => l.id !== id) : current.supports;
    const resistances =
      type === 'resistance' ? current.resistances.filter((l) => l.id !== id) : current.resistances;
    await this.save(symbol, { supports, resistances });
  }

  private async get(symbol: string): Promise<UserStockLevels | undefined> {
    const uid = this.auth.uid;
    if (!uid) return undefined;
    return new Promise((resolve) => {
      const sub = this.watch(symbol).subscribe((v) => {
        sub.unsubscribe();
        resolve(v);
      });
    });
  }
}

export interface VolumeShockerActive {
  symbols: Array<{ symbol: string; rank: number; ratio: number; daysRemaining: number }>;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class VolumeShockerService {
  private firestore = inject(Firestore);

  watchActive(): Observable<VolumeShockerActive | undefined> {
    const ref = doc(this.firestore, 'volumeShockers', 'active');
    return docData(ref) as Observable<VolumeShockerActive | undefined>;
  }
}
