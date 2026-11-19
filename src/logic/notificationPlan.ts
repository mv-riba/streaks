/**
 * Pure planning for daily check-in prompts (PRD §8).
 *
 * Why one-off notifications instead of one repeating trigger:
 *  - the payload must carry the intended completion date (§8.8), which a repeating
 *    trigger cannot vary per day;
 *  - a day that is already completed must not be prompted (§8.7). Local notifications
 *    have no "check before showing" hook, so the only reliable way is to not schedule
 *    that day at all.
 * We therefore keep a rolling window of upcoming days scheduled, and reconcile it on
 * app start, on resume, after every completion and on every settings change.
 */
import { addDays, normalizeTime, todayInTimeZone, zonedTimeToInstant, type LocalDate } from './dates';

/** iOS keeps at most 64 pending local notifications per app; stay safely below. */
export const MAX_PENDING = 60;
/** Days scheduled ahead per streak when the budget allows. */
export const MAX_DAYS_AHEAD = 14;

export const CHECKIN_CATEGORY = 'daily-checkin';
export const ACTION_COMPLETE = 'complete';
export const ACTION_NOT_YET = 'not-yet';

export interface PlanStreak {
  id: string;
  name: string;
  checkinEnabled: boolean;
  checkinTime: string | null; // 'HH:MM' or 'HH:MM:SS'
  isActive: boolean;
  startDate: LocalDate;
}

export interface CheckinPayload {
  kind: 'checkin';
  streakId: string;
  date: LocalDate;
  time: string; // 'HH:MM'
  timeZone: string;
  key: string;
}

export interface PlannedNotification {
  key: string;
  fireAt: Date;
  title: string;
  body: string;
  payload: CheckinPayload;
}

/** Key identifies a planned prompt and everything that should force a reschedule if changed. */
export function notificationKey(streakId: string, date: LocalDate, time: string, timeZone: string, name: string): string {
  return [streakId, date, normalizeTime(time), timeZone, name].join('|');
}

/** Friendly question built from the activity name: "Have you read for 20 minutes today?" fallback. */
export function checkinBody(name: string): string {
  const trimmed = name.trim().replace(/[.!?]+$/, '');
  return `Did you complete “${trimmed}” today?`;
}

export function daysAheadFor(enabledCount: number, maxPending = MAX_PENDING, maxDays = MAX_DAYS_AHEAD): number {
  if (enabledCount <= 0) return 0;
  return Math.max(1, Math.min(maxDays, Math.floor(maxPending / enabledCount)));
}

export function planCheckins(args: {
  streaks: PlanStreak[];
  completedDates: Record<string, Iterable<LocalDate>>;
  now: Date;
  timeZone: string;
  maxPending?: number;
  maxDays?: number;
}): PlannedNotification[] {
  const { streaks, completedDates, now, timeZone } = args;
  const maxPending = args.maxPending ?? MAX_PENDING;
  const enabled = streaks.filter((s) => s.isActive && s.checkinEnabled && s.checkinTime);
  const days = daysAheadFor(enabled.length, maxPending, args.maxDays ?? MAX_DAYS_AHEAD);
  const today = todayInTimeZone(timeZone, now);
  const out: PlannedNotification[] = [];

  for (const s of enabled) {
    const time = normalizeTime(s.checkinTime!);
    const done = new Set(completedDates[s.id] ?? []);
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      if (date < s.startDate) continue;
      if (done.has(date)) continue; // §8.7 — never ask about a completed day
      const fireAt = zonedTimeToInstant(date, time, timeZone);
      if (fireAt.getTime() <= now.getTime()) continue;
      const key = notificationKey(s.id, date, time, timeZone, s.name);
      out.push({
        key,
        fireAt,
        title: 'Streaks — Daily check-in',
        body: checkinBody(s.name),
        payload: { kind: 'checkin', streakId: s.id, date, time, timeZone, key },
      });
    }
  }
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return out.slice(0, maxPending);
}

export interface ExistingNotification {
  identifier: string;
  key: string | null; // null = not one of ours / unknown
}

/**
 * Diff desired vs. currently scheduled. Returns which identifiers to cancel and which
 * planned notifications to schedule. Duplicates of the same key are cancelled (§8.8).
 */
export function reconcilePlan(desired: PlannedNotification[], existing: ExistingNotification[]) {
  const wanted = new Map(desired.map((d) => [d.key, d]));
  const kept = new Set<string>();
  const toCancel: string[] = [];
  for (const e of existing) {
    if (e.key && wanted.has(e.key) && !kept.has(e.key)) kept.add(e.key);
    else toCancel.push(e.identifier);
  }
  const toSchedule = desired.filter((d) => !kept.has(d.key));
  return { toCancel, toSchedule };
}

export function isCheckinPayload(data: unknown): data is CheckinPayload {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.kind === 'checkin' && typeof d.streakId === 'string' && typeof d.date === 'string';
}

export type ResponseValidation =
  | { ok: true; streakId: string; date: LocalDate }
  | { ok: false; reason: 'invalid_payload' | 'expired' | 'future' };

/**
 * Old-notification guard (§13): a "Yes, completed" answer only counts for the day the
 * prompt was about, and only while that day is still today.
 */
export function validateCheckinResponse(data: unknown, today: LocalDate): ResponseValidation {
  if (!isCheckinPayload(data)) return { ok: false, reason: 'invalid_payload' };
  if (data.date < today) return { ok: false, reason: 'expired' };
  if (data.date > today) return { ok: false, reason: 'future' };
  return { ok: true, streakId: data.streakId, date: data.date };
}
