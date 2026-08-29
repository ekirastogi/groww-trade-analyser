-- Local SQLite schema (backend/internal/store/sqlite.go + extensions.go)
-- All raw market data stays on your machine; only computed results go to Firestore.

PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  isin TEXT,
  exchange TEXT DEFAULT 'NSE',
  sector TEXT,
  market_cap REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ohlc_candles (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume INTEGER,
  PRIMARY KEY (symbol, interval, ts)
);

CREATE TABLE IF NOT EXISTS indicator_snapshots (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts TEXT NOT NULL,
  rsi REAL, macd REAL, macd_signal REAL, macd_hist REAL,
  sma20 REAL, sma50 REAL, sma200 REAL,
  PRIMARY KEY (symbol, interval, ts)
);

CREATE TABLE IF NOT EXISTS fundamentals_snapshots (
  symbol TEXT NOT NULL, as_of TEXT NOT NULL,
  pe REAL, market_cap REAL, week52_high REAL, week52_low REAL,
  quarterly_perf REAL, yearly_perf REAL,
  PRIMARY KEY (symbol, as_of)
);

CREATE TABLE IF NOT EXISTS pe_history (
  symbol TEXT NOT NULL, as_of TEXT NOT NULL, pe REAL,
  PRIMARY KEY (symbol, as_of)
);

CREATE TABLE IF NOT EXISTS volume_shockers (
  trade_date TEXT NOT NULL, symbol TEXT NOT NULL,
  rank INTEGER, volume INTEGER, avg20 REAL, ratio REAL,
  PRIMARY KEY (trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS symbol_meta (
  symbol TEXT PRIMARY KEY, name TEXT,
  cap_bucket TEXT, sector TEXT,
  sector_index_symbol TEXT, cap_index_symbol TEXT
);

CREATE TABLE IF NOT EXISTS ingest_state (
  key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS news_items (
  id TEXT PRIMARY KEY,
  symbol TEXT, title TEXT, url TEXT, published_at TEXT, summary TEXT
);

CREATE TABLE IF NOT EXISTS trade_suggestions (
  id TEXT PRIMARY KEY,
  symbol TEXT, rule_id TEXT, rule_name TEXT, side TEXT,
  entry REAL, sl REAL,
  t1 REAL, t2 REAL, t3 REAL, t4 REAL, t5 REAL,
  confidence REAL, status TEXT,
  signal_snapshot TEXT,
  created_at TEXT, resolved_at TEXT, outcome_pct REAL,
  firestore_id TEXT
);

CREATE TABLE IF NOT EXISTS trade_outcomes (
  suggestion_id TEXT PRIMARY KEY,
  exit_price REAL, exit_reason TEXT, pnl_pct REAL, resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_volume_shockers_date ON volume_shockers(trade_date);
CREATE INDEX IF NOT EXISTS idx_pe_history_symbol ON pe_history(symbol, as_of);
