import { FirebaseOptions } from '@angular/fire/app';
import { firebaseConfig } from './firebase.config';

/** Firebase Hosting domains — authDomain must match the page origin for redirect sign-in on mobile Safari/Chrome. */
const HOSTED_AUTH_DOMAINS = new Set([
  'kairo-trade.web.app',
  'kairo-trade.firebaseapp.com',
]);

export function resolveFirebaseConfig(): FirebaseOptions {
  if (typeof window === 'undefined') {
    return firebaseConfig;
  }

  const host = window.location.host;
  if (HOSTED_AUTH_DOMAINS.has(host)) {
    return { ...firebaseConfig, authDomain: host };
  }

  return firebaseConfig;
}
