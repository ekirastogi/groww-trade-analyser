package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/config"
	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/supabase"
)

func main() {
	config.LoadDotEnv(".env")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	store, err := supabase.NewStore(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer store.Close()

	root := filepath.Join("..", "supabase", "migrations")
	entries, err := os.ReadDir(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read migrations: %v\n", err)
		os.Exit(1)
	}

	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		files = append(files, filepath.Join(root, e.Name()))
	}
	sort.Strings(files)

	if len(os.Args) > 1 {
		name := os.Args[1]
		filtered := files[:0]
		for _, file := range files {
			if strings.Contains(filepath.Base(file), name) {
				filtered = append(filtered, file)
			}
		}
		if len(filtered) == 0 {
			fmt.Fprintf(os.Stderr, "no migration matching %q\n", name)
			os.Exit(1)
		}
		files = filtered
	}

	if len(files) == 0 {
		fmt.Println("No migration files found.")
		return
	}

	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			fmt.Fprintf(os.Stderr, "read %s: %v\n", file, err)
			os.Exit(1)
		}
		fmt.Printf("Applying %s ...\n", filepath.Base(file))
		if err := store.ExecSQL(ctx, string(sql)); err != nil {
			fmt.Fprintf(os.Stderr, "apply %s: %v\n", file, err)
			os.Exit(1)
		}
		fmt.Printf("OK %s\n", filepath.Base(file))
	}

	fmt.Println("All migrations applied.")
}
