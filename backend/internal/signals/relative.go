package signals

import (
	"fmt"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/indicators"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

type Horizon string

const (
	HorizonIntraday Horizon = "intraday"
	HorizonBTST     Horizon = "btst"
)

type RelativeEvalInput struct {
	Symbol         string
	Quote          *market.Quote
	Candles        []market.Candle
	Fundamentals   *market.Fundamentals
	Meta           *store.SymbolMeta
	CapCandles     []market.Candle
	SectorCandles  []market.Candle
	NiftyCandles   []market.Candle
	VolumeRatio    float64
	IsVolumeShocker bool
}

func SessionReturn(candles []market.Candle) float64 {
	if len(candles) < 2 {
		return 0
	}
	prev := candles[len(candles)-2].Close
	last := candles[len(candles)-1].Close
	if prev == 0 {
		return 0
	}
	return (last - prev) / prev * 100
}

func EvaluateRelative(input RelativeEvalInput) []Suggestion {
	if input.Quote == nil || len(input.Candles) < 20 {
		return nil
	}

	rsi, macd, macdSig, macdHist, sma20, sma50, sma200 := indicators.ComputeAll(input.Candles)
	supports, resistances := indicators.SupportResistance(input.Candles)
	ltp := input.Quote.LTP

	stockRet := SessionReturn(input.Candles)
	niftyRet := SessionReturn(input.NiftyCandles)
	capRet := SessionReturn(input.CapCandles)
	sectorRet := SessionReturn(input.SectorCandles)

	vsNifty := stockRet - niftyRet
	vsCap := stockRet - capRet
	vsSector := stockRet - sectorRet

	capBucket := "large"
	sector := "general"
	if input.Meta != nil {
		if input.Meta.CapBucket != "" {
			capBucket = input.Meta.CapBucket
		}
		sector = input.Meta.Sector
	}

	metrics := map[string]float64{
		"rsi": rsi, "macd": macd, "macd_signal": macdSig, "macd_hist": macdHist,
		"sma20": sma20, "sma50": sma50, "sma200": sma200, "ltp": ltp,
		"vs_nifty": vsNifty, "vs_cap": vsCap, "vs_sector": vsSector,
		"volume_ratio": input.VolumeRatio,
	}
	if len(supports) > 0 {
		metrics["support_0"] = supports[0]
	}
	if len(resistances) > 0 {
		metrics["resistance_0"] = resistances[0]
	}

	// Relative strength gates
	if vsCap < -0.3 {
		return nil
	}
	if vsSector < -0.5 {
		return nil
	}
	if input.VolumeRatio < 1.1 && !input.IsVolumeShocker {
		return nil
	}

	horizons := []Horizon{HorizonIntraday}
	if IsBTSTWindowIST() {
		horizons = append(horizons, HorizonBTST)
	}

	var out []Suggestion
	for _, horizon := range horizons {
		if !passesTechnical(horizon, rsi, macdHist, ltp, supports, resistances) {
			continue
		}
		confidence := scoreConfidence(vsNifty, vsCap, vsSector, input.VolumeRatio, rsi, macdHist, input.IsVolumeShocker)
		if confidence < 40 {
			continue
		}

		entry := ltp
		sl, targets := slAndTargets(horizon, ltp, supports, resistances)
		ruleID := fmt.Sprintf("relative-%s-%s", horizon, capBucket)
		ruleName := fmt.Sprintf("Relative strength %s (%s)", strings.ToUpper(string(horizon)), capBucket)

		out = append(out, Suggestion{
			ID:         SuggestionID(input.Symbol, ruleID, sessionDateIST()),
			Symbol:     input.Symbol,
			RuleID:     ruleID,
			RuleName:   ruleName,
			Side:       "BUY",
			Entry:      entry,
			SL:         sl,
			Targets:    targets,
			Confidence: confidence,
			Horizon:    horizon,
			CapBucket:  capBucket,
			Sector:     sector,
			VsNiftyPct: vsNifty,
			VsCapPct:   vsCap,
			VsSectorPct: vsSector,
			VolumeRatio: input.VolumeRatio,
			Snapshot:   metrics,
		})
	}
	return out
}

func passesTechnical(h Horizon, rsi, macdHist, ltp float64, supports, resistances []float64) bool {
	if rsi > 72 || rsi < 25 {
		return false
	}
	if macdHist < 0 && h == HorizonIntraday {
		return false
	}
	if len(supports) > 0 && ltp > 0 {
		dist := abs(ltp-supports[0]) / ltp * 100
		if dist > 3 && h == HorizonIntraday {
			return false
		}
	}
	return true
}

func scoreConfidence(vsNifty, vsCap, vsSector, volRatio, rsi, macdHist float64, shocker bool) float64 {
	score := 30.0
	if vsNifty > 0 {
		score += 10
	}
	if vsCap > 0.5 {
		score += 15
	}
	if vsSector > 0.3 {
		score += 15
	}
	if volRatio >= 1.5 {
		score += 15
	}
	if shocker {
		score += 10
	}
	if rsi > 40 && rsi < 65 {
		score += 10
	}
	if macdHist > 0 {
		score += 5
	}
	if score > 100 {
		return 100
	}
	return score
}

func slAndTargets(h Horizon, ltp float64, supports, resistances []float64) (sl float64, targets []float64) {
	if len(supports) > 0 {
		sl = supports[0] * 0.995
	} else {
		sl = ltp * 0.98
	}
	if h == HorizonIntraday {
		if len(resistances) >= 3 {
			targets = resistances[:3]
		} else if len(resistances) > 0 {
			targets = resistances
		} else {
			targets = []float64{ltp * 1.01, ltp * 1.02, ltp * 1.03}
		}
	} else {
		if len(resistances) > 0 {
			targets = []float64{resistances[0]}
		} else {
			targets = []float64{ltp * 1.015}
		}
	}
	return sl, targets
}

func SuggestionID(symbol, ruleID, sessionDate string) string {
	return fmt.Sprintf("%s_%s_%s", strings.ToUpper(symbol), ruleID, sessionDate)
}

func sessionDateIST() string {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	return time.Now().In(loc).Format("2006-01-02")
}

func IsBTSTWindowIST() bool {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	now := time.Now().In(loc)
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return false
	}
	minutes := now.Hour()*60 + now.Minute()
	return minutes >= 14*60+30 && minutes <= 15*60+30
}
