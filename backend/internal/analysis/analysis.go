package analysis

import (
	"fmt"
	"sort"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/models"
)

type Options struct {
	StartDate  string
	EndDate    string
	TradeTypes []models.TradeType
}

func Analyze(report *models.Report, opts Options) models.AnalysisResult {
	trades := filterTrades(report.Trades, opts)
	totalSell := sumSellValue(trades)
	chargeRatio := 0.0
	if totalSell > 0 && report.Charges.Total > 0 {
		chargeRatio = report.Charges.Total / totalSell
	}

	result := models.AnalysisResult{
		Charges: report.Charges,
		Filters: models.FilterState{
			StartDate:  opts.StartDate,
			EndDate:    opts.EndDate,
			TradeTypes: opts.TradeTypes,
		},
	}

	result.Summary = buildSummary(trades, chargeRatio)
	result.Daily = aggregateByPeriod(trades, chargeRatio, "daily")
	result.Weekly = aggregateByPeriod(trades, chargeRatio, "weekly")
	result.Monthly = aggregateByPeriod(trades, chargeRatio, "monthly")
	result.Stocks = aggregateByStock(trades, chargeRatio)

	return result
}

func filterTrades(trades []models.Trade, opts Options) []models.Trade {
	start, end := parseFilterDates(opts.StartDate, opts.EndDate)
	typeFilter := buildTypeFilter(opts.TradeTypes)

	var filtered []models.Trade
	for _, t := range trades {
		if !start.IsZero() && t.SellDate.Before(start) {
			continue
		}
		if !end.IsZero() && t.SellDate.After(end) {
			continue
		}
		if len(typeFilter) > 0 && !typeFilter[t.TradeType] {
			continue
		}
		filtered = append(filtered, t)
	}
	return filtered
}

func buildTypeFilter(types []models.TradeType) map[models.TradeType]bool {
	if len(types) == 0 {
		return nil
	}
	filter := make(map[models.TradeType]bool)
	for _, tt := range types {
		if tt == models.TradeTypeAll {
			return nil
		}
		filter[tt] = true
	}
	return filter
}

func parseFilterDates(startStr, endStr string) (time.Time, time.Time) {
	var start, end time.Time
	if startStr != "" {
		start, _ = time.Parse("2006-01-02", startStr)
	}
	if endStr != "" {
		end, _ = time.Parse("2006-01-02", endStr)
		if !end.IsZero() {
			end = end.Add(24*time.Hour - time.Nanosecond)
		}
	}
	return start, end
}

func buildSummary(trades []models.Trade, chargeRatio float64) models.AnalysisSummary {
	var summary models.AnalysisSummary

	for _, t := range trades {
		summary.TradeCount++
		summary.TotalBuyValue += t.BuyValue
		summary.TotalSellValue += t.SellValue
		summary.RealisedPnL += t.RealisedPnL
		if t.RealisedPnL > 0 {
			summary.WinningTrades++
		} else if t.RealisedPnL < 0 {
			summary.LosingTrades++
		}
	}

	if summary.TradeCount > 0 {
		summary.WinRate = float64(summary.WinningTrades) / float64(summary.TradeCount) * 100
	}
	summary.AllocatedCharges = summary.TotalSellValue * chargeRatio
	summary.NetPnL = summary.RealisedPnL - summary.AllocatedCharges
	return summary
}

func aggregateByPeriod(trades []models.Trade, chargeRatio float64, period string) []models.PeriodBucket {
	buckets := map[string]*models.PeriodBucket{}

	for _, t := range trades {
		key, label := periodKey(t.SellDate, period)
		b, ok := buckets[key]
		if !ok {
			b = &models.PeriodBucket{Period: key, Label: label}
			buckets[key] = b
		}
		b.TradeCount++
		b.TotalBuyValue += t.BuyValue
		b.TotalSellValue += t.SellValue
		b.RealisedPnL += t.RealisedPnL
		if t.RealisedPnL > 0 {
			b.WinningTrades++
		} else if t.RealisedPnL < 0 {
			b.LosingTrades++
		}
	}

	var result []models.PeriodBucket
	for _, b := range buckets {
		if b.TradeCount > 0 {
			b.WinRate = float64(b.WinningTrades) / float64(b.TradeCount) * 100
		}
		b.AllocatedCharges = b.TotalSellValue * chargeRatio
		b.NetPnL = b.RealisedPnL - b.AllocatedCharges
		result = append(result, *b)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Period < result[j].Period
	})
	return result
}

func periodKey(d time.Time, period string) (string, string) {
	switch period {
	case "weekly":
		year, week := d.ISOWeek()
		key := fmt.Sprintf("%04d-W%02d", year, week)
		return key, fmt.Sprintf("Week %02d, %d", week, year)
	case "monthly":
		key := d.Format("2006-01")
		return key, d.Format("Jan 2006")
	default:
		key := d.Format("2006-01-02")
		return key, d.Format("02 Jan 2006")
	}
}

func aggregateByStock(trades []models.Trade, chargeRatio float64) []models.StockSummary {
	stockMap := map[string]*models.StockSummary{}

	for _, t := range trades {
		key := t.ISIN
		if key == "" {
			key = t.StockName
		}
		s, ok := stockMap[key]
		if !ok {
			s = &models.StockSummary{StockName: t.StockName, ISIN: t.ISIN}
			stockMap[key] = s
		}
		s.TradeCount++
		s.Quantity += t.Quantity
		s.BuyValue += t.BuyValue
		s.SellValue += t.SellValue
		s.RealisedPnL += t.RealisedPnL
	}

	var result []models.StockSummary
	for _, s := range stockMap {
		if s.Quantity > 0 {
			s.AvgBuyPrice = s.BuyValue / s.Quantity
			s.AvgSellPrice = s.SellValue / s.Quantity
		}
		if s.BuyValue > 0 {
			s.RealisedPnLPc = s.RealisedPnL / s.BuyValue
		}
		s.AllocatedCharges = s.SellValue * chargeRatio
		s.NetPnL = s.RealisedPnL - s.AllocatedCharges
		result = append(result, *s)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].RealisedPnL > result[j].RealisedPnL
	})
	return result
}

func sumSellValue(trades []models.Trade) float64 {
	var total float64
	for _, t := range trades {
		total += t.SellValue
	}
	return total
}
