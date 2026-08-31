package supabase

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
)

type RegistrySymbolRow struct {
	Symbol   string
	Exchange string
}

type RegistryBackfillResult struct {
	Processed int `json:"processed"`
	Updated   int `json:"updated"`
	Offset    int `json:"offset"`
	Total     int `json:"total"`
	Done      bool `json:"done"`
}

func (s *Store) CountRegistrySymbols(ctx context.Context, userID string, onlyMissing bool) (int, error) {
	q := `select count(*) from registry_stocks where user_id = $1`
	if onlyMissing {
		q += ` and coalesce(current_price, 0) = 0`
	}
	var n int
	if err := s.pool.QueryRow(ctx, q, userID).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func (s *Store) ListRegistrySymbols(ctx context.Context, userID string, onlyMissing bool, offset, limit int) ([]RegistrySymbolRow, error) {
	q := `
		select symbol, coalesce(nullif(exchange, ''), 'NSE')
		from registry_stocks
		where user_id = $1
	`
	if onlyMissing {
		q += ` and coalesce(current_price, 0) = 0`
	}
	q += ` order by symbol offset $2 limit $3`

	rows, err := s.pool.Query(ctx, q, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RegistrySymbolRow
	for rows.Next() {
		var row RegistrySymbolRow
		if err := rows.Scan(&row.Symbol, &row.Exchange); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) ApplyRegistryQuote(ctx context.Context, userID, symbol, name string, ltp, marketCap, pe float64) error {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if sym == "" {
		return fmt.Errorf("symbol required")
	}
	now := time.Now().UnixMilli()
	_, err := s.pool.Exec(ctx, `
		update registry_stocks set
			name = case when $3 <> '' then $3 else name end,
			current_price = case when $4 > 0 then $4 else current_price end,
			market_cap = case when $5 > 0 then $5 else market_cap end,
			pe = case when $6 > 0 then $6 else pe end,
			updated_at = $7
		where user_id = $1 and symbol = $2
	`, userID, sym, strings.TrimSpace(name), ltp, marketCap, pe, now)
	return err
}

func (s *Store) BackfillRegistryFromYahoo(ctx context.Context, yahoo *market.YahooProvider, userID string, offset, limit int, onlyMissing bool) (RegistryBackfillResult, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return RegistryBackfillResult{}, fmt.Errorf("user id required")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}

	total, err := s.CountRegistrySymbols(ctx, userID, onlyMissing)
	if err != nil {
		return RegistryBackfillResult{}, err
	}

	rows, err := s.ListRegistrySymbols(ctx, userID, onlyMissing, offset, limit)
	if err != nil {
		return RegistryBackfillResult{}, err
	}

	result := RegistryBackfillResult{
		Offset: offset,
		Total:  total,
		Done:   offset+len(rows) >= total || len(rows) == 0,
	}

	for i := 0; i < len(rows); i += market.YahooBatchSize {
		end := i + market.YahooBatchSize
		if end > len(rows) {
			end = len(rows)
		}
		chunk := rows[i:end]
		inputs := make([]market.RegistryQuoteInput, len(chunk))
		for j, row := range chunk {
			inputs[j] = market.RegistryQuoteInput{Symbol: row.Symbol, Exchange: row.Exchange}
		}

		quotes, err := yahoo.FetchRegistryQuotesBatch(ctx, inputs)
		if err != nil {
			return result, err
		}

		for _, row := range chunk {
			result.Processed++
			snap := quotes[row.Symbol]
			if snap == nil || snap.LTP <= 0 {
				continue
			}
			if err := s.ApplyRegistryQuote(ctx, userID, row.Symbol, snap.Name, snap.LTP, snap.MarketCap, snap.PE); err != nil {
				return result, err
			}
			result.Updated++
		}

		if end < len(rows) {
			select {
			case <-ctx.Done():
				return result, ctx.Err()
			case <-time.After(market.YahooBatchPause()):
			}
		}
	}

	result.Done = offset+len(rows) >= total
	return result, nil
}
