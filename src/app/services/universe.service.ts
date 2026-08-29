import { Injectable, inject } from '@angular/core';
import { Firestore, doc, writeBatch } from '@angular/fire/firestore';
import { AuthService } from './auth.service';

export interface UniverseEntry {
  symbol: string;
  name?: string;
  isin?: string;
  source: 'pnl_upload' | 'seed' | 'manual';
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class UniverseService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  async syncSymbols(
    symbols: Array<{ symbol: string; name?: string; isin?: string }>,
    source: UniverseEntry['source'] = 'pnl_upload'
  ): Promise<number> {
    await this.auth.whenReady();
    if (!this.auth.uid) return 0;

    const now = Date.now();
    const batch = writeBatch(this.firestore);
    let count = 0;
    const seen = new Set<string>();

    for (const entry of symbols) {
      const sym = entry.symbol.toUpperCase().trim();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      batch.set(
        doc(this.firestore, 'universe', sym),
        {
          symbol: sym,
          name: entry.name ?? sym,
          isin: entry.isin ?? '',
          source,
          updatedAt: now,
        },
        { merge: true }
      );
      count++;
    }
    if (count > 0) {
      await batch.commit();
    }
    return count;
  }
}
