package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/handlers"
)

func startHTTPServer(addr string, h *handlers.Handler, health map[string]any) {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, health)
	})
	mux.HandleFunc("GET /openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		http.ServeFile(w, r, firstExistingFile("docs/openapi.yaml"))
	})
	mux.HandleFunc("GET /docs", serveSwaggerUI)
	mux.HandleFunc("GET /docs/", serveSwaggerUI)

	mux.HandleFunc("POST /api/v1/reports", h.Upload)
	mux.HandleFunc("GET /api/v1/reports/{id}", h.Report)
	mux.HandleFunc("GET /api/v1/reports/{id}/analyze", h.Analyze)
	mux.HandleFunc("POST /api/v1/ingest/hot", h.IngestHot)
	mux.HandleFunc("POST /api/v1/ingest/symbol/{symbol}", h.IngestSymbol)
	mux.HandleFunc("POST /api/v1/ingest/seed-registry", h.IngestSeedRegistry)
	mux.HandleFunc("POST /api/v1/ingest/seed-universe", h.IngestSeedRegistry)
	mux.HandleFunc("POST /api/v1/registry/backfill-yahoo", h.BackfillRegistryYahoo)

	server := &http.Server{
		Addr:              addr,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("HTTP API listening on http://localhost%s", addr)
	log.Printf("Swagger UI: http://localhost%s/docs", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http: %v", err)
	}
}

func firstExistingFile(paths ...string) string {
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return paths[0]
}

func serveSwaggerUI(w http.ResponseWriter, r *http.Request) {
	path := firstExistingFile("docs/swagger-ui.html")
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "swagger UI not found; import docs/openapi.yaml into Swagger Editor", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, path)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func httpAddr() string {
	addr := strings.TrimSpace(os.Getenv("HTTP_ADDR"))
	if addr == "" {
		return ":8080"
	}
	if addr == "off" || addr == "disabled" {
		return ""
	}
	if !strings.HasPrefix(addr, ":") && !strings.Contains(addr, ":") {
		return ":" + addr
	}
	return addr
}
