# Groww Trader — Frontend

Angular SPA for the Groww Trader / Kairo workstation. Reads trade data and market snapshots from
**Supabase Postgres**, authenticated with a **Firebase Auth** ID token. Firestore is used only
for worker job eventing (`WorkerJobService`).

For architecture, backend worker setup, and full quick start, see the [root README](../README.md).

## Develop

```bash
npm install --legacy-peer-deps
npm start
```

Open http://localhost:4200

`prestart` generates the gitignored `src/environments/{firebase,supabase}.config.ts`. To work
without cloud access, copy the matching `.example.ts` files instead.

## Verify

```bash
npm run lint     # eslint + angular-eslint, including template accessibility rules
npm test         # unit tests; CI uses --watch=false --browsers=ChromeHeadless
```

Tests cover the pure logic where a regression would silently change money figures — the
per-trade charge helpers, the trade-type classifier, and P&L candle aggregation. They need no
TestBed, so add new cases alongside the util rather than mounting a component.

## Conventions

- **Standalone components and signals** throughout. No NgModules.
- **Sortable tables** use `TableSortState` from `src/app/utils/table-sort.utils.ts` — see
  `.cursor/rules/sortable-tables.mdc`. Do not hand-roll sort state.
- **Per-trade charges** come from `src/app/utils/trade-charges.utils.ts`. Never inline the
  `allocatedCharges ?? …` fallback; pages disagreed about net P&L when it was duplicated.
- **Trade classification** is `effectiveTradeType()` in `src/app/utils/trade-type-filter.utils.ts`,
  used by both the parser and the filters so a trade cannot be typed one way on upload and
  another way when filtered.
- **Routes are lazy.** Only the default `/` signals route is eager; add new pages with
  `loadComponent`. `xlsx` is dynamically imported inside `ParserService` to keep the largest
  dependency out of the initial bundle.
- **Uncaught errors** flow through `AppErrorHandler` and surface as a shell banner. When adding
  a data load, expose an error signal rather than collapsing a failure to an empty array — an
  empty list is indistinguishable from "this user has no trades".

## Deploy

Use the repo-root ship script, which commits, pushes and deploys in one step:

```bash
../scripts/ship.sh "commit message"
```

Hosting-only deploy from this directory:

```bash
npm run deploy
```
