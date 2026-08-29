import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { ChargesComponent } from './components/charges/charges.component';
import { WatchlistsComponent } from './components/watchlists/watchlists.component';
import { StockDetailComponent } from './components/stock-detail/stock-detail.component';
import { SignalsComponent } from './components/signals/signals.component';
import { HeatmapComponent } from './components/heatmap/heatmap.component';
import { UploadComponent } from './components/upload/upload.component';
import { LoginComponent } from './components/login/login.component';
import { AdminLayoutComponent } from './layout/admin-layout.component';
import { authGuard, loginGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [loginGuard] },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: SignalsComponent },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'upload', component: UploadComponent },
      { path: 'analytics', component: AnalyticsComponent },
      { path: 'charges', component: ChargesComponent },
      { path: 'watchlists', component: WatchlistsComponent },
      { path: 'stock/:symbol', component: StockDetailComponent },
      { path: 'signals', redirectTo: '', pathMatch: 'full' },
      { path: 'heatmap', component: HeatmapComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
