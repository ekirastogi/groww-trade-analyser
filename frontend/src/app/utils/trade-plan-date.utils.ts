const PLAN_TAB_COUNT = 6; // today + 5 trading days ahead

export function todayIso(): string {
  const d = new Date();
  return toIso(d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isWeekend(iso: string): boolean {
  const day = new Date(iso + 'T00:00:00').getDay();
  return day === 0 || day === 6;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Next weekday on or after the given date. */
export function nextTradingDayOnOrAfter(iso: string): string {
  let cursor = iso;
  while (isWeekend(cursor)) {
    cursor = addDaysIso(cursor, 1);
  }
  return cursor;
}

/** Previous weekday on or before the given date. */
export function previousTradingDayOnOrBefore(iso: string): string {
  let cursor = iso;
  while (isWeekend(cursor)) {
    cursor = addDaysIso(cursor, -1);
  }
  return cursor;
}

/** Today through the next 5 trading days (weekends excluded). */
export function upcomingPlanDates(): string[] {
  const dates: string[] = [];
  let cursor = nextTradingDayOnOrAfter(todayIso());

  while (dates.length < PLAN_TAB_COUNT) {
    if (!isWeekend(cursor)) {
      dates.push(cursor);
    }
    cursor = addDaysIso(cursor, 1);
  }

  return dates;
}

export function isUpcomingPlanDate(iso: string): boolean {
  return upcomingPlanDates().includes(iso);
}

export function isPastPlanDate(iso: string): boolean {
  return iso < todayIso() && !isWeekend(iso);
}

export function isValidPlanDate(iso: string): boolean {
  return isUpcomingPlanDate(iso) || isPastPlanDate(iso);
}

export function planDateTabLabel(iso: string): string {
  const today = todayIso();
  if (iso === today && !isWeekend(today)) return 'Today';

  const tomorrow = addDaysIso(today, 1);
  if (iso === tomorrow && !isWeekend(tomorrow)) return 'Tomorrow';

  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).replace(',', '');
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
  const tabs = upcomingPlanDates();
  if (!iso) return tabs[0];
  if (isUpcomingPlanDate(iso)) return iso;
  return tabs[0];
}

export function normalizePlanViewDate(iso: string | null | undefined): string {
  const tabs = upcomingPlanDates();
  if (!iso) return tabs[0];
  if (isWeekend(iso)) {
    return iso < todayIso()
      ? previousTradingDayOnOrBefore(iso)
      : nextTradingDayOnOrAfter(iso);
  }
  if (isValidPlanDate(iso)) return iso;
  return tabs[0];
}
