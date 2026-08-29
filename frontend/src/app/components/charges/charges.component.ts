import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { formatCurrency } from '../../utils/format.utils';
import { FilterPanelComponent } from '../shared/filter-panel/filter-panel.component';
import { ReportHistoryComponent } from '../shared/report-history/report-history.component';

type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-charges',
  standalone: true,
  imports: [CommonModule, RouterLink, FilterPanelComponent, ReportHistoryComponent],
  templateUrl: './charges.component.html',
})
export class ChargesComponent {
  readonly state = inject(ReportStateService);
  readonly formatCurrency = formatCurrency;

  sortColumn = signal('amount');
  sortDirection = signal<SortDir>('desc');

  analysis = computed(() => this.state.analysis());

  readonly chargeColumns = [
    { key: 'label', label: 'Charge Type' },
    { key: 'amount', label: 'Amount' },
  ];

  sortedChargeData = computed(() => {
    const items = (this.analysis()?.charges.items ?? []).filter((i) => i.label !== 'Total');
    const column = this.sortColumn();
    const direction = this.sortDirection();
    return [...items].sort((a, b) => {
      const av = column === 'label' ? a.label.toLowerCase() : a.amount;
      const bv = column === 'label' ? b.label.toLowerCase() : b.amount;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return direction === 'asc' ? cmp : -cmp;
    });
  });

  toggleSort(column: string): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.sortColumn.set(column);
    this.sortDirection.set(column === 'label' ? 'asc' : 'desc');
  }

  sortIndicator(column: string): string {
    if (this.sortColumn() !== column) return '';
    return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  isSortedColumn(column: string): boolean {
    return this.sortColumn() === column;
  }
}
