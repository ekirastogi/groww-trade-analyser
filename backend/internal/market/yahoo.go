package market

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type YahooProvider struct{}

func (p *YahooProvider) Name() string { return "yahoo" }

func (p *YahooProvider) yahooSymbol(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	if strings.HasPrefix(s, "^") {
		return s
	}
	if strings.Contains(s, ".") {
		return s
	}
	return s + ".NS"
}

func (p *YahooProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	ys := url.QueryEscape(p.yahooSymbol(symbol))
	u := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=1d", ys)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var parsed yahooChartResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, fmt.Errorf("yahoo: no data for %s", symbol)
	}

	r := parsed.Chart.Result[0]
	meta := r.Meta
	ltp := meta.RegularMarketPrice
	prev := meta.ChartPreviousClose
	if prev == 0 {
		prev = meta.PreviousClose
	}
	change := ltp - prev
	changePct := 0.0
	if prev != 0 {
		changePct = (change / prev) * 100
	}

	return &Quote{
		Symbol:    strings.ToUpper(symbol),
		Name:      meta.ShortName,
		LTP:       ltp,
		Change:    change,
		ChangePct: changePct,
		Open:      meta.RegularMarketOpen,
		High:      meta.RegularMarketDayHigh,
		Low:       meta.RegularMarketDayLow,
		PrevClose: prev,
		Volume:    meta.RegularMarketVolume,
		Exchange:  "NSE",
		UpdatedAt: time.Now(),
	}, nil
}

func (p *YahooProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	ys := url.QueryEscape(p.yahooSymbol(symbol))
	rangeParam := "1y"
	if !from.IsZero() && !to.IsZero() {
		days := int(to.Sub(from).Hours() / 24)
		if days <= 30 {
			rangeParam = "1mo"
		} else if days <= 90 {
			rangeParam = "3mo"
		} else if days <= 180 {
			rangeParam = "6mo"
		}
	}
	iv := "1d"
	if interval == "1wk" {
		iv = "1wk"
	}
	u := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=%s&range=%s", ys, iv, rangeParam)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var parsed yahooChartResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, fmt.Errorf("yahoo: no OHLC for %s", symbol)
	}

	r := parsed.Chart.Result[0]
	timestamps := r.Timestamp
	quotes := r.Indicators.Quote[0]
	candles := make([]Candle, 0, len(timestamps))

	for i, ts := range timestamps {
		if quotes.Open[i] == nil || quotes.Close[i] == nil {
			continue
		}
		t := time.Unix(ts, 0).UTC()
		if !from.IsZero() && t.Before(from) {
			continue
		}
		if !to.IsZero() && t.After(to) {
			continue
		}
		vol := int64(0)
		if quotes.Volume[i] != nil {
			vol = int64(*quotes.Volume[i])
		}
		candles = append(candles, Candle{
			Time:   t,
			Open:   *quotes.Open[i],
			High:   *quotes.High[i],
			Low:    *quotes.Low[i],
			Close:  *quotes.Close[i],
			Volume: vol,
		})
	}
	return candles, nil
}

func (p *YahooProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	q, err := p.GetQuote(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return &Fundamentals{
		Symbol:        strings.ToUpper(symbol),
		MarketCap:     q.MarketCap,
		QuarterlyPerf: 0,
		YearlyPerf:    0,
		TargetsHigh:   q.LTP * 1.15,
		TargetsLow:    q.LTP * 0.85,
		TargetsAvg:    q.LTP * 1.05,
	}, nil
}

func (p *YahooProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return []NewsItem{}, nil
}

func (p *YahooProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	q := strings.ToUpper(strings.TrimSpace(query))
	if q == "" {
		return nil, nil
	}
	return []SymbolInfo{{Symbol: q, Name: q, Exchange: "NSE"}}, nil
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				ShortName            string  `json:"shortName"`
				RegularMarketPrice   float64 `json:"regularMarketPrice"`
				ChartPreviousClose   float64 `json:"chartPreviousClose"`
				PreviousClose        float64 `json:"previousClose"`
				RegularMarketOpen    float64 `json:"regularMarketOpen"`
				RegularMarketDayHigh float64 `json:"regularMarketDayHigh"`
				RegularMarketDayLow  float64 `json:"regularMarketDayLow"`
				RegularMarketVolume  int64   `json:"regularMarketVolume"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
	} `json:"chart"`
}
