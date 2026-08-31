package market

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	yahooFinanceReferer = "https://finance.yahoo.com/"
	YahooBatchSize      = 50
	yahooCrumbTTL       = time.Hour
)

var (
	yahooQuoteURL     = "https://query1.finance.yahoo.com/v7/finance/quote"
	yahooCrumbURL     = "https://query2.finance.yahoo.com/v1/test/getcrumb"
	yahooBootstrapURL = "https://fc.yahoo.com"
)

// YahooProvider fetches delayed NSE/BSE quotes via Yahoo Finance (unofficial API).
type YahooProvider struct {
	client  *http.Client
	mu      sync.Mutex
	crumb   string
	crumbAt time.Time
}

func NewYahooProvider() *YahooProvider {
	jar, _ := cookiejar.New(nil)
	return &YahooProvider{
		client: &http.Client{
			Timeout: 30 * time.Second,
			Jar:     jar,
		},
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
	Symbol    string
	Name      string
	LTP       float64
	MarketCap float64
	PE        float64
	Exchange  string
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

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if err := p.ensureAuth(ctx); err != nil {
			return nil, err
		}
		out, err := p.fetchQuotes(ctx, yahooSyms, backMap)
		if err == nil {
			return out, nil
		}
		lastErr = err
		if attempt == 0 && yahooAuthRetryable(err) {
			p.invalidateAuth()
			continue
		}
		return nil, err
	}
	return nil, lastErr
}

func (p *YahooProvider) fetchQuotes(ctx context.Context, yahooSyms []string, backMap map[string]string) (map[string]*RegistryMarketSnapshot, error) {
	q := url.Values{}
	q.Set("symbols", strings.Join(yahooSyms, ","))
	q.Set("crumb", p.crumbValue())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, yahooQuoteURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	p.setBrowserHeaders(req)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo quote HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		QuoteResponse struct {
			Result []map[string]any `json:"result"`
		} `json:"quoteResponse"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
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

func (p *YahooProvider) ensureAuth(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.crumb != "" && time.Since(p.crumbAt) < yahooCrumbTTL {
		return nil
	}
	return p.bootstrapLocked(ctx)
}

func (p *YahooProvider) invalidateAuth() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.crumb = ""
	p.crumbAt = time.Time{}
}

func (p *YahooProvider) crumbValue() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.crumb
}

func (p *YahooProvider) bootstrapLocked(ctx context.Context) error {
	if err := p.loadCookiesFromEnv(); err != nil {
		return err
	}

	if strings.TrimSpace(os.Getenv("YAHOO_COOKIE")) == "" {
		if err := p.bootstrapCookies(ctx); err != nil {
			return err
		}
	}

	if crumb := strings.TrimSpace(os.Getenv("YAHOO_CRUMB")); crumb != "" {
		p.crumb = crumb
		p.crumbAt = time.Now()
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, yahooCrumbURL, nil)
	if err != nil {
		return err
	}
	p.setBrowserHeaders(req)

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("yahoo crumb HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	crumb := strings.TrimSpace(string(body))
	if crumb == "" {
		return fmt.Errorf("yahoo crumb empty")
	}
	p.crumb = crumb
	p.crumbAt = time.Now()
	return nil
}

func (p *YahooProvider) bootstrapCookies(ctx context.Context) error {
	endpoints := []string{yahooBootstrapURL, yahooFinanceReferer}
	var lastErr error
	for _, endpoint := range endpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return err
		}
		p.setBrowserHeaders(req)
		resp, err := p.client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 400 {
			return nil
		}
		lastErr = fmt.Errorf("yahoo bootstrap HTTP %d from %s", resp.StatusCode, endpoint)
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("yahoo bootstrap failed")
}

func (p *YahooProvider) loadCookiesFromEnv() error {
	raw := strings.TrimSpace(os.Getenv("YAHOO_COOKIE"))
	if raw == "" {
		return nil
	}
	u, err := url.Parse(yahooFinanceReferer)
	if err != nil {
		return err
	}
	var cookies []*http.Cookie
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		cookies = append(cookies, &http.Cookie{
			Name:  strings.TrimSpace(kv[0]),
			Value: strings.TrimSpace(kv[1]),
		})
	}
	if len(cookies) == 0 {
		return fmt.Errorf("YAHOO_COOKIE is set but no cookies parsed")
	}
	p.client.Jar.SetCookies(u, cookies)
	return nil
}

func (p *YahooProvider) setBrowserHeaders(req *http.Request) {
	req.Header.Set("User-Agent", yahooUserAgent())
	req.Header.Set("Accept", "application/json,text/plain,*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", yahooFinanceReferer)
}

func yahooAuthRetryable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "401") ||
		strings.Contains(msg, "403") ||
		strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "crumb")
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
		Symbol:    snap.Symbol,
		Name:      snap.Name,
		LTP:       snap.LTP,
		MarketCap: snap.MarketCap,
		Exchange:  snap.Exchange,
		UpdatedAt: time.Now(),
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
	return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
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
