import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDueDate,
  isDueTodayOrOverdue,
  isOverdue,
  localDateString,
  msUntilNextLocalMidnight,
} from '../../src/logic/localDate';

describe('local calendar date', () => {
  it('derives the local date from local components of the injected now, not UTC [test.tasky.local-date.local-date]', () => {
    // Late evening and early morning local times: the local date is what the wall clock shows.
    expect(localDateString(new Date(2026, 0, 31, 23, 59, 59))).toBe('2026-01-31');
    expect(localDateString(new Date(2026, 1, 1, 0, 0, 0))).toBe('2026-02-01');
    expect(localDateString(new Date(2026, 8, 5, 3, 4))).toBe('2026-09-05');
  });

  it('classifies due dates as overdue or due today-or-earlier [test.tasky.local-date.overdue]', () => {
    const today = '2026-06-15';
    expect(isOverdue('2026-06-14', today)).toBe(true);
    expect(isOverdue('2026-06-15', today)).toBe(false);
    expect(isOverdue(null, today)).toBe(false);
    expect(isDueTodayOrOverdue('2026-06-14', today)).toBe(true);
    expect(isDueTodayOrOverdue('2026-06-15', today)).toBe(true);
    expect(isDueTodayOrOverdue('2026-06-16', today)).toBe(false);
    expect(isDueTodayOrOverdue(null, today)).toBe(false);
    // year and month boundaries compare as calendar dates
    expect(isOverdue('2025-12-31', '2026-01-01')).toBe(true);
  });

  it('moves a task from due-today to overdue when the local day rolls over [test.tasky.local-date.rollover]', () => {
    const due = '2026-06-15';
    const beforeMidnight = localDateString(new Date(2026, 5, 15, 23, 59, 59));
    const afterMidnight = localDateString(new Date(2026, 5, 16, 0, 0, 1));
    expect(isOverdue(due, beforeMidnight)).toBe(false);
    expect(isDueTodayOrOverdue(due, beforeMidnight)).toBe(true);
    expect(isOverdue(due, afterMidnight)).toBe(true);
  });

  it('computes the delay until the next local midnight for the rollover timer [test.tasky.local-date.midnight-timer]', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 0, 0, 0))).toBe(24 * 60 * 60 * 1000);
    // month end
    expect(msUntilNextLocalMidnight(new Date(2026, 0, 31, 23, 0, 0))).toBe(60 * 60 * 1000);
  });

  it('does calendar arithmetic across month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('formats due dates relative to today', () => {
    expect(formatDueDate('2026-06-15', '2026-06-15')).toBe('Today');
    expect(formatDueDate('2026-06-16', '2026-06-15')).toBe('Tomorrow');
    expect(formatDueDate('2026-07-04', '2026-06-15')).toBe('Jul 4');
    expect(formatDueDate('2027-01-04', '2026-06-15')).toBe('Jan 4, 2027');
  });
});
