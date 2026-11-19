/**
 * Calendar-date helpers. A LocalDate is a plain 'YYYY-MM-DD' string that represents a
 * day on the user's calendar — never a UTC instant. All date arithmetic is done on
 * these strings via UTC-noon-free integer math so DST can never shift a day.
 */
export type LocalDate = string; // 'YYYY-MM-DD'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid local date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Days since 1970-01-01 for a calendar date (timezone-free). */
function toDayNumber(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * 86_400_000);
  return formatLocalDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** b - a in whole calendar days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Device timezone (IANA), falling back to UTC if the runtime cannot tell. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* fall through */
  }
  return 'UTC';
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsInZone(instant: Date, timeZone: string): Parts {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** The calendar date it currently is in `timeZone`. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): LocalDate {
  try {
    const p = partsInZone(now, timeZone);
    return formatLocalDate(p.year, p.month, p.day);
  } catch {
    return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `hh:mm`.
 * Handles DST: the result always shows the requested local time. If that time does not
 * exist (spring-forward gap) the instant just after the gap is returned (e.g. 02:30 → 03:30).
 */
export function zonedTimeToInstant(date: LocalDate, time: string, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hh ?? 0, mm ?? 0, 0);
  // Two candidates: one per offset seen around the target. Across a DST boundary they differ.
  const g1 = wall - timeZoneOffsetMs(new Date(wall), timeZone);
  const g2 = wall - timeZoneOffsetMs(new Date(g1), timeZone);
  const matches = (t: number) => {
    const p = partsInZone(new Date(t), timeZone);
    return p.hour === (hh ?? 0) && p.minute === (mm ?? 0) && p.day === day;
  };
  const exact = [g1, g2].filter(matches).sort((a, b) => a - b);
  if (exact.length > 0) return new Date(exact[0]!);
  // Spring-forward gap: the requested time does not exist; use the later candidate.
  return new Date(Math.max(g1, g2));
}

/** 'HH:MM' from a Postgres time ('HH:MM:SS') or 'HH:MM'. */
export function normalizeTime(time: string): string {
  const [h, m] = time.split(':');
  return `${pad(Number(h))}:${pad(Number(m ?? 0))}`;
}

/** Human time label for a 'HH:MM' value, e.g. '20:00' → '8 PM' (en) */
export function formatTimeLabel(time: string, locale?: string): string {
  const [h, m] = normalizeTime(time).split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: m === 0 ? undefined : '2-digit',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return normalizeTime(time);
  }
}

export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening';
export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Month grid for a calendar. `firstWeekday` is 0 = Sunday … 6 = Saturday.
 * Returns weeks of 7 cells; cells outside the month are null.
 */
export function monthGrid(year: number, month: number, firstWeekday: number): (LocalDate | null)[][] {
  const first = formatLocalDate(year, month, 1);
  const lead = (dayOfWeek(first) - firstWeekday + 7) % 7;
  const total = daysInMonth(year, month);
  const cells: (LocalDate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= total; d++) cells.push(formatLocalDate(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (LocalDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
