import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { ChargesComponent } from './components/charges/charges.component';
import { AdminLayoutComponent } from './layout/admin-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: AdminLayoutComponent,
    children: [
      { path: '', component: DashboardComponent },
      { path: 'analytics', component: AnalyticsComponent },
      { path: 'charges', component: ChargesComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
