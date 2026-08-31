package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/config"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/groww"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/handlers"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/ingestion"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

func main() {
	config.LoadDotEnv(".env")
	logx.Info("Groww Trading Worker — local market ingest + optional P&L HTTP API")
	if logx.Verbose {
		logx.Info("Verbose logging enabled (set LOG_VERBOSE=false to reduce noise)")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = store.DefaultDBPath()
	}
	db, err := store.NewSQLite(dbPath)
	if err != nil {
		log.Fatalf("sqlite: %v", err)
	}
	defer db.Close()
	logx.Info("SQLite: %s", dbPath)

	providerName := os.Getenv("MARKET_DATA_PROVIDER")
	if providerName == "" {
		providerName = "groww"
	}
	provider, err := market.NewProvider(providerName)
	if err != nil {
		log.Fatalf("market provider: %v", err)
	}
	logx.Info("Market provider: %s", provider.Name())
	if !market.ProviderConfigured(provider) {
		logx.Warn("Groww credentials missing — quotes/OHLC ingest disabled until GROWW_ACCESS_TOKEN is set")
		logx.Warn("Firestore jobs (e.g. Import NSE & BSE symbols) will still work")
	}

	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		logx.Warn("FIREBASE_PROJECT_ID not set — results will not sync to Firestore")
		logx.Warn("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path")
	}

	var publisher *firebase.Publisher
	if projectID != "" {
		pub, err := firebase.NewPublisher(ctx, projectID)
		if err != nil {
			log.Fatalf("firestore: %v", err)
		}
		defer pub.Close()
		publisher = pub
		logx.Info("Firestore publisher connected (project=%s)", projectID)
	}

	symbols := ingestion.DefaultSymbols()
	scheduler := ingestion.NewScheduler(provider, db, publisher, symbols)
	go scheduler.Run(ctx)

	executor := groww.NewExecutor(provider.(*market.GrowwProvider))

	if publisher != nil {
		go func() {
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
		}()

		go func() {
			_ = publisher.PollWorkerJobs(ctx, func(ctx context.Context, jobID string, data map[string]interface{}) error {
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
			})
		}()

		go func() {
			_ = publisher.PollApprovals(ctx, func(ctx context.Context, recID string, data map[string]interface{}) error {
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
			})
		}()
	}

	if addr := httpAddr(); addr != "" {
		interval := os.Getenv("INGEST_INTERVAL")
		if interval == "" {
			interval = "15m"
		}
		api := handlers.NewWithScheduler(store.New(), scheduler)
		go startHTTPServer(addr, api, map[string]any{
			"status":           "ok",
			"service":          "groww-trading-worker",
			"sqlitePath":       dbPath,
			"firebaseProject":  projectID,
			"firebaseEnabled":  publisher != nil,
			"marketProvider":   provider.Name(),
			"ingestInterval":   interval,
		})
	} else {
		log.Println("HTTP API disabled (HTTP_ADDR=off)")
	}

	logx.Info("Worker running. Press Ctrl+C to stop.")
	<-ctx.Done()
	logx.Info("Shutting down...")
}
