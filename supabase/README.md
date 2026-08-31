# Supabase data layer

App data (P&L, stocks, recommendations, universe, etc.) lives in **Supabase Postgres**.

**Firebase Firestore** is used only for **worker eventing** between the Angular UI and local Go worker:

- `worker/status` — heartbeat
- `worker/listen` — on-demand listen window
- `workerJobs/{id}` — ingest / seed jobs

## One-time setup

### Option A — Supabase CLI (recommended when it runs on your machine)

```bash
supabase link --project-ref vufjhwxlyhxunqhfeqtr
supabase db push
```

> **Note:** Recent Supabase CLI builds require a CPU with AVX. If `supabase` crashes on launch, use Option B.

### Option B — Go migrate runner (this repo)

1. Set `SUPABASE_DB_PASSWORD` in `backend/.env`.
2. Run:

```bash
./scripts/supabase-migrate.sh
```

This applies all files in `migrations/` in sorted order (`001_initial.sql`, `002_…`, `003_firebase_rls.sql`, …).

### Option C — SQL Editor

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/vufjhwxlyhxunqhfeqtr/sql/new).
2. Paste and run each file in `migrations/` in sorted order.
3. In **Authentication → Sign In / Providers → Third-Party Auth**, enable **Firebase** with project ID `kairo-trade`.
4. Copy **Project URL** and **anon public key** into `frontend/src/environments/supabase.config.ts` (see `supabase.config.example.ts`).
5. Set `SUPABASE_DB_PASSWORD` in `backend/.env` (never commit).

### Firebase custom claim (required once)

Supabase expects every Firebase user to have custom claim `role: authenticated`:

```bash
# GOOGLE_APPLICATION_CREDENTIALS must point at your Firebase service account JSON
./scripts/set-firebase-supabase-claims.sh
```

Then sign out and sign in again in the app so the JWT includes the new claim.

## Frontend

```bash
cp src/environments/supabase.config.example.ts src/environments/supabase.config.ts
# Add anon key from Supabase → Settings → API
```

Sign-in flow: **Firebase Google auth** (Firestore worker paths) + **Supabase Firebase Third-Party Auth** (Postgres RLS via Firebase JWT `accessToken` callback).

## Backend

```bash
cp .env.example .env
# Set SUPABASE_DB_PASSWORD and FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS
go run .
```

Worker writes market data to Postgres; UI reads via `supabase-js`.

## Migrating from Firestore

Existing Firestore documents are **not** auto-imported. Re-upload your P&L CSV or run a custom backfill.
