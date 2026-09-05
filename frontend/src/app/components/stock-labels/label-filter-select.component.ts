import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export interface LabelFilterOption {
  id: string;
  name: string;
  count: number;
}

/** Multi-select label filter. Empty selection means "All". */
@Component({
  selector: 'app-label-filter-select',
  standalone: true,
  template: `
    <div class="label-select">
      <button
        type="button"
        class="label-select-trigger"
        [class.label-select-trigger-active]="selectedIds().length > 0"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        (click)="open.set(!open())"
      >
        <span class="label-select-value">{{ summary() }}</span>
        <span class="label-select-caret" aria-hidden="true">▾</span>
      </button>

      @if (open()) {
        <div class="label-select-panel" role="listbox" aria-label="Filter by label">
          <button
            type="button"
            class="label-select-option"
            [class.label-select-option-active]="!selectedIds().length"
            (click)="selectAll()"
          >
            <span class="label-select-box" [class.label-select-box-on]="!selectedIds().length">
              @if (!selectedIds().length) {
                <span aria-hidden="true">✓</span>
              }
            </span>
            <span class="label-select-option-name">All stocks</span>
            <span class="label-select-count">{{ allCount() }}</span>
          </button>

          @if (options().length) {
            <div class="label-select-divider"></div>
          }

          @for (option of options(); track option.id) {
            <button
              type="button"
              class="label-select-option"
              [class.label-select-option-active]="isSelected(option.id)"
              [attr.aria-selected]="isSelected(option.id)"
              (click)="toggle(option.id)"
            >
              <span class="label-select-box" [class.label-select-box-on]="isSelected(option.id)">
                @if (isSelected(option.id)) {
                  <span aria-hidden="true">✓</span>
                }
              </span>
              <span class="label-select-option-name">{{ option.name }}</span>
              <span class="label-select-count">{{ option.count }}</span>
            </button>
          } @empty {
            <p class="label-select-empty">No labels yet</p>
          }

          @if (selectedIds().length) {
            <div class="label-select-footer">
              <button type="button" class="label-select-clear" (click)="selectAll()">
                Clear filter
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class LabelFilterSelectComponent {
  private host = inject(ElementRef<HTMLElement>);

  options = input<LabelFilterOption[]>([]);
  allCount = input(0);
  selectedIds = input<string[]>([]);
  selectionChange = output<string[]>();

  open = signal(false);

  summary = computed(() => {
    const ids = this.selectedIds();
    if (!ids.length) return 'All labels';
    if (ids.length === 1) {
      const match = this.options().find((option) => option.id === ids[0]);
      return match ? match.name : '1 label';
    }
    return `${ids.length} labels`;
  });

  isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  toggle(id: string): void {
    const ids = this.selectedIds();
    this.selectionChange.emit(
      ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]
    );
  }

  selectAll(): void {
    this.selectionChange.emit([]);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
