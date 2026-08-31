package datapub

import (
	"context"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/signals"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

type ApprovalHandler func(ctx context.Context, recommendationID string, data map[string]interface{}) error

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

type CatalogEntry struct {
	Symbol      string
	Name        string
	LTP         float64
	ChangePct   float64
	MarketCap   float64
	PE          float64
	Sector      string
	LastUpdated string
	DataSource  string
}

type VolumeShockerEntry struct {
	Symbol        string
	Rank          int
	Ratio         float64
	DaysRemaining int
}

type OpenRecommendation struct {
	ID   string
	Data map[string]interface{}
}

type Backend interface {
	PublishSlimStock(ctx context.Context, payload SlimStockPayload) error
	PublishChartView(ctx context.Context, symbol string, chart ChartPayload) error
	GetRegistrySymbols(ctx context.Context) ([]string, error)
	GetActiveVolumeShockers(ctx context.Context) (map[string]int, error)
	PublishVolumeShockers(ctx context.Context, tradeDate string, entries, active []VolumeShockerEntry) error
	PublishRecommendation(ctx context.Context, s signals.Suggestion) (string, error)
	PublishOutcome(ctx context.Context, recommendationID string, exitPrice float64, reason string, pnlPct float64) error
	MarkExecuting(ctx context.Context, id string) error
	MarkRejected(ctx context.Context, id string) error
	LoadOpenRecommendations(ctx context.Context) ([]OpenRecommendation, error)
	CheckOpenRecommendationsBatch(ctx context.Context, ltpBySymbol map[string]float64, docs []OpenRecommendation)
	RecommendationExists(ctx context.Context, id string) (bool, error)
	PollApprovalsOnce(ctx context.Context, seen map[string]bool, handler ApprovalHandler) error
	PublishMarketCatalog(ctx context.Context, entries []CatalogEntry) error
	LoadMarketCatalog(ctx context.Context) ([]CatalogEntry, error)
	SyncRegistrySymbols(ctx context.Context, userID string, entries []market.ExchangeSymbol) (int, error)
	GetWatchlistSymbols(ctx context.Context) ([]string, error)
	PublishStock(ctx context.Context, symbol string, quote *market.Quote, fund *market.Fundamentals, candles []market.Candle, news []market.NewsItem, dataSource string) error
}
