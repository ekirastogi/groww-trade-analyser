package market

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const yahooQuoteURL = "https://query1.finance.yahoo.com/v7/finance/quote"
const YahooBatchSize = 50

// YahooProvider fetches delayed NSE/BSE quotes via Yahoo Finance (unofficial API).
type YahooProvider struct {
	client *http.Client
}

func NewYahooProvider() *YahooProvider {
	return &YahooProvider{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *YahooProvider) Name() string { return "yahoo" }

func (p *YahooProvider) Configured() bool { return true }

func ToYahooSymbol(symbol, exchange string) string {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	sym = strings.TrimSuffix(sym, ".NS")
	sym = strings.TrimSuffix(sym, ".BO")
	if exchange == "BSE" {
		return sym + ".BO"
	}
	return sym + ".NS"
}

func FromYahooSymbol(yahooSymbol string) (symbol, exchange string) {
	sym := strings.ToUpper(strings.TrimSpace(yahooSymbol))
	if strings.HasSuffix(sym, ".BO") {
		return strings.TrimSuffix(sym, ".BO"), "BSE"
	}
	if strings.HasSuffix(sym, ".NS") {
		return strings.TrimSuffix(sym, ".NS"), "NSE"
	}
	return sym, "NSE"
}

type RegistryQuoteInput struct {
	Symbol   string
	Exchange string
}

// RegistryMarketSnapshot is a delayed quote row from Yahoo Finance.
type RegistryMarketSnapshot struct {
	Symbol     string
	Name       string
	LTP        float64
	MarketCap  float64
	PE         float64
	Exchange   string
}

// FetchRegistryQuotesBatch fetches up to YahooBatchSize quotes in one Yahoo request.
func (p *YahooProvider) FetchRegistryQuotesBatch(ctx context.Context, entries []RegistryQuoteInput) (map[string]*RegistryMarketSnapshot, error) {
	if len(entries) == 0 {
		return nil, nil
	}
	if len(entries) > YahooBatchSize {
		entries = entries[:YahooBatchSize]
	}

	yahooSyms := make([]string, 0, len(entries))
	backMap := make(map[string]string, len(entries))
	for _, e := range entries {
		ys := ToYahooSymbol(e.Symbol, e.Exchange)
		yahooSyms = append(yahooSyms, ys)
		backMap[ys] = strings.ToUpper(strings.TrimSpace(e.Symbol))
	}

	q := url.Values{}
	q.Set("symbols", strings.Join(yahooSyms, ","))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, yahooQuoteURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", yahooUserAgent())
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("yahoo quote HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		QuoteResponse struct {
			Result []map[string]any `json:"result"`
		} `json:"quoteResponse"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("yahoo quote decode: %w", err)
	}

	out := make(map[string]*RegistryMarketSnapshot, len(payload.QuoteResponse.Result))
	for _, row := range payload.QuoteResponse.Result {
		ySym, _ := row["symbol"].(string)
		sym, exchange := FromYahooSymbol(ySym)
		if mapped, ok := backMap[strings.ToUpper(ySym)]; ok {
			sym = mapped
		}
		name, _ := row["shortName"].(string)
		if name == "" {
			name, _ = row["longName"].(string)
		}
		ltp := yahooFloat(row["regularMarketPrice"])
		if ltp == 0 {
			ltp = yahooFloat(row["regularMarketPreviousClose"])
		}
		out[sym] = &RegistryMarketSnapshot{
			Symbol:    sym,
			Name:      name,
			LTP:       ltp,
			MarketCap: yahooFloat(row["marketCap"]),
			PE:        yahooFloat(row["trailingPE"]),
			Exchange:  exchange,
		}
	}
	return out, nil
}

func (p *YahooProvider) GetQuote(ctx context.Context, symbol string) (*Quote, error) {
	m, err := p.FetchRegistryQuotesBatch(ctx, []RegistryQuoteInput{{Symbol: symbol, Exchange: "NSE"}})
	if err != nil {
		return nil, err
	}
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	snap := m[sym]
	if snap == nil || snap.LTP <= 0 {
		return nil, fmt.Errorf("yahoo: no quote for %s", sym)
	}
	return &Quote{
		Symbol:     snap.Symbol,
		Name:       snap.Name,
		LTP:        snap.LTP,
		MarketCap:  snap.MarketCap,
		Exchange:   snap.Exchange,
		UpdatedAt:  time.Now(),
	}, nil
}

func (p *YahooProvider) GetOHLC(ctx context.Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	return nil, fmt.Errorf("yahoo: use groww provider for OHLC history")
}

func (p *YahooProvider) GetFundamentals(ctx context.Context, symbol string) (*Fundamentals, error) {
	q, err := p.GetQuote(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return &Fundamentals{
		Symbol:    q.Symbol,
		MarketCap: q.MarketCap,
		PE:        0,
	}, nil
}

func (p *YahooProvider) GetNews(ctx context.Context, symbol string, limit int) ([]NewsItem, error) {
	return nil, nil
}

func (p *YahooProvider) SearchSymbol(ctx context.Context, query string) ([]SymbolInfo, error) {
	return nil, nil
}

func yahooFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	default:
		return 0
	}
}

func yahooUserAgent() string {
	if ua := strings.TrimSpace(os.Getenv("YAHOO_USER_AGENT")); ua != "" {
		return ua
	}
	return "Mozilla/5.0 (compatible; KairoTrader/1.0)"
}

func YahooBatchPause() time.Duration {
	ms := 1500
	if v := os.Getenv("YAHOO_BATCH_PAUSE_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			ms = n
		}
	}
	return time.Duration(ms) * time.Millisecond
}
