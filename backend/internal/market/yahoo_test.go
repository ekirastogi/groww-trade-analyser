package market

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestYahooProviderFetchRegistryQuotesBatch(t *testing.T) {
	t.Parallel()

	var crumbHits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/test/getcrumb":
			crumbHits++
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("test-crumb"))
		case r.URL.Path == "/v7/finance/quote":
			if r.URL.Query().Get("crumb") != "test-crumb" {
				http.Error(w, `{"finance":{"error":{"code":"Unauthorized"}}}`, http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"quoteResponse": {
					"result": [{
						"symbol": "RELIANCE.NS",
						"shortName": "Reliance Industries",
						"regularMarketPrice": 2500.5,
						"marketCap": 1700000000000,
						"trailingPE": 28.4
					}]
				}
			}`))
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()

	oldBootstrap, oldCrumb, oldQuote := yahooBootstrapURL, yahooCrumbURL, yahooQuoteURL
	yahooBootstrapURL = srv.URL
	yahooCrumbURL = srv.URL + "/v1/test/getcrumb"
	yahooQuoteURL = srv.URL + "/v7/finance/quote"
	t.Cleanup(func() {
		yahooBootstrapURL = oldBootstrap
		yahooCrumbURL = oldCrumb
		yahooQuoteURL = oldQuote
	})

	provider := NewYahooProvider()
	provider.client = srv.Client()

	out, err := provider.FetchRegistryQuotesBatch(context.Background(), []RegistryQuoteInput{
		{Symbol: "RELIANCE", Exchange: "NSE"},
	})
	if err != nil {
		t.Fatalf("FetchRegistryQuotesBatch: %v", err)
	}
	if crumbHits == 0 {
		t.Fatalf("expected crumb bootstrap")
	}
	snap := out["RELIANCE"]
	if snap == nil || snap.LTP != 2500.5 || snap.MarketCap != 1700000000000 {
		t.Fatalf("unexpected snapshot: %#v", snap)
	}
}
