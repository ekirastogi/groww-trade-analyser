package parser

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/models"
	"github.com/xuri/excelize/v2"
)

const dateLayout = "02-01-2006"

func ParseFile(filename string, r io.Reader) (*models.Report, error) {
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".csv") {
		return parseCSV(r)
	}
	if strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls") {
		return parseXLSX(r)
	}
	return nil, fmt.Errorf("unsupported file type: use .csv or .xlsx")
}

func parseXLSX(r io.Reader) (*models.Report, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()

	sheet := "Trade Level"
	if idx, _ := f.GetSheetIndex(sheet); idx == -1 {
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, fmt.Errorf("no sheets found")
		}
		sheet = sheets[0]
	}

	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("read rows: %w", err)
	}

	report := &models.Report{}
	parseHeaderSection(rows, report)

	headerIdx := findHeaderRow(rows, "Stock name")
	if headerIdx == -1 {
		return nil, fmt.Errorf("could not find trade header row (Stock name)")
	}

	for i := headerIdx + 1; i < len(rows); i++ {
		row := padRow(rows[i], 11)
		if strings.TrimSpace(row[0]) == "" || row[0] == "Stock name" {
			continue
		}
		trade, err := parseTradeRow(row)
		if err != nil {
			continue
		}
		report.Trades = append(report.Trades, trade)
	}

	scripSheet := "Scrip Level"
	if idx, _ := f.GetSheetIndex(scripSheet); idx != -1 {
		scripRows, err := f.GetRows(scripSheet)
		if err == nil {
			report.StockSummary = parseScripLevel(scripRows)
		}
	}

	finalizeReport(report)
	return report, nil
}

func parseCSV(r io.Reader) (*models.Report, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read csv: %w", err)
	}

	report := &models.Report{}
	parseHeaderSection(rows, report)

	headerIdx := findHeaderRow(rows, "Stock name")
	if headerIdx == -1 {
		return nil, fmt.Errorf("could not find trade header row (Stock name)")
	}

	for i := headerIdx + 1; i < len(rows); i++ {
		row := padRow(rows[i], 11)
		if strings.TrimSpace(row[0]) == "" || row[0] == "Stock name" {
			continue
		}
		trade, err := parseTradeRow(row)
		if err != nil {
			continue
		}
		report.Trades = append(report.Trades, trade)
	}

	finalizeReport(report)
	return report, nil
}

func parseHeaderSection(rows [][]string, report *models.Report) {
	for i := 0; i < len(rows) && i < 30; i++ {
		row := padRow(rows[i], 2)
		label := strings.TrimSpace(row[0])
		value := strings.TrimSpace(row[1])

		switch {
		case label == "Name":
			report.Summary.ClientName = value
		case label == "Unique Client Code":
			report.Summary.ClientCode = value
		case strings.Contains(label, "P&L Statement"):
			report.Summary.Period = label
		case label == "Realised P&L":
			report.Summary.RealisedPnL = parseFloat(value)
		case label == "Unrealised P&L":
			report.Summary.UnrealisedPnL = parseFloat(value)
		case isChargeLabel(label):
			amount := parseFloat(value)
			if amount != 0 || label == "Total" {
				report.Charges.Items = append(report.Charges.Items, models.ChargeItem{
					Label:  label,
					Amount: amount,
				})
				if label == "Total" {
					report.Charges.Total = amount
				}
			}
		}
	}
}

func isChargeLabel(label string) bool {
	chargeLabels := []string{
		"Exchange Transaction Charges", "SEBI Charges", "STT", "Stamp Duty",
		"IPFT Charges", "Brokerage", "CDSL DP Charges", "Groww DP Charges",
		"MIS Charges", "Pledge Charges", "MTF Pledge Charges",
		"MTF Unpledge Charges", "MTF interest", "Total GST", "Total",
	}
	for _, c := range chargeLabels {
		if label == c {
			return true
		}
	}
	return false
}

func parseScripLevel(rows [][]string) []models.StockSummary {
	headerIdx := findHeaderRow(rows, "Stock name")
	if headerIdx == -1 {
		return nil
	}

	var stocks []models.StockSummary
	for i := headerIdx + 1; i < len(rows); i++ {
		row := padRow(rows[i], 9)
		if strings.TrimSpace(row[0]) == "" {
			continue
		}
		stocks = append(stocks, models.StockSummary{
			StockName:     row[0],
			ISIN:          row[1],
			Quantity:      parseFloat(row[2]),
			AvgBuyPrice:   parseFloat(row[3]),
			BuyValue:      parseFloat(row[4]),
			AvgSellPrice:  parseFloat(row[5]),
			SellValue:     parseFloat(row[6]),
			RealisedPnL:   parseFloat(row[7]),
			RealisedPnLPc: parseFloat(row[8]),
		})
	}
	return stocks
}

func parseTradeRow(row []string) (models.Trade, error) {
	buyDate, err := parseDate(row[3])
	if err != nil {
		return models.Trade{}, err
	}
	sellDate, err := parseDate(row[6])
	if err != nil {
		return models.Trade{}, err
	}

	remark := strings.TrimSpace(row[10])
	tradeType := classifyTradeType(buyDate, sellDate, remark)
	holdingDays := int(sellDate.Sub(buyDate).Hours() / 24)

	return models.Trade{
		StockName:   strings.TrimSpace(row[0]),
		ISIN:        strings.TrimSpace(row[1]),
		Quantity:    parseFloat(row[2]),
		BuyDate:     buyDate,
		BuyPrice:    parseFloat(row[4]),
		BuyValue:    parseFloat(row[5]),
		SellDate:    sellDate,
		SellPrice:   parseFloat(row[7]),
		SellValue:   parseFloat(row[8]),
		RealisedPnL: parseFloat(row[9]),
		Remark:      remark,
		TradeType:   tradeType,
		HoldingDays: holdingDays,
	}, nil
}

func classifyTradeType(buyDate, sellDate time.Time, remark string) models.TradeType {
	lower := strings.ToLower(remark)
	if strings.Contains(lower, "intraday") {
		return models.TradeTypeIntraday
	}
	if strings.Contains(lower, "mtf") {
		return models.TradeTypeMTF
	}
	if strings.Contains(lower, "fno") || strings.Contains(lower, "future") || strings.Contains(lower, "option") {
		return models.TradeTypeFNO
	}
	if buyDate.Equal(sellDate) {
		return models.TradeTypeSameDay
	}
	return models.TradeTypeDelivery
}

func finalizeReport(report *models.Report) {
	if report.Charges.Total == 0 {
		for _, item := range report.Charges.Items {
			if item.Label != "Total" {
				report.Charges.Total += item.Amount
			}
		}
	}

	typeSet := map[models.TradeType]bool{models.TradeTypeAll: true}
	var minDate, maxDate time.Time

	for i, t := range report.Trades {
		typeSet[t.TradeType] = true
		if i == 0 || t.SellDate.Before(minDate) {
			minDate = t.SellDate
		}
		if i == 0 || t.SellDate.After(maxDate) {
			maxDate = t.SellDate
		}
	}

	if !minDate.IsZero() {
		report.DateRange.Min = minDate.Format("2006-01-02")
		report.DateRange.Max = maxDate.Format("2006-01-02")
	}

	order := []models.TradeType{
		models.TradeTypeAll,
		models.TradeTypeIntraday,
		models.TradeTypeDelivery,
		models.TradeTypeSameDay,
		models.TradeTypeMTF,
		models.TradeTypeFNO,
	}
	for _, tt := range order {
		if typeSet[tt] {
			report.TradeTypes = append(report.TradeTypes, tt)
		}
	}
}

func findHeaderRow(rows [][]string, col string) int {
	for i, row := range rows {
		for _, cell := range row {
			if strings.TrimSpace(cell) == col {
				return i
			}
		}
	}
	return -1
}

func padRow(row []string, n int) []string {
	if len(row) >= n {
		return row
	}
	padded := make([]string, n)
	copy(padded, row)
	return padded
}

func parseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty date")
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}

func parseFloat(s string) float64 {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	if s == "" {
		return 0
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
