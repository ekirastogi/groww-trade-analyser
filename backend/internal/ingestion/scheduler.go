package ingestion

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/signals"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

type Scheduler struct {
	provider     market.Provider
	db           *store.SQLiteStore
	publisher    *firebase.Publisher
	rules        []signals.Rule
	interval     time.Duration
	fullBook     []string
	hotSet       map[string]bool
	indexCandles map[string][]market.Candle
	lastEOD      string
	catalogCache map[string]firebase.CatalogEntry
	lastCatalogFlush time.Time
}

func NewScheduler(provider market.Provider, db *store.SQLiteStore, pub *firebase.Publisher, symbols []string) *Scheduler {
	iv := 15 * time.Minute
	if v := os.Getenv("INGEST_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			iv = d
		}
	}
	return &Scheduler{
		provider:     provider,
		db:           db,
		publisher:    pub,
		rules:        signals.DefaultRules(),
		interval:     iv,
		fullBook:     symbols,
		hotSet:       make(map[string]bool),
		indexCandles: make(map[string][]market.Candle),
		catalogCache: make(map[string]firebase.CatalogEntry),
	}
}

func (s *Scheduler) Run(ctx context.Context) {
	s.bootstrap(ctx)
	logx.Info("Ingestion scheduler started (interval=%s, fullBook=%d symbols)", s.interval, len(s.fullBook))
	s.tick(ctx)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logx.Info("Ingestion scheduler stopping")
			return
		case <-ticker.C:
			logx.Verbosef("Scheduled tick — refreshing universe and hot set")
			s.refreshUniverse(ctx)
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) bootstrap(ctx context.Context) {
	logx.Info("Bootstrap: loading symbol meta and universe")
	s.loadMetaCSV()
	s.loadCatalogCache(ctx)
	s.refreshUniverse(ctx)
	s.refreshHotSet(ctx)
	logx.Info("Bootstrap: warming %d index symbols", len(market.IndexSymbols))
	for _, idx := range market.IndexSymbols {
		logx.Verbosef("Bootstrap index OHLC: %s", idx)
		_ = s.fetchIncrementalOHLC(ctx, idx)
		candles, _ := s.db.GetCandles(idx, "1d", 260)
		s.indexCandles[idx] = candles
	}
	loc, _ := time.LoadLocation("Asia/Kolkata")
	today := time.Now().In(loc).Format("2006-01-02")
	lastEOD, _ := s.db.GetIngestState("last_eod")
	if lastEOD == today {
		s.lastEOD = today
		logx.Info("Bootstrap: skipping EOD pass (already completed today)")
	} else {
		eodSyms := s.eodSymbolList(ctx)
		logx.Info("Bootstrap: initial EOD pass for %d symbols (universe + hot set, not full CSV book)", len(eodSyms))
		s.runEOD(ctx, eodSyms)
	}
}

func (s *Scheduler) loadMetaCSV() {
	path := store.FindMetaCSV()
	if path == "" {
		return
	}
	rows, err := store.LoadSymbolMetaCSV(path)
	if err != nil {
		logx.Warn("symbol meta csv: %v", err)
		return
	}
	for _, m := range rows {
		_ = s.db.UpsertSymbolMeta(m)
	}
	logx.Info("Loaded %d symbol meta rows from %s", len(rows), path)
}

func (s *Scheduler) refreshUniverse(ctx context.Context) {
	before := len(s.fullBook)
	set := make(map[string]bool)
	fromSeed := 0
	fromCSV := 0
	fromFirestore := 0

	for _, sym := range s.fullBook {
		set[strings.ToUpper(sym)] = true
	}
	fromSeed = len(set)
	if path := store.FindUniverseCSV(); path != "" {
		if syms, err := store.LoadUniverseCSV(path); err == nil {
			for _, sym := range syms {
				set[strings.ToUpper(sym)] = true
			}
			fromCSV = len(syms)
		}
	}
	if s.publisher != nil {
		if syms, err := s.publisher.GetUniverseSymbols(ctx); err == nil {
			for _, sym := range syms {
				set[strings.ToUpper(sym)] = true
			}
			fromFirestore = len(syms)
		} else {
			logx.Warn("Universe refresh: Firestore read failed: %v", err)
		}
	}
	var book []string
	for sym := range set {
		book = append(book, sym)
	}
	sort.Strings(book)
	s.fullBook = book
	if len(book) != before {
		logx.Info("Universe updated: %d symbols (was %d) [seed=%d csv=%d firestore=%d]",
			len(book), before, fromSeed, fromCSV, fromFirestore)
	} else {
		logx.Verbosef("Universe unchanged: %d symbols [seed=%d csv=%d firestore=%d]",
			len(book), fromSeed, fromCSV, fromFirestore)
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	if s.shouldRunEOD() {
		s.runEOD(ctx, s.eodSymbolList(ctx))
	}
	s.refreshHotSet(ctx)
	hotCount := len(s.hotSet)
	if hotCount == 0 {
		logx.Verbosef("Hot tick: no symbols in hot set")
		return
	}
	logx.Info("Hot ingest starting for %d symbols", hotCount)

	var openRecs []firebase.OpenRecommendation
	if s.publisher != nil {
		var err error
		openRecs, err = s.publisher.LoadOpenRecommendations(ctx)
		if err != nil {
			logx.Warn("Load open recommendations: %v", err)
		}
	}

	ltpBySymbol := make(map[string]float64, hotCount)
	ok, fail := 0, 0
	for sym := range s.hotSet {
		ltp, err := s.ingestHot(ctx, sym)
		if err != nil {
			logx.Error("Hot ingest %s: %v", sym, err)
			fail++
		} else {
			ok++
			if ltp > 0 {
				ltpBySymbol[sym] = ltp
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	if s.publisher != nil && len(ltpBySymbol) > 0 && len(openRecs) > 0 {
		s.publisher.CheckOpenRecommendationsBatch(ctx, ltpBySymbol, openRecs)
	}
	logx.Info("Hot ingest done: %d ok, %d failed", ok, fail)
	s.flushCatalog(ctx, false)
}

func (s *Scheduler) loadCatalogCache(ctx context.Context) {
	if s.publisher == nil {
		return
	}
	entries, err := s.publisher.LoadMarketCatalog(ctx)
	if err != nil {
		return
	}
	for _, e := range entries {
		s.catalogCache[e.Symbol] = e
	}
	logx.Info("Loaded %d catalog entries from Firestore", len(entries))
}

func catalogFlushInterval() time.Duration {
	iv := 5 * time.Minute
	if v := os.Getenv("CATALOG_FLUSH_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			iv = time.Duration(n) * time.Minute
		}
	}
	return iv
}

func (s *Scheduler) flushCatalog(ctx context.Context, force bool) {
	if s.publisher == nil || len(s.catalogCache) == 0 {
		return
	}
	if !force && time.Since(s.lastCatalogFlush) < catalogFlushInterval() {
		logx.Verbosef("Skipping catalog flush (throttled, last %s ago)", time.Since(s.lastCatalogFlush).Round(time.Second))
		return
	}
	entries := make([]firebase.CatalogEntry, 0, len(s.catalogCache))
	for _, e := range s.catalogCache {
		entries = append(entries, e)
	}
	if err := s.publisher.PublishMarketCatalog(ctx, entries); err != nil {
		logx.Warn("catalog publish: %v", err)
	} else {
		s.lastCatalogFlush = time.Now()
		logx.Verbosef("Published market catalog (%d symbols, 1 Firestore write)", len(entries))
	}
}

func hotSymbolsMax() int {
	max := 30
	if v := os.Getenv("HOT_SYMBOLS_MAX"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			max = n
		}
	}
	return max
}

func (s *Scheduler) refreshHotSet(ctx context.Context) {
	s.hotSet = make(map[string]bool)
	maxHot := hotSymbolsMax()

	if s.publisher != nil {
		if shockers, err := s.publisher.GetActiveVolumeShockers(ctx); err == nil {
			for sym := range shockers {
				s.hotSet[sym] = true
			}
		}
		// Only user-uploaded universe symbols for hot quotes — not the full CSV seed book.
		if syms, err := s.publisher.GetUniverseSymbols(ctx); err == nil {
			for _, sym := range syms {
				if len(s.hotSet) >= maxHot {
					break
				}
				s.hotSet[strings.ToUpper(sym)] = true
			}
		}
	}
	for _, sym := range DefaultSymbols() {
		s.hotSet[strings.ToUpper(sym)] = true
	}
	logx.Verbosef("Hot set refreshed: %d symbols (max %d)", len(s.hotSet), maxHot)
}

func (s *Scheduler) shouldRunEOD() bool {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	today := time.Now().In(loc).Format("2006-01-02")
	if s.lastEOD == today {
		return false
	}
	now := time.Now().In(loc)
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return false
	}
	minutes := now.Hour()*60 + now.Minute()
	return minutes >= 16*60 // after 4pm IST
}

func (s *Scheduler) eodSymbolList(ctx context.Context) []string {
	set := make(map[string]bool)
	for sym := range s.hotSet {
		sym = strings.ToUpper(sym)
		if !market.IsIndexSymbol(sym) {
			set[sym] = true
		}
	}
	if s.publisher != nil {
		if syms, err := s.publisher.GetUniverseSymbols(ctx); err == nil {
			for _, sym := range syms {
				sym = strings.ToUpper(sym)
				if !market.IsIndexSymbol(sym) {
					set[sym] = true
				}
			}
		}
	}
	for _, sym := range DefaultSymbols() {
		sym = strings.ToUpper(sym)
		if !market.IsIndexSymbol(sym) {
			set[sym] = true
		}
	}
	out := make([]string, 0, len(set))
	for sym := range set {
		out = append(out, sym)
	}
	sort.Strings(out)
	return out
}

func (s *Scheduler) runEOD(ctx context.Context, symbols []string) {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	today := time.Now().In(loc).Format("2006-01-02")
	logx.Info("EOD ingest starting for %d symbols (%s IST)", len(symbols), today)
	ok, fail, skip := 0, 0, 0
	for i, sym := range symbols {
		if market.IsIndexSymbol(sym) {
			skip++
			continue
		}
		logx.Verbosef("EOD [%d/%d] %s", i+1, len(symbols), sym)
		if err := s.ingestEOD(ctx, sym, true); err != nil {
			logx.Error("EOD %s: %v", sym, err)
			fail++
		} else {
			ok++
		}
		if i%10 == 9 {
			time.Sleep(2 * time.Second)
		} else {
			time.Sleep(400 * time.Millisecond)
		}
	}
	s.computeVolumeShockers(ctx, today)
	for _, idx := range market.IndexSymbols {
		_ = s.fetchIncrementalOHLC(ctx, idx)
		candles, _ := s.db.GetCandles(idx, "1d", 260)
		s.indexCandles[idx] = candles
	}
	s.lastEOD = today
	_ = s.db.SetIngestState("last_eod", today)
	logx.Info("EOD ingest complete: %d ok, %d failed, %d indices skipped", ok, fail, skip)
	s.flushCatalog(ctx, true)
}

func (s *Scheduler) ingestEOD(ctx context.Context, symbol string, publishChart bool) error {
	if err := s.fetchIncrementalOHLC(ctx, symbol); err != nil {
		return err
	}
	candles, err := s.db.GetCandles(symbol, "1d", 260)
	if err != nil || len(candles) == 0 {
		return err
	}
	_ = s.db.ComputeAndStoreIndicators(symbol, "1d", candles)

	if s.publisher == nil {
		return nil
	}
	quote, err := s.provider.GetQuote(ctx, symbol)
	if err != nil {
		return err
	}
	fund, _ := s.provider.GetFundamentals(ctx, symbol)
	return s.publishSymbol(ctx, symbol, quote, fund, candles, publishChart)
}

func (s *Scheduler) ingestHot(ctx context.Context, symbol string) (float64, error) {
	if market.IsIndexSymbol(symbol) {
		return 0, nil
	}
	logx.Verbosef("Hot %s: fetching quote", symbol)
	quote, err := s.provider.GetQuote(ctx, symbol)
	if err != nil {
		return 0, err
	}
	candles, _ := s.db.GetCandles(symbol, "1d", 260)
	if len(candles) < 20 {
		logx.Verbosef("Hot %s: backfilling OHLC (%d candles in DB)", symbol, len(candles))
		_ = s.fetchIncrementalOHLC(ctx, symbol)
		candles, _ = s.db.GetCandles(symbol, "1d", 260)
	}
	fund, _ := s.provider.GetFundamentals(ctx, symbol)
	if s.publisher != nil {
		if err := s.publishSymbol(ctx, symbol, quote, fund, candles, false); err != nil {
			return 0, err
		}
		logx.Verbosef("Hot %s: published to Firestore (ltp=%.2f)", symbol, quote.LTP)
	}
	if signals.IsMarketHoursIST() {
		s.evaluateSignals(ctx, symbol, quote, candles, fund)
	}
	return quote.LTP, nil
}

func (s *Scheduler) fetchIncrementalOHLC(ctx context.Context, symbol string) error {
	latest, _ := s.db.LatestCandleDate(symbol, "1d")
	from := time.Now().AddDate(-5, 0, 0)
	if !latest.IsZero() {
		from = latest.AddDate(0, 0, -3)
	}
	logx.Verbosef("OHLC %s: fetching from %s to now (latest in DB: %s)", symbol, from.Format("2006-01-02"), latest.Format("2006-01-02"))
	var candles []market.Candle
	err := market.FetchWithBackoff(ctx, 3, func() error {
		var e error
		candles, e = s.provider.GetOHLC(ctx, symbol, "1d", from, time.Now())
		return e
	})
	if err != nil {
		return err
	}
	if len(candles) == 0 {
		logx.Verbosef("OHLC %s: no new candles returned", symbol)
		return nil
	}
	logx.Verbosef("OHLC %s: upserting %d candles", symbol, len(candles))
	return s.db.UpsertCandles(symbol, "1d", candles)
}

func (s *Scheduler) publishSymbol(ctx context.Context, symbol string, quote *market.Quote, fund *market.Fundamentals, candles []market.Candle, publishChart bool) error {
	rsi, macd, macdSig, macdHist, sma20, sma50, sma200 := indicators.ComputeAll(candles)
	supports, resistances := indicators.SupportResistance(candles)
	w52h, w52l := store.Week52Range(candles)
	volRatio, _, _ := store.VolumeRatio(candles)

	meta, _ := s.db.GetSymbolMeta(symbol)
	capBucket, sector := "large", "general"
	capIdx, sectorIdx := "^NSEI", "^NSEI"
	if meta != nil {
		capBucket, sector = meta.CapBucket, meta.Sector
		if meta.CapIndexSymbol != "" {
			capIdx = meta.CapIndexSymbol
		}
		if meta.SectorIndexSymbol != "" {
			sectorIdx = meta.SectorIndexSymbol
		}
	}

	stockRet := signals.SessionReturn(candles)
	niftyRet := signals.SessionReturn(s.indexCandles["^NSEI"])
	capRet := signals.SessionReturn(s.indexCandles[capIdx])
	sectorRet := signals.SessionReturn(s.indexCandles[sectorIdx])

	fs := &store.FundamentalSnapshot{Symbol: strings.ToUpper(symbol), AsOf: time.Now(), Week52High: w52h, Week52Low: w52l}
	if fund != nil {
		fs.PE = fund.PE
		fs.MarketCap = fund.MarketCap
		fs.QuarterlyPerf = fund.QuarterlyPerf
		fs.YearlyPerf = fund.YearlyPerf
		_ = s.db.UpsertPEHistory(symbol, time.Now(), fund.PE)
	}
	_ = s.db.UpsertFundamentals(*fs)

	peHist, _ := s.db.GetPEHistory(symbol, 30)
	var peSeries []float64
	for i := len(peHist) - 1; i >= 0; i-- {
		peSeries = append(peSeries, peHist[i].PE)
	}

	payload := firebase.SlimStockPayload{
		Symbol: symbol, Name: quote.Name, Quote: quote, Fundamentals: fs,
		Indicators: map[string]float64{
			"rsi": rsi, "macd": macd, "macdSignal": macdSig, "macdHist": macdHist,
			"sma20": sma20, "sma50": sma50, "sma200": sma200,
		},
		Supports: supports, Resistances: resistances,
		Week52High: w52h, Week52Low: w52l, PESeries: peSeries,
		VsNiftyPct: stockRet - niftyRet, VsCapPct: stockRet - capRet, VsSectorPct: stockRet - sectorRet,
		CapBucket: capBucket, Sector: sector, VolumeRatio: volRatio, DataSource: s.provider.Name(),
	}
	if err := s.publisher.PublishSlimStock(ctx, payload); err != nil {
		return err
	}
	sym := strings.ToUpper(symbol)
	s.catalogCache[sym] = firebase.CatalogEntry{
		Symbol: sym, Name: quote.Name, LTP: quote.LTP, ChangePct: quote.ChangePct,
		MarketCap: fs.MarketCap, PE: fs.PE, Sector: sector,
		LastUpdated: time.Now().Format(time.RFC3339), DataSource: s.provider.Name(),
	}
	if publishChart {
		return s.publisher.PublishChartView(ctx, symbol, firebase.BuildChartPayload(candles))
	}
	return nil
}

func (s *Scheduler) evaluateSignals(ctx context.Context, symbol string, quote *market.Quote, candles []market.Candle, fund *market.Fundamentals) {
	meta, _ := s.db.GetSymbolMeta(symbol)
	capIdx, sectorIdx := "^NSEI", "^NSEI"
	isShocker := s.hotSet[symbol]
	if meta != nil {
		if meta.CapIndexSymbol != "" {
			capIdx = meta.CapIndexSymbol
		}
		if meta.SectorIndexSymbol != "" {
			sectorIdx = meta.SectorIndexSymbol
		}
	}
	volRatio, _, _ := store.VolumeRatio(candles)

	relInput := signals.RelativeEvalInput{
		Symbol: symbol, Quote: quote, Candles: candles, Fundamentals: fund, Meta: meta,
		CapCandles: s.indexCandles[capIdx], SectorCandles: s.indexCandles[sectorIdx],
		NiftyCandles: s.indexCandles["^NSEI"], VolumeRatio: volRatio, IsVolumeShocker: isShocker,
	}
	suggestions := signals.EvaluateRelative(relInput)
	legacy := signals.Evaluate(s.rules, signals.EvalInput{Symbol: symbol, Quote: quote, Candles: candles, Fundamentals: fund})
	suggestions = append(suggestions, legacy...)

	for _, sug := range suggestions {
		if s.publisher != nil {
			exists, _ := s.publisher.RecommendationExists(ctx, sug.ID)
			if exists {
				continue
			}
			fsID, err := s.publisher.PublishRecommendation(ctx, sug)
			if err != nil {
				logx.Warn("publish recommendation: %v", err)
				continue
			}
			_ = s.db.SaveSuggestion(sug.ID, sug.Symbol, sug.RuleID, sug.RuleName, sug.Side, sug.Entry, sug.SL, sug.Targets, sug.Confidence, signals.SnapshotJSON(sug.Snapshot))
			_ = s.db.SetFirestoreID(sug.ID, fsID)
		}
		logx.Info("SIGNAL: %s", signals.FormatSuggestionLog(sug))
	}
}

func (s *Scheduler) computeVolumeShockers(ctx context.Context, tradeDate string) {
	topN := 20
	if v := os.Getenv("VOLUME_SHOCKER_TOP_N"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			topN = n
		}
	}
	holdDays := 5
	if v := os.Getenv("VOLUME_SHOCKER_HOLD_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			holdDays = n
		}
	}

	type ranked struct {
		symbol string
		ratio  float64
		vol    int64
		avg20  float64
	}
	var all []ranked
	for _, sym := range s.fullBook {
		if market.IsIndexSymbol(sym) {
			continue
		}
		candles, err := s.db.GetCandles(sym, "1d", 25)
		if err != nil || len(candles) < 21 {
			continue
		}
		ratio, avg20, vol := store.VolumeRatio(candles)
		if ratio <= 0 {
			continue
		}
		all = append(all, ranked{sym, ratio, vol, avg20})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ratio > all[j].ratio })
	if len(all) > topN {
		all = all[:topN]
	}

	var rows []store.VolumeShockerRow
	var dayEntries []firebase.VolumeShockerEntry
	for i, r := range all {
		rows = append(rows, store.VolumeShockerRow{
			TradeDate: tradeDate, Symbol: r.symbol, Rank: i + 1,
			Volume: r.vol, Avg20: r.avg20, Ratio: r.ratio,
		})
		dayEntries = append(dayEntries, firebase.VolumeShockerEntry{
			Symbol: r.symbol, Rank: i + 1, Ratio: r.ratio, DaysRemaining: holdDays,
		})
		s.hotSet[r.symbol] = true
	}
	_ = s.db.SaveVolumeShockers(tradeDate, rows)

	activeMap, _ := s.db.ActiveVolumeShockers(holdDays)
	var activeEntries []firebase.VolumeShockerEntry
	for sym, days := range activeMap {
		activeEntries = append(activeEntries, firebase.VolumeShockerEntry{
			Symbol: sym, DaysRemaining: days, Ratio: 0, Rank: 0,
		})
	}
	if s.publisher != nil {
		_ = s.publisher.PublishVolumeShockers(ctx, tradeDate, dayEntries, activeEntries)
	}
	logx.Info("Volume shockers: %d symbols for %s", len(dayEntries), tradeDate)
}

func (s *Scheduler) RunHotIngestNow(ctx context.Context) int {
	logx.Info("Manual hot ingest requested — refreshing universe and hot set")
	s.refreshUniverse(ctx)
	s.refreshHotSet(ctx)
	logx.Info("Manual hot ingest: processing %d symbols", len(s.hotSet))
	count := 0
	var openRecs []firebase.OpenRecommendation
	if s.publisher != nil {
		openRecs, _ = s.publisher.LoadOpenRecommendations(ctx)
	}
	ltpBySymbol := make(map[string]float64)
	for sym := range s.hotSet {
		ltp, err := s.ingestHot(ctx, sym)
		if err != nil {
			logx.Error("Manual hot ingest %s: %v", sym, err)
		} else {
			count++
			if ltp > 0 {
				ltpBySymbol[sym] = ltp
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	if s.publisher != nil && len(ltpBySymbol) > 0 && len(openRecs) > 0 {
		s.publisher.CheckOpenRecommendationsBatch(ctx, ltpBySymbol, openRecs)
	}
	logx.Info("Manual hot ingest complete: %d/%d symbols", count, len(s.hotSet))
	s.flushCatalog(ctx, true)
	return count
}

// RunSymbolIngestNow fetches OHLC, fundamentals, indicators, and publishes stock + chart for one symbol.
func (s *Scheduler) RunSymbolIngestNow(ctx context.Context, symbol string) error {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return fmt.Errorf("symbol required")
	}
	logx.Info("Symbol ingest requested: %s", symbol)
	for _, idx := range market.IndexSymbols {
		if len(s.indexCandles[idx]) < 5 {
			_ = s.fetchIncrementalOHLC(ctx, idx)
			candles, _ := s.db.GetCandles(idx, "1d", 260)
			s.indexCandles[idx] = candles
		}
	}
	if err := s.ingestEOD(ctx, symbol, true); err != nil {
		return err
	}
	s.flushCatalog(ctx, true)
	logx.Info("Symbol ingest complete: %s", symbol)
	return nil
}

func DefaultSymbols() []string {
	raw := os.Getenv("WATCH_SYMBOLS")
	if raw == "" {
		return []string{"RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"}
	}
	parts := strings.Split(raw, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, strings.ToUpper(p))
		}
	}
	return out
}
