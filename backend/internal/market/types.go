package market

import (
	"context"
	"time"
)

type Context = context.Context

type Quote struct {
	Symbol     string    `json:"symbol"`
	Name       string    `json:"name"`
	LTP        float64   `json:"ltp"`
	Change     float64   `json:"change"`
	ChangePct  float64   `json:"changePct"`
	Open       float64   `json:"open"`
	High       float64   `json:"high"`
	Low        float64   `json:"low"`
	PrevClose  float64   `json:"prevClose"`
	Volume     int64     `json:"volume"`
	MarketCap  float64   `json:"marketCap"`
	Exchange   string    `json:"exchange"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Candle struct {
	Time   time.Time `json:"time"`
	Open   float64   `json:"open"`
	High   float64   `json:"high"`
	Low    float64   `json:"low"`
	Close  float64   `json:"close"`
	Volume int64     `json:"volume"`
}

type Fundamentals struct {
	Symbol        string  `json:"symbol"`
	MarketCap     float64 `json:"marketCap"`
	QuarterlyPerf float64 `json:"quarterlyPerf"`
	YearlyPerf    float64 `json:"yearlyPerf"`
	TargetsHigh   float64 `json:"targetsHigh"`
	TargetsLow    float64 `json:"targetsLow"`
	TargetsAvg    float64 `json:"targetsAvg"`
	Sector        string  `json:"sector"`
	PE            float64 `json:"pe"`
}

type NewsItem struct {
	ID          string    `json:"id"`
	Symbol      string    `json:"symbol"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
	Summary     string    `json:"summary"`
}

type SymbolInfo struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"`
	ISIN     string `json:"isin,omitempty"`
}

type Provider interface {
	Name() string
	GetQuote(ctx Context, symbol string) (*Quote, error)
	GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error)
	GetFundamentals(ctx Context, symbol string) (*Fundamentals, error)
	GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error)
	SearchSymbol(ctx Context, query string) ([]SymbolInfo, error)
}
