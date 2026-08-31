package market

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestYahooProviderFetchRegistryQuotesBatchSpark(t *testing.T) {

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v7/finance/spark":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"spark": {
					"result": [{
						"symbol": "RELIANCE.NS",
						"response": [{
							"meta": {
								"symbol": "RELIANCE.NS",
								"shortName": "Reliance Industries",
								"regularMarketPrice": 2500.5,
								"marketCap": 1700000000000,
								"trailingPE": 28.4
							}
						}]
					}]
				}
			}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer srv.Close()

	oldBootstrap, oldSpark := yahooBootstrapURL, yahooSparkURL
	yahooBootstrapURL = srv.URL
	yahooSparkURL = srv.URL + "/v7/finance/spark"
	t.Cleanup(func() {
		yahooBootstrapURL = oldBootstrap
		yahooSparkURL = oldSpark
	})

	provider := NewYahooProvider()
	provider.client = srv.Client()
	t.Setenv("YAHOO_CRUMB", "")
	t.Setenv("YAHOO_COOKIE", "")

	out, err := provider.FetchRegistryQuotesBatch(context.Background(), []RegistryQuoteInput{
		{Symbol: "RELIANCE", Exchange: "NSE"},
	})
	if err != nil {
		t.Fatalf("FetchRegistryQuotesBatch: %v", err)
	}
	snap := out["RELIANCE"]
	if snap == nil || snap.LTP != 2500.5 || snap.MarketCap != 1700000000000 {
		t.Fatalf("unexpected snapshot: %#v", snap)
	}
}

func TestYahooProviderFetchRegistryQuotesBatchV7Fallback(t *testing.T) {

	var crumbHits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/test/getcrumb":
			crumbHits++
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("test-crumb"))
		case r.URL.Path == "/v7/finance/spark":
			http.Error(w, "spark down", http.StatusServiceUnavailable)
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

	oldBootstrap, oldCrumb, oldSpark, oldQuote := yahooBootstrapURL, yahooCrumbURL, yahooSparkURL, yahooQuoteURL
	yahooBootstrapURL = srv.URL
	yahooCrumbURL = srv.URL + "/v1/test/getcrumb"
	yahooSparkURL = srv.URL + "/v7/finance/spark"
	yahooQuoteURL = srv.URL + "/v7/finance/quote"
	t.Cleanup(func() {
		yahooBootstrapURL = oldBootstrap
		yahooCrumbURL = oldCrumb
		yahooSparkURL = oldSpark
		yahooQuoteURL = oldQuote
	})

	provider := NewYahooProvider()
	provider.client = srv.Client()
	t.Setenv("YAHOO_CRUMB", "")
	t.Setenv("YAHOO_COOKIE", "")

	out, err := provider.FetchRegistryQuotesBatch(context.Background(), []RegistryQuoteInput{
		{Symbol: "RELIANCE", Exchange: "NSE"},
	})
	if err != nil {
		t.Fatalf("FetchRegistryQuotesBatch: %v", err)
	}
	if crumbHits == 0 {
		t.Fatalf("expected crumb bootstrap for v7 fallback")
	}
	snap := out["RELIANCE"]
	if snap == nil || snap.LTP != 2500.5 {
		t.Fatalf("unexpected snapshot: %#v", snap)
	}
}
