import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { WatchlistService } from '../../services/watchlist.service';
import { StockFirestoreService } from '../../services/stock-firestore.service';
import { AuthService } from '../../services/auth.service';
import { Watchlist } from '../../models/watchlist.models';

@Component({
  selector: 'app-watchlists',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './watchlists.component.html',
})
export class WatchlistsComponent {
  private watchlistSvc = inject(WatchlistService);
  private stockSvc = inject(StockFirestoreService);
  readonly auth = inject(AuthService);

  watchlists = toSignal(this.watchlistSvc.watchAll(), { initialValue: [] as Watchlist[] });
  stocks = toSignal(this.stockSvc.watchAllStocks(), { initialValue: [] });

  newName = '';
  newSymbol = '';
  selectedWatchlistId = signal<string | null>(null);
  error = signal<string | null>(null);

  async createWatchlist(): Promise<void> {
    if (!this.newName.trim()) return;
    try {
      const lists = this.watchlists();
      await this.watchlistSvc.create({
        name: this.newName.trim(),
        type: 'manual',
        color: '#6366f1',
        sortOrder: lists.length,
        stockSymbols: [],
      });
      this.newName = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to create watchlist');
    }
  }

  async addSymbol(wl: Watchlist): Promise<void> {
    if (!this.newSymbol.trim()) return;
    try {
      await this.watchlistSvc.addSymbol(wl.id, this.newSymbol.trim(), wl.stockSymbols);
      this.newSymbol = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add symbol');
    }
  }

  async removeSymbol(wl: Watchlist, symbol: string): Promise<void> {
    await this.watchlistSvc.removeSymbol(wl.id, symbol, wl.stockSymbols);
  }

  async deleteWatchlist(id: string): Promise<void> {
    await this.watchlistSvc.remove(id);
  }

  stockPrice(symbol: string): string {
    const s = this.stocks().find((x) => x.symbol === symbol);
    return s ? `₹${s.ltp?.toFixed(2)} (${s.changePct?.toFixed(2)}%)` : '—';
  }
}
