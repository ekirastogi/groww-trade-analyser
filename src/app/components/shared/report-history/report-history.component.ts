import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportStateService } from '../../../services/report-state.service';
import { formatRelativeTime } from '../../../utils/format.utils';

@Component({
  selector: 'app-report-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (state.reportHistory().length) {
      <div [class]="variant() === 'sidebar' ? 'space-y-1' : ''">
        @if (showLabel()) {
          <div
            class="text-xs font-semibold uppercase tracking-wide text-slate-500"
            [class.mb-2]="variant() === 'bar' || variant() === 'upload'"
            [class.mb-1]="variant() === 'sidebar'"
            [class.text-center]="variant() === 'upload'"
          >
            @if (variant() === 'upload') {
              Or open a recent upload
            } @else {
              Recent uploads ({{ state.reportHistory().length }}/5)
            }
          </div>
        }

        @if (variant() === 'bar') {
          <div class="flex gap-2 overflow-x-auto pb-1">
            @for (entry of state.reportHistory(); track entry.id) {
              <button
                type="button"
                class="flex min-w-[160px] max-w-[220px] shrink-0 flex-col rounded-lg border px-3 py-2 text-left transition hover:border-brand-300"
                [class.border-brand-500]="state.activeHistoryId() === entry.id"
                [class.bg-brand-50]="state.activeHistoryId() === entry.id"
                [class.border-slate-200]="state.activeHistoryId() !== entry.id"
                [class.bg-white]="state.activeHistoryId() !== entry.id"
                (click)="select(entry.id)"
              >
                <span class="truncate text-sm font-semibold text-slate-900">{{ entry.fileName }}</span>
                <span class="mt-0.5 truncate text-xs text-slate-500">{{ entry.report.summary.period }}</span>
                <span class="mt-1 text-xs text-slate-400">{{ formatRelativeTime(entry.uploadedAt) }}</span>
              </button>
            }
          </div>
        } @else if (variant() === 'upload') {
          <div class="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            @for (entry of state.reportHistory(); track entry.id) {
              <button
                type="button"
                class="flex min-h-[140px] flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50 hover:shadow-sm"
                [ngClass]="state.activeHistoryId() === entry.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30' : ''"
                (click)="select(entry.id)"
              >
                <span class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm">📄</span>
                <span class="truncate text-sm font-semibold text-slate-900" [title]="entry.fileName">{{ entry.fileName }}</span>
                <span class="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">{{ entry.report.summary.period }}</span>
                <span class="mt-auto pt-3 text-xs text-slate-400">{{ formatRelativeTime(entry.uploadedAt) }}</span>
              </button>
            }
          </div>
        } @else {
          @for (entry of state.reportHistory(); track entry.id) {
            <button
              type="button"
              class="flex w-full flex-col rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
              [ngClass]="state.activeHistoryId() === entry.id ? 'bg-brand-500/15 text-white' : ''"
              (click)="select(entry.id)"
            >
              <span class="truncate text-xs font-semibold">{{ entry.fileName }}</span>
              <span class="mt-0.5 truncate text-[11px] opacity-70">{{ entry.report.summary.period }}</span>
              <span class="mt-0.5 text-[10px] opacity-50">{{ formatRelativeTime(entry.uploadedAt) }}</span>
            </button>
          }
        }
      </div>
    }
  `,
})
export class ReportHistoryComponent {
  readonly state = inject(ReportStateService);
  readonly formatRelativeTime = formatRelativeTime;

  variant = input<'bar' | 'sidebar' | 'upload'>('bar');
  showLabel = input(true);
  selected = output<void>();

  select(id: string): void {
    this.state.selectHistoryReport(id);
    this.selected.emit();
  }
}
