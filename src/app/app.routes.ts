import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { ChargesComponent } from './components/charges/charges.component';
import { WatchlistsComponent } from './components/watchlists/watchlists.component';
import { StockDetailComponent } from './components/stock-detail/stock-detail.component';
import { SignalsComponent } from './components/signals/signals.component';
import { HeatmapComponent } from './components/heatmap/heatmap.component';
import { AdminLayoutComponent } from './layout/admin-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: AdminLayoutComponent,
    children: [
      { path: '', component: DashboardComponent },
      { path: 'analytics', component: AnalyticsComponent },
      { path: 'charges', component: ChargesComponent },
      { path: 'watchlists', component: WatchlistsComponent },
      { path: 'stock/:symbol', component: StockDetailComponent },
      { path: 'signals', component: SignalsComponent },
      { path: 'heatmap', component: HeatmapComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
