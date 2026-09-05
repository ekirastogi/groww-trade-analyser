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

/** Doc id for the Nth identical fingerprint (0 = the fingerprint itself). */
export async function tradeOccurrenceKey(fingerprint: string, occurrence: number): Promise<string> {
  return occurrence <= 0 ? fingerprint : sha256Hex(`${fingerprint}|${occurrence}`);
}

/** @deprecated Use computeTradeFingerprint */
export async function computeTradeDedupeKey(trade: Trade, clientCode: string): Promise<string> {
  return computeTradeFingerprint(trade, clientCode);
}

/**
 * Stable id for a parsed row. Returns null when that occurrence already exists
 * (caller should skip the row). Identical rows in the same file use suffixes.
 */
export async function resolveTradeDedupeKey(
  trade: Trade,
  clientCode: string,
  occurrenceInFile: number,
  takenKeys: Set<string>
): Promise<string | null> {
  const base = await computeTradeFingerprint(trade, clientCode);
  const key = await tradeOccurrenceKey(base, occurrenceInFile);
  if (takenKeys.has(key)) return null;
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
