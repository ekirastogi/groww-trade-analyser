package groww

import (
	"context"
	"fmt"
	"log"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

// Executor handles approved trade execution on Groww.
type Executor struct {
	provider *market.GrowwProvider
	enabled  bool
}

func NewExecutor() *Executor {
	token := "" // os.Getenv("GROWW_API_TOKEN")
	return &Executor{
		provider: &market.GrowwProvider{},
		enabled:  token != "",
	}
}

type OrderRequest struct {
	RecommendationID string
	Symbol           string
	Side             string
	Entry            float64
	SL               float64
	Quantity         int
}

func (e *Executor) Execute(ctx context.Context, req OrderRequest) (string, error) {
	if !e.enabled {
		log.Printf("[groww] DRY RUN: would execute %s %s qty=%d @ %.2f (rec=%s)",
			req.Side, req.Symbol, req.Quantity, req.Entry, req.RecommendationID)
		return "dry-run-order-id", nil
	}
	return e.provider.PlaceOrder(ctx, req.Symbol, req.Side, req.Quantity, req.Entry)
}

func (e *Executor) Enabled() bool {
	return e.enabled
}

func DefaultQuantity(symbol string) int {
	return 1
}

func ValidateRequest(req OrderRequest) error {
	if req.Symbol == "" {
		return fmt.Errorf("symbol required")
	}
	if req.Side == "" {
		return fmt.Errorf("side required")
	}
	return nil
}
