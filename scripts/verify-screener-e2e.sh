#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1. Verify camelToSnake / snakeToCamel round-trip"
node <<'NODE'
const camelToSnake = (key) =>
  key
    .replace(/PnL/g, 'Pnl')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9])/g, '$1_$2')
    .toLowerCase();

const snakeToCamel = (key) => {
  const camel = key
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/_([0-9])/g, '$1');
  return camel.replace(/PnlPct/g, 'PnLPct').replace(/Pnl/g, 'PnL');
};

const fields = [
  'profitGrowth10y', 'salesGrowth3y', 'stockCagr10y', 'screenerFetchedAt',
  'quarterlyResults', 'profitLoss', 'balanceSheet', 'cashFlow', 'fiiHolding',
];
for (const f of fields) {
  const snake = camelToSnake(f);
  const back = snakeToCamel(snake);
  if (back !== f) {
    console.error(`FAIL ${f} -> ${snake} -> ${back}`);
    process.exit(1);
  }
  console.log(`OK ${f} -> ${snake}`);
}
NODE

echo ""
echo "==> 2. Build frontend"
cd frontend && npm run build

echo ""
echo "==> 3. Curl screener-fetch edge function"
cd "$ROOT"
SUPABASE_URL="$(grep -o "url: '[^']*'" frontend/src/environments/supabase.config.ts | head -1 | cut -d"'" -f2)"
ANON_KEY="$(grep -o "anonKey: '[^']*'" frontend/src/environments/supabase.config.ts | head -1 | cut -d"'" -f2)"

if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  echo "WARN: Could not read supabase config — skip live curl"
else
  for SYM in LANDMARK MAZDOCK; do
    echo "Fetching $SYM..."
    RESP="$(curl -sS -X POST "$SUPABASE_URL/functions/v1/screener-fetch" \
      -H "Content-Type: application/json" \
      -H "apikey: $ANON_KEY" \
      -H "Authorization: Bearer $ANON_KEY" \
      -d "{\"symbol\":\"$SYM\"}")"
    REQUIRE_GROWTH="$([[ "$SYM" == "MAZDOCK" ]] && echo 1 || echo 0)"
    RESP="$RESP" REQUIRE_GROWTH="$REQUIRE_GROWTH" node -e '
      const d = JSON.parse(process.env.RESP);
      if (d.error) { console.error("ERROR:", d.error); process.exit(1); }
      const checks = [
        ["symbol", d.symbol],
        ["quarterlyResults.rows", d.quarterlyResults?.rows?.length],
        ["profitLoss.rows", d.profitLoss?.rows?.length],
        ["balanceSheet.rows", d.balanceSheet?.rows?.length],
        ["cashFlow.rows", d.cashFlow?.rows?.length],
      ];
      if (process.env.REQUIRE_GROWTH === "1") {
        checks.push(["profitGrowth10y", d.profitGrowth10y != null]);
      }
      for (const [k, val] of checks) {
        if (!val) { console.error("MISSING", k); process.exit(1); }
        const extra = typeof val === "boolean" ? "" : `(${val})`;
        console.log("  OK", k, extra);
      }
    '
  done
fi

echo ""
echo "==> All e2e checks passed"
