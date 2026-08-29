import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { TradeSuggestion } from '../models/signal.models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class RecommendationService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'recommendations');

  watchTopPending(limitCount = 20): Observable<TradeSuggestion[]> {
    const q = query(
      this.col,
      where('approvalStatus', '==', 'pending'),
      orderBy('confidence', 'desc'),
      limit(limitCount)
    );
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  watchByHorizon(horizon: 'intraday' | 'btst', limitCount = 20): Observable<TradeSuggestion[]> {
    const q = query(
      this.col,
      where('approvalStatus', '==', 'pending'),
      where('horizon', '==', horizon),
      orderBy('confidence', 'desc'),
      limit(limitCount)
    );
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  watchAll(): Observable<TradeSuggestion[]> {
    const q = query(this.col, orderBy('createdAt', 'desc'), limit(100));
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  watchPending(): Observable<TradeSuggestion[]> {
    return this.watchTopPending(50);
  }

  watchHistory(): Observable<TradeSuggestion[]> {
    const q = query(
      this.col,
      where('status', 'in', ['executed', 'hit_target', 'hit_sl', 'expired', 'rejected']),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  async approve(id: string): Promise<void> {
    const uid = this.auth.uid;
    await updateDoc(doc(this.firestore, 'recommendations', id), {
      approvalStatus: 'approved',
      status: 'pending_approval',
      approvedAt: new Date().toISOString(),
      approvedBy: uid,
    });
  }

  async reject(id: string): Promise<void> {
    const uid = this.auth.uid;
    await updateDoc(doc(this.firestore, 'recommendations', id), {
      approvalStatus: 'rejected',
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: uid,
    });
  }
}
