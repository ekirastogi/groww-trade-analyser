import { Trade, TradeType, TradeTypeStats } from '../models/trade.models';

export function normalizeSymbol(stockName: string): string {
  return stockName
    .trim()
    .toUpperCase()
    .replace(/\s+(LTD|LIMITED|INC|CORP|CO)\.?$/i, '')
    .replace(/[^A-Z0-9&-]/g, '')
    .slice(0, 32) || stockName.trim().toUpperCase();
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stable fingerprint for a trade row — includes value totals so same-day legs stay distinct. */
export async function computeTradeFingerprint(trade: Trade, clientCode: string): Promise<string> {
  const raw = [
    clientCode,
    trade.isin,
    trade.stockName,
    trade.buyDate,
    trade.sellDate,
    trade.quantity,
    trade.buyPrice,
    trade.buyValue,
    trade.sellPrice,
    trade.sellValue,
    trade.realisedPnL,
    trade.tradeType,
    trade.remark,
  ].join('|');
  return sha256Hex(raw);
}

/** @deprecated Use computeTradeFingerprint */
export async function computeTradeDedupeKey(trade: Trade, clientCode: string): Promise<string> {
  return computeTradeFingerprint(trade, clientCode);
}

/**
 * Assign a unique Firestore doc id for each parsed row.
 * Identical rows in the same file get suffixes; only exact keys already in Firestore are skipped.
 */
export async function resolveTradeDedupeKey(
  trade: Trade,
  clientCode: string,
  occurrenceInFile: number,
  takenKeys: Set<string>
): Promise<string> {
  const base = await computeTradeFingerprint(trade, clientCode);
  let suffix = occurrenceInFile;
  let key = suffix === 0 ? base : await sha256Hex(`${base}|${suffix}`);

  while (takenKeys.has(key)) {
    suffix++;
    key = await sha256Hex(`${base}|${suffix}`);
  }

  takenKeys.add(key);
  return key;
}

export async function computeFileContentHash(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function computeChargeRatio(totalSellValue: number, chargesTotal: number): number {
  return totalSellValue > 0 && chargesTotal > 0 ? chargesTotal / totalSellValue : 0;
}

interface TradeWithCharges extends Trade {
  allocatedCharges: number;
  netPnL: number;
}

export function enrichTradeWithCharges(trade: Trade, chargeRatio: number): TradeWithCharges {
  const allocatedCharges = trade.sellValue * chargeRatio;
  return {
    ...trade,
    allocatedCharges,
    netPnL: trade.realisedPnL - allocatedCharges,
  };
}

export function buildTradeTypeStats(trades: TradeWithCharges[]): TradeTypeStats {
  let winningTrades = 0;
  let losingTrades = 0;
  let totalBuyValue = 0;
  let totalSellValue = 0;
  let realisedPnL = 0;
  let allocatedCharges = 0;
  let netPnL = 0;

  for (const t of trades) {
    totalBuyValue += t.buyValue;
    totalSellValue += t.sellValue;
    realisedPnL += t.realisedPnL;
    allocatedCharges += t.allocatedCharges;
    netPnL += t.netPnL;
    if (t.realisedPnL > 0) winningTrades++;
    else if (t.realisedPnL < 0) losingTrades++;
  }

  const tradeCount = trades.length;
  return {
    tradeCount,
    winningTrades,
    losingTrades,
    winRate: tradeCount ? (winningTrades / tradeCount) * 100 : 0,
    totalBuyValue,
    totalSellValue,
    realisedPnL,
    allocatedCharges,
    netPnL,
  };
}
