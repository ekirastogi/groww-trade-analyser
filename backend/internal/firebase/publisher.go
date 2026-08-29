package firebase

import (
	"context"
	"log"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type Publisher struct {
	client *firestore.Client
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

func (p *Publisher) ListenApprovals(ctx context.Context, handler ApprovalHandler) error {
	log.Println("Listening for trade approvals on Firestore recommendations (snapshot)...")
	iter := p.client.Collection("recommendations").
		Where("approvalStatus", "==", "approved").
		Where("status", "==", "pending_approval").
		Snapshots(ctx)

	for {
		snap, err := iter.Next()
		if err != nil {
			return err
		}
		for _, change := range snap.Changes {
			if change.Kind != firestore.DocumentAdded && change.Kind != firestore.DocumentModified {
				continue
			}
			data := change.Doc.Data()
			if err := handler(ctx, change.Doc.Ref.ID, data); err != nil {
				log.Printf("approval handler error for %s: %v", change.Doc.Ref.ID, err)
			}
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

func (p *Publisher) CheckOpenRecommendations(ctx context.Context, symbol string, ltp float64) {
	iter := p.client.Collection("recommendations").
		Where("symbol", "==", symbol).
		Where("status", "in", []interface{}{"pending_approval", "approved", "executing"}).
		Documents(ctx)

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return
		}
		data := doc.Data()
		side, _ := data["side"].(string)
		sl, _ := data["sl"].(float64)
		targets, _ := data["targets"].([]interface{})
		if len(targets) == 0 {
			continue
		}
		t1, _ := targets[0].(float64)

		var outcome string
		var pnlPct float64
		if strings.ToUpper(side) == "BUY" {
			if ltp <= sl {
				outcome = "hit_sl"
				pnlPct = (ltp - sl) / sl * 100
			} else if ltp >= t1 {
				outcome = "hit_target"
				entry, _ := data["entry"].(float64)
				if entry > 0 {
					pnlPct = (ltp - entry) / entry * 100
				}
			}
		} else {
			if ltp >= sl {
				outcome = "hit_sl"
			} else if ltp <= t1 {
				outcome = "hit_target"
				entry, _ := data["entry"].(float64)
				if entry > 0 {
					pnlPct = (entry - ltp) / entry * 100
				}
			}
		}
		if outcome != "" {
			_ = p.PublishOutcome(ctx, doc.Ref.ID, ltp, outcome, pnlPct)
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
