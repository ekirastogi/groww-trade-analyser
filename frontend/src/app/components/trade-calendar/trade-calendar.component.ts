import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { TradePlanService } from '../../services/trade-plan.service';
import { DayTradeSummary } from '../../models/trading-journal.models';
import { formatCurrency, pnlClass } from '../../utils/format.utils';

@Component({
  selector: 'app-trade-calendar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './trade-calendar.component.html',
})
export class TradeCalendarComponent {
  private planSvc = inject(TradePlanService);

  viewYear = signal(new Date().getFullYear());
  viewMonth = signal(new Date().getMonth() + 1);
  selectedDate = signal<string | null>(null);

  monthKey = computed(() => ({ year: this.viewYear(), month: this.viewMonth() }));

  summaries = toSignal(
    toObservable(this.monthKey).pipe(
      switchMap(({ year, month }) => this.planSvc.daySummariesForMonth$(year, month))
    ),
    { initialValue: [] as DayTradeSummary[] }
  );

  summaryByDate = computed(() => {
    const map = new Map<string, DayTradeSummary>();
    for (const s of this.summaries()) {
      map.set(s.tradeDate, s);
    }
    return map;
  });

  calendarWeeks = computed(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const first = new Date(year, month - 1, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: Array<{ date: string | null; day: number | null }> = [];
    for (let i = 0; i < startPad; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    const weeks: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  selectedSummary = computed(() => {
    const d = this.selectedDate();
    if (!d) return null;
    return this.summaryByDate().get(d) ?? null;
  });

  fmt = formatCurrency;
  pnlClass = pnlClass;

  monthLabel(): string {
    return new Date(this.viewYear(), this.viewMonth() - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
  }

  prevMonth(): void {
    if (this.viewMonth() === 1) {
      this.viewMonth.set(12);
      this.viewYear.update((y) => y - 1);
    } else {
      this.viewMonth.update((m) => m - 1);
    }
  }

  nextMonth(): void {
    if (this.viewMonth() === 12) {
      this.viewMonth.set(1);
      this.viewYear.update((y) => y + 1);
    } else {
      this.viewMonth.update((m) => m + 1);
    }
  }

  selectDate(date: string | null): void {
    if (date) this.selectedDate.set(date);
  }

  summaryFor(date: string | null): DayTradeSummary | undefined {
    if (!date) return undefined;
    return this.summaryByDate().get(date);
  }
}
