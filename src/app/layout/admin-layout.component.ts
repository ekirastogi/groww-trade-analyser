import { Component, inject, signal, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReportStateService } from '../services/report-state.service';
import { ReportHistoryComponent } from '../components/shared/report-history/report-history.component';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ReportHistoryComponent],
  templateUrl: './admin-layout.component.html',
})
export class AdminLayoutComponent implements OnInit {
  readonly state = inject(ReportStateService);
  readonly auth = inject(AuthService);
  private notifications = inject(NotificationService);
  private router = inject(Router);
  sidebarOpen = signal(false);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth < 1024);

  ngOnInit(): void {
    if (this.auth.user()) {
      this.notifications.requestPermission();
    }
  }

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

  onNavigate(): void {
    this.closeSidebar();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
