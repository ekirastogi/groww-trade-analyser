export type TradePlanHashView = 'open' | 'date';

export function parseTradePlanHash(hash: string): { view: TradePlanHashView; date: string | null } {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw || raw === 'date') return { view: 'date', date: null };
  if (raw === 'open') return { view: 'open', date: null };
  if (raw.startsWith('date=')) {
    const date = raw.slice('date='.length).trim();
    return { view: 'date', date: date || null };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { view: 'date', date: raw };
  return { view: 'date', date: null };
}

export function buildTradePlanHash(view: TradePlanHashView, date?: string | null): string {
  if (view === 'open') return '#open';
  if (date) return `#date=${date}`;
  return '';
}

export function replaceTradePlanHash(view: TradePlanHashView, date?: string | null): void {
  if (typeof window === 'undefined') return;
  const hash = buildTradePlanHash(view, date);
  history.replaceState(null, '', `${window.location.pathname}${hash}`);
}
