package market

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// GrowwProvider fetches market data and places orders via the official Groww Trade API.
type GrowwProvider struct {
	client *GrowwClient
}

func NewGrowwProvider() *GrowwProvider {
	return &GrowwProvider{client: NewGrowwClient()}
}

func (p *GrowwProvider) Name() string { return "groww" }

func (p *GrowwProvider) Configured() bool {
	return p.client != nil && p.client.Configured()
}

type growwQuotePayload struct {
	LastPrice       float64 `json:"last_price"`
	DayChange       float64 `json:"day_change"`
	DayChangePerc   float64 `json:"day_change_perc"`
	Volume          int64   `json:"volume"`
	MarketCap       float64 `json:"market_cap"`
	Week52High      float64 `json:"week_52_high"`
	Week52Low       float64 `json:"week_52_low"`
	Open            float64 `json:"open"`
	High            float64 `json:"high"`
	Low             float64 `json:"low"`
	Close           float64 `json:"close"`
	OHLC            any     `json:"ohlc"`
}

func (p *GrowwProvider) GetQuote(ctx Context, symbol string) (*Quote, error) {
	tradingSymbol := ToTradingSymbol(symbol)
	q := url.Values{}
	q.Set("exchange", "NSE")
	q.Set("segment", "CASH")
	q.Set("trading_symbol", tradingSymbol)

	var payload growwQuotePayload
	if err := p.client.get(ctx, "/v1/live-data/quote", q, &payload); err != nil {
		return nil, err
	}
	ohlc := parseGrowwOHLC(payload.OHLC)
	open, high, low, close := payload.Open, payload.High, payload.Low, payload.Close
	if open == 0 && ohlc != nil {
		open, high, low, close = ohlc.Open, ohlc.High, ohlc.Low, ohlc.Close
	}
	prevClose := close
	if payload.DayChange != 0 && payload.LastPrice != 0 {
		prevClose = payload.LastPrice - payload.DayChange
	}
	return &Quote{
		Symbol:    strings.ToUpper(strings.TrimPrefix(symbol, "^")),
		Name:      tradingSymbol,
		LTP:       payload.LastPrice,
		Change:    payload.DayChange,
		ChangePct: payload.DayChangePerc,
		Open:      open,
		High:      high,
		Low:       low,
		PrevClose: prevClose,
		Volume:    payload.Volume,
		MarketCap: payload.MarketCap,
		Exchange:  "NSE",
		UpdatedAt: time.Now(),
	}, nil
}

type growwOHLC struct {
	Open  float64
	High  float64
	Low   float64
	Close float64
}

var growwOHLCPattern = regexp.MustCompile(`open:\s*([0-9.]+).*high:\s*([0-9.]+).*low:\s*([0-9.]+).*close:\s*([0-9.]+)`)

func parseGrowwOHLC(raw any) *growwOHLC {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case map[string]any:
		return &growwOHLC{
			Open:  toFloat(v["open"]),
			High:  toFloat(v["high"]),
			Low:   toFloat(v["low"]),
			Close: toFloat(v["close"]),
		}
	case string:
		m := growwOHLCPattern.FindStringSubmatch(v)
		if len(m) != 5 {
			return nil
		}
		return &growwOHLC{
			Open:  parseFloat(m[1]),
			High:  parseFloat(m[2]),
			Low:   parseFloat(m[3]),
			Close: parseFloat(m[4]),
		}
	default:
		b, err := json.Marshal(raw)
		if err != nil {
			return nil
		}
		var m map[string]float64
		if err := json.Unmarshal(b, &m); err != nil {
			return nil
		}
		return &growwOHLC{
			Open:  m["open"],
			High:  m["high"],
			Low:   m["low"],
			Close: m["close"],
		}
	}
}

func (p *GrowwProvider) GetOHLC(ctx Context, symbol, interval string, from, to time.Time) ([]Candle, error) {
	if interval != "1d" && interval != "1D" {
		return nil, fmt.Errorf("groww: only 1d interval is supported (got %s)", interval)
	}

	growwSymbol := ToGrowwSymbol(symbol)
	loc, _ := time.LoadLocation("Asia/Kolkata")
	from = from.In(loc)
	to = to.In(loc)

	var all []Candle
	chunkStart := from
	for chunkStart.Before(to) {
		chunkEnd := chunkStart.AddDate(0, 0, 179)
		if chunkEnd.After(to) {
			chunkEnd = to
		}
		q := url.Values{}
		q.Set("exchange", "NSE")
		q.Set("segment", "CASH")
		q.Set("groww_symbol", growwSymbol)
		q.Set("start_time", chunkStart.Format("2006-01-02 15:04:05"))
		q.Set("end_time", chunkEnd.Format("2006-01-02 15:04:05"))
		q.Set("candle_interval", "1day")

		var payload struct {
			Candles [][]any `json:"candles"`
		}
		if err := p.client.get(ctx, "/v1/historical/candles", q, &payload); err != nil {
			return nil, err
		}
		for _, row := range payload.Candles {
			if len(row) < 5 {
				continue
			}
			ts, err := parseGrowwCandleTime(row[0], loc)
			if err != nil {
				continue
			}
			all = append(all, Candle{
				Time:   ts,
				Open:   toFloat(row[1]),
				High:   toFloat(row[2]),
				Low:    toFloat(row[3]),
				Close:  toFloat(row[4]),
				Volume: int64(toFloat(row[5])),
			})
		}
		chunkStart = chunkEnd.AddDate(0, 0, 1)
	}
	return all, nil
}

func parseGrowwCandleTime(raw any, loc *time.Location) (time.Time, error) {
	switch v := raw.(type) {
	case string:
		for _, layout := range []string{
			time.RFC3339,
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05",
			"2006-01-02",
		} {
			if t, err := time.ParseInLocation(layout, v, loc); err == nil {
				return t, nil
			}
		}
		return time.Time{}, fmt.Errorf("unsupported candle time %q", v)
	case float64:
		sec := int64(v)
		if sec > 1_000_000_000_000 {
			sec /= 1000
		}
		return time.Unix(sec, 0).In(loc), nil
	default:
		return time.Time{}, fmt.Errorf("unsupported candle time type %T", raw)
	}
}

func (p *GrowwProvider) GetFundamentals(ctx Context, symbol string) (*Fundamentals, error) {
	quote, err := p.GetQuote(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return &Fundamentals{
		Symbol:    ToTradingSymbol(symbol),
		MarketCap: quote.MarketCap,
	}, nil
}

func (p *GrowwProvider) GetNews(ctx Context, symbol string, limit int) ([]NewsItem, error) {
	return nil, nil
}

func (p *GrowwProvider) SearchSymbol(ctx Context, query string) ([]SymbolInfo, error) {
	q := strings.ToUpper(strings.TrimSpace(query))
	if q == "" {
		return nil, nil
	}
	return []SymbolInfo{{Symbol: q, Name: q, Exchange: "NSE"}}, nil
}

// PlaceOrder executes a CNC order on Groww.
func (p *GrowwProvider) PlaceOrder(ctx Context, symbol, side string, qty int, price float64) (string, error) {
	tradingSymbol := ToTradingSymbol(symbol)
	txn := "BUY"
	if strings.EqualFold(side, "SELL") {
		txn = "SELL"
	}
	orderType := "MARKET"
	orderPrice := 0.0
	if price > 0 {
		orderType = "LIMIT"
		orderPrice = price
	}
	body := map[string]any{
		"validity":         "DAY",
		"exchange":         "NSE",
		"transaction_type": txn,
		"order_type":       orderType,
		"price":            orderPrice,
		"product":          "CNC",
		"quantity":         qty,
		"segment":          "CASH",
		"trading_symbol":   tradingSymbol,
	}
	var payload struct {
		GrowwOrderID string `json:"groww_order_id"`
	}
	if err := p.client.post(ctx, "/v1/order/create", body, &payload); err != nil {
		return "", err
	}
	if payload.GrowwOrderID == "" {
		return "submitted", nil
	}
	return payload.GrowwOrderID, nil
}

func toFloat(v any) float64 {
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
		return parseFloat(n)
	default:
		return 0
	}
}

func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}
