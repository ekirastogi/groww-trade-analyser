package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/analysis"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/ingestion"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/models"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/parser"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

type Handler struct {
	store     *store.Store
	scheduler *ingestion.Scheduler
}

func New(s *store.Store) *Handler {
	return &Handler{store: s}
}

func NewWithScheduler(s *store.Store, scheduler *ingestion.Scheduler) *Handler {
	return &Handler{store: s, scheduler: scheduler}
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "could not parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	report, err := parser.ParseFile(header.Filename, file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	id := h.store.Save(report)

	resp := models.UploadResponse{
		ID:         id,
		Summary:    report.Summary,
		DateRange:  report.DateRange,
		TradeTypes: report.TradeTypes,
		TradeCount: len(report.Trades),
		StockCount: len(report.StockSummary),
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Analyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	report, ok := h.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "report not found")
		return
	}

	opts := analysis.Options{
		StartDate:  r.URL.Query().Get("startDate"),
		EndDate:    r.URL.Query().Get("endDate"),
		TradeTypes: parseTradeTypes(r.URL.Query().Get("tradeTypes")),
	}

	result := analysis.Analyze(report, opts)
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	report, ok := h.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "report not found")
		return
	}

	writeJSON(w, http.StatusOK, report)
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) IngestHot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.scheduler == nil {
		writeError(w, http.StatusServiceUnavailable, "ingestion scheduler not available")
		return
	}

	count := h.scheduler.RunHotIngestNow(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"status":          "ok",
		"symbolsIngested": count,
	})
}

func (h *Handler) IngestSymbol(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.scheduler == nil {
		writeError(w, http.StatusServiceUnavailable, "ingestion scheduler not available")
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(r.PathValue("symbol")))
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "symbol required")
		return
	}
	if err := h.scheduler.RunSymbolIngestNow(r.Context(), symbol); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"symbol": symbol,
	})
}

func parseTradeTypes(raw string) []models.TradeType {
	if raw == "" || raw == "all" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var types []models.TradeType
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			types = append(types, models.TradeType(p))
		}
	}
	return types
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
