#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1. Verify camelToSnake / snakeToCamel for all registry_stocks fields"
node <<'NODE'
const camelToSnake = (key) =>
  key
    .replace(/PnL/g, 'Pnl')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9]+)(?=[a-z])/g, '$1_$2')
    .toLowerCase();

const snakeToCamel = (key) => {
  const camel = key
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/_([0-9])/g, '$1');
  return camel.replace(/PnlPct/g, 'PnLPct').replace(/Pnl/g, 'PnL');
};

// Every camelCase key written by registry-stock.service save() + expected DB column.
const registryMappings = {
  userId: 'user_id',
  symbol: 'symbol',
  name: 'name',
  isin: 'isin',
  exchange: 'exchange',
  source: 'source',
  currentPrice: 'current_price',
  marketCap: 'market_cap',
  pe: 'pe',
  rsi: 'rsi',
  macd: 'macd',
  macdHist: 'macd_hist',
  macdSignal: 'macd_signal',
  sma20: 'sma20',
  sma50: 'sma50',
  supports: 'supports',
  resistances: 'resistances',
  notes: 'notes',
  bookValue: 'book_value',
  dividendYield: 'dividend_yield',
  roce: 'roce',
  roe: 'roe',
  faceValue: 'face_value',
  highLow: 'high_low',
  salesGrowth3y: 'sales_growth_3y',
  salesGrowth5y: 'sales_growth_5y',
  salesGrowth10y: 'sales_growth_10y',
  salesGrowthTtm: 'sales_growth_ttm',
  profitGrowth3y: 'profit_growth_3y',
  profitGrowth5y: 'profit_growth_5y',
  profitGrowth10y: 'profit_growth_10y',
  profitGrowthTtm: 'profit_growth_ttm',
  stockCagr1y: 'stock_cagr_1y',
  stockCagr3y: 'stock_cagr_3y',
  stockCagr5y: 'stock_cagr_5y',
  stockCagr10y: 'stock_cagr_10y',
  promoterHolding: 'promoter_holding',
  fiiHolding: 'fii_holding',
  diiHolding: 'dii_holding',
  publicHolding: 'public_holding',
  governmentHolding: 'government_holding',
  otherHolding: 'other_holding',
  quarterlyResults: 'quarterly_results',
  profitLoss: 'profit_loss',
  balanceSheet: 'balance_sheet',
  cashFlow: 'cash_flow',
  shareholding: 'shareholding',
  screenerUrl: 'screener_url',
  screenerFetchedAt: 'screener_fetched_at',
  updatedAt: 'updated_at',
};

// Other tables / models that share the same converter.
const otherMappings = {
  week52High: 'week52_high',
  week52Low: 'week52_low',
  vsNiftyPct: 'vs_nifty_pct',
  vsCapIndexPct: 'vs_cap_index_pct',
  vsSectorPct: 'vs_sector_pct',
  realisedPnL: 'realised_pnl',
  netPnL: 'net_pnl',
  byTradeType: 'by_trade_type',
};

let failed = false;
for (const [camel, expectedSnake] of Object.entries({ ...registryMappings, ...otherMappings })) {
  const snake = camelToSnake(camel);
  const back = snakeToCamel(snake);
  if (snake !== expectedSnake) {
    console.error(`FAIL snake ${camel}: got ${snake}, expected ${expectedSnake}`);
    failed = true;
  } else if (back !== camel) {
    console.error(`FAIL round-trip ${camel}: ${snake} -> ${back}`);
    failed = true;
  } else {
    console.log(`OK ${camel} -> ${snake}`);
  }
}

if (failed) process.exit(1);
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
