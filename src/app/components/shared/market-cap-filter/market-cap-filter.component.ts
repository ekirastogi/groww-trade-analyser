import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MARKET_CAP_LABELS,
  MARKET_CAP_TIERS,
  MarketCapTier,
} from '../../../utils/market-cap.utils';

@Component({
  selector: 'app-market-cap-filter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-wrap items-center gap-1">
      @for (tier of tiers; track tier) {
        <button
          type="button"
          class="chip !px-2 !py-0.5 !text-[11px]"
          [class.chip-active]="isSelected(tier)"
          [class.chip-inactive]="!isSelected(tier)"
          (click)="toggle(tier)"
        >
          {{ labels[tier] }}
        </button>
      }
    </div>
  `,
})
export class MarketCapFilterComponent {
  readonly tiers = MARKET_CAP_TIERS;
  readonly labels = MARKET_CAP_LABELS;

  selected = input<MarketCapTier[]>([]);
  selectedChange = output<MarketCapTier[]>();

  isSelected(tier: MarketCapTier): boolean {
    return this.selected().includes(tier);
  }

  toggle(tier: MarketCapTier): void {
    const current = this.selected();
    const next = current.includes(tier)
      ? current.filter((t) => t !== tier)
      : [...current, tier];
    this.selectedChange.emit(next);
  }
}
