package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/groww"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/ingestion"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
)

func workerFirestoreMode() string {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("WORKER_FIRESTORE_MODE")))
	if mode == "" {
		return "ondemand"
	}
	return mode
}

func listenCheckInterval() time.Duration {
	iv := 60 * time.Second
	if v := os.Getenv("WORKER_LISTEN_CHECK_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			iv = d
		}
	}
	return iv
}

func quotaBackoffDuration() time.Duration {
	iv := 5 * time.Minute
	if v := os.Getenv("WORKER_QUOTA_BACKOFF"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			iv = d
		}
	}
	return iv
}

func runFirestoreWorker(
	ctx context.Context,
	publisher *firebase.Publisher,
	scheduler *ingestion.Scheduler,
	executor *groww.Executor,
) {
	jobHandler := makeJobHandler(publisher, scheduler)
	approvalHandler := makeApprovalHandler(publisher, executor)
	tradingEnabled := os.Getenv("GROWW_ENABLE_TRADING") == "true"

	if workerFirestoreMode() == "always" {
		logx.Info("Worker Firestore mode: always (continuous heartbeat + job poll)")
		go runHeartbeatLoop(ctx, publisher)
		go func() { _ = publisher.PollWorkerJobs(ctx, jobHandler) }()
		if tradingEnabled {
			go func() { _ = publisher.PollApprovals(ctx, approvalHandler) }()
		}
		return
	}

	logx.Info("Worker Firestore mode: ondemand (idle until Settings → Worker → Connect)")
	go runOnDemandWorkerLoop(ctx, publisher, jobHandler, approvalHandler, tradingEnabled)
}

func runHeartbeatLoop(ctx context.Context, publisher *firebase.Publisher) {
	if err := publisher.PublishHeartbeat(ctx); err != nil {
		logx.Warn("worker heartbeat: %v", err)
	}
	heartbeat := 5 * time.Minute
	if v := os.Getenv("HEARTBEAT_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			heartbeat = d
		}
	}
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := publisher.PublishHeartbeat(ctx); err != nil {
				logx.Warn("worker heartbeat: %v", err)
			}
		}
	}
}

func runOnDemandWorkerLoop(
	ctx context.Context,
	publisher *firebase.Publisher,
	jobHandler firebase.JobHandler,
	approvalHandler firebase.ApprovalHandler,
	tradingEnabled bool,
) {
	seenJobs := make(map[string]bool)
	seenApprovals := make(map[string]bool)
	wasActive := false
	quotaPausedUntil := time.Time{}

	ticker := time.NewTicker(listenCheckInterval())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !quotaPausedUntil.IsZero() && time.Now().Before(quotaPausedUntil) {
				continue
			}
			quotaPausedUntil = time.Time{}

			active, err := publisher.IsListenWindowActive(ctx)
			if err != nil {
				if firebase.IsQuotaError(err) {
					logx.Warn("Firestore quota exceeded — pausing worker polls for %s", quotaBackoffDuration())
					quotaPausedUntil = time.Now().Add(quotaBackoffDuration())
				} else {
					logx.Warn("Listen window check failed: %v", err)
				}
				continue
			}

			if !active {
				if wasActive {
					logx.Info("Listen window ended — worker Firestore idle")
				}
				wasActive = false
				continue
			}

			if !wasActive {
				logx.Info("Listen window active — processing worker jobs")
			}
			wasActive = true

			if err := publisher.PublishHeartbeat(ctx); err != nil {
				if firebase.IsQuotaError(err) {
					logx.Warn("Firestore quota exceeded — pausing worker polls for %s", quotaBackoffDuration())
					quotaPausedUntil = time.Now().Add(quotaBackoffDuration())
				}
				continue
			}
			if err := publisher.PollPendingJobsOnce(ctx, seenJobs, jobHandler); err != nil {
				if firebase.IsQuotaError(err) {
					logx.Warn("Firestore quota exceeded — pausing worker polls for %s", quotaBackoffDuration())
					quotaPausedUntil = time.Now().Add(quotaBackoffDuration())
				} else {
					logx.Warn("Worker job poll error: %v", err)
				}
				continue
			}
			if tradingEnabled {
				if err := publisher.PollApprovalsOnce(ctx, seenApprovals, approvalHandler); err != nil && firebase.IsQuotaError(err) {
					logx.Warn("Firestore quota exceeded — pausing worker polls for %s", quotaBackoffDuration())
					quotaPausedUntil = time.Now().Add(quotaBackoffDuration())
				}
			}
		}
	}
}

func makeJobHandler(publisher *firebase.Publisher, scheduler *ingestion.Scheduler) firebase.JobHandler {
	return func(ctx context.Context, jobID string, data map[string]interface{}) error {
		jobType, _ := data["type"].(string)
		if err := publisher.MarkJobRunning(ctx, jobID); err != nil {
			return err
		}
		switch jobType {
		case "hot_ingest":
			logx.Info("Processing Firestore job %s (hot_ingest)", jobID)
			count := scheduler.RunHotIngestNow(ctx)
			return publisher.MarkJobCompleted(ctx, jobID, count)
		case "symbol_ingest":
			symbol, _ := data["symbol"].(string)
			symbol = strings.ToUpper(strings.TrimSpace(symbol))
			if symbol == "" {
				return fmt.Errorf("symbol required")
			}
			logx.Info("Processing Firestore job %s (symbol_ingest %s)", jobID, symbol)
			if err := scheduler.RunSymbolIngestNow(ctx, symbol); err != nil {
				return err
			}
			return publisher.MarkJobCompleted(ctx, jobID, 1)
		case "seed_universe":
			logx.Info("Processing Firestore job %s (seed_universe)", jobID)
			count, err := scheduler.SeedUniverseFromExchanges(ctx)
			if err != nil {
				return err
			}
			return publisher.MarkJobCompleted(ctx, jobID, count)
		default:
			return fmt.Errorf("unknown job type: %s", jobType)
		}
	}
}

func makeApprovalHandler(publisher *firebase.Publisher, executor *groww.Executor) firebase.ApprovalHandler {
	return func(ctx context.Context, recID string, data map[string]interface{}) error {
		symbol, _ := data["symbol"].(string)
		side, _ := data["side"].(string)
		entry, _ := data["entry"].(float64)
		sl, _ := data["sl"].(float64)

		_ = publisher.MarkExecuting(ctx, recID)

		req := groww.OrderRequest{
			RecommendationID: recID,
			Symbol:           symbol,
			Side:             side,
			Entry:            entry,
			SL:               sl,
			Quantity:         groww.DefaultQuantity(symbol),
		}
		if err := groww.ValidateRequest(req); err != nil {
			return err
		}
		orderID, err := executor.Execute(ctx, req)
		if err != nil {
			log.Printf("groww execution failed: %v", err)
			return err
		}
		log.Printf("Order placed on Groww: %s (rec=%s)", orderID, recID)
		return publisher.PublishOutcome(ctx, recID, entry, "executed_on_groww", 0)
	}
}
