package indicators

import "github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"

func SMA(values []float64, period int) float64 {
	if len(values) < period || period <= 0 {
		return 0
	}
	sum := 0.0
	for i := len(values) - period; i < len(values); i++ {
		sum += values[i]
	}
	return sum / float64(period)
}

func EMA(values []float64, period int) []float64 {
	if len(values) == 0 || period <= 0 {
		return nil
	}
	k := 2.0 / float64(period+1)
	ema := make([]float64, len(values))
	ema[0] = values[0]
	for i := 1; i < len(values); i++ {
		ema[i] = values[i]*k + ema[i-1]*(1-k)
	}
	return ema
}

func RSI(closes []float64, period int) float64 {
	if len(closes) <= period {
		return 50
	}
	gain, loss := 0.0, 0.0
	for i := len(closes) - period; i < len(closes); i++ {
		diff := closes[i] - closes[i-1]
		if diff > 0 {
			gain += diff
		} else {
			loss -= diff
		}
	}
	if loss == 0 {
		return 100
	}
	rs := gain / loss
	return 100 - (100 / (1 + rs))
}

func MACD(closes []float64) (macd, signal, hist float64) {
	if len(closes) < 26 {
		return 0, 0, 0
	}
	ema12 := EMA(closes, 12)
	ema26 := EMA(closes, 26)
	macdLine := make([]float64, len(closes))
	for i := range closes {
		macdLine[i] = ema12[i] - ema26[i]
	}
	sigLine := EMA(macdLine, 9)
	macd = macdLine[len(macdLine)-1]
	signal = sigLine[len(sigLine)-1]
	hist = macd - signal
	return
}

func ComputeAll(candles []market.Candle) (rsi, macd, macdSig, macdHist, sma20, sma50, sma200 float64) {
	closes := make([]float64, len(candles))
	for i, c := range candles {
		closes[i] = c.Close
	}
	rsi = RSI(closes, 14)
	macd, macdSig, macdHist = MACD(closes)
	sma20 = SMA(closes, 20)
	sma50 = SMA(closes, 50)
	sma200 = SMA(closes, 200)
	return
}

func SupportResistance(candles []market.Candle) (supports, resistances []float64) {
	if len(candles) == 0 {
		return []float64{}, []float64{}
	}
	last := candles[len(candles)-1]
	prev := candles[len(candles)-2]
	h, l, c := last.High, last.Low, last.Close
	if len(candles) >= 2 {
		h = prev.High
		l = prev.Low
		c = prev.Close
	}
	pivot := (h + l + c) / 3
	s1 := 2*pivot - h
	s2 := pivot - (h - l)
	s3 := l - 2*(h-pivot)
	r1 := 2*pivot - l
	r2 := pivot + (h - l)
	r3 := h + 2*(pivot-l)
	return []float64{s1, s2, s3}, []float64{r1, r2, r3}
}

func swingPoints(candles []market.Candle, lookback int) (lows, highs []float64) {
	start := len(candles) - lookback
	if start < 1 {
		start = 1
	}
	for i := start; i < len(candles)-1; i++ {
		if candles[i].Low < candles[i-1].Low && candles[i].Low < candles[i+1].Low {
			lows = append(lows, candles[i].Low)
		}
		if candles[i].High > candles[i-1].High && candles[i].High > candles[i+1].High {
			highs = append(highs, candles[i].High)
		}
	}
	return
}
