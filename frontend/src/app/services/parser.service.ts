import { Injectable } from '@angular/core';
import { effectiveTradeType } from '../utils/trade-type-filter.utils';

/**
 * Upper bound on an uploaded workbook. A real Groww P&L statement is a few hundred KB;
 * this stops a malformed or hostile file from hanging the tab inside the parser.
 */
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
import {
  Report,
  StockSummary,
  Trade,
  TradeType,
  UnrealisedHolding,
  UnrealisedLot,
} from '../models/trade.models';
import {
  isJunkScripRow,
  isUnrealisedSectionLabel,
  mergeHoldingsWithLots,
  parseHoldingsAsOf,
} from '../utils/holdings.utils';
import { normalizeSymbol } from '../utils/upload-merge.utils';

const CHARGE_LABELS = [
  'Exchange Transaction Charges', 'SEBI Charges', 'STT', 'Stamp Duty',
  'IPFT Charges', 'Brokerage', 'CDSL DP Charges', 'Groww DP Charges',
  'MIS Charges', 'Pledge Charges', 'MTF Pledge Charges',
  'MTF Unpledge Charges', 'MTF interest', 'Total GST', 'Total',
];

@Injectable({ providedIn: 'root' })
export class ParserService {
  async parseFile(file: File): Promise<Report> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      const text = await file.text();
      return this.parseRows(this.csvToRows(text));
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (file.size > MAX_WORKBOOK_BYTES) {
        throw new Error(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. P&L statements are far smaller — please check you picked the right file.`
        );
      }
      // Loaded on demand: the spreadsheet parser is the single largest dependency in the app,
      // and only this upload path needs it. A static import puts it in the initial bundle.
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      if (!wb.SheetNames.length) throw new Error('That workbook has no sheets to read.');
      const sheet = wb.SheetNames.includes('Trade Level') ? 'Trade Level' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[sheet], {
        header: 1,
        defval: '',
      });
      const report = this.parseRows(rows);

      const scripSheet = wb.SheetNames.includes('Scrip Level') ? 'Scrip Level' : null;
      if (scripSheet) {
        const scripRows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[scripSheet], {
          header: 1,
          defval: '',
        });
        const scrip = this.parseScripLevel(scripRows);
        report.stockSummary = scrip.realised;
        const asOfDate =
          scrip.asOfDate ||
          report.unrealisedLots?.[0]?.closingDate ||
          '';
        report.unrealisedHoldings = mergeHoldingsWithLots(
          scrip.unrealised,
          report.unrealisedLots ?? [],
          asOfDate
        );
        if (scrip.asOfDate && report.unrealisedHoldings.length) {
          report.unrealisedHoldings = report.unrealisedHoldings.map((holding) => ({
            ...holding,
            asOfDate: scrip.asOfDate,
          }));
        }
      } else if (report.unrealisedLots?.length) {
        report.unrealisedHoldings = mergeHoldingsWithLots(
          [],
          report.unrealisedLots,
          report.unrealisedLots[0]?.closingDate ?? ''
        );
      }
      return report;
    }
    throw new Error('Unsupported file type. Use .csv or .xlsx');
  }

  private parseRows(rows: (string | number)[][]): Report {
    const report: Report = {
      summary: { clientName: '', clientCode: '', period: '', realisedPnL: 0, unrealisedPnL: 0 },
      charges: { items: [], total: 0 },
      trades: [],
      stockSummary: [],
      unrealisedHoldings: [],
      unrealisedLots: [],
      dateRange: { min: '', max: '' },
      tradeTypes: ['all'],
    };

    this.parseHeaderSection(rows, report);

    const unrealisedIdx = this.findUnrealisedSection(rows);
    const realisedHeaderIdx = this.findHeaderRowBefore(rows, 'Stock name', unrealisedIdx);
    if (realisedHeaderIdx === -1) throw new Error('Could not find trade header row (Stock name)');

    const realisedEnd = unrealisedIdx === -1 ? rows.length : unrealisedIdx;
    for (let i = realisedHeaderIdx + 1; i < realisedEnd; i++) {
      const row = this.padRow(rows[i], 11);
      if (isJunkScripRow(String(row[0]))) continue;
      const trade = this.parseTradeRow(row);
      if (trade) report.trades.push(trade);
    }

    if (unrealisedIdx !== -1) {
      const lotHeaderIdx = this.findHeaderRowFrom(rows, 'Stock name', unrealisedIdx);
      const start = lotHeaderIdx === -1 ? unrealisedIdx + 1 : lotHeaderIdx + 1;
      for (let i = start; i < rows.length; i++) {
        const row = this.padRow(rows[i], 11);
        if (isJunkScripRow(String(row[0]))) continue;
        const lot = this.parseUnrealisedLot(row);
        if (lot) report.unrealisedLots!.push(lot);
      }
      if (!report.unrealisedHoldings?.length && report.unrealisedLots?.length) {
        report.unrealisedHoldings = mergeHoldingsWithLots(
          [],
          report.unrealisedLots,
          report.unrealisedLots[0]?.closingDate ?? ''
        );
      }
    }

    this.finalizeReport(report);
    return report;
  }

  private parseHeaderSection(rows: (string | number)[][], report: Report): void {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = this.padRow(rows[i], 2);
      const label = String(row[0]).trim();
      const value = String(row[1]).trim();

      if (label === 'Name') report.summary.clientName = value;
      else if (label === 'Unique Client Code') report.summary.clientCode = value;
      else if (label.includes('P&L Statement')) report.summary.period = label;
      else if (label === 'Realised P&L') report.summary.realisedPnL = this.parseFloat(value);
      else if (label === 'Unrealised P&L') report.summary.unrealisedPnL = this.parseFloat(value);
      else if (CHARGE_LABELS.includes(label)) {
        const amount = this.parseFloat(value);
        report.charges.items.push({ label, amount });
        if (label === 'Total') report.charges.total = amount;
      }
    }
  }

  private parseScripLevel(rows: (string | number)[][]): {
    realised: StockSummary[];
    unrealised: UnrealisedHolding[];
    asOfDate: string;
  } {
    const unrealisedIdx = this.findUnrealisedSection(rows);
    const realisedHeaderIdx = this.findHeaderRowBefore(rows, 'Stock name', unrealisedIdx);
    const realised: StockSummary[] = [];
    const unrealised: UnrealisedHolding[] = [];
    let asOfDate = '';

    if (unrealisedIdx !== -1) {
      asOfDate = parseHoldingsAsOf(String(rows[unrealisedIdx][0] ?? '')) ?? '';
    }

    if (realisedHeaderIdx !== -1) {
      const end = unrealisedIdx === -1 ? rows.length : unrealisedIdx;
      for (let i = realisedHeaderIdx + 1; i < end; i++) {
        const stock = this.parseRealisedScripRow(rows[i]);
        if (stock) realised.push(stock);
      }
    }

    if (unrealisedIdx !== -1) {
      const headerIdx = this.findHeaderRowFrom(rows, 'Stock name', unrealisedIdx);
      const start = headerIdx === -1 ? unrealisedIdx + 1 : headerIdx + 1;
      for (let i = start; i < rows.length; i++) {
        const holding = this.parseUnrealisedScripRow(rows[i], asOfDate);
        if (holding) unrealised.push(holding);
      }
    }

    return { realised, unrealised, asOfDate };
  }

  private parseRealisedScripRow(raw: (string | number)[]): StockSummary | null {
    const row = this.padRow(raw, 9);
    const name = String(row[0]).trim();
    if (isJunkScripRow(name)) return null;
    return {
      stockName: name,
      isin: String(row[1]),
      symbol: normalizeSymbol(name),
      quantity: this.parseFloat(row[2]),
      avgBuyPrice: this.parseFloat(row[3]),
      buyValue: this.parseFloat(row[4]),
      avgSellPrice: this.parseFloat(row[5]),
      sellValue: this.parseFloat(row[6]),
      realisedPnL: this.parseFloat(row[7]),
      realisedPnLPct: this.parseFloat(row[8]),
      tradeCount: 0,
      allocatedCharges: 0,
      netPnL: 0,
    };
  }

  private parseUnrealisedScripRow(
    raw: (string | number)[],
    asOfDate: string
  ): UnrealisedHolding | null {
    const row = this.padRow(raw, 9);
    const name = String(row[0]).trim();
    if (isJunkScripRow(name)) return null;
    const buyValue = this.parseFloat(row[4]);
    const unrealisedPnL = this.parseFloat(row[7]);
    return {
      stockName: name,
      isin: String(row[1]).trim(),
      symbol: normalizeSymbol(name),
      quantity: this.parseFloat(row[2]),
      avgBuyPrice: this.parseFloat(row[3]),
      buyValue,
      closingPrice: this.parseFloat(row[5]),
      closingValue: this.parseFloat(row[6]),
      unrealisedPnL,
      unrealisedPnLPct: this.parseFloat(row[8]) || (buyValue ? unrealisedPnL / buyValue : 0),
      asOfDate,
      lots: [],
    };
  }

  private parseTradeRow(row: (string | number)[]): Trade | null {
    const buyDate = this.parseDate(String(row[3]));
    const sellDate = this.parseDate(String(row[6]));
    if (!buyDate || !sellDate) return null;

    const remark = String(row[10]).trim();
    const buyMs = new Date(buyDate).getTime();
    const sellMs = new Date(sellDate).getTime();
    const holdingDays = Math.floor((sellMs - buyMs) / 86400000);
    // Shared with the filter layer so a trade can't be classified one way on upload and
    // another way when filtered. `all` means "nothing stored yet" and falls through to delivery.
    const tradeType = effectiveTradeType({
      tradeType: 'all',
      buyDate,
      sellDate,
      remark,
      holdingDays,
    });

    return {
      stockName: String(row[0]).trim(),
      isin: String(row[1]).trim(),
      quantity: this.parseFloat(row[2]),
      buyDate,
      buyPrice: this.parseFloat(row[4]),
      buyValue: this.parseFloat(row[5]),
      sellDate,
      sellPrice: this.parseFloat(row[7]),
      sellValue: this.parseFloat(row[8]),
      realisedPnL: this.parseFloat(row[9]),
      remark,
      tradeType,
      holdingDays,
    };
  }

  private parseUnrealisedLot(row: (string | number)[]): UnrealisedLot | null {
    const buyDate = this.parseDate(String(row[3]));
    const closingDate = this.parseDate(String(row[6]));
    if (!buyDate || !closingDate) return null;
    const buyMs = new Date(buyDate).getTime();
    const closeMs = new Date(closingDate).getTime();
    return {
      stockName: String(row[0]).trim(),
      isin: String(row[1]).trim(),
      quantity: this.parseFloat(row[2]),
      buyDate,
      buyPrice: this.parseFloat(row[4]),
      buyValue: this.parseFloat(row[5]),
      closingDate,
      closingPrice: this.parseFloat(row[7]),
      closingValue: this.parseFloat(row[8]),
      unrealisedPnL: this.parseFloat(row[9]),
      remark: String(row[10]).trim(),
      holdingDays: Math.floor((closeMs - buyMs) / 86400000),
    };
  }

  private finalizeReport(report: Report): void {
    if (!report.charges.total) {
      report.charges.total = report.charges.items
        .filter((i) => i.label !== 'Total')
        .reduce((s, i) => s + i.amount, 0);
    }

    const typeSet = new Set<TradeType>(['all']);
    let minDate = '';
    let maxDate = '';

    report.trades.forEach((t, i) => {
      typeSet.add(t.tradeType);
      if (i === 0 || t.sellDate < minDate) minDate = t.sellDate;
      if (i === 0 || t.sellDate > maxDate) maxDate = t.sellDate;
    });

    report.dateRange = { min: minDate, max: maxDate };
    const order: TradeType[] = ['all', 'intraday', 'delivery', 'same_day', 'mtf', 'fno'];
    report.tradeTypes = order.filter((t) => typeSet.has(t));
  }

  private csvToRows(text: string): (string | number)[][] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((line) => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else current += ch;
      }
      result.push(current);
      return result;
    });
  }

  private findUnrealisedSection(rows: (string | number)[][]): number {
    return rows.findIndex((row) => isUnrealisedSectionLabel(String(row[0] ?? '')));
  }

  private findHeaderRow(rows: (string | number)[][], col: string): number {
    return rows.findIndex((row) => row.some((cell) => String(cell).trim() === col));
  }

  private findHeaderRowFrom(rows: (string | number)[][], col: string, from: number): number {
    for (let i = from; i < rows.length; i++) {
      if (rows[i].some((cell) => String(cell).trim() === col)) return i;
    }
    return -1;
  }

  private findHeaderRowBefore(rows: (string | number)[][], col: string, before: number): number {
    const end = before === -1 ? rows.length : before;
    for (let i = 0; i < end; i++) {
      if (rows[i].some((cell) => String(cell).trim() === col)) return i;
    }
    return -1;
  }

  private padRow(row: (string | number)[], n: number): (string | number)[] {
    const padded = [...row];
    while (padded.length < n) padded.push('');
    return padded;
  }

  private parseDate(s: string): string | null {
    s = s.trim();
    if (!s) return null;
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  private parseFloat(v: string | number): number {
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/,/g, '');
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
}
