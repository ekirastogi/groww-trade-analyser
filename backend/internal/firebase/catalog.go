package firebase

import (
	"context"
	"sort"
	"time"
)

type CatalogEntry struct {
	Symbol     string  `json:"symbol"`
	Name       string  `json:"name"`
	LTP        float64 `json:"ltp"`
	ChangePct  float64 `json:"changePct"`
	MarketCap  float64 `json:"marketCap"`
	PE         float64 `json:"pe"`
	Sector     string  `json:"sector"`
	LastUpdated string `json:"lastUpdated"`
	DataSource string  `json:"dataSource"`
}

func (p *Publisher) PublishMarketCatalog(ctx context.Context, entries []CatalogEntry) error {
	sort.Slice(entries, func(i, j int) bool { return entries[i].Symbol < entries[j].Symbol })
	rows := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, map[string]interface{}{
			"symbol": e.Symbol, "name": e.Name, "ltp": e.LTP,
			"changePct": e.ChangePct, "marketCap": e.MarketCap, "pe": e.PE,
			"sector": e.Sector, "lastUpdated": e.LastUpdated, "dataSource": e.DataSource,
		})
	}
	_, err := p.client.Collection("marketCatalog").Doc("summary").Set(ctx, map[string]interface{}{
		"updatedAt": time.Now().UnixMilli(),
		"count":     len(rows),
		"stocks":    rows,
	})
	return err
}

func (p *Publisher) LoadMarketCatalog(ctx context.Context) ([]CatalogEntry, error) {
	doc, err := p.client.Collection("marketCatalog").Doc("summary").Get(ctx)
	if err != nil {
		return nil, err
	}
	data := doc.Data()
	raw, _ := data["stocks"].([]interface{})
	out := make([]CatalogEntry, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		out = append(out, CatalogEntry{
			Symbol:      strField(m, "symbol"),
			Name:        strField(m, "name"),
			LTP:         floatField(m, "ltp"),
			ChangePct:   floatField(m, "changePct"),
			MarketCap:   floatField(m, "marketCap"),
			PE:          floatField(m, "pe"),
			Sector:      strField(m, "sector"),
			LastUpdated: strField(m, "lastUpdated"),
			DataSource:  strField(m, "dataSource"),
		})
	}
	return out, nil
}

func strField(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func floatField(m map[string]interface{}, key string) float64 {
	switch v := m[key].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	default:
		return 0
	}
}
