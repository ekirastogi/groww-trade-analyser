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
      {
        path: '',
        component: SignalsComponent,
        data: { title: 'Signals', subtitle: 'Trade recommendations from your engine' },
      },
      {
        path: 'dashboard',
        component: DashboardComponent,
        data: { title: 'Dashboard', subtitle: 'Portfolio overview from your P&L' },
      },
      {
        path: 'upload',
        component: UploadComponent,
        data: { title: 'Upload P&L', subtitle: 'Import broker export to Firebase' },
      },
      {
        path: 'analytics',
        component: AnalyticsComponent,
        data: { title: 'Analytics', subtitle: 'Charts and performance breakdowns' },
      },
      {
        path: 'charges',
        component: ChargesComponent,
        data: { title: 'Charges', subtitle: 'Trading fees from your report' },
      },
      {
        path: 'watchlists',
        component: WatchlistsComponent,
        data: { title: 'Watchlists', subtitle: 'Profitable and loss-making stocks' },
      },
      {
        path: 'stock/:symbol',
        component: StockDetailComponent,
        data: { title: 'Stock', subtitle: 'Market data and your trades' },
      },
      { path: 'signals', redirectTo: '', pathMatch: 'full' },
      {
        path: 'heatmap',
        component: HeatmapComponent,
        data: { title: 'P&L Heatmap', subtitle: 'Profitable vs loss-making stocks' },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
