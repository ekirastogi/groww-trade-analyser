package firebase

import (
	"context"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Publisher struct {
	client *firestore.Client

	universeMu      sync.Mutex
	universeCache   []string
	universeCacheAt time.Time

	shockersMu      sync.Mutex
	shockersCache   map[string]int
	shockersCacheAt time.Time
}

func NewPublisher(ctx context.Context, projectID string) (*Publisher, error) {
	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &Publisher{client: client}, nil
}

func (p *Publisher) Close() error {
	return p.client.Close()
}

func (p *Publisher) Client() *firestore.Client {
	return p.client
}

func (p *Publisher) PublishOutcome(ctx context.Context, recommendationID string, exitPrice float64, reason string, pnlPct float64) error {
	_, err := p.client.Collection("recommendations").Doc(recommendationID).Set(ctx, map[string]interface{}{
		"status":         "executed",
		"approvalStatus": "executed",
		"exitPrice":      exitPrice,
		"exitReason":     reason,
		"outcomePct":     pnlPct,
		"resolvedAt":     time.Now().Format(time.RFC3339),
	}, firestore.MergeAll)
	return err
}

type ApprovalHandler func(ctx context.Context, recommendationID string, data map[string]interface{}) error

func approvalPollInterval() time.Duration {
	iv := 30 * time.Second
	if v := os.Getenv("APPROVAL_POLL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			iv = d
		}
	}
	return iv
}

// PollApprovalsOnce checks pending approvals in a single query.
func (p *Publisher) PollApprovalsOnce(ctx context.Context, seen map[string]bool, handler ApprovalHandler) error {
	iter := p.client.Collection("recommendations").
		Where("approvalStatus", "==", "approved").
		Where("status", "==", "pending_approval").
		Documents(ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
		}
		id := doc.Ref.ID
		if seen[id] {
			continue
		}
		seen[id] = true
		if err := handler(ctx, id, doc.Data()); err != nil {
			log.Printf("approval handler error for %s: %v", id, err)
		}
	}
	return nil
}

// PollApprovals queries pending approvals on an interval (always-on mode).
func (p *Publisher) PollApprovals(ctx context.Context, handler ApprovalHandler) error {
	interval := approvalPollInterval()
	log.Printf("Polling for trade approvals every %s", interval)
	seen := make(map[string]bool)

	poll := func() {
		if err := p.PollApprovalsOnce(ctx, seen, handler); err != nil {
			log.Printf("approval poll error: %v", err)
		}
	}

	poll()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			poll()
		}
	}
}

func (p *Publisher) MarkExecuting(ctx context.Context, id string) error {
	_, err := p.client.Collection("recommendations").Doc(id).Set(ctx, map[string]interface{}{
		"status":         "executing",
		"approvalStatus": "executing",
		"executingAt":    time.Now().Format(time.RFC3339),
	}, firestore.MergeAll)
	return err
}

func (p *Publisher) MarkRejected(ctx context.Context, id string) error {
	_, err := p.client.Collection("recommendations").Doc(id).Set(ctx, map[string]interface{}{
		"status":         "rejected",
		"approvalStatus": "rejected",
		"resolvedAt":     time.Now().Format(time.RFC3339),
	}, firestore.MergeAll)
	return err
}

type OpenRecommendation struct {
	ID   string
	Data map[string]interface{}
}

func (p *Publisher) LoadOpenRecommendations(ctx context.Context) ([]OpenRecommendation, error) {
	iter := p.client.Collection("recommendations").
		Where("status", "in", []interface{}{"pending_approval", "approved", "executing"}).
		Documents(ctx)

	var out []OpenRecommendation
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		out = append(out, OpenRecommendation{ID: doc.Ref.ID, Data: doc.Data()})
	}
	return out, nil
}

func checkRecommendationOutcome(data map[string]interface{}, ltp float64) (outcome string, pnlPct float64) {
	side, _ := data["side"].(string)
	sl, _ := data["sl"].(float64)
	targets, _ := data["targets"].([]interface{})
	if len(targets) == 0 {
		return "", 0
	}
	t1, _ := targets[0].(float64)

	if strings.ToUpper(side) == "BUY" {
		if ltp <= sl {
			return "hit_sl", (ltp - sl) / sl * 100
		}
		if ltp >= t1 {
			entry, _ := data["entry"].(float64)
			if entry > 0 {
				return "hit_target", (ltp - entry) / entry * 100
			}
			return "hit_target", 0
		}
	} else {
		if ltp >= sl {
			return "hit_sl", 0
		}
		if ltp <= t1 {
			entry, _ := data["entry"].(float64)
			if entry > 0 {
				return "hit_target", (entry - ltp) / entry * 100
			}
			return "hit_target", 0
		}
	}
	return "", 0
}

// CheckOpenRecommendationsBatch evaluates SL/target hits using one query per tick.
func (p *Publisher) CheckOpenRecommendationsBatch(ctx context.Context, ltpBySymbol map[string]float64, docs []OpenRecommendation) {
	if len(ltpBySymbol) == 0 || len(docs) == 0 {
		return
	}
	for _, rec := range docs {
		sym, _ := rec.Data["symbol"].(string)
		sym = strings.ToUpper(sym)
		ltp, ok := ltpBySymbol[sym]
		if !ok {
			continue
		}
		outcome, pnlPct := checkRecommendationOutcome(rec.Data, ltp)
		if outcome != "" {
			_ = p.PublishOutcome(ctx, rec.ID, ltp, outcome, pnlPct)
		}
	}
}

func (p *Publisher) RecommendationExists(ctx context.Context, id string) (bool, error) {
	_, err := p.client.Collection("recommendations").Doc(id).Get(ctx)
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
