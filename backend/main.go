package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/config"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/datapub"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/firebase"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/groww"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/handlers"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/ingestion"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/logx"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/market"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/store"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/supabase"
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
		logx.Warn("Worker jobs (e.g. Import NSE & BSE symbols) will still work when listen window is active")
	}

	var dataBackend datapub.Backend
	var pgStore *supabase.Store
	if sb, err := supabase.NewStore(ctx); err != nil {
		log.Fatalf("supabase: %v", err)
	} else {
		defer sb.Close()
		pgStore = sb
		dataBackend = sb
		logx.Info("Supabase Postgres connected (data layer)")
	}

	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		logx.Warn("FIREBASE_PROJECT_ID not set — worker eventing disabled")
		logx.Warn("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path")
	}

	var workerPub *firebase.Publisher
	if projectID != "" {
		pub, err := firebase.NewPublisher(ctx, projectID)
		if err != nil {
			log.Fatalf("firestore worker: %v", err)
		}
		defer pub.Close()
		workerPub = pub
		logx.Info("Firebase connected for worker eventing only (project=%s)", projectID)
	}

	symbols := ingestion.DefaultSymbols()
	scheduler := ingestion.NewScheduler(provider, db, dataBackend, symbols)
	go scheduler.Run(ctx)

	executor := groww.NewExecutor(provider.(*market.GrowwProvider))

	if workerPub != nil && dataBackend != nil {
		runFirestoreWorker(ctx, workerPub, dataBackend, scheduler, executor)
	}

	if addr := httpAddr(); addr != "" {
		interval := os.Getenv("INGEST_INTERVAL")
		if interval == "" {
			interval = "15m"
		}
		api := handlers.NewWithScheduler(store.New(), scheduler, pgStore)
		go startHTTPServer(addr, api, map[string]any{
			"status":          "ok",
			"service":         "groww-trading-worker",
			"sqlitePath":      dbPath,
			"firebaseProject": projectID,
			"firebaseEnabled": workerPub != nil,
			"supabaseEnabled": dataBackend != nil,
			"marketProvider":  provider.Name(),
			"ingestInterval":  interval,
		})
	} else {
		log.Println("HTTP API disabled (HTTP_ADDR=off)")
	}

	logx.Info("Worker running. Press Ctrl+C to stop.")
	<-ctx.Done()
	logx.Info("Shutting down...")
}
