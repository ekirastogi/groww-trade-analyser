package market

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type NSEProvider struct{}

func (p *NSEProvider) Name() string { return "nse" }

func (p *NSEProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	u := fmt.Sprintf("https://www.nseindia.com/api/quote-equity?symbol=%s", sym)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://www.nseindia.com/")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nse: status %d for %s", resp.StatusCode, sym)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var data nseQuoteResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}

	ltp := data.PriceInfo.LastPrice
	prev := data.PriceInfo.PreviousClose
	change := ltp - prev
	changePct := 0.0
	if prev != 0 {
		changePct = (change / prev) * 100
	}

	return &Quote{
		Symbol:    sym,
		Name:      data.Info.CompanyName,
		LTP:       ltp,
		Change:    change,
		ChangePct: changePct,
		Open:      data.PriceInfo.Open,
		High:      data.PriceInfo.IntraDayHighLow.Max,
		Low:       data.PriceInfo.IntraDayHighLow.Min,
		PrevClose: prev,
		Exchange:  "NSE",
		UpdatedAt: time.Now(),
	}, nil
}

func (p *NSEProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	yahoo := &YahooProvider{}
	return yahoo.GetOHLC(ctx, symbol, interval, from, to)
}

func (p *NSEProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	yahoo := &YahooProvider{}
	return yahoo.GetFundamentals(ctx, symbol)
}

func (p *NSEProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return []NewsItem{}, nil
}

func (p *NSEProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	return (&YahooProvider{}).SearchSymbol(ctx, query)
}

type nseQuoteResponse struct {
	Info struct {
		CompanyName string `json:"companyName"`
	} `json:"info"`
	PriceInfo struct {
		LastPrice        float64 `json:"lastPrice"`
		PreviousClose    float64 `json:"previousClose"`
		Open             float64 `json:"open"`
		IntraDayHighLow  struct {
			Min float64 `json:"min"`
			Max float64 `json:"max"`
		} `json:"intraDayHighLow"`
	} `json:"priceInfo"`
}
