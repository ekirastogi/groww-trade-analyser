# Supabase data layer

App data (P&L, stocks, recommendations, universe, etc.) lives in **Supabase Postgres**.

**Firebase Firestore** is used only for **worker eventing** between the Angular UI and local Go worker:

- `worker/status` — heartbeat
- `worker/listen` — on-demand listen window
- `workerJobs/{id}` — ingest / seed jobs

## One-time setup

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/vufjhwxlyhxunqhfeqtr/sql/new).
2. Paste and run `migrations/001_initial.sql`.
3. In **Authentication → Providers**, enable **Google** (same Google Cloud project as Firebase is fine).
4. Copy **Project URL** and **anon public key** into `frontend/src/environments/supabase.config.ts` (see `supabase.config.example.ts`).
5. Set `SUPABASE_DB_PASSWORD` in `backend/.env` (never commit).

## Frontend

```bash
cp src/environments/supabase.config.example.ts src/environments/supabase.config.ts
# Add anon key from Supabase → Settings → API
```

Sign-in flow: Firebase Google auth (worker rules) + Supabase `signInWithIdToken` (RLS on Postgres).

## Backend

```bash
cp .env.example .env
# Set SUPABASE_DB_PASSWORD and FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS
go run .
```

Worker writes market data to Postgres; UI reads via `supabase-js`.

## Migrating from Firestore

Existing Firestore documents are **not** auto-imported. Re-upload your P&L CSV or run a custom backfill.
