import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RecommendationService } from '../../services/recommendation.service';
import { AuthService } from '../../services/auth.service';
import { TradeSuggestion } from '../../models/signal.models';
import { formatCurrency } from '../../utils/format.utils';
import { TableSortState } from '../../utils/table-sort.utils';

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './signals.component.html',
})
export class SignalsComponent {
  private recSvc = inject(RecommendationService);
  readonly auth = inject(AuthService);

  recommendations = toSignal(this.recSvc.watchAll(), { initialValue: [] as TradeSuggestion[] });
  processing = signal<string | null>(null);
  error = signal<string | null>(null);
  fmt = formatCurrency;
  readonly tableSort = new TableSortState('createdAt', 'desc');

  readonly historyColumns = [
    { key: 'createdAt', label: 'Time', align: 'left' as const },
    { key: 'symbol', label: 'Symbol', align: 'left' as const },
    { key: 'side', label: 'Side', align: 'left' as const },
    { key: 'entry', label: 'Entry', align: 'left' as const },
    { key: 'status', label: 'Status', align: 'left' as const },
    { key: 'outcomePct', label: 'Outcome', align: 'right' as const },
  ];

  pending(recs: TradeSuggestion[]) {
    return recs.filter((r) => r.approvalStatus === 'pending' || r.status === 'pending_approval');
  }

  history(recs: TradeSuggestion[]) {
    return recs.filter((r) => r.approvalStatus !== 'pending' && r.status !== 'pending_approval');
  }

  sortedHistory = computed(() =>
    this.tableSort.sort(this.history(this.recommendations()), (rec, col) => {
      switch (col) {
        case 'createdAt':
          return rec.createdAt ?? 0;
        case 'symbol':
          return rec.symbol.toLowerCase();
        case 'side':
          return rec.side;
        case 'entry':
          return rec.entry;
        case 'status':
          return rec.approvalStatus ?? rec.status;
        case 'outcomePct':
          return rec.outcomePct ?? -Infinity;
        default:
          return 0;
      }
    })
  );

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

  statusClass(rec: TradeSuggestion): string {
    const s = rec.approvalStatus ?? rec.status;
    if (s === 'executed' || s === 'hit_target') return 'text-emerald-600 bg-emerald-50';
    if (s === 'rejected' || s === 'hit_sl') return 'text-red-600 bg-red-50';
    if (s === 'approved' || s === 'executing') return 'text-amber-600 bg-amber-50';
    return 'text-blue-600 bg-blue-50';
  }
}
