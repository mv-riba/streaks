/**
 * Streak business rules (PRD §9). One implementation, used by Home, Detail and the
 * notification scheduler. Statistics are always derived from completion records —
 * never stored — so editing or deleting records can never leave stale numbers.
 */
import { addDays, diffDays, type LocalDate } from './dates';

export type StreakStatus =
  /** Today is recorded. */
  | 'completed_today'
  /** Streak is alive (yesterday done) and today is still open. */
  | 'ongoing'
  /** Had completions before, but a full calendar day was missed. */
  | 'broken'
  /** No completions yet. */
  | 'not_started'
  /** Start date is in the future. */
  | 'scheduled';

export interface StreakStats {
  current: number;
  longest: number;
  total: number;
  completedToday: boolean;
  status: StreakStatus;
}

export function uniqueSorted(dates: Iterable<LocalDate>): LocalDate[] {
  return Array.from(new Set(dates)).sort();
}

/** Longest run of consecutive calendar days across the full history. */
export function longestRun(sorted: LocalDate[]): number {
  let best = 0;
  let run = 0;
  let prev: LocalDate | null = null;
  for (const d of sorted) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** Length of the consecutive run that ends exactly on `anchor`. */
function runEndingOn(set: Set<LocalDate>, anchor: LocalDate): number {
  let n = 0;
  let d = anchor;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/**
 * @param completedDates every recorded completion date for one streak
 * @param today the user's current local calendar date
 * @param startDate the streak's first eligible day
 */
export function computeStreakStats(
  completedDates: Iterable<LocalDate>,
  today: LocalDate,
  startDate?: LocalDate,
): StreakStats {
  const sorted = uniqueSorted(completedDates);
  const set = new Set(sorted);
  const total = sorted.length;
  const longest = longestRun(sorted);
  const latest = sorted[sorted.length - 1];

  let current = 0;
  let completedToday = false;

  if (latest !== undefined && latest > today) {
    // Travelled west after completing "tomorrow" in the old timezone: the record is real,
    // so it must not be lost. Count it as today's completion.
    completedToday = true;
    current = runEndingOn(set, latest);
  } else if (set.has(today)) {
    completedToday = true;
    current = runEndingOn(set, today);
  } else {
    // Today is still pending — it must not break the streak before the day ends (§9.4).
    current = runEndingOn(set, addDays(today, -1));
  }

  let status: StreakStatus;
  if (startDate && startDate > today) status = 'scheduled';
  else if (completedToday) status = 'completed_today';
  else if (total === 0) status = 'not_started';
  else if (current > 0) status = 'ongoing';
  else status = 'broken';

  return { current, longest: Math.max(longest, current), total, completedToday, status };
}

/** Can a completion be recorded for `date` given the streak window? */
export function canCompleteOn(date: LocalDate, today: LocalDate, startDate: LocalDate): boolean {
  return date <= today && date >= startDate;
}
