/** Fields we can identify a stock from. Display names stay as-is; identity is ISIN. */
export interface StockIdentityFields {
  isin?: string | null;
  symbol?: string | null;
  stockName?: string | null;
  name?: string | null;
  exchange?: string | null;
}

export type IdentityHint = {
  symbol: string;
  name?: string;
  isin?: string;
  exchange?: string;
};

/** Canonical ISIN: trim + uppercase. Empty when the source had no ISIN. */
export function normalizeIsin(isin?: string | null): string {
  return (isin ?? '').trim().toUpperCase();
}

/** Display/routing ticker derived from a company name when no exchange symbol is known yet. */
export function normalizeSymbol(stockName: string): string {
  return stockName
    .trim()
    .toUpperCase()
    .replace(/\s+(LTD|LIMITED|INC|CORP|CO)\.?$/i, '')
    .replace(/[^A-Z0-9&-]/g, '')
    .slice(0, 32) || stockName.trim().toUpperCase();
}

/**
 * Stable identity for grouping, matching, and persistence.
 * ISIN wins. Symbol/name are fallbacks only when a row has no ISIN (F&O, manual).
 */
export function stockIdentityKey(stock: StockIdentityFields): string {
  const isin = normalizeIsin(stock.isin);
  if (isin) return isin;
  const symbol = (stock.symbol ?? '').trim().toUpperCase();
  if (symbol) return `SYM:${symbol}`;
  const name = (stock.stockName ?? stock.name ?? '').trim();
  return `NAME:${normalizeSymbol(name)}`;
}

export function stocksMatch(a: StockIdentityFields, b: StockIdentityFields): boolean {
  return stockIdentityKey(a) === stockIdentityKey(b);
}

/**
 * Copy a known ISIN onto rows of the same scrip that arrived without one
 * (e.g. a trade line missing column 1 while the scrip sheet had it).
 */
export function fillMissingIsins<T extends { isin: string; stockName: string }>(rows: T[]): T[] {
  const isinByName = new Map<string, string>();
  for (const row of rows) {
    const isin = normalizeIsin(row.isin);
    if (!isin) continue;
    const nameKey = normalizeSymbol(row.stockName);
    if (nameKey && !isinByName.has(nameKey)) isinByName.set(nameKey, isin);
  }

  return rows.map((row) => {
    const isin = normalizeIsin(row.isin) || isinByName.get(normalizeSymbol(row.stockName)) || '';
    return isin === row.isin ? row : { ...row, isin };
  });
}

/**
 * Maps an ISIN to one canonical ticker for routing, labels, and a future Groww live feed.
 * NSE / shorter tickers (VBL) win over name-derived symbols (VARUNBEVERAGES).
 */
export class StockIdentityResolver {
  private symbolByIsin = new Map<string, string>();
  private isinBySymbol = new Map<string, string>();

  static fromHints(hints: IdentityHint[]): StockIdentityResolver {
    const resolver = new StockIdentityResolver();
    for (const hint of hints) resolver.addKnown(hint);
    return resolver;
  }

  addKnown(hint: IdentityHint): void {
    const symbol = hint.symbol.trim().toUpperCase();
    if (!symbol) return;
    const isin = normalizeIsin(hint.isin);
    if (!isin) return;
    const existing = this.symbolByIsin.get(isin);
    if (!existing || preferTicker(existing, symbol, hint.exchange)) {
      this.symbolByIsin.set(isin, symbol);
    }
    const canonical = this.symbolByIsin.get(isin);
    if (canonical) this.isinBySymbol.set(canonical, isin);
  }

  resolve(isinRaw: string, name: string, symbolHint = ''): { isin: string; symbol: string } {
    const isin = normalizeIsin(isinRaw);
    if (isin) {
      const mapped = this.symbolByIsin.get(isin);
      if (mapped) return { isin, symbol: mapped };
    }

    const hinted = symbolHint.trim().toUpperCase();
    let symbol = hinted || normalizeSymbol(name);
    if (isin) {
      const takenBy = this.isinBySymbol.get(symbol);
      if (takenBy && takenBy !== isin) {
        symbol = `${symbol}-${isin.slice(-6)}`;
      }
      this.symbolByIsin.set(isin, symbol);
      this.isinBySymbol.set(symbol, isin);
    }
    return { isin, symbol };
  }
}

function preferTicker(existing: string, candidate: string, exchange?: string): boolean {
  if (candidate === existing) return false;
  const candidateNse = exchange === 'NSE';
  if (candidateNse && candidate.length < existing.length) return true;
  if (candidate.length < existing.length) return true;
  return false;
}
