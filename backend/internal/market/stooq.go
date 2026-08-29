package market

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// StooqProvider fetches daily OHLC from stooq.com (no API key).
type StooqProvider struct {
	client *http.Client
}

func NewStooqProvider() *StooqProvider {
	return &StooqProvider{client: &http.Client{Timeout: 45 * time.Second}}
}

func (p *StooqProvider) Name() string { return "stooq" }

func (p *StooqProvider) stooqSymbol(symbol string) string {
	s := strings.ToLower(strings.TrimSpace(symbol))
	if strings.Contains(s, ".") {
		return s
	}
	return s + ".in"
}

func (p *StooqProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	candles, err := p.GetOHLC(ctx, symbol, "1d", time.Now().AddDate(0, 0, -10), time.Now())
	if err != nil || len(candles) == 0 {
		return nil, fmt.Errorf("stooq: no quote for %s", symbol)
	}
	last := candles[len(candles)-1]
	prev := last.Close
	if len(candles) >= 2 {
		prev = candles[len(candles)-2].Close
	}
	change := last.Close - prev
	changePct := 0.0
	if prev != 0 {
		changePct = change / prev * 100
	}
	return &Quote{
		Symbol:    strings.ToUpper(symbol),
		Name:      strings.ToUpper(symbol),
		LTP:       last.Close,
		Change:    change,
		ChangePct: changePct,
		Open:      last.Open,
		High:      last.High,
		Low:       last.Low,
		PrevClose: prev,
		Volume:    last.Volume,
		Exchange:  "NSE",
		UpdatedAt: time.Now(),
	}, nil
}

func (p *StooqProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	if interval != "1d" && interval != "1wk" {
		return nil, fmt.Errorf("stooq: unsupported interval %s", interval)
	}
	stooq := p.stooqSymbol(symbol)
	url := fmt.Sprintf("https://stooq.com/q/d/l/?s=%s&i=d", stooq)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "groww-trader/1.0")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stooq: http %d for %s", resp.StatusCode, symbol)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if !looksLikeStooqCSV(body) {
		return nil, fmt.Errorf("stooq: non-csv response for %s (rate limit or bot check)", symbol)
	}

	all, err := parseStooqCSV(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	var out []Candle
	for _, c := range all {
		if !from.IsZero() && c.Time.Before(from) {
			continue
		}
		if !to.IsZero() && c.Time.After(to) {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

func looksLikeStooqCSV(body []byte) bool {
	trim := strings.TrimSpace(string(body))
	if trim == "" {
		return false
	}
	if strings.HasPrefix(trim, "<") || strings.Contains(trim, "<!DOCTYPE") {
		return false
	}
	return strings.HasPrefix(trim, "Date,")
}

func parseStooqCSV(r io.Reader) ([]Candle, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("stooq: empty csv")
	}
	var candles []Candle
	for i, row := range rows {
		if i == 0 {
			continue
		}
		if len(row) < 6 {
			continue
		}
		t, err := time.Parse("2006-01-02", row[0])
		if err != nil {
			continue
		}
		open, _ := strconv.ParseFloat(row[1], 64)
		high, _ := strconv.ParseFloat(row[2], 64)
		low, _ := strconv.ParseFloat(row[3], 64)
		close, _ := strconv.ParseFloat(row[4], 64)
		vol, _ := strconv.ParseInt(row[5], 10, 64)
		candles = append(candles, Candle{
			Time: t, Open: open, High: high, Low: low, Close: close, Volume: vol,
		})
	}
	return candles, nil
}

func (p *StooqProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	return nil, fmt.Errorf("stooq: fundamentals not available")
}

func (p *StooqProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return nil, nil
}

func (p *StooqProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	return nil, nil
}
