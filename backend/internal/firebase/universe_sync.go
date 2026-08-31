package firebase

import (
	"context"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

// SyncRegistrySymbols is a legacy Firestore path; Supabase is the data layer.
func (p *Publisher) SyncRegistrySymbols(ctx context.Context, userID string, entries []market.ExchangeSymbol) (int, error) {
	_ = ctx
	_ = userID
	return len(entries), nil
}
