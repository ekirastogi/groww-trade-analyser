import { bootstrapApplication } from '@angular/platform-browser';
import { buildAppConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { firebaseConfig } from './environments/firebase.config';

const CANONICAL_HOST = 'kairo-trade.firebaseapp.com';

if (typeof window !== 'undefined' && window.location.host === 'kairo-trade.web.app') {
  const target = `${window.location.protocol}//${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(target);
} else {
  bootstrapApplication(AppComponent, buildAppConfig(firebaseConfig));
}
