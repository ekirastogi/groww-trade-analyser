package models

import "time"

type TradeType string

const (
	TradeTypeAll       TradeType = "all"
	TradeTypeIntraday  TradeType = "intraday"
	TradeTypeDelivery  TradeType = "delivery"
	TradeTypeSameDay   TradeType = "same_day"
	TradeTypeMTF       TradeType = "mtf"
	TradeTypeFNO       TradeType = "fno"
)

type Trade struct {
	StockName   string    `json:"stockName"`
	ISIN        string    `json:"isin"`
	Quantity    float64   `json:"quantity"`
	BuyDate     time.Time `json:"buyDate"`
	BuyPrice    float64   `json:"buyPrice"`
	BuyValue    float64   `json:"buyValue"`
	SellDate    time.Time `json:"sellDate"`
	SellPrice   float64   `json:"sellPrice"`
	SellValue   float64   `json:"sellValue"`
	RealisedPnL float64   `json:"realisedPnL"`
	Remark      string    `json:"remark"`
	TradeType   TradeType `json:"tradeType"`
	HoldingDays int       `json:"holdingDays"`
}

type StockSummary struct {
	StockName     string  `json:"stockName"`
	ISIN          string  `json:"isin"`
	Quantity      float64 `json:"quantity"`
	AvgBuyPrice   float64 `json:"avgBuyPrice"`
	BuyValue      float64 `json:"buyValue"`
	AvgSellPrice  float64 `json:"avgSellPrice"`
	SellValue     float64 `json:"sellValue"`
	RealisedPnL   float64 `json:"realisedPnL"`
	RealisedPnLPc float64 `json:"realisedPnLPct"`
	TradeCount    int     `json:"tradeCount"`
	AllocatedCharges float64 `json:"allocatedCharges"`
	NetPnL        float64 `json:"netPnL"`
}

type ChargeItem struct {
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
}

type ChargesSummary struct {
	Items []ChargeItem `json:"items"`
	Total float64      `json:"total"`
}

type ReportSummary struct {
	ClientName string  `json:"clientName"`
	ClientCode string  `json:"clientCode"`
	Period     string  `json:"period"`
	RealisedPnL   float64 `json:"realisedPnL"`
	UnrealisedPnL float64 `json:"unrealisedPnL"`
}

type Report struct {
	ID           string         `json:"id"`
	Summary      ReportSummary  `json:"summary"`
	Charges      ChargesSummary `json:"charges"`
	Trades       []Trade        `json:"trades"`
	StockSummary []StockSummary `json:"stockSummary"`
	DateRange    DateRange      `json:"dateRange"`
	TradeTypes   []TradeType    `json:"tradeTypes"`
}

type DateRange struct {
	Min string `json:"min"`
	Max string `json:"max"`
}

type PeriodBucket struct {
	Period        string  `json:"period"`
	Label         string  `json:"label"`
	TradeCount    int     `json:"tradeCount"`
	TotalBuyValue float64 `json:"totalBuyValue"`
	TotalSellValue float64 `json:"totalSellValue"`
	RealisedPnL   float64 `json:"realisedPnL"`
	WinningTrades int     `json:"winningTrades"`
	LosingTrades  int     `json:"losingTrades"`
	WinRate       float64 `json:"winRate"`
	AllocatedCharges float64 `json:"allocatedCharges"`
	NetPnL        float64 `json:"netPnL"`
}

type AnalysisSummary struct {
	TradeCount       int     `json:"tradeCount"`
	TotalBuyValue    float64 `json:"totalBuyValue"`
	TotalSellValue   float64 `json:"totalSellValue"`
	RealisedPnL      float64 `json:"realisedPnL"`
	WinningTrades    int     `json:"winningTrades"`
	LosingTrades     int     `json:"losingTrades"`
	WinRate          float64 `json:"winRate"`
	AllocatedCharges float64 `json:"allocatedCharges"`
	NetPnL           float64 `json:"netPnL"`
}

type AnalysisResult struct {
	Summary AnalysisSummary `json:"summary"`
	Daily   []PeriodBucket  `json:"daily"`
	Weekly  []PeriodBucket  `json:"weekly"`
	Monthly []PeriodBucket  `json:"monthly"`
	Stocks  []StockSummary  `json:"stocks"`
	Charges ChargesSummary  `json:"charges"`
	Filters FilterState     `json:"filters"`
}

type FilterState struct {
	StartDate  string      `json:"startDate"`
	EndDate    string      `json:"endDate"`
	TradeTypes []TradeType `json:"tradeTypes"`
}

type UploadResponse struct {
	ID         string        `json:"id"`
	Summary    ReportSummary `json:"summary"`
	DateRange  DateRange     `json:"dateRange"`
	TradeTypes []TradeType   `json:"tradeTypes"`
	TradeCount int           `json:"tradeCount"`
	StockCount int           `json:"stockCount"`
}
