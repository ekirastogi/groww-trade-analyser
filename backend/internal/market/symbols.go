package market

import "strings"

// IndexSymbols are benchmark indices ingested alongside stocks.
var IndexSymbols = []string{
	"^NSEI",      // Nifty 50
	"^NSEMDCP50", // Nifty Midcap
	"^CNXSC",     // Nifty Smallcap
	"^CNXIT",     // Nifty IT
	"^NSEBANK",   // Nifty Bank
	"^CNXPHARMA", // Nifty Pharma
}

// indexTradingSymbols maps internal index keys to Groww/NSE trading symbols.
var indexTradingSymbols = map[string]string{
	"^NSEI":      "NIFTY",
	"^NSEMDCP50": "NIFTY MIDCAP 50",
	"^CNXSC":     "NIFTY SMLCAP 250",
	"^CNXIT":     "NIFTY IT",
	"^NSEBANK":   "BANKNIFTY",
	"^CNXPHARMA": "NIFTY PHARMA",
}

func IsIndexSymbol(symbol string) bool {
	for _, idx := range IndexSymbols {
		if idx == symbol {
			return true
		}
	}
	return false
}

// ToTradingSymbol converts an internal symbol to a Groww/NSE trading symbol.
func ToTradingSymbol(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	if mapped, ok := indexTradingSymbols[s]; ok {
		return mapped
	}
	s = strings.TrimPrefix(s, "^")
	s = strings.TrimSuffix(s, ".NS")
	s = strings.TrimSuffix(s, "-EQ")
	return s
}

// ToGrowwSymbol builds the Groww symbol identifier (e.g. NSE-RELIANCE).
func ToGrowwSymbol(symbol string) string {
	return "NSE-" + ToTradingSymbol(symbol)
}
