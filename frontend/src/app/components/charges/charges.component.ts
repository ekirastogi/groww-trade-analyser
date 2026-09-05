import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { formatCurrency } from '../../utils/format.utils';
import { FilterPanelComponent } from '../shared/filter-panel/filter-panel.component';
import { DateRangeFilterComponent } from '../shared/date-range-filter/date-range-filter.component';
import { ReportHistoryComponent } from '../shared/report-history/report-history.component';
import { ChargesCalculatorComponent } from '../utils/charges-calculator.component';
import { readJson, writeJson } from '../../utils/local-store.utils';

type SortDir = 'asc' | 'desc';
type ChargesTab = 'statement' | 'calculator';

const TAB_STORAGE_KEY = 'kairo-charges-tab';

@Component({
  selector: 'app-charges',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FilterPanelComponent,
    DateRangeFilterComponent,
    ReportHistoryComponent,
    ChargesCalculatorComponent,
  ],
  templateUrl: './charges.component.html',
})
export class ChargesComponent implements OnInit {
  readonly state = inject(ReportStateService);
  readonly formatCurrency = formatCurrency;

  sortColumn = signal('amount');
  sortDirection = signal<SortDir>('desc');

  readonly tabs: { id: ChargesTab; label: string }[] = [
    { id: 'statement', label: 'Statement charges' },
    { id: 'calculator', label: 'Trade calculator' },
  ];
  tab = signal<ChargesTab>(readJson<ChargesTab>(TAB_STORAGE_KEY, 'statement'));

  setTab(tab: ChargesTab): void {
    this.tab.set(tab);
    writeJson(TAB_STORAGE_KEY, tab);
  }

  analysis = computed(() => this.state.analysis());

  async ngOnInit(): Promise<void> {
    await this.state.ensureLoadedFromFirebase();
  }

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
