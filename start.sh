#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting local trading worker (ingests data → Firestore)..."
cd "$ROOT/backend"
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi
go run . &
WORKER_PID=$!

echo "Starting Angular frontend on :4200..."
cd "$ROOT/frontend"
npm start &
FRONTEND_PID=$!

trap "kill $WORKER_PID $FRONTEND_PID 2>/dev/null" EXIT

echo ""
echo "  Frontend:  http://localhost:4200"
echo "  Worker:    http://localhost:8080 (optional HTTP API)"
echo "  Firebase:  UI reads stocks + recommendations from Firestore"
echo ""

wait
