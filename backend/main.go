package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/groww"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/handlers"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/ingestion"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
)

func main() {
	log.Println("Groww Trading Worker — local market ingest + optional P&L HTTP API")

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
	log.Printf("SQLite: %s", dbPath)

	providerName := os.Getenv("MARKET_DATA_PROVIDER")
	if providerName == "" {
		providerName = "stooq+yahoo"
	}
	provider := market.NewProvider(providerName)
	log.Printf("Market provider: %s", provider.Name())

	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		log.Println("WARNING: FIREBASE_PROJECT_ID not set — results will not sync to Firestore")
		log.Println("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path")
	}

	var publisher *firebase.Publisher
	if projectID != "" {
		pub, err := firebase.NewPublisher(ctx, projectID)
		if err != nil {
			log.Fatalf("firestore: %v", err)
		}
		defer pub.Close()
		publisher = pub
		log.Println("Firestore publisher connected")
	}

	symbols := ingestion.DefaultSymbols()
	scheduler := ingestion.NewScheduler(provider, db, publisher, symbols)
	go scheduler.Run(ctx)

	executor := groww.NewExecutor()

	if publisher != nil {
		go func() {
			_ = publisher.ListenApprovals(ctx, func(ctx context.Context, recID string, data map[string]interface{}) error {
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
			interval = "5m"
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

	log.Println("Worker running. Press Ctrl+C to stop.")
	<-ctx.Done()
	log.Println("Shutting down...")
}
