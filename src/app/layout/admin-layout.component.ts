import { Component, inject, signal, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReportStateService } from '../services/report-state.service';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { BrandLogoComponent } from '../components/shared/brand-logo/brand-logo.component';
import { BRAND } from '../constants/brand';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, BrandLogoComponent],
  templateUrl: './admin-layout.component.html',
})
export class AdminLayoutComponent implements OnInit {
  readonly state = inject(ReportStateService);
  readonly auth = inject(AuthService);
  readonly brand = BRAND;
  private notifications = inject(NotificationService);
  private router = inject(Router);
  sidebarOpen = signal(true);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth < 1024);

  ngOnInit(): void {
    if (this.auth.user()) {
      this.notifications.requestPermission();
    }
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
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
    if (this.isMobile()) {
      this.closeSidebar();
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }

  userInitial(email: string | null | undefined): string {
    return (email?.charAt(0) ?? 'U').toUpperCase();
  }
}
