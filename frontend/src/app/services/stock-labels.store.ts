import { Injectable, computed, inject, signal } from '@angular/core';
import { RegistryLabel } from '../models/trading-journal.models';
import { RegistryLabelService, StockLabelMap } from './registry-label.service';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Shared label state for the registry page, the stock detail page, and the reusable
 * label manager. Keeping it in one store means filter pills, per-row pickers and the
 * manager all reflect the same labels without each page refetching.
 */
@Injectable({ providedIn: 'root' })
export class StockLabelsStore {
  private svc = inject(RegistryLabelService);

  labels = signal<RegistryLabel[]>([]);
  assignments = signal<StockLabelMap>(new Map());
  busy = signal(false);
  error = signal<string | null>(null);
  loaded = signal(false);

  hasLabels = computed(() => this.labels().length > 0);

  private inFlight: Promise<void> | null = null;

  /** Loads once per session; safe to call from every consumer. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded()) return;
    await this.reload();
  }

  async reload(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const [labels, assignments] = await Promise.all([
        this.svc.listLabels(),
        this.svc.listAssignments(),
      ]);
      this.labels.set(labels);
      this.assignments.set(assignments);
      this.error.set(null);
      this.loaded.set(true);
    } catch (err) {
      this.labels.set([]);
      this.assignments.set(new Map());
      this.error.set(errorMessage(err, 'Failed to load labels'));
    } finally {
      this.busy.set(false);
    }
  }

  labelIdsFor(symbol: string): string[] {
    if (!symbol) return [];
    return this.assignments().get(symbol.toUpperCase()) ?? [];
  }

  countFor(labelId: string): number {
    let n = 0;
    for (const ids of this.assignments().values()) {
      if (ids.includes(labelId)) n++;
    }
    return n;
  }

  async create(rawName: string): Promise<RegistryLabel | null> {
    const name = rawName.trim();
    if (!name) {
      this.error.set('Enter a label name');
      return null;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.svc.createLabel(name);
      this.labels.update((rows) => [...rows, created]);
      this.loaded.set(true);
      return created;
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not create label'));
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async remove(labelId: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.svc.deleteLabel(labelId);
      this.labels.update((rows) => rows.filter((row) => row.id !== labelId));
      this.assignments.update((map) => {
        const next: StockLabelMap = new Map();
        for (const [symbol, ids] of map) {
          const kept = ids.filter((id) => id !== labelId);
          if (kept.length) next.set(symbol, kept);
        }
        return next;
      });
      return true;
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not delete label'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async assign(symbol: string, labelId: string): Promise<void> {
    const sym = symbol?.trim().toUpperCase();
    if (!sym || !labelId) return;
    this.error.set(null);
    try {
      await this.svc.addToStock(sym, labelId);
      const current = this.labelIdsFor(sym);
      if (!current.includes(labelId)) this.setSymbolLabels(sym, [...current, labelId]);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not add label'));
    }
  }

  async unassign(symbol: string, labelId: string): Promise<void> {
    const sym = symbol?.trim().toUpperCase();
    if (!sym || !labelId) return;
    this.error.set(null);
    try {
      await this.svc.removeFromStock(sym, labelId);
      this.setSymbolLabels(
        sym,
        this.labelIdsFor(sym).filter((id) => id !== labelId)
      );
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not remove label'));
    }
  }

  private setSymbolLabels(symbol: string, ids: string[]): void {
    this.assignments.update((map) => {
      const next = new Map(map);
      if (ids.length) next.set(symbol, ids);
      else next.delete(symbol);
      return next;
    });
  }
}
