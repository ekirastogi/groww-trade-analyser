import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import {
  ChargeItem,
  ChargesSummary,
  Report,
  ReportSummary,
  StockSummary,
  Trade,
  TradeType,
} from '../models/trade.models';

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
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
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
        report.stockSummary = this.parseScripLevel(scripRows);
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
      dateRange: { min: '', max: '' },
      tradeTypes: ['all'],
    };

    this.parseHeaderSection(rows, report);

    const headerIdx = this.findHeaderRow(rows, 'Stock name');
    if (headerIdx === -1) throw new Error('Could not find trade header row (Stock name)');

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = this.padRow(rows[i], 11);
      if (!String(row[0]).trim() || row[0] === 'Stock name') continue;
      const trade = this.parseTradeRow(row);
      if (trade) report.trades.push(trade);
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

  private parseScripLevel(rows: (string | number)[][]): StockSummary[] {
    const headerIdx = this.findHeaderRow(rows, 'Stock name');
    if (headerIdx === -1) return [];

    const stocks: StockSummary[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = this.padRow(rows[i], 9);
      if (!String(row[0]).trim()) continue;
      stocks.push({
        stockName: String(row[0]),
        isin: String(row[1]),
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
      });
    }
    return stocks;
  }

  private parseTradeRow(row: (string | number)[]): Trade | null {
    const buyDate = this.parseDate(String(row[3]));
    const sellDate = this.parseDate(String(row[6]));
    if (!buyDate || !sellDate) return null;

    const remark = String(row[10]).trim();
    const tradeType = this.classifyTradeType(buyDate, sellDate, remark);
    const buyMs = new Date(buyDate).getTime();
    const sellMs = new Date(sellDate).getTime();
    const holdingDays = Math.floor((sellMs - buyMs) / 86400000);

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

  private classifyTradeType(buyDate: string, sellDate: string, remark: string): TradeType {
    const lower = remark.toLowerCase();
    if (lower.includes('intraday')) return 'intraday';
    if (lower.includes('mtf')) return 'mtf';
    if (lower.includes('fno') || lower.includes('future') || lower.includes('option')) return 'fno';
    if (buyDate === sellDate) return 'same_day';
    return 'delivery';
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

  private findHeaderRow(rows: (string | number)[][], col: string): number {
    return rows.findIndex((row) => row.some((cell) => String(cell).trim() === col));
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
