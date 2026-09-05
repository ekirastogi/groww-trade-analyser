import { Component, computed, input, output } from '@angular/core';
import { RegistryLabel } from '../../models/trading-journal.models';

@Component({
  selector: 'app-stock-label-picker',
  standalone: true,
  template: `
    <div class="flex flex-wrap items-center gap-1">
      @for (label of selectedLabels(); track label.id) {
        <button
          type="button"
          class="label-chip"
          [disabled]="disabled()"
          [title]="disabled() ? label.name : 'Remove ' + label.name"
          (click)="removeLabel.emit(label.id)"
        >
          {{ label.name }}
          @if (!disabled()) {
            <span class="label-chip-x" aria-hidden="true">×</span>
          }
        </button>
      }
      @if (!disabled() && unselectedLabels().length) {
        <select
          class="label-add-select"
          aria-label="Add label"
          (change)="onAdd($event)"
        >
          <option value="">Add label</option>
          @for (label of unselectedLabels(); track label.id) {
            <option [value]="label.id">{{ label.name }}</option>
          }
        </select>
      } @else if (!labels().length) {
        <span class="text-xs text-slate-400">No labels yet</span>
      }
    </div>
  `,
})
export class StockLabelPickerComponent {
  labels = input<RegistryLabel[]>([]);
  selectedIds = input<string[]>([]);
  disabled = input(false);
  addLabel = output<string>();
  removeLabel = output<string>();

  selectedLabels = computed(() => {
    const byId = new Map(this.labels().map((label) => [label.id, label]));
    return this.selectedIds()
      .map((id) => byId.get(id))
      .filter((label): label is RegistryLabel => !!label);
  });

  unselectedLabels = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.labels().filter((label) => !selected.has(label.id));
  });

  onAdd(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (id) this.addLabel.emit(id);
  }
}
