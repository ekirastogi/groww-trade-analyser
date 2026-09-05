import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReportStateService } from '../../../services/report-state.service';
import { FilterUrlService } from '../../../services/filter-url.service';
import { formatDate } from '../../../utils/format.utils';
import {
  DATE_RANGE_PRESETS,
  DateRangePresetId,
  detectDateRangePreset,
  rangeForPreset,
} from '../../../utils/date-range-preset.utils';

@Component({
  selector: 'app-date-range-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './date-range-filter.component.html',
})
export class DateRangeFilterComponent {
  readonly state = inject(ReportStateService);
  private filterUrl = inject(FilterUrlService);

  /** Toolbar (default) vs stacked layout inside a filter card. */
  variant = input<'toolbar' | 'panel'>('toolbar');

  readonly presets = DATE_RANGE_PRESETS;
  readonly formatDate = formatDate;

  bounds = computed(() => {
    const range = this.state.report()?.dateRange;
    return { min: range?.min ?? '', max: range?.max ?? '' };
  });

  activePreset = computed(() =>
    detectDateRangePreset(this.state.startDate(), this.state.endDate(), this.bounds())
  );

  rangeCaption = computed(() => {
    const start = this.state.startDate();
    const end = this.state.endDate();
    if (!start || !end) return '';
    return `${formatDate(start)} – ${formatDate(end)}`;
  });

  isPresetActive(id: DateRangePresetId): boolean {
    return this.activePreset() === id;
  }

  selectPreset(id: DateRangePresetId): void {
    const report = this.state.report();
    if (!report) return;
    const range = rangeForPreset(id, this.bounds());
    this.filterUrl.updateDateRange(range.start, range.end, this.state.selectedTradeTypes());
  }

  onCustomDateChange(which: 'start' | 'end', value: string): void {
    const report = this.state.report();
    if (!report || !value) return;
    const start = which === 'start' ? value : this.state.startDate();
    const end = which === 'end' ? value : this.state.endDate();
    this.filterUrl.updateDateRange(start, end, this.state.selectedTradeTypes());
  }
}
