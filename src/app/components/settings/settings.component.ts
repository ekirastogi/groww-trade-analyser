import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { AuthService } from '../../services/auth.service';
import { TradeLedgerService } from '../../services/trade-ledger.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private ledger = inject(TradeLedgerService);
  private router = inject(Router);
  readonly state = inject(ReportStateService);
  readonly auth = inject(AuthService);

  resetConfirmChecked = signal(false);
  resetBusy = signal(false);
  resetError = signal<string | null>(null);
  resetSuccess = signal<string | null>(null);
  reingestFile = signal<File | null>(null);

  canConfirmReset = computed(() => this.resetConfirmChecked() && !this.resetBusy());

  onReingestFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.reingestFile.set(file);
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
