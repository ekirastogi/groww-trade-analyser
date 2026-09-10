import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StockSummary } from '../../../models/trade.models';
import { formatCurrency, formatPct, pnlClass } from '../../../utils/format.utils';
import { normalizeSymbol } from '../../../utils/upload-merge.utils';

export type StockBreakdownColumn =
  | 'stockName'
  | 'tradeCount'
  | 'quantity'
  | 'buyValue'
  | 'sellValue'
  | 'realisedPnL'
  | 'realisedPnLPct'
  | 'allocatedCharges'
  | 'netPnL'
  | 'winRate';

type SortDir = 'asc' | 'desc';

/**
 * Per-stock breakdown table matching the dashboard's look and sorting behaviour, so the
 * same stock figures read identically wherever they appear.
 */
@Component({
  selector: 'app-stock-breakdown-table',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './stock-breakdown-table.component.html',
})
export class StockBreakdownTableComponent {
  stocks = input.required<StockSummary[]>();
  emptyMessage = input('No stock data for current filters');

  readonly columns: { key: StockBreakdownColumn; label: string }[] = [
    { key: 'stockName', label: 'Stock' },
    { key: 'tradeCount', label: 'Trades' },
    { key: 'quantity', label: 'Qty' },
    { key: 'buyValue', label: 'Buy Value' },
    { key: 'sellValue', label: 'Sell Value' },
    { key: 'realisedPnL', label: 'P&L' },
    { key: 'realisedPnLPct', label: 'P&L %' },
    { key: 'allocatedCharges', label: 'Charges' },
    { key: 'netPnL', label: 'Net P&L' },
    { key: 'winRate', label: 'Win %' },
  ];

  sortColumn = signal<StockBreakdownColumn>('netPnL');
  sortDirection = signal<SortDir>('desc');

  readonly formatCurrency = formatCurrency;
  readonly formatPct = formatPct;
  readonly pnlClass = pnlClass;

  rows = computed(() => {
    const key = this.sortColumn();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    return [...this.stocks()].sort((a, b) => {
      if (key === 'stockName') return a.stockName.localeCompare(b.stockName) * dir;
      return ((this.metric(a, key) - this.metric(b, key)) as number) * dir;
    });
  });

  totals = computed(() => {
    const stocks = this.rows();
    if (!stocks.length) return null;

    const sum = (pick: (s: StockSummary) => number) =>
      stocks.reduce((acc, stock) => acc + pick(stock), 0);
    const buyValue = sum((s) => s.buyValue);
    const realisedPnL = sum((s) => s.realisedPnL);

    return {
      stockCount: stocks.length,
      tradeCount: sum((s) => s.tradeCount),
      quantity: sum((s) => s.quantity),
      buyValue,
      sellValue: sum((s) => s.sellValue),
      realisedPnL,
      // Stored as a fraction; formatPct scales it to a percentage for display.
      realisedPnLPct: buyValue > 0 ? realisedPnL / buyValue : 0,
      allocatedCharges: sum((s) => s.allocatedCharges),
      netPnL: sum((s) => s.netPnL),
    };
  });

  private metric(stock: StockSummary, key: StockBreakdownColumn): number {
    switch (key) {
      case 'tradeCount':
        return stock.tradeCount;
      case 'quantity':
        return stock.quantity;
      case 'buyValue':
        return stock.buyValue;
      case 'sellValue':
        return stock.sellValue;
      case 'realisedPnL':
        return stock.realisedPnL;
      case 'realisedPnLPct':
        return stock.realisedPnLPct;
      case 'allocatedCharges':
        return stock.allocatedCharges;
      case 'winRate':
        return stock.winRate ?? -1;
      default:
        return stock.netPnL;
    }
  }

  toggleSort(column: StockBreakdownColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortColumn.set(column);
    this.sortDirection.set(column === 'stockName' ? 'asc' : 'desc');
  }

  sortIndicator(column: StockBreakdownColumn): string {
    if (this.sortColumn() !== column) return '';
    return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  isSortedColumn(column: StockBreakdownColumn): boolean {
    return this.sortColumn() === column;
  }

  stockSymbol(stock: StockSummary): string {
    return normalizeSymbol(stock.stockName);
  }

  /** Keeps the widest columns off small screens, matching the dashboard table. */
  responsiveClass(key: StockBreakdownColumn): string {
    if (key === 'stockName' || key === 'netPnL') return '';
    if (key === 'tradeCount' || key === 'realisedPnL') return 'hidden sm:table-cell';
    return 'hidden lg:table-cell';
  }

  cellClass(key: StockBreakdownColumn, stock: StockSummary): string {
    const base = 'text-right tabular-nums';
    switch (key) {
      case 'realisedPnL':
      case 'realisedPnLPct':
        return `${base} ${pnlClass(stock.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} font-semibold ${pnlClass(stock.netPnL)}`;
      default:
        return base;
    }
  }

  totalsCellClass(key: StockBreakdownColumn): string {
    const totals = this.totals();
    const base = 'text-right tabular-nums font-semibold';
    if (!totals) return base;
    switch (key) {
      case 'realisedPnL':
      case 'realisedPnLPct':
        return `${base} ${pnlClass(totals.realisedPnL)}`;
      case 'allocatedCharges':
        return `${base} text-red-600`;
      case 'netPnL':
        return `${base} ${pnlClass(totals.netPnL)}`;
      default:
        return base;
    }
  }
}
