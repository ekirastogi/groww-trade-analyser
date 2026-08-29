# Groww Trading Worker

Local Go backend for Kairo. Two jobs in one process:

1. **Market worker** — Stooq daily OHLC + Yahoo quotes into **SQLite**; indicators, relative-strength signals, volume shockers; slim snapshots to **Firestore**.
2. **P&L HTTP API** (optional) — local REST to parse Groww exports (in-memory only).

```
Stooq/Yahoo ──► SQLite (~/.groww-trader/market.db) ──► Firestore (slim) ◄── Angular
P&L upload ──► universe/{SYMBOL} ──► worker hydrates on startup
```

## Required dependencies

| Dependency | Purpose |
|---|---|
| Go 1.24+ | Runtime |
| SQLite (embedded) | All OHLC, fundamentals, volume shocker history — **not** sent wholesale to Firebase |
| Firebase Firestore | Slim `stocks/{sym}`, `stocks/{sym}/views/chart`, `recommendations`, `universe`, `volumeShockers` |
| Service account JSON | Worker writes bypass security rules |
| Stooq + Yahoo | Stooq: daily OHLC (no key). Yahoo: LTP, PE, market cap |

## Data layout

**SQLite (local, full history)**
- `ohlc_candles` — years of daily bars per symbol
- `fundamentals_snapshots`, `pe_history`
- `symbol_meta` — cap bucket, sector, index mapping
- `volume_shockers` — daily rankings

**Firestore (UI reads only)**
- `stocks/{SYMBOL}` — LTP, PE, 52w range, indicators, 3 S/R, vs-index %, **no candles**
- `stocks/{SYMBOL}/views/chart` — ~1y candles + SMA series
- `universe/{SYMBOL}` — written by P&L upload; worker ingests all on startup
- `volumeShockers/active` — top volume names held 5 trading days
- `recommendations/{id}` — idempotent (`SYMBOL_rule_sessionDate`), ranked by confidence

## Ingest tiers

| Tier | When | What |
|---|---|---|
| Full book | EOD (~4pm IST) | Incremental Stooq OHLC for all `universe` + seed CSV (~200 symbols) |
| Hot set | Every `INGEST_INTERVAL` | Yahoo quote + slim stock doc for P&L symbols, shockers, open recs |
| Indices | EOD + hot eval | Nifty, Midcap, sector indices for relative-strength scoring |

## Relative-strength signals

Pipeline: cap bucket → vs Nifty/Midcap/Smallcap → vs sector index → volume → MACD/RSI/S/R → **INTRADAY** or **BTST**.

Groww live feed plugs in later via `market.Provider` — same scoring, no architecture change.

## Run

```bash
cd backend
cp .env.example .env
# export vars, then:
go run .
```

Seed data: `data/universe.csv`, `data/symbol_meta.csv` (~200 NSE names).

## HTTP API

Default `http://localhost:8080` — see `/docs` for Swagger. Set `HTTP_ADDR=off` to disable.

## Env vars

See [`.env.example`](.env.example). Key: `MARKET_DATA_PROVIDER=stooq+yahoo`, `VOLUME_SHOCKER_TOP_N`, `VOLUME_SHOCKER_HOLD_DAYS`.
