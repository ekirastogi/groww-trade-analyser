import { Component, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReportStateService } from '../services/report-state.service';
import { ReportHistoryComponent } from '../components/shared/report-history/report-history.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ReportHistoryComponent],
  templateUrl: './admin-layout.component.html',
})
export class AdminLayoutComponent {
  readonly state = inject(ReportStateService);
  sidebarOpen = signal(typeof window !== 'undefined' && window.innerWidth >= 1024);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth < 1024);

  @HostListener('window:resize')
  onResize(): void {
    const mobile = window.innerWidth < 1024;
    const wasMobile = this.isMobile();
    this.isMobile.set(mobile);
    if (mobile && !wasMobile) {
      this.sidebarOpen.set(false);
    }
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
