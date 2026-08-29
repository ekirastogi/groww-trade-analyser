# Kairo

**Trade at the right moment** — a personal trading workstation for signals, portfolio analytics, and market intelligence.

## Stack

- **Frontend**: Angular 17, Tailwind CSS, Firebase (Auth, Firestore, Hosting)
- **Local engine**: Go worker with SQLite (market data, indicators, signals) — publishes to Firestore

The UI talks only to Firebase. The local backend runs on your machine and syncs recommendations and market snapshots to the cloud.

## Development

```bash
npm install
cp src/environments/firebase.config.example.ts src/environments/firebase.config.ts
# Add your Firebase web app values to firebase.config.ts
npm start
```

Open [http://localhost:4200](http://localhost:4200).

## Firebase & secrets

Firebase web config is stored in **Google Secret Manager** (via Firebase CLI) so it stays out of git. No Cloud Functions are used — config is fetched at **build time**.

**One-time project setup** (requires [Firebase CLI](https://firebase.google.com/docs/cli) logged in):

```bash
npm run firebase:setup
```

This creates the Firestore database, deploys security rules/indexes, and uploads your local `firebase.config.ts` to Secret Manager.

**Production deploy**:

```bash
npm run deploy
```

Hosted at [kairo-trade.web.app](https://kairo-trade.web.app).

> **Note:** Firebase web API keys are public by design (they end up in the browser bundle). Secret Manager keeps them out of git and centralizes config for CI/CD. Real secrets (Groww API token, service account keys) belong only in the **backend** `.env`, never in the frontend.

## Project structure

| Path | Purpose |
|------|---------|
| `src/app/components/` | Pages: signals, dashboard, upload, analytics, watchlists |
| `src/app/services/` | Firestore, auth, trade ledger, recommendations |
| `scripts/` | Firebase setup, Secret Manager upload/fetch |

## Broker uploads

P&amp;L files from supported brokers (e.g. Groww exports) can be uploaded and optionally synced to Firestore with incremental deduplication per client account.
