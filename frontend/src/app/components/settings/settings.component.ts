import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { AuthService } from '../../services/auth.service';
import { TradeLedgerService } from '../../services/trade-ledger.service';
import { BackendWorkerService } from '../../services/backend-worker.service';

type SettingsTab = 'backfill' | 'reset';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  private ledger = inject(TradeLedgerService);
  private router = inject(Router);
  private worker = inject(BackendWorkerService);
  readonly state = inject(ReportStateService);
  readonly auth = inject(AuthService);

  activeTab = signal<SettingsTab>('backfill');

  resetConfirmChecked = signal(false);
  resetBusy = signal(false);
  resetError = signal<string | null>(null);
  resetSuccess = signal<string | null>(null);
  reingestFile = signal<File | null>(null);

  backfillBusy = signal(false);
  backfillError = signal<string | null>(null);
  backfillSuccess = signal<string | null>(null);
  rebuildProfiles = signal(false);
  triggerIngest = signal(true);
  workerOnline = signal(false);
  backendUrl = signal('http://localhost:8080');

  canConfirmReset = computed(() => this.resetConfirmChecked() && !this.resetBusy());
  canRunBackfill = computed(() => !this.backfillBusy());

  ngOnInit(): void {
    this.worker.loadSavedBaseUrl();
    this.backendUrl.set(this.worker.getBaseUrl());
    void this.refreshWorkerStatus();
  }

  setTab(tab: SettingsTab): void {
    this.activeTab.set(tab);
  }

  onBackendUrlChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.backendUrl.set(value);
    this.worker.setBaseUrl(value);
    void this.refreshWorkerStatus();
  }

  async refreshWorkerStatus(): Promise<void> {
    const health = await this.worker.checkHealth();
    this.workerOnline.set(health?.status === 'ok');
  }

  onReingestFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.reingestFile.set(file);
  }

  async runBackfill(): Promise<void> {
    if (!this.canRunBackfill()) return;

    this.backfillBusy.set(true);
    this.backfillError.set(null);
    this.backfillSuccess.set(null);

    try {
      const result = await this.ledger.backfillUniverse({
        rebuildProfiles: this.rebuildProfiles(),
      });

      let message = `Synced ${result.symbolsSynced} symbol(s) from ${result.clientsProcessed} client account(s) to the universe collection.`;
      if (result.profilesRebuilt) {
        message += ` Rebuilt stock profiles for ${result.profilesRebuilt} client(s).`;
      }

      if (this.triggerIngest()) {
        await this.refreshWorkerStatus();
        if (this.workerOnline()) {
          const ingest = await this.worker.triggerHotIngest();
          if (ingest) {
            message += ` Local worker ingested ${ingest.symbolsIngested} symbol(s).`;
          } else {
            message += ' Could not trigger local worker ingest.';
          }
        } else {
          message += ' Start the local backend worker to fetch market data.';
        }
      }

      this.backfillSuccess.set(message);
    } catch (e) {
      this.backfillError.set(e instanceof Error ? e.message : 'Backfill failed');
    } finally {
      this.backfillBusy.set(false);
    }
  }

  async confirmResetAllData(): Promise<void> {
    if (!this.canConfirmReset()) return;

    this.resetBusy.set(true);
    this.resetError.set(null);
    this.resetSuccess.set(null);

    try {
      const result = await this.ledger.resetAllData();
      this.state.clear();

      const file = this.reingestFile();
      if (file) {
        const upload = await this.ledger.uploadReport(file, { forceReingest: true });
        this.state.applyUploadResult(upload);
        this.resetSuccess.set(
          `Reset complete. Re-ingested ${upload.newTradesAdded} trades for ${upload.clientName}.`
        );
        this.resetConfirmChecked.set(false);
        this.reingestFile.set(null);
        await this.router.navigate(['/dashboard']);
      } else {
        this.resetSuccess.set(
          result.clientsRemoved
            ? `Removed ${result.clientsRemoved} client account(s) from Firebase. Upload a P&L file to start fresh.`
            : 'All trade data cleared. Upload a P&L file to start fresh.'
        );
        this.resetConfirmChecked.set(false);
        this.reingestFile.set(null);
      }
    } catch (e) {
      this.resetError.set(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      this.resetBusy.set(false);
    }
  }
}
