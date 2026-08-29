# Groww Trader

Personal trading workstation: **local Go worker** ingests market data into **SQLite**, publishes slim snapshots to **Firebase Firestore**, and the **Angular UI** reads Firestore only.

Groww P&L report analysis runs **in the browser** (upload `.xlsx`/`.csv` on Dashboard). Uploaded symbols are written to `universe/{SYMBOL}` for the worker to hydrate.

## Architecture

```
P&L upload ──► universe/{SYMBOL} ──► Go worker (local)
Stooq/Yahoo ──► SQLite (~/.groww-trader/market.db) ──► Firestore (slim) ◄── Angular
```

| Layer | What |
|---|---|
| **SQLite** | Years of OHLC, fundamentals, PE history, volume shocker rankings, symbol meta |
| **Firestore** | Slim `stocks/{sym}`, chart at `stocks/{sym}/views/chart`, `recommendations`, `volumeShockers/active`, `universe` |
| **Worker** | EOD full book (~200+ symbols), hot-set quotes during market hours, relative-strength INTRADAY/BTST signals |

## Quick start

### 1. Firebase setup

1. Create a project at https://console.firebase.google.com
2. Enable **Authentication** (Google sign-in) and **Firestore**
3. Create a **service account** key for the local worker
4. Update `frontend/src/environments/environment.ts` with your Firebase web config
5. Update `.firebaserc` with your project ID
6. Deploy rules: `firebase deploy --only firestore:rules,firestore:indexes`

### 2. Backend worker (local)

```bash
cd backend
cp .env.example .env
# Edit: FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS

export MARKET_DATA_PROVIDER=stooq+yahoo
export WATCH_SYMBOLS=RELIANCE,TCS,INFY

go run .
```

See [`backend/README.md`](backend/README.md) for ingest tiers, env vars, and HTTP API (`/docs`).

### 3. Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm start
```

Open http://localhost:4200 — sign in with Google.

### 4. Both together

```bash
./start.sh
```

## UI pages

| Route | Description |
|-------|-------------|
| `/` | **Recommended trades** — ranked INTRADAY/BTST signals + volume shocker strip |
| `/dashboard` | Upload Groww P&L exports (client-side) |
| `/watchlists` | Manage symbol lists |
| `/stock/:symbol` | Groww-like chart (SMA, MACD, RSI, system + user S/R), 52w range, PE |
| `/heatmap` | P&L treemap from uploaded report |
| `/analytics` | P&L charts |

## Project structure

```
groww/
├── backend/           # Local worker (Go + SQLite + Firestore sync)
├── frontend/          # Angular SPA (Firestore only)
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
└── start.sh
```

## Swapping market data provider

Set `MARKET_DATA_PROVIDER=stooq+yahoo|yahoo|stooq|nse|groww` in backend `.env`. Groww live feed plugs in later via the same `market.Provider` interface.

## Groww trading (future)

Set `GROWW_API_TOKEN` and implement `GrowwProvider.PlaceOrder()`. Approved recommendations execute automatically (dry-run until wired).
