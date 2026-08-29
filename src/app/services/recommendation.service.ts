import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
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

  watchAll(): Observable<TradeSuggestion[]> {
    const q = query(this.col, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  watchPending(): Observable<TradeSuggestion[]> {
    const q = query(
      this.col,
      where('approvalStatus', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );
    return collectionData(q, { idField: 'id' }) as Observable<TradeSuggestion[]>;
  }

  watchHistory(): Observable<TradeSuggestion[]> {
    const q = query(
      this.col,
      where('status', 'in', ['executed', 'hit_target', 'hit_sl', 'expired', 'rejected']),
      orderBy('createdAt', 'desc')
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
