package datapub

import "github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"

func BuildChartPayload(candles []market.Candle) ChartPayload {
	if len(candles) > 252 {
		candles = candles[len(candles)-252:]
	}
	closes := make([]float64, len(candles))
	for i, c := range candles {
		closes[i] = c.Close
	}
	return ChartPayload{
		Candles: candles,
		SMA20:   rollingSMA(closes, 20),
		SMA50:   rollingSMA(closes, 50),
		SMA200:  rollingSMA(closes, 200),
	}
}

func rollingSMA(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range values {
		if i+1 < period {
			out[i] = 0
			continue
		}
		sum := 0.0
		for j := i - period + 1; j <= i; j++ {
			sum += values[j]
		}
		out[i] = sum / float64(period)
	}
	return out
}
