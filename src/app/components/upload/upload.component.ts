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
    await this.state.loadFile(file);

    if (!this.pushToFirebase()) return;

    try {
      const result = await this.ledger.uploadReport(file);
      if (result.fileDuplicate) {
        this.pushResult.set(`File already uploaded for account ${result.clientCode}. No changes made.`);
      } else {
        this.pushResult.set(
          `Pushed to Firebase for ${result.clientName} (${result.clientCode}): ` +
          `${result.newTradesAdded} new trades, ${result.duplicatesSkipped} duplicates skipped.`
        );
      }
    } catch (e) {
      this.pushError.set(e instanceof Error ? e.message : 'Firebase upload failed');
    }
  }

  goToDashboard(): void {
    void this.router.navigate(['/dashboard']);
  }
}
