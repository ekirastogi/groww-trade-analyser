import { Component, OnInit, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RegistryLabel } from '../../models/trading-journal.models';
import { StockLabelsStore } from '../../services/stock-labels.store';

/**
 * Create labels, tag the current stock, and (optionally) delete labels.
 * Used behind a toggle on both the stock detail page and the stock registry page.
 */
@Component({
  selector: 'app-stock-labels-manager',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="label-manager">
      @if (symbol()) {
        <div class="label-manager-block">
          <p class="label-manager-title">Labels on {{ symbol() }}</p>
          <div class="label-manager-chips">
            @for (label of assigned(); track label.id) {
              <button
                type="button"
                class="label-chip"
                [disabled]="disabled() || store.busy()"
                [title]="'Remove ' + label.name"
                (click)="unassign(label.id)"
              >
                {{ label.name }}
                <span class="label-chip-x" aria-hidden="true">×</span>
              </button>
            } @empty {
              <span class="label-manager-empty">No labels on this stock yet</span>
            }
          </div>
        </div>

        @if (available().length) {
          <div class="label-manager-block">
            <p class="label-manager-title">Add existing label</p>
            <div class="label-manager-chips">
              @for (label of available(); track label.id) {
                <button
                  type="button"
                  class="label-filter-pill"
                  [disabled]="disabled() || store.busy()"
                  (click)="assign(label.id)"
                >
                  + {{ label.name }}
                </button>
              }
            </div>
          </div>
        }
      }

      <div class="label-manager-block">
        <p class="label-manager-title">Create a new label</p>
        <div class="label-manager-create">
          <input
            class="input-field flex-1"
            placeholder="e.g. Watch, Core, Swing"
            maxlength="40"
            [(ngModel)]="newName"
            (keyup.enter)="create()"
          />
          <button
            type="button"
            class="btn-primary whitespace-nowrap"
            [disabled]="disabled() || store.busy() || !newName.trim()"
            (click)="create()"
          >
            {{ store.busy() ? 'Saving…' : 'Add label' }}
          </button>
        </div>
        @if (symbol()) {
          <p class="label-manager-hint">New labels are tagged to {{ symbol() }} automatically.</p>
        }
      </div>

      @if (allowDelete()) {
        <div class="label-manager-block">
          <p class="label-manager-title">All labels</p>
          <div class="label-manager-chips">
            @for (label of store.labels(); track label.id) {
              <span class="label-manage-chip">
                <span>{{ label.name }}</span>
                <span class="text-xs text-slate-400">{{ store.countFor(label.id) }}</span>
                <button
                  type="button"
                  class="text-xs text-red-500 hover:underline"
                  [disabled]="disabled() || store.busy()"
                  (click)="remove(label)"
                >
                  Delete
                </button>
              </span>
            } @empty {
              <span class="label-manager-empty">No labels yet</span>
            }
          </div>
        </div>
      }

      @if (store.error(); as err) {
        <p class="label-manager-error">{{ err }}</p>
      }
    </div>
  `,
})
export class StockLabelsManagerComponent implements OnInit {
  /** When set, labels can be tagged to this symbol. Omit for global label management. */
  symbol = input<string | null>(null);
  /** Registry page also manages the label list itself. */
  allowDelete = input(false);
  disabled = input(false);
  /**
   * Optional hook run before the first tag is written — the stock detail page uses it to
   * add the stock to the registry so a label always has a row to attach to.
   */
  beforeAssign = input<(() => Promise<unknown>) | null>(null);

  store = inject(StockLabelsStore);
  newName = '';

  assigned = computed(() => {
    const ids = new Set(this.store.labelIdsFor(this.symbol() ?? ''));
    return this.store.labels().filter((label) => ids.has(label.id));
  });

  available = computed(() => {
    const ids = new Set(this.store.labelIdsFor(this.symbol() ?? ''));
    return this.store.labels().filter((label) => !ids.has(label.id));
  });

  ngOnInit(): void {
    void this.store.ensureLoaded();
  }

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    const created = await this.store.create(name);
    if (!created) return;
    this.newName = '';
    const sym = this.symbol();
    if (sym) {
      await this.runBeforeAssign();
      await this.store.assign(sym, created.id);
    }
  }

  async remove(label: RegistryLabel): Promise<void> {
    const count = this.store.countFor(label.id);
    const extra = count ? ` It will be removed from ${count} stock${count === 1 ? '' : 's'}.` : '';
    if (!confirm(`Delete label “${label.name}”?${extra} Labels cannot be renamed.`)) return;
    await this.store.remove(label.id);
  }

  async assign(labelId: string): Promise<void> {
    const sym = this.symbol();
    if (!sym) return;
    await this.runBeforeAssign();
    await this.store.assign(sym, labelId);
  }

  unassign(labelId: string): void {
    const sym = this.symbol();
    if (sym) void this.store.unassign(sym, labelId);
  }

  private async runBeforeAssign(): Promise<void> {
    const hook = this.beforeAssign();
    if (hook) await hook();
  }
}
