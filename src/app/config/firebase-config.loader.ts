import { FirebaseOptions } from '@angular/fire/app';

const CONFIG_URLS = [
  '/api/firebase-config',
  'https://growtrader-628a0.web.app/api/firebase-config',
];

export async function loadFirebaseConfig(): Promise<FirebaseOptions> {
  for (const url of CONFIG_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        return (await response.json()) as FirebaseOptions;
      }
    } catch {
      // try next URL
    }
  }

  throw new Error(
    'Could not load Firebase config from Secret Manager. ' +
      'Run: npm run secrets:setup && firebase deploy --only functions'
  );
}
