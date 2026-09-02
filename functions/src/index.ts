import { initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { fetchScreenerSnapshot } from './screener';

initializeApp();

setGlobalOptions({
  region: 'asia-south1',
  memory: '512MiB',
  timeoutSeconds: 60,
  maxInstances: 5,
});

const ALLOWED_EMAILS = new Set(['ekirastogi@gmail.com']);

function assertAllowed(email: string | undefined): void {
  const normalized = email?.trim().toLowerCase() ?? '';
  if (!ALLOWED_EMAILS.has(normalized)) {
    throw new HttpsError('permission-denied', 'This workspace is private.');
  }
}

export const fetchScreenerStock = onCall<{ symbol?: string }>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to fetch Screener data.');
  }
  assertAllowed(request.auth.token.email as string | undefined);

  const symbol = String(request.data?.symbol ?? '').trim();
  if (!symbol) {
    throw new HttpsError('invalid-argument', 'Symbol is required.');
  }

  try {
    return await fetchScreenerSnapshot(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Screener fetch failed';
    throw new HttpsError('not-found', message);
  }
});
