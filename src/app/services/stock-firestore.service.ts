import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { StockSnapshot } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class StockFirestoreService {
  private firestore = inject(Firestore);

  watchAllStocks(): Observable<StockSnapshot[]> {
    const ref = collection(this.firestore, 'stocks');
    return collectionData(ref, { idField: 'symbol' }).pipe(
      map((docs) => docs as StockSnapshot[])
    );
  }

  watchStock(symbol: string): Observable<StockSnapshot | undefined> {
    const ref = doc(this.firestore, 'stocks', symbol.toUpperCase());
    return docData(ref, { idField: 'symbol' }) as Observable<StockSnapshot | undefined>;
  }

  watchStocksBySymbols(symbols: string[]): Observable<StockSnapshot[]> {
    return this.watchAllStocks().pipe(
      map((stocks) => {
        const set = new Set(symbols.map((s) => s.toUpperCase()));
        return stocks.filter((s) => set.has(s.symbol));
      })
    );
  }
}
