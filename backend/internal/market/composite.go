package market

import (
	"context"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
)

// CompositeProvider uses Stooq for OHLC and Yahoo for quotes/fundamentals.
type CompositeProvider struct {
	ohlc   Provider
	quotes Provider
}

func NewCompositeProvider() *CompositeProvider {
	return &CompositeProvider{
		ohlc:   NewStooqProvider(),
		quotes: &YahooProvider{},
	}
}

func (p *CompositeProvider) Name() string { return "stooq+yahoo" }

func (p *CompositeProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	q, err := p.quotes.GetQuote(ctx, symbol)
	if err != nil {
		return p.ohlc.GetQuote(ctx, symbol)
	}
	return q, nil
}

func (p *CompositeProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	// Yahoo first — Stooq often returns bot-check HTML for automated requests.
	candles, err := p.quotes.GetOHLC(ctx, symbol, interval, from, to)
	if err == nil && len(candles) > 0 {
		logx.Verbosef("OHLC %s: yahoo returned %d candles", symbol, len(candles))
		return candles, nil
	}
	if err != nil {
		logx.Verbosef("OHLC %s: yahoo failed: %v — trying stooq", symbol, err)
	}
	fallback, fbErr := p.ohlc.GetOHLC(ctx, symbol, interval, from, to)
	if fbErr != nil {
		if err != nil {
			return nil, err
		}
		return nil, fbErr
	}
	logx.Verbosef("OHLC %s: stooq returned %d candles", symbol, len(fallback))
	return fallback, nil
}

func (p *CompositeProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	return p.quotes.GetFundamentals(ctx, symbol)
}

func (p *CompositeProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return p.quotes.GetNews(ctx, symbol, limit)
}

func (p *CompositeProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	return p.quotes.SearchSymbol(ctx, query)
}

// IndexSymbols are benchmark indices ingested alongside stocks.
var IndexSymbols = []string{
	"^NSEI",      // Nifty 50
	"^NSEMDCP50", // Nifty Midcap (Yahoo)
	"^CNXSC",     // Nifty Smallcap
	"^CNXIT",     // Nifty IT
	"^NSEBANK",   // Nifty Bank
	"^CNXPHARMA", // Nifty Pharma
}

func IsIndexSymbol(symbol string) bool {
	s := symbol
	for _, idx := range IndexSymbols {
		if idx == s {
			return true
		}
	}
	return false
}

func NewProvider(name string) Provider {
	switch name {
	case "nse":
		return &NSEProvider{}
	case "groww":
		return &GrowwProvider{}
	case "yahoo":
		return &YahooProvider{}
	case "stooq":
		return NewStooqProvider()
	case "stooq+yahoo", "composite":
		return NewCompositeProvider()
	default:
		return NewCompositeProvider()
	}
}

// BackoffSleep sleeps with exponential backoff for rate limits.
func BackoffSleep(attempt int) {
	d := time.Duration(attempt*attempt) * 500 * time.Millisecond
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	time.Sleep(d)
}

func FetchWithBackoff(ctx context.Context, attempts int, fn func() error) error {
	var last error
	for i := 0; i < attempts; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := fn(); err != nil {
			last = err
			BackoffSleep(i + 1)
			continue
		}
		return nil
	}
	return last
}
