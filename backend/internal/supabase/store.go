package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/datapub"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/signals"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists app data in Supabase Postgres. Worker eventing stays on Firebase.
type Store struct {
	pool *pgxpool.Pool

	universeMu      sync.Mutex
	universeCache   []string
	universeCacheAt time.Time

	shockersMu      sync.Mutex
	shockersCache   map[string]int
	shockersCacheAt time.Time
}

func NewStore(ctx context.Context) (*Store, error) {
	connURL, err := buildConnURL()
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(connURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("supabase ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func buildConnURL() (string, error) {
	if raw := strings.TrimSpace(os.Getenv("SUPABASE_DB_URL")); raw != "" {
		return raw, nil
	}
	host := envOr("SUPABASE_DB_HOST", "db.vufjhwxlyhxunqhfeqtr.supabase.co")
	port := envOr("SUPABASE_DB_PORT", "5432")
	db := envOr("SUPABASE_DB_NAME", "postgres")
	user := envOr("SUPABASE_DB_USER", "postgres")
	pass := os.Getenv("SUPABASE_DB_PASSWORD")
	if pass == "" {
		return "", fmt.Errorf("SUPABASE_DB_PASSWORD or SUPABASE_DB_URL required")
	}
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, pass),
		Host:   fmt.Sprintf("%s:%s", host, port),
		Path:   db,
	}
	q := u.Query()
	q.Set("sslmode", "require")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) PublishSlimStock(ctx context.Context, payload datapub.SlimStockPayload) error {
	sym := strings.ToUpper(payload.Symbol)
	supports, _ := json.Marshal(payload.Supports)
	resistances, _ := json.Marshal(payload.Resistances)
	indicators, _ := json.Marshal(payload.Indicators)
	peSeries, _ := json.Marshal(payload.PESeries)

	mcap, pe, qp, yp := 0.0, 0.0, 0.0, 0.0
	if payload.Fundamentals != nil {
		mcap = payload.Fundamentals.MarketCap
		pe = payload.Fundamentals.PE
		qp = payload.Fundamentals.QuarterlyPerf
		yp = payload.Fundamentals.YearlyPerf
	}
	ltp, chg, chgPct := 0.0, 0.0, 0.0
	name := payload.Name
	if payload.Quote != nil {
		ltp = payload.Quote.LTP
		chg = payload.Quote.Change
		chgPct = payload.Quote.ChangePct
		if name == "" {
			name = payload.Quote.Name
		}
		if mcap == 0 {
			mcap = payload.Quote.MarketCap
		}
	}

	_, err := s.pool.Exec(ctx, `
		insert into stocks (
			symbol, name, exchange, ltp, change_amt, change_pct, market_cap, pe,
			week52_high, week52_low, support_levels, resistance_levels,
			quarterly_perf, yearly_perf, indicators, pe_series,
			vs_nifty_pct, vs_cap_index_pct, vs_sector_pct, cap_bucket, sector,
			volume_ratio, last_updated, data_source
		) values ($1,$2,'NSE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		on conflict (symbol) do update set
			name=excluded.name, ltp=excluded.ltp, change_amt=excluded.change_amt,
			change_pct=excluded.change_pct, market_cap=excluded.market_cap, pe=excluded.pe,
			week52_high=excluded.week52_high, week52_low=excluded.week52_low,
			support_levels=excluded.support_levels, resistance_levels=excluded.resistance_levels,
			quarterly_perf=excluded.quarterly_perf, yearly_perf=excluded.yearly_perf,
			indicators=excluded.indicators, pe_series=excluded.pe_series,
			vs_nifty_pct=excluded.vs_nifty_pct, vs_cap_index_pct=excluded.vs_cap_index_pct,
			vs_sector_pct=excluded.vs_sector_pct, cap_bucket=excluded.cap_bucket,
			sector=excluded.sector, volume_ratio=excluded.volume_ratio,
			last_updated=excluded.last_updated, data_source=excluded.data_source
	`, sym, name, ltp, chg, chgPct, mcap, pe, payload.Week52High, payload.Week52Low,
		supports, resistances, qp, yp, indicators, peSeries,
		payload.VsNiftyPct, payload.VsCapPct, payload.VsSectorPct, payload.CapBucket, payload.Sector,
		payload.VolumeRatio, time.Now().Format(time.RFC3339), payload.DataSource)
	return err
}

func (s *Store) PublishChartView(ctx context.Context, symbol string, chart datapub.ChartPayload) error {
	sym := strings.ToUpper(symbol)
	candles := make([]map[string]interface{}, 0, len(chart.Candles))
	for _, c := range chart.Candles {
		candles = append(candles, map[string]interface{}{
			"time": c.Time.Format("2006-01-02"), "open": c.Open, "high": c.High,
			"low": c.Low, "close": c.Close, "volume": c.Volume,
		})
	}
	cj, _ := json.Marshal(candles)
	s20, _ := json.Marshal(chart.SMA20)
	s50, _ := json.Marshal(chart.SMA50)
	s200, _ := json.Marshal(chart.SMA200)
	_, err := s.pool.Exec(ctx, `
		insert into stock_charts (symbol, candles, sma20, sma50, sma200, updated_at)
		values ($1,$2,$3,$4,$5,$6)
		on conflict (symbol) do update set
			candles=excluded.candles, sma20=excluded.sma20, sma50=excluded.sma50,
			sma200=excluded.sma200, updated_at=excluded.updated_at
	`, sym, cj, s20, s50, s200, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) GetUniverseSymbols(ctx context.Context) ([]string, error) {
	cacheTTL := 30 * time.Minute
	if v := os.Getenv("UNIVERSE_CACHE_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cacheTTL = time.Duration(n) * time.Minute
		}
	}
	s.universeMu.Lock()
	if len(s.universeCache) > 0 && time.Since(s.universeCacheAt) < cacheTTL {
		out := append([]string(nil), s.universeCache...)
		s.universeMu.Unlock()
		return out, nil
	}
	s.universeMu.Unlock()

	rows, err := s.pool.Query(ctx, `select symbol from universe order by symbol`)
	if err != nil {
		return s.cachedUniverseFallback(), err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var sym string
		if err := rows.Scan(&sym); err != nil {
			return s.cachedUniverseFallback(), err
		}
		out = append(out, strings.ToUpper(sym))
	}
	s.universeMu.Lock()
	s.universeCache = append([]string(nil), out...)
	s.universeCacheAt = time.Now()
	s.universeMu.Unlock()
	return out, nil
}

func (s *Store) cachedUniverseFallback() []string {
	s.universeMu.Lock()
	defer s.universeMu.Unlock()
	return append([]string(nil), s.universeCache...)
}

func (s *Store) GetActiveVolumeShockers(ctx context.Context) (map[string]int, error) {
	cacheTTL := 5 * time.Minute
	if v := os.Getenv("SHOCKERS_CACHE_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cacheTTL = time.Duration(n) * time.Minute
		}
	}
	s.shockersMu.Lock()
	if len(s.shockersCache) > 0 && time.Since(s.shockersCacheAt) < cacheTTL {
		out := make(map[string]int, len(s.shockersCache))
		for k, v := range s.shockersCache {
			out[k] = v
		}
		s.shockersMu.Unlock()
		return out, nil
	}
	s.shockersMu.Unlock()

	var raw []byte
	err := s.pool.QueryRow(ctx, `select symbols from volume_shockers_active where id='active'`).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return map[string]int{}, nil
		}
		return s.cachedShockersFallback(), err
	}
	out := parseShockerSymbols(raw)
	s.shockersMu.Lock()
	s.shockersCache = out
	s.shockersCacheAt = time.Now()
	s.shockersMu.Unlock()
	return out, nil
}

func parseShockerSymbols(raw []byte) map[string]int {
	out := make(map[string]int)
	var items []map[string]interface{}
	if json.Unmarshal(raw, &items) != nil {
		return out
	}
	for _, m := range items {
		sym, _ := m["symbol"].(string)
		days := 1
		switch d := m["daysRemaining"].(type) {
		case float64:
			days = int(d)
		case int:
			days = d
		}
		if sym != "" {
			out[strings.ToUpper(sym)] = days
		}
	}
	return out
}

func (s *Store) cachedShockersFallback() map[string]int {
	s.shockersMu.Lock()
	defer s.shockersMu.Unlock()
	out := make(map[string]int, len(s.shockersCache))
	for k, v := range s.shockersCache {
		out[k] = v
	}
	return out
}

func (s *Store) PublishVolumeShockers(ctx context.Context, tradeDate string, entries, active []datapub.VolumeShockerEntry) error {
	dayItems := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		dayItems = append(dayItems, map[string]interface{}{
			"symbol": e.Symbol, "rank": e.Rank, "ratio": e.Ratio,
		})
	}
	activeItems := make([]map[string]interface{}, 0, len(active))
	for _, e := range active {
		activeItems = append(activeItems, map[string]interface{}{
			"symbol": e.Symbol, "rank": e.Rank, "ratio": e.Ratio, "daysRemaining": e.DaysRemaining,
		})
	}
	dj, _ := json.Marshal(dayItems)
	aj, _ := json.Marshal(activeItems)
	now := time.Now().Format(time.RFC3339)
	if _, err := s.pool.Exec(ctx, `
		insert into volume_shockers_daily (trade_date, symbols, updated_at) values ($1,$2,$3)
		on conflict (trade_date) do update set symbols=excluded.symbols, updated_at=excluded.updated_at
	`, tradeDate, dj, now); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		insert into volume_shockers_active (id, symbols, updated_at) values ('active',$1,$2)
		on conflict (id) do update set symbols=excluded.symbols, updated_at=excluded.updated_at
	`, aj, now)
	return err
}

func (s *Store) PublishRecommendation(ctx context.Context, sug signals.Suggestion) (string, error) {
	targets, _ := json.Marshal(sug.Targets)
	snapshot, _ := json.Marshal(sug.Snapshot)
	_, err := s.pool.Exec(ctx, `
		insert into recommendations (
			id, symbol, rule_id, rule_name, side, entry, sl, targets, confidence, horizon,
			cap_bucket, sector, vs_nifty_pct, vs_cap_index_pct, vs_sector_pct, volume_ratio,
			status, approval_status, signal_snapshot, created_at, platform
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending_approval','pending',$17,$18,'groww')
		on conflict (id) do nothing
	`, sug.ID, strings.ToUpper(sug.Symbol), sug.RuleID, sug.RuleName, sug.Side,
		sug.Entry, sug.SL, targets, sug.Confidence, string(sug.Horizon),
		sug.CapBucket, sug.Sector, sug.VsNiftyPct, sug.VsCapPct, sug.VsSectorPct, sug.VolumeRatio,
		snapshot, time.Now().Format(time.RFC3339))
	return sug.ID, err
}

func (s *Store) PublishOutcome(ctx context.Context, recommendationID string, exitPrice float64, reason string, pnlPct float64) error {
	_, err := s.pool.Exec(ctx, `
		update recommendations set
			status='executed', approval_status='executed',
			exit_price=$2, exit_reason=$3, outcome_pct=$4, resolved_at=$5
		where id=$1
	`, recommendationID, exitPrice, reason, pnlPct, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) MarkExecuting(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `
		update recommendations set status='executing', approval_status='executing', executing_at=$2 where id=$1
	`, id, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) MarkRejected(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `
		update recommendations set status='rejected', approval_status='rejected', resolved_at=$2 where id=$1
	`, id, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) LoadOpenRecommendations(ctx context.Context) ([]datapub.OpenRecommendation, error) {
	rows, err := s.pool.Query(ctx, `
		select id, row_to_json(recommendations.*) from recommendations
		where status in ('pending_approval','approved','executing')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []datapub.OpenRecommendation
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		data := map[string]interface{}{}
		_ = json.Unmarshal(raw, &data)
		out = append(out, datapub.OpenRecommendation{ID: id, Data: normalizeRecRow(data)})
	}
	return out, nil
}

func normalizeRecRow(data map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(data))
	for k, v := range data {
		out[snakeToCamel(k)] = v
	}
	if targets, ok := data["targets"]; ok {
		out["targets"] = jsonArrayToInterface(targets)
	}
	if sl, ok := data["sl"]; ok {
		out["sl"] = sl
	}
	if side, ok := data["side"]; ok {
		out["side"] = side
	}
	if entry, ok := data["entry"]; ok {
		out["entry"] = entry
	}
	return out
}

func jsonArrayToInterface(v interface{}) []interface{} {
	switch t := v.(type) {
	case []interface{}:
		return t
	default:
		b, _ := json.Marshal(v)
		var out []interface{}
		_ = json.Unmarshal(b, &out)
		return out
	}
}

func snakeToCamel(s string) string {
	parts := strings.Split(s, "_")
	for i := 1; i < len(parts); i++ {
		if parts[i] == "" {
			continue
		}
		parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
	}
	return strings.Join(parts, "")
}

func (s *Store) CheckOpenRecommendationsBatch(ctx context.Context, ltpBySymbol map[string]float64, docs []datapub.OpenRecommendation) {
	if len(ltpBySymbol) == 0 || len(docs) == 0 {
		return
	}
	for _, rec := range docs {
		sym, _ := rec.Data["symbol"].(string)
		sym = strings.ToUpper(sym)
		ltp, ok := ltpBySymbol[sym]
		if !ok {
			continue
		}
		outcome, pnlPct := checkRecommendationOutcome(rec.Data, ltp)
		if outcome != "" {
			_ = s.PublishOutcome(ctx, rec.ID, ltp, outcome, pnlPct)
		}
	}
}

func checkRecommendationOutcome(data map[string]interface{}, ltp float64) (outcome string, pnlPct float64) {
	side, _ := data["side"].(string)
	sl, _ := data["sl"].(float64)
	targets, _ := data["targets"].([]interface{})
	if len(targets) == 0 {
		return "", 0
	}
	t1, _ := targets[0].(float64)
	if strings.ToUpper(side) == "BUY" {
		if ltp <= sl {
			return "hit_sl", (ltp - sl) / sl * 100
		}
		if ltp >= t1 {
			entry, _ := data["entry"].(float64)
			if entry > 0 {
				return "hit_target", (ltp - entry) / entry * 100
			}
			return "hit_target", 0
		}
	} else {
		if ltp >= sl {
			return "hit_sl", 0
		}
		if ltp <= t1 {
			entry, _ := data["entry"].(float64)
			if entry > 0 {
				return "hit_target", (entry - ltp) / entry * 100
			}
			return "hit_target", 0
		}
	}
	return "", 0
}

func (s *Store) RecommendationExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from recommendations where id=$1)`, id).Scan(&exists)
	return exists, err
}

func (s *Store) PollApprovalsOnce(ctx context.Context, seen map[string]bool, handler datapub.ApprovalHandler) error {
	rows, err := s.pool.Query(ctx, `
		select id, row_to_json(recommendations.*) from recommendations
		where approval_status='approved' and status='pending_approval'
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		if seen[id] {
			continue
		}
		data := map[string]interface{}{}
		_ = json.Unmarshal(raw, &data)
		if err := handler(ctx, id, normalizeRecRow(data)); err != nil {
			log.Printf("approval handler failed for %s: %v", id, err)
			continue
		}
		seen[id] = true
	}
	return nil
}

func (s *Store) PublishMarketCatalog(ctx context.Context, entries []datapub.CatalogEntry) error {
	rows := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, map[string]interface{}{
			"symbol": e.Symbol, "name": e.Name, "ltp": e.LTP,
			"changePct": e.ChangePct, "marketCap": e.MarketCap, "pe": e.PE,
			"sector": e.Sector, "lastUpdated": e.LastUpdated, "dataSource": e.DataSource,
		})
	}
	payload, _ := json.Marshal(rows)
	_, err := s.pool.Exec(ctx, `
		insert into market_catalog (id, updated_at, count, stocks) values ('summary',$1,$2,$3)
		on conflict (id) do update set updated_at=excluded.updated_at, count=excluded.count, stocks=excluded.stocks
	`, time.Now().UnixMilli(), len(rows), payload)
	return err
}

func (s *Store) LoadMarketCatalog(ctx context.Context) ([]datapub.CatalogEntry, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `select stocks from market_catalog where id='summary'`).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]datapub.CatalogEntry, 0, len(items))
	for _, m := range items {
		out = append(out, datapub.CatalogEntry{
			Symbol:      strField(m, "symbol"),
			Name:        strField(m, "name"),
			LTP:         floatField(m, "ltp"),
			ChangePct:   floatField(m, "changePct"),
			MarketCap:   floatField(m, "marketCap"),
			PE:          floatField(m, "pe"),
			Sector:      strField(m, "sector"),
			LastUpdated: strField(m, "lastUpdated"),
			DataSource:  strField(m, "dataSource"),
		})
	}
	return out, nil
}

func strField(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func floatField(m map[string]interface{}, key string) float64 {
	switch v := m[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	default:
		return 0
	}
}

func (s *Store) SyncUniverseSymbols(ctx context.Context, entries []market.ExchangeSymbol) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}
	now := time.Now().UnixMilli()
	batch := &pgx.Batch{}
	count := 0
	for _, entry := range entries {
		symbol := strings.ToUpper(strings.TrimSpace(entry.Symbol))
		if symbol == "" {
			continue
		}
		batch.Queue(`
			insert into universe (symbol, name, isin, exchange, source, updated_at)
			values ($1,$2,$3,$4,'exchange_seed',$5)
			on conflict (symbol) do update set
				name=excluded.name, isin=excluded.isin, exchange=excluded.exchange,
				source=excluded.source, updated_at=excluded.updated_at
		`, symbol, entry.Name, entry.ISIN, entry.Exchange, now)
		count++
	}
	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < count; i++ {
		if _, err := br.Exec(); err != nil {
			return count, err
		}
	}
	s.universeMu.Lock()
	s.universeCache = nil
	s.universeCacheAt = time.Time{}
	s.universeMu.Unlock()
	return count, nil
}

func (s *Store) GetWatchlistSymbols(ctx context.Context) ([]string, error) {
	return s.GetUniverseSymbols(ctx)
}

func (s *Store) PublishStock(ctx context.Context, symbol string, quote *market.Quote, fund *market.Fundamentals, candles []market.Candle, news []market.NewsItem, dataSource string) error {
	rsi, macd, macdSig, macdHist, sma20, sma50, sma200 := indicators.ComputeAll(candles)
	supports, resistances := indicators.SupportResistance(candles)
	w52h, w52l := store.Week52Range(candles)
	volRatio, _, _ := store.VolumeRatio(candles)

	fs := &store.FundamentalSnapshot{Symbol: strings.ToUpper(symbol)}
	if fund != nil {
		fs.PE = fund.PE
		fs.MarketCap = fund.MarketCap
		fs.QuarterlyPerf = fund.QuarterlyPerf
		fs.YearlyPerf = fund.YearlyPerf
	}
	fs.Week52High = w52h
	fs.Week52Low = w52l

	if err := s.PublishSlimStock(ctx, datapub.SlimStockPayload{
		Symbol: symbol, Name: quote.Name, Quote: quote, Fundamentals: fs,
		Indicators: map[string]float64{
			"rsi": rsi, "macd": macd, "macdSignal": macdSig, "macdHist": macdHist,
			"sma20": sma20, "sma50": sma50, "sma200": sma200,
		},
		Supports: supports, Resistances: resistances,
		Week52High: w52h, Week52Low: w52l, VolumeRatio: volRatio, DataSource: dataSource,
	}); err != nil {
		return err
	}
	return s.PublishChartView(ctx, symbol, datapub.BuildChartPayload(candles))
}

// ExecSQL runs a migration script (multiple statements).
func (s *Store) ExecSQL(ctx context.Context, sql string) error {
	_, err := s.pool.Exec(ctx, sql)
	return err
}
