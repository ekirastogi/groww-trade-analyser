import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { TradeLedgerService } from '../../services/trade-ledger.service';
import { AuthService } from '../../services/auth.service';
import { ReportHistoryComponent } from '../shared/report-history/report-history.component';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, ReportHistoryComponent],
  templateUrl: './upload.component.html',
})
export class UploadComponent {
  readonly state = inject(ReportStateService);
  private ledger = inject(TradeLedgerService);
  private router = inject(Router);
  readonly auth = inject(AuthService);

  pushToFirebase = signal(true);
  dragOver = signal(false);
  uploading = signal(false);
  pushResult = signal<string | null>(null);
  pushError = signal<string | null>(null);

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void this.handleFile(file);
  }

  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void this.handleFile(file);
  }

  private async handleFile(file: File): Promise<void> {
    this.pushResult.set(null);
    this.pushError.set(null);
    this.uploading.set(true);

    try {
      await this.auth.whenReady();

      if (this.pushToFirebase()) {
        if (!this.auth.currentUser) {
          this.pushError.set('Sign in to store uploads in Firebase and load dashboards from the cloud.');
          return;
        }

        const result = await this.ledger.uploadReport(file);
        this.state.applyUploadResult(result);

        if (result.fileDuplicate) {
          this.pushResult.set(
            `File already in Firebase for ${result.clientName} (${result.clientCode}). Dashboard refreshed from cloud.`
          );
        } else {
          this.pushResult.set(
            `Saved to Firebase for ${result.clientName} (${result.clientCode}): ` +
              `${result.newTradesAdded} trades imported.`
          );
        }

        await this.router.navigate(['/dashboard']);
        return;
      }

      await this.state.loadFile(file);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      this.pushError.set(message);
      this.state.error.set(message);
    } finally {
      this.uploading.set(false);
    }
  }

  goToDashboard(): void {
    void this.router.navigate(['/dashboard']);
  }
}
