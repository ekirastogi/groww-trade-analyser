import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportStateService } from '../../../services/report-state.service';
import { TRADE_TYPE_LABELS, TradeType } from '../../../models/trade.models';

@Component({
  selector: 'app-trade-type-filter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Trade type</p>
          <p class="text-[11px] text-slate-400">Filter stocks and tiers by how trades were placed</p>
        </div>
        @if (hasDateFilter()) {
          <button type="button" class="text-xs text-kairo-600 hover:underline" (click)="resetFilters()">Reset filters</button>
        }
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        @for (type of availableTypes(); track type) {
          <button
            type="button"
            class="chip"
            [class.chip-active]="isSelected(type)"
            [class.chip-inactive]="!isSelected(type)"
            (click)="toggle(type)"
          >
            {{ labels[type] || type }}
          </button>
        }
      </div>
    </div>
  `,
})
export class TradeTypeFilterComponent {
  readonly state = inject(ReportStateService);
  readonly labels = TRADE_TYPE_LABELS;

  availableTypes = computed(() => {
    const types = this.state.report()?.tradeTypes ?? ['all'];
    return types.filter((t) => t !== 'all' && t !== 'same_day' && t !== 'fno');
  });

  isSelected(type: TradeType): boolean {
    const selected = this.state.selectedTradeTypes();
    if (selected.includes('all')) return false;
    return selected.includes(type);
  }

  hasDateFilter(): boolean {
    const report = this.state.report();
    if (!report) return false;
    return (
      this.state.startDate() !== report.dateRange.min ||
      this.state.endDate() !== report.dateRange.max ||
      !this.state.selectedTradeTypes().includes('all')
    );
  }

  toggle(type: TradeType): void {
    const current = this.state.selectedTradeTypes().filter((t) => t !== 'all');
    const idx = current.indexOf(type);
    let next: TradeType[];

    if (idx >= 0) {
      next = current.filter((t) => t !== type);
      if (!next.length) next = ['all'];
    } else {
      next = [...current.filter((t) => t !== 'all'), type];
    }

    this.state.applyFilters(this.state.startDate(), this.state.endDate(), next);
  }

  resetFilters(): void {
    this.state.resetFilters();
  }
}
