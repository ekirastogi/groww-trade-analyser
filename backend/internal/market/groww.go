package market

import (
	"fmt"
	"strings"
	"time"
)

// GrowwProvider is a stub for future Groww API integration (quotes + order execution).
type GrowwProvider struct{}

func (p *GrowwProvider) Name() string { return "groww" }

func (p *GrowwProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	return nil, fmt.Errorf("groww provider: not configured — set GROWW_API_TOKEN and implement Groww API")
}

func (p *GrowwProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	return nil, fmt.Errorf("groww provider: OHLC not implemented")
}

func (p *GrowwProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	return nil, fmt.Errorf("groww provider: fundamentals not implemented")
}

func (p *GrowwProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return nil, fmt.Errorf("groww provider: news not implemented")
}

func (p *GrowwProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	q := strings.ToUpper(strings.TrimSpace(query))
	if q == "" {
		return nil, nil
	}
	return []SymbolInfo{{Symbol: q, Name: q, Exchange: "NSE"}}, nil
}

// PlaceOrder executes a trade on Groww (future implementation).
func (p *GrowwProvider) PlaceOrder(ctx Context, symbol, side string, qty int, price float64) (string, error) {
	return "", fmt.Errorf("groww order execution: not implemented — wire Groww trading API here")
}
