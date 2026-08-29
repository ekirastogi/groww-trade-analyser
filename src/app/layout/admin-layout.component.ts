import { Component, inject, signal, HostListener, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReportStateService } from '../services/report-state.service';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { TradeLedgerService } from '../services/trade-ledger.service';
import { BrandLogoComponent } from '../components/shared/brand-logo/brand-logo.component';
import { BRAND } from '../constants/brand';

interface NavItem {
  label: string;
  route: string;
  exact?: boolean;
  icon: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

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
  private ledger = inject(TradeLedgerService);
  private router = inject(Router);

  sidebarOpen = signal(true);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth < 1024);
  resetModalOpen = signal(false);
  resetConfirmChecked = signal(false);
  resetBusy = signal(false);
  resetError = signal<string | null>(null);
  resetSuccess = signal<string | null>(null);
  reingestFile = signal<File | null>(null);

  readonly navSections: NavSection[] = [
    {
      title: 'Portfolio',
      items: [
        {
          label: 'Dashboard',
          route: '/dashboard',
          icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
        },
        {
          label: 'Upload P&L',
          route: '/upload',
          icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
        },
        {
          label: 'Charges',
          route: '/charges',
          icon: 'M9 14l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z',
        },
      ],
    },
    {
      title: 'Market',
      items: [
        {
          label: 'Signals',
          route: '/',
          exact: true,
          icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
        },
        {
          label: 'Watchlists',
          route: '/watchlists',
          icon: 'M5 5h14M5 12h14M5 19h14',
        },
        {
          label: 'Heatmap',
          route: '/heatmap',
          icon: 'M4 6h16M4 10h16M4 14h16M4 18h16',
        },
      ],
    },
    {
      title: 'Analysis',
      items: [
        {
          label: 'Analytics',
          route: '/analytics',
          icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        },
      ],
    },
  ];

  canConfirmReset = computed(() => this.resetConfirmChecked() && !this.resetBusy());

  async ngOnInit(): Promise<void> {
    if (this.auth.user()) {
      this.notifications.requestPermission();
    }
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }

    await this.auth.whenReady();
    if (this.auth.currentUser) {
      await this.state.ensureLoadedFromFirebase();
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

  openResetModal(): void {
    this.resetModalOpen.set(true);
    this.resetConfirmChecked.set(false);
    this.resetError.set(null);
    this.resetSuccess.set(null);
    this.reingestFile.set(null);
    if (this.isMobile()) {
      this.closeSidebar();
    }
  }

  closeResetModal(): void {
    if (this.resetBusy()) return;
    this.resetModalOpen.set(false);
  }

  onReingestFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.reingestFile.set(file);
  }

  async confirmResetAllData(): Promise<void> {
    if (!this.canConfirmReset()) return;

    this.resetBusy.set(true);
    this.resetError.set(null);

    try {
      const result = await this.ledger.resetAllData();
      this.state.clear();

      const file = this.reingestFile();
      if (file) {
        const upload = await this.ledger.uploadReport(file, { forceReingest: true });
        await this.state.loadFromClient(upload.clientCode);
        this.resetSuccess.set(
          `Reset complete. Re-ingested ${upload.newTradesAdded} trades for ${upload.clientName}.`
        );
        await this.router.navigate(['/dashboard']);
      } else {
        this.resetSuccess.set(
          result.clientsRemoved
            ? `Removed ${result.clientsRemoved} client account(s) from Firebase. Upload a P&L file to start fresh.`
            : 'All trade data cleared. Upload a P&L file to start fresh.'
        );
      }

      setTimeout(() => this.resetModalOpen.set(false), 1200);
    } catch (e) {
      this.resetError.set(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      this.resetBusy.set(false);
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
