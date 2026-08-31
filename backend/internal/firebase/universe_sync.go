package firebase

import (
	"context"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

const universeBatchSize = 400

// SyncUniverseSymbols writes exchange symbols to Firestore universe/{symbol}.
func (p *Publisher) SyncUniverseSymbols(ctx context.Context, entries []market.ExchangeSymbol) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	now := time.Now().UnixMilli()
	batch := p.client.Batch()
	ops := 0
	count := 0

	flush := func() error {
		if ops == 0 {
			return nil
		}
		if _, err := batch.Commit(ctx); err != nil {
			return err
		}
		batch = p.client.Batch()
		ops = 0
		return nil
	}

	for _, entry := range entries {
		symbol := entry.Symbol
		if symbol == "" {
			continue
		}
		ref := p.client.Collection("universe").Doc(symbol)
		batch.Set(ref, map[string]interface{}{
			"symbol":    symbol,
			"name":        entry.Name,
			"isin":        entry.ISIN,
			"exchange":    entry.Exchange,
			"source":      "exchange_seed",
			"updatedAt":   now,
		}, firestore.MergeAll)
		ops++
		count++
		if ops >= universeBatchSize {
			if err := flush(); err != nil {
				return count, err
			}
		}
	}
	if err := flush(); err != nil {
		return count, err
	}

	p.universeMu.Lock()
	p.universeCache = nil
	p.universeCacheAt = time.Time{}
	p.universeMu.Unlock()

	return count, nil
}
