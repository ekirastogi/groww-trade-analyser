export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number): string {
  return (value * 100).toFixed(2) + '%';
}

export function pnlClass(value: number): string {
  if (value > 0) return 'text-emerald-600';
  if (value < 0) return 'text-red-600';
  return 'text-slate-600';
}

export function pnlBadgeClass(value: number): string {
  if (value > 0) return 'bg-emerald-100 text-emerald-700';
  if (value < 0) return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
