"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchScreenerStock = void 0;
const app_1 = require("firebase-admin/app");
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
const screener_1 = require("./screener");
(0, app_1.initializeApp)();
(0, v2_1.setGlobalOptions)({
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 5,
});
const ALLOWED_EMAILS = new Set(['ekirastogi@gmail.com']);
function assertAllowed(email) {
    const normalized = email?.trim().toLowerCase() ?? '';
    if (!ALLOWED_EMAILS.has(normalized)) {
        throw new https_1.HttpsError('permission-denied', 'This workspace is private.');
    }
}
exports.fetchScreenerStock = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to fetch Screener data.');
    }
    assertAllowed(request.auth.token.email);
    const symbol = String(request.data?.symbol ?? '').trim();
    if (!symbol) {
        throw new https_1.HttpsError('invalid-argument', 'Symbol is required.');
    }
    try {
        return await (0, screener_1.fetchScreenerSnapshot)(symbol);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Screener fetch failed';
        throw new https_1.HttpsError('not-found', message);
    }
});
//# sourceMappingURL=index.js.map