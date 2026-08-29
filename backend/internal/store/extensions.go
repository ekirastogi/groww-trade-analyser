package store

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

// SymbolMeta holds cap bucket and sector mapping for relative-strength scoring.
type SymbolMeta struct {
	Symbol            string
	Name              string
	CapBucket         string // large | mid | small
	Sector            string
	SectorIndexSymbol string
	CapIndexSymbol    string
}

type FundamentalSnapshot struct {
	Symbol      string
	AsOf        time.Time
	PE          float64
	MarketCap   float64
	Week52High  float64
	Week52Low   float64
	QuarterlyPerf float64
	YearlyPerf    float64
}

type VolumeShockerRow struct {
	TradeDate string
	Symbol    string
	Rank      int
	Volume    int64
	Avg20     float64
	Ratio     float64
}

func (s *SQLiteStore) migrateExtended() error {
	stmts := []string{
		`PRAGMA journal_mode=WAL`,
		`CREATE TABLE IF NOT EXISTS fundamentals_snapshots (
			symbol TEXT NOT NULL, as_of TEXT NOT NULL,
			pe REAL, market_cap REAL, week52_high REAL, week52_low REAL,
			quarterly_perf REAL, yearly_perf REAL,
			PRIMARY KEY (symbol, as_of)
		)`,
		`CREATE TABLE IF NOT EXISTS pe_history (
			symbol TEXT NOT NULL, as_of TEXT NOT NULL, pe REAL,
			PRIMARY KEY (symbol, as_of)
		)`,
		`CREATE TABLE IF NOT EXISTS volume_shockers (
			trade_date TEXT NOT NULL, symbol TEXT NOT NULL,
			rank INTEGER, volume INTEGER, avg20 REAL, ratio REAL,
			PRIMARY KEY (trade_date, symbol)
		)`,
		`CREATE TABLE IF NOT EXISTS symbol_meta (
			symbol TEXT PRIMARY KEY, name TEXT,
			cap_bucket TEXT, sector TEXT,
			sector_index_symbol TEXT, cap_index_symbol TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS ingest_state (
			key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_volume_shockers_date ON volume_shockers(trade_date)`,
		`CREATE INDEX IF NOT EXISTS idx_pe_history_symbol ON pe_history(symbol, as_of)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}

func (s *SQLiteStore) UpsertFundamentals(f FundamentalSnapshot) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO fundamentals_snapshots
		(symbol, as_of, pe, market_cap, week52_high, week52_low, quarterly_perf, yearly_perf)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		f.Symbol, f.AsOf.Format(time.RFC3339), f.PE, f.MarketCap, f.Week52High, f.Week52Low,
		f.QuarterlyPerf, f.YearlyPerf)
	return err
}

func (s *SQLiteStore) LatestFundamentals(symbol string) (*FundamentalSnapshot, error) {
	row := s.db.QueryRow(`SELECT as_of, pe, market_cap, week52_high, week52_low, quarterly_perf, yearly_perf
		FROM fundamentals_snapshots WHERE symbol = ? ORDER BY as_of DESC LIMIT 1`, symbol)
	var ts string
	var f FundamentalSnapshot
	f.Symbol = symbol
	if err := row.Scan(&ts, &f.PE, &f.MarketCap, &f.Week52High, &f.Week52Low, &f.QuarterlyPerf, &f.YearlyPerf); err != nil {
		return nil, err
	}
	f.AsOf, _ = time.Parse(time.RFC3339, ts)
	return &f, nil
}

func (s *SQLiteStore) UpsertPEHistory(symbol string, asOf time.Time, pe float64) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO pe_history(symbol, as_of, pe) VALUES (?, ?, ?)`,
		symbol, asOf.Format(time.RFC3339), pe)
	return err
}

func (s *SQLiteStore) GetPEHistory(symbol string, limit int) ([]struct {
	AsOf time.Time
	PE   float64
}, error) {
	rows, err := s.db.Query(`SELECT as_of, pe FROM pe_history WHERE symbol = ? ORDER BY as_of DESC LIMIT ?`, symbol, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		AsOf time.Time
		PE   float64
	}
	for rows.Next() {
		var ts string
		var pe float64
		if err := rows.Scan(&ts, &pe); err != nil {
			return nil, err
		}
		t, _ := time.Parse(time.RFC3339, ts)
		out = append(out, struct {
			AsOf time.Time
			PE   float64
		}{t, pe})
	}
	return out, nil
}

func (s *SQLiteStore) UpsertSymbolMeta(m SymbolMeta) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO symbol_meta
		(symbol, name, cap_bucket, sector, sector_index_symbol, cap_index_symbol)
		VALUES (?, ?, ?, ?, ?, ?)`,
		m.Symbol, m.Name, m.CapBucket, m.Sector, m.SectorIndexSymbol, m.CapIndexSymbol)
	return err
}

func (s *SQLiteStore) GetSymbolMeta(symbol string) (*SymbolMeta, error) {
	row := s.db.QueryRow(`SELECT symbol, name, cap_bucket, sector, sector_index_symbol, cap_index_symbol
		FROM symbol_meta WHERE symbol = ?`, strings.ToUpper(symbol))
	var m SymbolMeta
	if err := row.Scan(&m.Symbol, &m.Name, &m.CapBucket, &m.Sector, &m.SectorIndexSymbol, &m.CapIndexSymbol); err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *SQLiteStore) AllSymbolMeta() ([]SymbolMeta, error) {
	rows, err := s.db.Query(`SELECT symbol, name, cap_bucket, sector, sector_index_symbol, cap_index_symbol FROM symbol_meta`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SymbolMeta
	for rows.Next() {
		var m SymbolMeta
		if err := rows.Scan(&m.Symbol, &m.Name, &m.CapBucket, &m.Sector, &m.SectorIndexSymbol, &m.CapIndexSymbol); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *SQLiteStore) LatestCandleDate(symbol, interval string) (time.Time, error) {
	var ts string
	err := s.db.QueryRow(`SELECT ts FROM ohlc_candles WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT 1`,
		symbol, interval).Scan(&ts)
	if err == sql.ErrNoRows {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, ts)
}

func (s *SQLiteStore) SaveVolumeShockers(tradeDate string, rows []VolumeShockerRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM volume_shockers WHERE trade_date = ?`, tradeDate); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO volume_shockers(trade_date, symbol, rank, volume, avg20, ratio) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range rows {
		if _, err := stmt.Exec(tradeDate, r.Symbol, r.Rank, r.Volume, r.Avg20, r.Ratio); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteStore) ActiveVolumeShockers(holdDays int) (map[string]int, error) {
	rows, err := s.db.Query(`SELECT trade_date, symbol, rank, ratio FROM volume_shockers ORDER BY trade_date DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type entry struct {
		date string
		rank int
	}
	bySymbol := make(map[string]entry)
	datesSeen := make(map[string]bool)
	var orderedDates []string

	for rows.Next() {
		var date, symbol string
		var rank int
		var ratio float64
		if err := rows.Scan(&date, &symbol, &rank, &ratio); err != nil {
			return nil, err
		}
		if !datesSeen[date] {
			datesSeen[date] = true
			orderedDates = append(orderedDates, date)
			if len(orderedDates) > holdDays {
				break
			}
		}
		if len(orderedDates) > holdDays {
			continue
		}
		sym := strings.ToUpper(symbol)
		if _, ok := bySymbol[sym]; !ok {
			bySymbol[sym] = entry{date: date, rank: rank}
		}
	}

	out := make(map[string]int)
	for sym, e := range bySymbol {
		daysLeft := holdDays
		for i, d := range orderedDates {
			if d == e.date {
				daysLeft = holdDays - i
				break
			}
		}
		if daysLeft < 1 {
			daysLeft = 1
		}
		out[sym] = daysLeft
	}
	return out, nil
}

func (s *SQLiteStore) SetIngestState(key, value string) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO ingest_state(key, value, updated_at) VALUES (?, ?, ?)`,
		key, value, time.Now().Format(time.RFC3339))
	return err
}

func (s *SQLiteStore) GetIngestState(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM ingest_state WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

// ComputeAndStoreIndicators computes indicator series for candles and stores latest.
func (s *SQLiteStore) ComputeAndStoreIndicators(symbol, interval string, candles []market.Candle) error {
	if len(candles) == 0 {
		return nil
	}
	closes := make([]float64, len(candles))
	for i, c := range candles {
		closes[i] = c.Close
	}
	rsi, macd, macdSig, macdHist, sma20, sma50, sma200 := indicators.ComputeAll(candles)
	return s.UpsertIndicator(symbol, interval, IndicatorRow{
		TS: candles[len(candles)-1].Time, RSI: rsi, MACD: macd,
		MACDSignal: macdSig, MACDHist: macdHist, SMA20: sma20, SMA50: sma50, SMA200: sma200,
	})
}

func LoadSymbolMetaCSV(path string) ([]SymbolMeta, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	var out []SymbolMeta
	for i, row := range rows {
		if i == 0 || len(row) < 4 {
			continue
		}
		sym := strings.ToUpper(strings.TrimSpace(row[0]))
		cap := strings.ToLower(strings.TrimSpace(row[2]))
		capIdx := "^NSEI"
		switch cap {
		case "mid":
			capIdx = "^NSEMDCP50"
		case "small":
			capIdx = "^CNXSC"
		}
		out = append(out, SymbolMeta{
			Symbol:            sym,
			Name:              strings.TrimSpace(row[1]),
			CapBucket:         cap,
			Sector:            strings.TrimSpace(row[3]),
			SectorIndexSymbol: sectorIndexFor(strings.TrimSpace(row[3])),
			CapIndexSymbol:    capIdx,
		})
	}
	return out, nil
}

func sectorIndexFor(sector string) string {
	switch strings.ToLower(sector) {
	case "it", "technology":
		return "^CNXIT"
	case "bank", "financial", "finance":
		return "^NSEBANK"
	case "pharma", "healthcare":
		return "^CNXPHARMA"
	default:
		return "^NSEI"
	}
}

func FindMetaCSV() string {
	candidates := []string{
		"data/symbol_meta.csv",
		filepath.Join(filepath.Dir(DefaultDBPath()), "symbol_meta.csv"),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func LoadUniverseCSV(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	var syms []string
	for i, row := range rows {
		if i == 0 || len(row) == 0 {
			continue
		}
		s := strings.ToUpper(strings.TrimSpace(row[0]))
		if s != "" && !strings.HasPrefix(s, "#") {
			syms = append(syms, s)
		}
	}
	return syms, nil
}

func FindUniverseCSV() string {
	for _, p := range []string{"data/universe.csv"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func Week52Range(candles []market.Candle) (high, low float64) {
	if len(candles) == 0 {
		return 0, 0
	}
	limit := 252
	if len(candles) < limit {
		limit = len(candles)
	}
	slice := candles[len(candles)-limit:]
	high, low = slice[0].High, slice[0].Low
	for _, c := range slice {
		if c.High > high {
			high = c.High
		}
		if c.Low < low {
			low = c.Low
		}
	}
	return high, low
}

func VolumeRatio(candles []market.Candle) (ratio float64, avg20 float64, todayVol int64) {
	if len(candles) == 0 {
		return 0, 0, 0
	}
	todayVol = candles[len(candles)-1].Volume
	n := 20
	if len(candles) < n+1 {
		n = len(candles) - 1
	}
	if n <= 0 {
		return 0, 0, todayVol
	}
	sum := int64(0)
	for i := len(candles) - n - 1; i < len(candles)-1; i++ {
		sum += candles[i].Volume
	}
	avg20 = float64(sum) / float64(n)
	if avg20 == 0 {
		return 0, 0, todayVol
	}
	return float64(todayVol) / avg20, avg20, todayVol
}
