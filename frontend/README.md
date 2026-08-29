# Groww Trader — Frontend

Angular SPA for the Groww Trader / Kairo workstation. Reads trade data and market snapshots from **Firebase Firestore** only.

For architecture, backend worker setup, and full quick start, see the [root README](../README.md).

## Develop

```bash
npm install --legacy-peer-deps
npm start
```

Open http://localhost:4200

## Deploy

From this directory:

```bash
npm run deploy
```

Or from the repo root (uses root `firebase.json`):

```bash
firebase deploy --only hosting
```
