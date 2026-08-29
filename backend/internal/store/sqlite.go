package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	_ "modernc.org/sqlite"
)

type SQLiteStore struct {
	db *sql.DB
}

func NewSQLite(dbPath string) (*SQLiteStore, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &SQLiteStore{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	if err := s.migrateExtended(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) migrate() error {
	schema := `
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

CREATE INDEX IF NOT EXISTS idx_ohlc_symbol ON ohlc_candles(symbol, interval, ts);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON trade_suggestions(status);
`
	_, err := s.db.Exec(schema)
	return err
}

func (s *SQLiteStore) UpsertCandles(symbol, interval string, candles []market.Candle) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR REPLACE INTO ohlc_candles(symbol, interval, ts, open, high, low, close, volume)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range candles {
		_, err = stmt.Exec(symbol, interval, c.Time.Format(time.RFC3339), c.Open, c.High, c.Low, c.Close, c.Volume)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteStore) GetCandles(symbol, interval string, limit int) ([]market.Candle, error) {
	rows, err := s.db.Query(`SELECT ts, open, high, low, close, volume FROM ohlc_candles
		WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT ?`, symbol, interval, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var candles []market.Candle
	for rows.Next() {
		var ts string
		var c market.Candle
		if err := rows.Scan(&ts, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume); err != nil {
			return nil, err
		}
		c.Time, _ = time.Parse(time.RFC3339, ts)
		candles = append(candles, c)
	}
	// reverse to ascending
	for i, j := 0, len(candles)-1; i < j; i, j = i+1, j-1 {
		candles[i], candles[j] = candles[j], candles[i]
	}
	return candles, nil
}

type IndicatorRow struct {
	TS         time.Time
	RSI        float64
	MACD       float64
	MACDSignal float64
	MACDHist   float64
	SMA20      float64
	SMA50      float64
	SMA200     float64
}

func (s *SQLiteStore) UpsertIndicator(symbol, interval string, row IndicatorRow) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO indicator_snapshots
		(symbol, interval, ts, rsi, macd, macd_signal, macd_hist, sma20, sma50, sma200)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		symbol, interval, row.TS.Format(time.RFC3339),
		row.RSI, row.MACD, row.MACDSignal, row.MACDHist, row.SMA20, row.SMA50, row.SMA200)
	return err
}

func (s *SQLiteStore) LatestIndicator(symbol, interval string) (*IndicatorRow, error) {
	row := s.db.QueryRow(`SELECT ts, rsi, macd, macd_signal, macd_hist, sma20, sma50, sma200
		FROM indicator_snapshots WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT 1`, symbol, interval)
	var ts string
	var ind IndicatorRow
	if err := row.Scan(&ts, &ind.RSI, &ind.MACD, &ind.MACDSignal, &ind.MACDHist, &ind.SMA20, &ind.SMA50, &ind.SMA200); err != nil {
		return nil, err
	}
	ind.TS, _ = time.Parse(time.RFC3339, ts)
	return &ind, nil
}

func (s *SQLiteStore) UpsertStock(symbol, name, exchange string, marketCap float64) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO stocks(symbol, name, exchange, market_cap, updated_at)
		VALUES (?, ?, ?, ?, ?)`, symbol, name, exchange, marketCap, time.Now().Format(time.RFC3339))
	return err
}

func (s *SQLiteStore) SaveSuggestion(id, symbol, ruleID, ruleName, side string, entry, sl float64, targets []float64, confidence float64, snapshot string) error {
	t := make([]float64, 5)
	for i := 0; i < len(targets) && i < 5; i++ {
		t[i] = targets[i]
	}
	_, err := s.db.Exec(`INSERT OR REPLACE INTO trade_suggestions
		(id, symbol, rule_id, rule_name, side, entry, sl, t1, t2, t3, t4, t5, confidence, status, signal_snapshot, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
		id, symbol, ruleID, ruleName, side, entry, sl, t[0], t[1], t[2], t[3], t[4], confidence, snapshot, time.Now().Format(time.RFC3339))
	return err
}

func (s *SQLiteStore) UpdateSuggestionStatus(id, status string, outcomePct float64) error {
	_, err := s.db.Exec(`UPDATE trade_suggestions SET status = ?, resolved_at = ?, outcome_pct = ? WHERE id = ?`,
		status, time.Now().Format(time.RFC3339), outcomePct, id)
	return err
}

func (s *SQLiteStore) SetFirestoreID(id, firestoreID string) error {
	_, err := s.db.Exec(`UPDATE trade_suggestions SET firestore_id = ? WHERE id = ?`, firestoreID, id)
	return err
}

func (s *SQLiteStore) GetSuggestionByFirestoreID(firestoreID string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM trade_suggestions WHERE firestore_id = ?`, firestoreID).Scan(&id)
	return id, err
}

func (s *SQLiteStore) SaveOutcome(suggestionID string, exitPrice float64, reason string, pnlPct float64) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO trade_outcomes(suggestion_id, exit_price, exit_reason, pnl_pct, resolved_at)
		VALUES (?, ?, ?, ?, ?)`, suggestionID, exitPrice, reason, pnlPct, time.Now().Format(time.RFC3339))
	return err
}

func (s *SQLiteStore) UpsertNews(item market.NewsItem) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO news_items(id, symbol, title, url, published_at, summary)
		VALUES (?, ?, ?, ?, ?, ?)`, item.ID, item.Symbol, item.Title, item.URL, item.PublishedAt.Format(time.RFC3339), item.Summary)
	return err
}

func (s *SQLiteStore) GetNews(symbol string, limit int) ([]market.NewsItem, error) {
	rows, err := s.db.Query(`SELECT id, symbol, title, url, published_at, summary FROM news_items
		WHERE symbol = ? ORDER BY published_at DESC LIMIT ?`, symbol, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []market.NewsItem
	for rows.Next() {
		var item market.NewsItem
		var ts string
		if err := rows.Scan(&item.ID, &item.Symbol, &item.Title, &item.URL, &ts, &item.Summary); err != nil {
			return nil, err
		}
		item.PublishedAt, _ = time.Parse(time.RFC3339, ts)
		items = append(items, item)
	}
	return items, nil
}

func (s *SQLiteStore) DB() *sql.DB {
	return s.db
}

func DefaultDBPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".groww-trader", "market.db")
}

func (s *SQLiteStore) String() string {
	return fmt.Sprintf("sqlite@%s", s.db)
}
