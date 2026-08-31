import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { AuthService } from '../../services/auth.service';
import { TradeLedgerService } from '../../services/trade-ledger.service';
import { WorkerJobService } from '../../services/worker-job.service';
import { UploadComponent } from '../upload/upload.component';

type SettingsTab = 'upload' | 'backfill' | 'worker' | 'reset';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, UploadComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private ledger = inject(TradeLedgerService);
  private router = inject(Router);
  private workerJobs = inject(WorkerJobService);
  readonly state = inject(ReportStateService);
  readonly auth = inject(AuthService);

  activeTab = signal<SettingsTab>('upload');

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

  workerBusy = signal(false);
  workerError = signal<string | null>(null);
  workerSuccess = signal<string | null>(null);
  workerOnline = signal(false);
  listenUntil = signal<number | null>(null);

  canConfirmReset = computed(() => this.resetConfirmChecked() && !this.resetBusy());
  canRunBackfill = computed(() => !this.backfillBusy());
  listenActive = computed(() => {
    const until = this.listenUntil();
    return !!until && until > Date.now();
  });

  setTab(tab: SettingsTab): void {
    this.activeTab.set(tab);
    if (tab === 'worker') {
      void this.refreshWorkerStatus();
    }
  }

  onReingestFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.reingestFile.set(file);
  }

  async refreshWorkerStatus(): Promise<void> {
    const listen = await this.workerJobs.getListenState();
    this.listenUntil.set(this.workerJobs.isListenActive(listen) ? listen?.until ?? null : null);
    this.workerOnline.set(await this.workerJobs.getWorkerOnline());
  }

  async connectWorker(): Promise<void> {
    this.workerBusy.set(true);
    this.workerError.set(null);
    this.workerSuccess.set(null);
    try {
      await this.workerJobs.requestListenWindow();
      await this.refreshWorkerStatus();
      this.workerSuccess.set(
        'Listen window opened for 15 minutes. Start the backend worker locally if it is not already running.'
      );
    } catch (e) {
      this.workerError.set(e instanceof Error ? e.message : 'Failed to connect worker');
    } finally {
      this.workerBusy.set(false);
    }
  }

  async runHotIngest(): Promise<void> {
    this.workerBusy.set(true);
    this.workerError.set(null);
    this.workerSuccess.set(null);
    try {
      const jobId = await this.workerJobs.requestHotIngest();
      const job = await this.workerJobs.waitForJob(jobId);
      if (job.status === 'completed') {
        this.workerSuccess.set(`Hot ingest completed for ${job.symbolsIngested ?? 0} symbol(s).`);
      } else {
        this.workerError.set(job.error ?? 'Hot ingest failed');
      }
      await this.refreshWorkerStatus();
    } catch (e) {
      this.workerError.set(e instanceof Error ? e.message : 'Hot ingest failed');
    } finally {
      this.workerBusy.set(false);
    }
  }

  async importUniverse(): Promise<void> {
    this.workerBusy.set(true);
    this.workerError.set(null);
    this.workerSuccess.set(null);
    try {
      const jobId = await this.workerJobs.requestSeedUniverse();
      const job = await this.workerJobs.waitForJob(jobId, 20 * 60 * 1000);
      if (job.status === 'completed') {
        this.workerSuccess.set(`Imported ${job.symbolsIngested ?? 0} NSE/BSE symbols into universe.`);
      } else {
        this.workerError.set(job.error ?? 'Universe import failed');
      }
      await this.refreshWorkerStatus();
    } catch (e) {
      this.workerError.set(e instanceof Error ? e.message : 'Universe import failed');
    } finally {
      this.workerBusy.set(false);
    }
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
        await this.workerJobs.requestListenWindow();
        const online = await this.workerJobs.getWorkerOnline();
        if (!online) {
          message +=
            ' Worker is offline — open the Worker tab, click Connect, and ensure `cd backend && go run .` is running.';
        } else {
          const jobId = await this.workerJobs.requestHotIngest();
          message += ' Ingest requested via Firebase…';
          const job = await this.workerJobs.waitForJob(jobId);
          if (job.status === 'completed') {
            message += ` Worker ingested ${job.symbolsIngested ?? 0} symbol(s).`;
          } else {
            message += ` Ingest failed: ${job.error ?? 'unknown error'}.`;
          }
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
        const parts = [
          result.clientsRemoved ? `${result.clientsRemoved} client account(s)` : null,
          result.watchlistsRemoved ? `${result.watchlistsRemoved} watchlist(s)` : null,
          result.registryStocksRemoved ? `${result.registryStocksRemoved} registry stock(s)` : null,
          result.plannedTradesRemoved ? `${result.plannedTradesRemoved} planned trade(s)` : null,
        ].filter(Boolean);
        this.resetSuccess.set(
          parts.length
            ? `Cleared: ${parts.join(', ')}. Upload a P&L file to start fresh.`
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
