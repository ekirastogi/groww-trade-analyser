package market

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ExchangeSymbol is a listed equity from NSE or BSE.
type ExchangeSymbol struct {
	Symbol   string
	Name     string
	Exchange string
	ISIN     string
}

const nseEquityListURL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
const bseEquityListURL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active"

// FetchNSEEquities downloads the official NSE equity master list.
func FetchNSEEquities(ctx context.Context) ([]ExchangeSymbol, error) {
	body, err := fetchExchangeCSV(ctx, nseEquityListURL)
	if err != nil {
		return nil, err
	}
	r := csv.NewReader(strings.NewReader(body))
	r.LazyQuotes = true
	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse NSE CSV: %w", err)
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("NSE CSV empty")
	}

	header := indexHeader(records[0])
	symIdx := header["SYMBOL"]
	nameIdx := header["NAME OF COMPANY"]
	isinIdx := header[" ISIN NUMBER"]
	if isinIdx < 0 {
		isinIdx = header["ISIN NUMBER"]
	}
	if symIdx < 0 || nameIdx < 0 {
		return nil, fmt.Errorf("unexpected NSE CSV columns")
	}

	out := make([]ExchangeSymbol, 0, len(records)-1)
	seen := make(map[string]bool)
	for _, row := range records[1:] {
		if symIdx >= len(row) || nameIdx >= len(row) {
			continue
		}
		symbol := strings.ToUpper(strings.TrimSpace(row[symIdx]))
		if symbol == "" || seen[symbol] {
			continue
		}
		seen[symbol] = true
		isin := ""
		if isinIdx >= 0 && isinIdx < len(row) {
			isin = strings.TrimSpace(row[isinIdx])
		}
		out = append(out, ExchangeSymbol{
			Symbol:   symbol,
			Name:     strings.TrimSpace(row[nameIdx]),
			Exchange: "NSE",
			ISIN:     isin,
		})
	}
	return out, nil
}

// FetchBSEEquities downloads the BSE active equity list (best effort).
func FetchBSEEquities(ctx context.Context) ([]ExchangeSymbol, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bseEquityListURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://www.bseindia.com/")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("BSE list HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}

	// BSE returns JSON array: [{ "scrip_cd", "scrip_name", "ISIN", ... }]
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("parse BSE JSON: %w", err)
	}

	out := make([]ExchangeSymbol, 0, len(rows))
	seen := make(map[string]bool)
	for _, row := range rows {
		symbol := strings.ToUpper(strings.TrimSpace(anyString(row["scrip_cd"])))
		name := strings.TrimSpace(anyString(row["scrip_name"]))
		if symbol == "" || seen[symbol] {
			continue
		}
		seen[symbol] = true
		out = append(out, ExchangeSymbol{
			Symbol:   symbol,
			Name:     name,
			Exchange: "BSE",
			ISIN:     strings.TrimSpace(anyString(row["ISIN"])),
		})
	}
	return out, nil
}

// MergeExchangeSymbols merges NSE and BSE lists, preferring NSE names on duplicate symbols.
func MergeExchangeSymbols(nse, bse []ExchangeSymbol) []ExchangeSymbol {
	bySymbol := make(map[string]ExchangeSymbol, len(nse)+len(bse))
	for _, s := range bse {
		bySymbol[s.Symbol] = s
	}
	for _, s := range nse {
		bySymbol[s.Symbol] = s
	}
	out := make([]ExchangeSymbol, 0, len(bySymbol))
	for _, s := range bySymbol {
		out = append(out, s)
	}
	return out
}

func fetchExchangeCSV(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Accept", "text/csv,*/*")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d fetching %s", resp.StatusCode, url)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func indexHeader(row []string) map[string]int {
	m := make(map[string]int, len(row))
	for i, col := range row {
		m[strings.ToUpper(strings.TrimSpace(col))] = i
	}
	return m
}

func anyString(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return fmt.Sprintf("%.0f", t)
	default:
		return fmt.Sprint(t)
	}
}
