package ingestion

import (
	"context"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/signals"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

type Scheduler struct {
	provider    market.Provider
	db          *store.SQLiteStore
	publisher   *firebase.Publisher
	rules       []signals.Rule
	interval    time.Duration
	fullBook    []string
	hotSet      map[string]bool
	indexCandles map[string][]market.Candle
	lastEOD     string
}

func NewScheduler(provider market.Provider, db *store.SQLiteStore, pub *firebase.Publisher, symbols []string) *Scheduler {
	iv := 5 * time.Minute
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
	}
}

func (s *Scheduler) Run(ctx context.Context) {
	s.bootstrap(ctx)
	log.Printf("Ingestion scheduler started (interval=%s, fullBook=%d)", s.interval, len(s.fullBook))
	s.tick(ctx)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.refreshUniverse(ctx)
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) bootstrap(ctx context.Context) {
	s.loadMetaCSV()
	s.refreshUniverse(ctx)
	for _, idx := range market.IndexSymbols {
		_ = s.fetchIncrementalOHLC(ctx, idx)
		candles, _ := s.db.GetCandles(idx, "1d", 260)
		s.indexCandles[idx] = candles
	}
	// Initial EOD pass for full book
	s.runEOD(ctx)
}

func (s *Scheduler) loadMetaCSV() {
	path := store.FindMetaCSV()
	if path == "" {
		return
	}
	rows, err := store.LoadSymbolMetaCSV(path)
	if err != nil {
		log.Printf("symbol meta csv: %v", err)
		return
	}
	for _, m := range rows {
		_ = s.db.UpsertSymbolMeta(m)
	}
	log.Printf("Loaded %d symbol meta rows", len(rows))
}

func (s *Scheduler) refreshUniverse(ctx context.Context) {
	set := make(map[string]bool)
	for _, sym := range s.fullBook {
		set[strings.ToUpper(sym)] = true
	}
	if path := store.FindUniverseCSV(); path != "" {
		if syms, err := store.LoadUniverseCSV(path); err == nil {
			for _, sym := range syms {
				set[strings.ToUpper(sym)] = true
			}
		}
	}
	if s.publisher != nil {
		if syms, err := s.publisher.GetUniverseSymbols(ctx); err == nil {
			for _, sym := range syms {
				set[strings.ToUpper(sym)] = true
			}
		}
		if shockers, err := s.publisher.GetActiveVolumeShockers(ctx); err == nil {
			for sym := range shockers {
				set[sym] = true
				s.hotSet[sym] = true
			}
		}
	}
	var book []string
	for sym := range set {
		book = append(book, sym)
	}
	sort.Strings(book)
	s.fullBook = book
}

func (s *Scheduler) tick(ctx context.Context) {
	if s.shouldRunEOD() {
		s.runEOD(ctx)
	}
	s.refreshHotSet(ctx)
	for sym := range s.hotSet {
		if err := s.ingestHot(ctx, sym); err != nil {
			log.Printf("hot ingest %s: %v", sym, err)
		}
		time.Sleep(300 * time.Millisecond)
	}
}

func (s *Scheduler) refreshHotSet(ctx context.Context) {
	s.hotSet = make(map[string]bool)
	if s.publisher == nil {
		for _, sym := range s.fullBook {
			if len(s.fullBook) <= 30 {
				s.hotSet[sym] = true
			}
		}
		return
	}
	if shockers, err := s.publisher.GetActiveVolumeShockers(ctx); err == nil {
		for sym := range shockers {
			s.hotSet[sym] = true
		}
	}
	if syms, err := s.publisher.GetUniverseSymbols(ctx); err == nil {
		for _, sym := range syms {
			s.hotSet[strings.ToUpper(sym)] = true
		}
	}
	for _, sym := range DefaultSymbols() {
		s.hotSet[strings.ToUpper(sym)] = true
	}
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

func (s *Scheduler) runEOD(ctx context.Context) {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	today := time.Now().In(loc).Format("2006-01-02")
	log.Printf("EOD ingest for %d symbols", len(s.fullBook))
	for i, sym := range s.fullBook {
		if market.IsIndexSymbol(sym) {
			continue
		}
		if err := s.ingestEOD(ctx, sym, false); err != nil {
			log.Printf("eod %s: %v", sym, err)
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
	return s.publishSymbol(ctx, symbol, quote, fund, candles, publishChart, false)
}

func (s *Scheduler) ingestHot(ctx context.Context, symbol string) error {
	if market.IsIndexSymbol(symbol) {
		return nil
	}
	quote, err := s.provider.GetQuote(ctx, symbol)
	if err != nil {
		return err
	}
	candles, _ := s.db.GetCandles(symbol, "1d", 260)
	if len(candles) < 20 {
		_ = s.fetchIncrementalOHLC(ctx, symbol)
		candles, _ = s.db.GetCandles(symbol, "1d", 260)
	}
	fund, _ := s.provider.GetFundamentals(ctx, symbol)
	if s.publisher != nil {
		if err := s.publishSymbol(ctx, symbol, quote, fund, candles, false, true); err != nil {
			log.Printf("publish hot %s: %v", symbol, err)
		}
		s.publisher.CheckOpenRecommendations(ctx, symbol, quote.LTP)
	}
	if signals.IsMarketHoursIST() {
		s.evaluateSignals(ctx, symbol, quote, candles, fund)
	}
	return nil
}

func (s *Scheduler) fetchIncrementalOHLC(ctx context.Context, symbol string) error {
	latest, _ := s.db.LatestCandleDate(symbol, "1d")
	from := time.Now().AddDate(-5, 0, 0)
	if !latest.IsZero() {
		from = latest.AddDate(0, 0, -3)
	}
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
		return nil
	}
	return s.db.UpsertCandles(symbol, "1d", candles)
}

func (s *Scheduler) publishSymbol(ctx context.Context, symbol string, quote *market.Quote, fund *market.Fundamentals, candles []market.Candle, publishChart, hot bool) error {
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
	if publishChart || hot {
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
				log.Printf("publish recommendation: %v", err)
				continue
			}
			_ = s.db.SaveSuggestion(sug.ID, sug.Symbol, sug.RuleID, sug.RuleName, sug.Side, sug.Entry, sug.SL, sug.Targets, sug.Confidence, signals.SnapshotJSON(sug.Snapshot))
			_ = s.db.SetFirestoreID(sug.ID, fsID)
		}
		log.Printf("SIGNAL: %s", signals.FormatSuggestionLog(sug))
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
	log.Printf("Volume shockers: %d symbols for %s", len(dayEntries), tradeDate)
}

func (s *Scheduler) RunHotIngestNow(ctx context.Context) int {
	s.refreshUniverse(ctx)
	s.refreshHotSet(ctx)
	count := 0
	for sym := range s.hotSet {
		if err := s.ingestHot(ctx, sym); err != nil {
			log.Printf("hot ingest %s: %v", sym, err)
		} else {
			count++
		}
		time.Sleep(300 * time.Millisecond)
	}
	return count
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
