import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UnrealisedHolding, UnrealisedLot } from '../../../models/trade.models';
import { formatCurrency, formatDate, formatPct, formatPrice, pnlClass } from '../../../utils/format.utils';
import { TableSortState } from '../../../utils/table-sort.utils';
import { holdingsTotals } from '../../../utils/holdings.utils';

export type HoldingColumn =
  | 'stockName'
  | 'quantity'
  | 'avgBuyPrice'
  | 'closingPrice'
  | 'buyValue'
  | 'closingValue'
  | 'unrealisedPnL'
  | 'unrealisedPnLPct'
  | 'lots';

@Component({
  selector: 'app-holdings-table',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './holdings-table.component.html',
})
export class HoldingsTableComponent {
  holdings = input.required<UnrealisedHolding[]>();
  emptyMessage = input('No open holdings in the latest P&L file');

  readonly tableSort = new TableSortState('unrealisedPnL', 'desc');
  readonly lotSort = new TableSortState('buyDate', 'asc');
  expandedKey = signal<string | null>(null);

  readonly formatCurrency = formatCurrency;
  readonly formatPrice = formatPrice;
  readonly formatPct = formatPct;
  readonly formatDate = formatDate;
  readonly pnlClass = pnlClass;

  readonly columns: { key: HoldingColumn; label: string }[] = [
    { key: 'stockName', label: 'Stock' },
    { key: 'quantity', label: 'Qty' },
    { key: 'avgBuyPrice', label: 'Avg buy' },
    { key: 'closingPrice', label: 'Close' },
    { key: 'buyValue', label: 'Buy value' },
    { key: 'closingValue', label: 'Close value' },
    { key: 'lots', label: 'Lots' },
    { key: 'unrealisedPnL', label: 'Unrealised P&L' },
    { key: 'unrealisedPnLPct', label: 'P&L %' },
  ];

  readonly lotColumns = [
    { key: 'buyDate', label: 'Buy' },
    { key: 'quantity', label: 'Qty' },
    { key: 'buyPrice', label: 'Buy price' },
    { key: 'closingPrice', label: 'Close' },
    { key: 'unrealisedPnL', label: 'Unrealised P&L' },
  ];

  rows = computed(() =>
    this.tableSort.sort(this.holdings(), (holding, col) => this.sortValue(holding, col))
  );

  totals = computed(() => {
    const holdings = this.rows();
    if (!holdings.length) return null;
    return holdingsTotals(holdings);
  });

  toggleExpand(holding: UnrealisedHolding, event?: Event): void {
    event?.stopPropagation();
    const key = this.rowKey(holding);
    this.expandedKey.update((current) => (current === key ? null : key));
  }

  isExpanded(holding: UnrealisedHolding): boolean {
    return this.expandedKey() === this.rowKey(holding);
  }

  rowKey(holding: UnrealisedHolding): string {
    return holding.isin || holding.symbol || holding.stockName;
  }

  sortedLots(holding: UnrealisedHolding): UnrealisedLot[] {
    return this.lotSort.sort(holding.lots ?? [], (lot, col) => {
      switch (col) {
        case 'buyDate':
          return lot.buyDate;
        case 'quantity':
          return lot.quantity;
        case 'buyPrice':
          return lot.buyPrice;
        case 'closingPrice':
          return lot.closingPrice;
        case 'unrealisedPnL':
          return lot.unrealisedPnL;
        default:
          return 0;
      }
    });
  }

  private sortValue(holding: UnrealisedHolding, col: string): string | number {
    switch (col) {
      case 'stockName':
        return holding.stockName;
      case 'quantity':
        return holding.quantity;
      case 'avgBuyPrice':
        return holding.avgBuyPrice;
      case 'closingPrice':
        return holding.closingPrice;
      case 'buyValue':
        return holding.buyValue;
      case 'closingValue':
        return holding.closingValue;
      case 'lots':
        return holding.lots?.length ?? 0;
      case 'unrealisedPnLPct':
        return holding.unrealisedPnLPct;
      default:
        return holding.unrealisedPnL;
    }
  }

  responsiveClass(key: HoldingColumn): string {
    if (key === 'stockName' || key === 'unrealisedPnL') return '';
    if (key === 'quantity' || key === 'unrealisedPnLPct') return 'hidden sm:table-cell';
    return 'hidden lg:table-cell';
  }
}
