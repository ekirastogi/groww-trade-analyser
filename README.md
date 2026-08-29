# Kairo

**Trade at the right moment** — a personal trading workstation for signals, portfolio analytics, and market intelligence.

## Stack

- **Frontend**: Angular 17, Tailwind CSS, Firebase (Auth, Firestore, Hosting)
- **Local engine**: Go worker with SQLite (market data, indicators, signals) — publishes to Firestore

The UI talks only to Firebase. The local backend runs on your machine and syncs recommendations and market snapshots to the cloud.

## Development

```bash
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

## Production build & deploy

```bash
npm run secrets:setup   # one-time: upload Firebase web config to Secret Manager
npm run deploy          # build + deploy hosting & functions
```

Hosted at [growtrader-628a0.web.app](https://growtrader-628a0.web.app).

## Project structure

| Path | Purpose |
|------|---------|
| `src/app/components/` | Pages: signals, dashboard, upload, analytics, watchlists |
| `src/app/services/` | Firestore, auth, trade ledger, recommendations |
| `functions/` | Cloud Function serving Firebase config from Secret Manager |

## Broker uploads

P&amp;L files from supported brokers (e.g. Groww exports) can be uploaded and optionally synced to Firestore with incremental deduplication per client account.
