const PLAN_AHEAD_DAYS = 5;

export function todayIso(): string {
  const d = new Date();
  return toIso(d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIso(d);
}

export function upcomingPlanDates(): string[] {
  const today = todayIso();
  return Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, i) => addDaysIso(today, i));
}

export function isUpcomingPlanDate(iso: string): boolean {
  const today = todayIso();
  const max = addDaysIso(today, PLAN_AHEAD_DAYS);
  return iso >= today && iso <= max;
}

export function isPastPlanDate(iso: string): boolean {
  return iso < todayIso();
}

export function planDateTabLabel(iso: string): string {
  const today = todayIso();
  if (iso === today) return 'Today';
  if (iso === addDaysIso(today, 1)) return 'Tomorrow';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function planDateHeading(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function clampToUpcomingPlanDate(iso: string | null | undefined): string {
  if (!iso) return todayIso();
  if (isUpcomingPlanDate(iso)) return iso;
  if (isPastPlanDate(iso)) return iso;
  return addDaysIso(todayIso(), PLAN_AHEAD_DAYS);
}
