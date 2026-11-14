import { isValidDateString } from '../domain/validation';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The user's local calendar date (YYYY-MM-DD) for the given instant. `now` is injectable for tests. */
export function localDateString(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Calendar-day arithmetic in local time (DST safe because it uses date components, not milliseconds). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d + days));
}

/** A valid due date strictly before today. */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && isValidDateString(dueDate) && dueDate < today;
}

/** A valid due date that is today or earlier (overdue included). */
export function isDueTodayOrOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && isValidDateString(dueDate) && dueDate <= today;
}

/** Milliseconds until the next local midnight; always at least 1 so a timer never spins. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}

/** Human label for a due date relative to today, e.g. "Today", "Tomorrow", "Mar 4". */
export function formatDueDate(dueDate: string, today: string): string {
  if (dueDate === today) return 'Today';
  if (dueDate === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = dueDate.split('-').map(Number);
  const sameYear = y === Number(today.slice(0, 4));
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
