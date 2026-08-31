package firebase

import (
	"context"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
	"google.golang.org/api/iterator"
)

const workerStatusDoc = "worker/status"

type JobHandler func(ctx context.Context, jobID string, data map[string]interface{}) error

func jobPollInterval() time.Duration {
	iv := 30 * time.Second
	if v := os.Getenv("WORKER_JOB_POLL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			iv = d
		}
	}
	return iv
}

func (p *Publisher) PublishHeartbeat(ctx context.Context) error {
	_, err := p.client.Collection("worker").Doc("status").Set(ctx, map[string]interface{}{
		"status":   "online",
		"lastSeen": time.Now().UnixMilli(),
		"service":  "groww-trading-worker",
	}, firestore.MergeAll)
	if err == nil {
		logx.Verbosef("Heartbeat published to worker/status")
	}
	return err
}

func (p *Publisher) MarkJobRunning(ctx context.Context, jobID string) error {
	_, err := p.client.Collection("workerJobs").Doc(jobID).Set(ctx, map[string]interface{}{
		"status":    "running",
		"startedAt": time.Now().UnixMilli(),
	}, firestore.MergeAll)
	return err
}

func (p *Publisher) MarkJobCompleted(ctx context.Context, jobID string, symbolsIngested int) error {
	_, err := p.client.Collection("workerJobs").Doc(jobID).Set(ctx, map[string]interface{}{
		"status":          "completed",
		"completedAt":     time.Now().UnixMilli(),
		"symbolsIngested": symbolsIngested,
	}, firestore.MergeAll)
	return err
}

func (p *Publisher) MarkJobFailed(ctx context.Context, jobID, errMsg string) error {
	_, err := p.client.Collection("workerJobs").Doc(jobID).Set(ctx, map[string]interface{}{
		"status":      "failed",
		"completedAt": time.Now().UnixMilli(),
		"error":       errMsg,
	}, firestore.MergeAll)
	return err
}

// PollWorkerJobs queries pending jobs on an interval instead of a snapshot listener.
func (p *Publisher) PollWorkerJobs(ctx context.Context, handler JobHandler) error {
	interval := jobPollInterval()
	logx.Info("Polling for worker jobs every %s (no snapshot listener)", interval)
	seen := make(map[string]bool)

	poll := func() {
		iter := p.client.Collection("workerJobs").
			Where("status", "==", "pending").
			Documents(ctx)
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				logx.Warn("Worker job poll error: %v", err)
				return
			}
			jobID := doc.Ref.ID
			if seen[jobID] {
				continue
			}
			data := doc.Data()
			jobType, _ := data["type"].(string)
			if jobType != "hot_ingest" && jobType != "symbol_ingest" && jobType != "seed_universe" {
				continue
			}
			seen[jobID] = true
			logx.Info("Worker job received: id=%s type=%s", jobID, jobType)
			if err := handler(ctx, jobID, data); err != nil {
				logx.Error("Worker job %s failed: %v", jobID, err)
				_ = p.MarkJobFailed(ctx, jobID, err.Error())
			} else {
				logx.Info("Worker job %s completed", jobID)
			}
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
