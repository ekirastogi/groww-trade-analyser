package firebase

import (
	"context"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/signals"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type SlimStockPayload struct {
	Symbol           string
	Name             string
	Quote            *market.Quote
	Fundamentals     *store.FundamentalSnapshot
	Indicators       map[string]float64
	Supports         []float64
	Resistances      []float64
	Week52High       float64
	Week52Low        float64
	PESeries         []float64
	VsNiftyPct       float64
	VsCapPct         float64
	VsSectorPct      float64
	CapBucket        string
	Sector           string
	VolumeRatio      float64
	DataSource       string
}

type ChartPayload struct {
	Candles    []market.Candle
	Indicators []map[string]float64
	SMA20      []float64
	SMA50      []float64
	SMA200     []float64
}

func (p *Publisher) PublishSlimStock(ctx context.Context, payload SlimStockPayload) error {
	sym := strings.ToUpper(payload.Symbol)
	mcap := 0.0
	pe := 0.0
	qp, yp := 0.0, 0.0
	if payload.Fundamentals != nil {
		mcap = payload.Fundamentals.MarketCap
		pe = payload.Fundamentals.PE
		qp = payload.Fundamentals.QuarterlyPerf
		yp = payload.Fundamentals.YearlyPerf
	}
	if payload.Quote != nil && mcap == 0 {
		mcap = payload.Quote.MarketCap
	}

	doc := map[string]interface{}{
		"symbol":           sym,
		"name":             payload.Name,
		"exchange":         "NSE",
		"ltp":              payload.Quote.LTP,
		"change":           payload.Quote.Change,
		"changePct":        payload.Quote.ChangePct,
		"marketCap":        mcap,
		"pe":               pe,
		"week52High":       payload.Week52High,
		"week52Low":        payload.Week52Low,
		"supportLevels":    payload.Supports,
		"resistanceLevels": payload.Resistances,
		"quarterlyPerf":    qp,
		"yearlyPerf":       yp,
		"indicators":       payload.Indicators,
		"peSeries":         payload.PESeries,
		"vsNiftyPct":       payload.VsNiftyPct,
		"vsCapIndexPct":    payload.VsCapPct,
		"vsSectorPct":      payload.VsSectorPct,
		"capBucket":        payload.CapBucket,
		"sector":           payload.Sector,
		"volumeRatio":      payload.VolumeRatio,
		"lastUpdated":      time.Now().Format(time.RFC3339),
		"dataSource":       payload.DataSource,
	}
	_, err := p.client.Collection("stocks").Doc(sym).Set(ctx, doc, firestore.MergeAll)
	return err
}

func (p *Publisher) PublishChartView(ctx context.Context, symbol string, chart ChartPayload) error {
	sym := strings.ToUpper(symbol)
	candleDocs := make([]map[string]interface{}, 0, len(chart.Candles))
	for _, c := range chart.Candles {
		candleDocs = append(candleDocs, map[string]interface{}{
			"time": c.Time.Format("2006-01-02"), "open": c.Open, "high": c.High,
			"low": c.Low, "close": c.Close, "volume": c.Volume,
		})
	}
	doc := map[string]interface{}{
		"symbol":     sym,
		"candles":    candleDocs,
		"sma20":      chart.SMA20,
		"sma50":      chart.SMA50,
		"sma200":     chart.SMA200,
		"updatedAt":  time.Now().Format(time.RFC3339),
	}
	_, err := p.client.Collection("stocks").Doc(sym).Collection("views").Doc("chart").Set(ctx, doc)
	return err
}

func BuildChartPayload(candles []market.Candle) ChartPayload {
	if len(candles) > 252 {
		candles = candles[len(candles)-252:]
	}
	closes := make([]float64, len(candles))
	for i, c := range candles {
		closes[i] = c.Close
	}
	sma20s := rollingSMA(closes, 20)
	sma50s := rollingSMA(closes, 50)
	sma200s := rollingSMA(closes, 200)
	return ChartPayload{Candles: candles, SMA20: sma20s, SMA50: sma50s, SMA200: sma200s}
}

func rollingSMA(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range values {
		if i+1 < period {
			out[i] = 0
			continue
		}
		sum := 0.0
		for j := i - period + 1; j <= i; j++ {
			sum += values[j]
		}
		out[i] = sum / float64(period)
	}
	return out
}

func (p *Publisher) GetUniverseSymbols(ctx context.Context) ([]string, error) {
	set := make(map[string]bool)
	iter := p.client.Collection("universe").Documents(ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		id := strings.ToUpper(doc.Ref.ID)
		if id != "" {
			set[id] = true
		}
		data := doc.Data()
		if sym, ok := data["symbol"].(string); ok && sym != "" {
			set[strings.ToUpper(sym)] = true
		}
	}
	var out []string
	for s := range set {
		out = append(out, s)
	}
	return out, nil
}

func (p *Publisher) GetActiveVolumeShockers(ctx context.Context) (map[string]int, error) {
	doc, err := p.client.Collection("volumeShockers").Doc("active").Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return map[string]int{}, nil
		}
		return nil, err
	}
	data := doc.Data()
	items, _ := data["symbols"].([]interface{})
	out := make(map[string]int)
	for _, it := range items {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		sym, _ := m["symbol"].(string)
		days := 1
		if d, ok := m["daysRemaining"].(int64); ok {
			days = int(d)
		}
		if sym != "" {
			out[strings.ToUpper(sym)] = days
		}
	}
	return out, nil
}

type VolumeShockerEntry struct {
	Symbol        string
	Rank          int
	Ratio         float64
	DaysRemaining int
}

func (p *Publisher) PublishVolumeShockers(ctx context.Context, tradeDate string, entries []VolumeShockerEntry, active []VolumeShockerEntry) error {
	dayItems := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		dayItems = append(dayItems, map[string]interface{}{
			"symbol": e.Symbol, "rank": e.Rank, "ratio": e.Ratio,
		})
	}
	if _, err := p.client.Collection("volumeShockers").Doc(tradeDate).Set(ctx, map[string]interface{}{
		"tradeDate": tradeDate, "symbols": dayItems, "updatedAt": time.Now().Format(time.RFC3339),
	}); err != nil {
		return err
	}
	activeItems := make([]map[string]interface{}, 0, len(active))
	for _, e := range active {
		activeItems = append(activeItems, map[string]interface{}{
			"symbol": e.Symbol, "rank": e.Rank, "ratio": e.Ratio, "daysRemaining": e.DaysRemaining,
		})
	}
	_, err := p.client.Collection("volumeShockers").Doc("active").Set(ctx, map[string]interface{}{
		"symbols": activeItems, "updatedAt": time.Now().Format(time.RFC3339),
	})
	return err
}

func (p *Publisher) PublishRecommendation(ctx context.Context, s signals.Suggestion) (string, error) {
	id := s.ID
	doc := map[string]interface{}{
		"symbol":         s.Symbol,
		"ruleId":         s.RuleID,
		"ruleName":       s.RuleName,
		"side":           s.Side,
		"entry":          s.Entry,
		"sl":             s.SL,
		"targets":        s.Targets,
		"confidence":     s.Confidence,
		"horizon":        string(s.Horizon),
		"capBucket":      s.CapBucket,
		"sector":         s.Sector,
		"vsNiftyPct":     s.VsNiftyPct,
		"vsCapIndexPct":  s.VsCapPct,
		"vsSectorPct":    s.VsSectorPct,
		"volumeRatio":    s.VolumeRatio,
		"status":         "pending_approval",
		"approvalStatus": "pending",
		"signalSnapshot": s.Snapshot,
		"createdAt":      time.Now().Format(time.RFC3339),
		"platform":       "groww",
	}
	_, err := p.client.Collection("recommendations").Doc(id).Set(ctx, doc, firestore.MergeAll)
	return id, err
}

// PublishStock legacy wrapper — redirects to slim + chart.
func (p *Publisher) PublishStock(ctx context.Context, symbol string, quote *market.Quote, fund *market.Fundamentals, candles []market.Candle, news []market.NewsItem, dataSource string) error {
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

	if err := p.PublishSlimStock(ctx, SlimStockPayload{
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
	return p.PublishChartView(ctx, symbol, BuildChartPayload(candles))
}

func (p *Publisher) GetWatchlistSymbols(ctx context.Context) ([]string, error) {
	return p.GetUniverseSymbols(ctx)
}
