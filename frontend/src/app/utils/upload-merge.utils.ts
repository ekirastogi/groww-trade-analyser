import { Trade, TradeType, TradeTypeStats } from '../models/trade.models';
import { ChargesService } from '../services/charges.service';
import { RealizedTradeRow } from './charges.utils';
import { effectiveTradeType } from './trade-type-filter.utils';

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

/**
 * Per-trade charges from the Groww rate card, aligned with the input array.
 * When `statementTotal` is the charges line from the P&L Excel, results are scaled so
 * the book matches what Groww actually billed for that statement.
 */
export function computeTradeCharges(
  trades: Trade[],
  chargesSvc: Pick<ChargesService, 'realized'>,
  statementTotal = 0
): number[] {
  const rows: RealizedTradeRow[] = trades.map((trade, index) => ({
    key: String(index),
    isin: trade.isin || trade.stockName,
    tradeType: effectiveTradeType(trade),
    quantity: trade.quantity,
    buyDate: trade.buyDate,
    sellDate: trade.sellDate,
    buyPrice: trade.buyPrice,
    sellPrice: trade.sellPrice,
  }));

  const breakdowns = chargesSvc.realized(rows);
  const estimated = trades.map((_, index) => breakdowns.get(String(index))?.total ?? 0);
  return allocateToStatementCharges(estimated, trades, statementTotal);
}

/**
 * Stretch estimated charges so they sum to Groww's billed total. Equity-only files are
 * scaled uniformly. When F&O rows exist, equity keeps the rate card and leftover
 * statement charges go to F&O by sell value (that is where option STT lives).
 */
export function allocateToStatementCharges(
  estimated: number[],
  trades: Trade[],
  statementTotal: number
): number[] {
  if (estimated.length !== trades.length) return estimated;
  if (!(statementTotal > 0) || !trades.length) return estimated;

  const isFno = trades.map((trade) => effectiveTradeType(trade) === 'fno');
  const equitySum = estimated.reduce((sum, value, i) => sum + (isFno[i] ? 0 : value), 0);
  const fnoCount = isFno.filter(Boolean).length;

  if (fnoCount && equitySum <= statementTotal) {
    const leftover = statementTotal - equitySum;
    const fnoSell = trades.reduce((sum, trade, i) => sum + (isFno[i] ? trade.sellValue : 0), 0);
    const fnoQty = trades.reduce((sum, trade, i) => sum + (isFno[i] ? trade.quantity : 0), 0);
    return estimated.map((value, i) => {
      if (!isFno[i]) return value;
      if (fnoSell > 0) return leftover * (trades[i].sellValue / fnoSell);
      if (fnoQty > 0) return leftover * (trades[i].quantity / fnoQty);
      return leftover / fnoCount;
    });
  }

  const estimatedSum = estimated.reduce((sum, value) => sum + value, 0);
  if (!(estimatedSum > 0)) {
    const sell = trades.reduce((sum, trade) => sum + trade.sellValue, 0);
    if (!(sell > 0)) return estimated.map(() => statementTotal / trades.length);
    return trades.map((trade) => statementTotal * (trade.sellValue / sell));
  }
  const scale = statementTotal / estimatedSum;
  return estimated.map((value) => value * scale);
}

/**
 * Attaches charges to a trade from the rate-card / statement allocation.
 */
export function enrichTradeWithCharges(
  trade: Trade,
  allocatedCharges: number
): TradeWithCharges {
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
