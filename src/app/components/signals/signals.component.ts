import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RecommendationService } from '../../services/recommendation.service';
import { VolumeShockerService } from '../../services/stock-levels.service';
import { AuthService } from '../../services/auth.service';
import { TradeHorizon, TradeSuggestion } from '../../models/signal.models';
import { formatCurrency, formatPct } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

type HorizonFilter = 'all' | TradeHorizon;

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './signals.component.html',
})
export class SignalsComponent {
  private recSvc = inject(RecommendationService);
  private shockerSvc = inject(VolumeShockerService);
  readonly auth = inject(AuthService);

  recommendations = toSignal(this.recSvc.watchTopPending(30), { initialValue: [] as TradeSuggestion[] });
  shockers = toSignal(this.shockerSvc.watchActive(), { initialValue: undefined });
  horizonFilter = signal<HorizonFilter>('all');
  processing = signal<string | null>(null);
  error = signal<string | null>(null);
  fmt = formatCurrency;
  fmtPct = formatPct;
  readonly tableSort = new TableSortState('createdAt', 'desc');

  readonly historyColumns = [
    { key: 'createdAt', label: 'Time', align: 'left' as const },
    { key: 'symbol', label: 'Symbol', align: 'left' as const },
    { key: 'horizon', label: 'Style', align: 'left' as const },
    { key: 'entry', label: 'Entry', align: 'left' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
    { key: 'outcomePct', label: 'Outcome', align: 'right' as const },
  ];

  ranked = computed(() => {
    const filter = this.horizonFilter();
    let recs = [...this.recommendations()];
    if (filter !== 'all') {
      recs = recs.filter((r) => (r.horizon ?? 'intraday') === filter);
    }
    return recs.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  });

  shockerList = computed(() => this.shockers()?.symbols ?? []);

  async approve(rec: TradeSuggestion): Promise<void> {
    this.processing.set(rec.id);
    this.error.set(null);
    try {
      await this.recSvc.approve(rec.id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      this.processing.set(null);
    }
  }

  async reject(rec: TradeSuggestion): Promise<void> {
    this.processing.set(rec.id);
    try {
      await this.recSvc.reject(rec.id);
    } finally {
      this.processing.set(null);
    }
  }

  setHorizon(h: HorizonFilter): void {
    this.horizonFilter.set(h);
  }

  horizonLabel(rec: TradeSuggestion): string {
    return (rec.horizon ?? 'intraday').toUpperCase();
  }

  vsIndexLine(rec: TradeSuggestion): string {
    const parts: string[] = [];
    if (rec.vsNiftyPct != null) parts.push(`Nifty ${rec.vsNiftyPct >= 0 ? '+' : ''}${rec.vsNiftyPct.toFixed(2)}%`);
    if (rec.vsCapIndexPct != null) parts.push(`Cap ${rec.vsCapIndexPct >= 0 ? '+' : ''}${rec.vsCapIndexPct.toFixed(2)}%`);
    if (rec.vsSectorPct != null) parts.push(`${rec.sector ?? 'Sector'} ${rec.vsSectorPct >= 0 ? '+' : ''}${rec.vsSectorPct.toFixed(2)}%`);
    return parts.join(' · ');
  }

  statusClass(rec: TradeSuggestion): string {
    const s = rec.approvalStatus ?? rec.status;
    if (s === 'executed' || s === 'hit_target') return 'text-emerald-600 bg-emerald-50';
    if (s === 'rejected' || s === 'hit_sl') return 'text-red-600 bg-red-50';
    if (s === 'approved' || s === 'executing') return 'text-amber-600 bg-amber-50';
    return 'text-blue-600 bg-blue-50';
  }
}
