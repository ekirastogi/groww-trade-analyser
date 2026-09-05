import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegistryStock } from '../../models/trading-journal.models';
import { formatFetchedAt, formatDataAge } from '../../utils/data-age.utils';

@Component({
  selector: 'app-screener-fundamentals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './screener-fundamentals.component.html',
})
export class ScreenerFundamentalsComponent {
  @Input({ required: true }) stock!: RegistryStock;

  formatFetchedAt = formatFetchedAt;
  formatDataAge = formatDataAge;

  formatPct(value: number | undefined): string {
    if (value == null || Number.isNaN(value)) return '—';
    return `${value}%`;
  }
}
