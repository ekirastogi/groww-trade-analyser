#!/usr/bin/env bash
# Apply supabase/migrations/*.sql using backend Postgres credentials.
# Use when Supabase CLI is unavailable (e.g. older CPUs without AVX).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"
go run ./cmd/migrate
