package signals

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

type Condition struct {
	Field    string  `json:"field"`
	Operator string  `json:"operator"`
	Value    float64 `json:"value"`
}

type Rule struct {
	ID         string
	Name       string
	Enabled    bool
	Conditions []Condition
	Side       string
}

type Suggestion struct {
	ID          string
	Symbol      string
	RuleID      string
	RuleName    string
	Side        string
	Entry       float64
	SL          float64
	Targets     []float64
	Confidence  float64
	Horizon     Horizon
	CapBucket   string
	Sector      string
	VsNiftyPct  float64
	VsCapPct    float64
	VsSectorPct float64
	VolumeRatio float64
	Snapshot    map[string]float64
}

type EvalInput struct {
	Symbol      string
	Quote       *market.Quote
	Candles     []market.Candle
	Fundamentals *market.Fundamentals
}

func DefaultRules() []Rule {
	return []Rule{
		{
			ID: "rsi-oversold-support", Name: "RSI Oversold near Support", Enabled: true, Side: "BUY",
			Conditions: []Condition{
				{Field: "rsi", Operator: "<", Value: 30},
				{Field: "near_support", Operator: "within_pct", Value: 1.5},
			},
		},
		{
			ID: "rsi-overbought-resistance", Name: "RSI Overbought near Resistance", Enabled: true, Side: "SELL",
			Conditions: []Condition{
				{Field: "rsi", Operator: ">", Value: 70},
				{Field: "near_resistance", Operator: "within_pct", Value: 1.5},
			},
		},
		{
			ID: "macd-bullish-cross", Name: "MACD Bullish Cross", Enabled: true, Side: "BUY",
			Conditions: []Condition{
				{Field: "macd_hist", Operator: ">", Value: 0},
				{Field: "rsi", Operator: "<", Value: 60},
			},
		},
	}
}

func Evaluate(rules []Rule, input EvalInput) []Suggestion {
	if input.Quote == nil || len(input.Candles) == 0 {
		return nil
	}

	rsi, macd, macdSig, macdHist, sma20, sma50, _ := indicators.ComputeAll(input.Candles)
	supports, resistances := indicators.SupportResistance(input.Candles)
	ltp := input.Quote.LTP

	metrics := map[string]float64{
		"rsi": rsi, "macd": macd, "macd_signal": macdSig, "macd_hist": macdHist,
		"sma20": sma20, "sma50": sma50, "ltp": ltp,
		"support_0": supports[0], "resistance_0": resistances[0],
	}

	var out []Suggestion
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if !matchAll(rule.Conditions, metrics, ltp, supports, resistances) {
			continue
		}

		entry := ltp
		var sl float64
		var targets []float64
		if strings.ToUpper(rule.Side) == "BUY" {
			sl = supports[0] * 0.99
			targets = resistances[:3]
		} else {
			sl = resistances[0] * 1.01
			targets = supports[:3]
		}

		confidence := float64(len(rule.Conditions)) / 3.0 * 100
		if confidence > 100 {
			confidence = 100
		}

		out = append(out, Suggestion{
			ID:         SuggestionID(input.Symbol, rule.ID, sessionDateIST()),
			Symbol:     input.Symbol,
			RuleID:     rule.ID,
			RuleName:   rule.Name,
			Side:       rule.Side,
			Entry:      entry,
			SL:         sl,
			Targets:    targets,
			Confidence: confidence,
			Snapshot:   metrics,
		})
	}
	return out
}

func matchAll(conds []Condition, metrics map[string]float64, ltp float64, supports, resistances []float64) bool {
	for _, c := range conds {
		if !matchOne(c, metrics, ltp, supports, resistances) {
			return false
		}
	}
	return true
}

func matchOne(c Condition, metrics map[string]float64, ltp float64, supports, resistances []float64) bool {
	switch c.Field {
	case "near_support":
		if len(supports) == 0 || ltp == 0 {
			return false
		}
		pct := abs(ltp-supports[0]) / ltp * 100
		return c.Operator == "within_pct" && pct <= c.Value
	case "near_resistance":
		if len(resistances) == 0 || ltp == 0 {
			return false
		}
		pct := abs(ltp-resistances[0]) / ltp * 100
		return c.Operator == "within_pct" && pct <= c.Value
	default:
		v, ok := metrics[c.Field]
		if !ok {
			return false
		}
		switch c.Operator {
		case "<":
			return v < c.Value
		case ">":
			return v > c.Value
		default:
			return false
		}
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func SnapshotJSON(m map[string]float64) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func IsMarketHoursIST() bool {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	now := time.Now().In(loc)
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return false
	}
	minutes := now.Hour()*60 + now.Minute()
	return minutes >= 9*60+15 && minutes <= 15*60+30
}

func FormatSuggestionLog(s Suggestion) string {
	return fmt.Sprintf("%s %s %s entry=%.2f sl=%.2f conf=%.0f%%", s.Side, s.Symbol, s.RuleName, s.Entry, s.SL, s.Confidence)
}
