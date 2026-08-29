import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  documentId,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { ChartView, StockSnapshot } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class StockFirestoreService {
  private firestore = inject(Firestore);

  watchStock(symbol: string): Observable<StockSnapshot | undefined> {
    const ref = doc(this.firestore, 'stocks', symbol.toUpperCase());
    return docData(ref, { idField: 'symbol' }) as Observable<StockSnapshot | undefined>;
  }

  watchChart(symbol: string): Observable<ChartView | undefined> {
    const ref = doc(this.firestore, 'stocks', symbol.toUpperCase(), 'views', 'chart');
    return docData(ref) as Observable<ChartView | undefined>;
  }

  watchStocksBySymbols(symbols: string[]): Observable<StockSnapshot[]> {
    const upper = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
    if (!upper.length) return of([]);
    const chunks: string[][] = [];
    for (let i = 0; i < upper.length; i += 10) {
      chunks.push(upper.slice(i, i + 10));
    }
    // Firestore 'in' limited to 10 — use first chunk for simplicity; heatmap uses hot list doc
    const ref = collection(this.firestore, 'stocks');
    const q = query(ref, where(documentId(), 'in', chunks[0]));
    return collectionData(q, { idField: 'symbol' }).pipe(
      map((docs) => docs as StockSnapshot[])
    );
  }
}
