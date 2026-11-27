/** All database access lives here (Neon Data API). The database is the source of truth (§10.4). */
import { neon } from '../lib/neon';
import type { PendingCompletion, SendResult } from '../logic/completionQueue';
import type { CheckinPatch, Completion, NewStreakInput, Streak, StreakDetailsPatch } from './types';

/** Server rejections that will never succeed on retry (raised by record_completion). */
const PERMANENT_REJECTIONS = [
  'streak_not_found',
  'streak_archived',
  'future_date',
  'date_too_old',
  'before_start_date',
  'invalid_timezone',
  'invalid_source',
  'invalid_date',
];

export class ApiError extends Error {}

function fail(error: { message: string } | null, fallback: string): never {
  throw new ApiError(error?.message || fallback);
}

export async function fetchActiveStreaks(): Promise<Streak[]> {
  const { data, error } = await neon
    .from('streaks')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'Could not load streaks');
  return (data ?? []) as Streak[];
}

/** Every completion for the given streaks, paged past PostgREST's row limit. */
export async function fetchCompletions(streakIds: string[]): Promise<Completion[]> {
  if (streakIds.length === 0) return [];
  const pageSize = 1000;
  const out: Completion[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await neon
      .from('completions')
      .select('streak_id, completed_date, source, created_at')
      .in('streak_id', streakIds)
      .order('completed_date', { ascending: true })
      .order('streak_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) fail(error, 'Could not load history');
    out.push(...((data ?? []) as Completion[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function createStreak(input: NewStreakInput): Promise<Streak> {
  const { data, error } = await neon
    .from('streaks')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      frequency: 'daily',
      start_date: input.start_date,
      checkin_enabled: input.checkin_enabled,
      checkin_time: input.checkin_enabled ? input.checkin_time : null,
    })
    .select('*')
    .single();
  if (error) fail(error, 'Could not create streak');
  return data as Streak;
}

async function patchStreak(id: string, patch: Record<string, unknown>): Promise<Streak> {
  const { data, error } = await neon.from('streaks').update(patch).eq('id', id).select('*').single();
  if (error) fail(error, 'Could not save changes');
  return data as Streak;
}

export const updateStreakDetails = (id: string, patch: StreakDetailsPatch) =>
  patchStreak(id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
  });

export const updateCheckin = (id: string, patch: CheckinPatch) =>
  patchStreak(id, {
    checkin_enabled: patch.checkin_enabled,
    checkin_time: patch.checkin_enabled ? patch.checkin_time : null,
  });

export const archiveStreak = (id: string) =>
  patchStreak(id, { is_active: false, archived_at: new Date().toISOString() });

export async function deleteStreak(id: string): Promise<void> {
  const { error } = await neon.from('streaks').delete().eq('id', id);
  if (error) fail(error, 'Could not delete streak');
}

/** Sends one queued completion through the record_completion RPC and classifies the outcome. */
export async function sendCompletion(item: PendingCompletion): Promise<SendResult> {
  // Neon Auth checks the session with the server, which throws when offline: retry later.
  const session = await neon.auth.getSession().catch(() => null);
  if (!session) return { kind: 'retry', reason: 'network' };
  if (!session.data.session) return { kind: 'retry', reason: 'not_signed_in' };
  const { data, error } = await neon.rpc('record_completion', {
    p_streak_id: item.streakId,
    p_completed_date: item.date,
    p_timezone: item.timeZone,
    p_source: item.source,
  });
  if (error) {
    const code = PERMANENT_REJECTIONS.find((c) => error.message?.includes(c));
    return code ? { kind: 'rejected', reason: code } : { kind: 'retry', reason: error.message || 'network' };
  }
  return (data as { status?: string })?.status === 'already_completed' ? { kind: 'already_completed' } : { kind: 'created' };
}

/**
 * Creates or refreshes the user's profile with the device's current timezone (§4.2).
 * Runs on every sign-in; it replaces Supabase's on_auth_user_created trigger, which has no
 * equivalent on Neon Auth's user table.
 */
export async function syncProfile(userId: string, email: string | undefined, timezone: string): Promise<void> {
  const { error } = await neon.from('profiles').upsert({ id: userId, email, timezone }, { onConflict: 'id' });
  if (!error) return;
  if (error.message?.includes('invalid_timezone')) {
    // Same fallback the old trigger had: a brand-new profile gets UTC; an existing one keeps
    // its timezone (validate_profile still rejects the invalid value).
    const retry = await neon
      .from('profiles')
      .upsert({ id: userId, email, timezone: 'UTC' }, { onConflict: 'id', ignoreDuplicates: true });
    if (!retry.error) return;
  }
  console.warn('profile sync failed', error.message);
}

/** Permanently deletes the signed-in user: Neon Auth user → profiles → streaks → completions. */
export async function deleteAccount(): Promise<void> {
  const { error } = await neon.rpc('delete_my_account');
  if (error) throw new ApiError('Could not delete your account. Please try again.');
}

export function friendlyRejection(reason: string): string {
  switch (reason) {
    case 'streak_archived':
      return 'That streak was archived, so the completion was not recorded.';
    case 'streak_not_found':
      return 'That streak no longer exists.';
    case 'future_date':
    case 'date_too_old':
    case 'before_start_date':
      return 'That day can no longer be recorded.';
    default:
      return 'A completion could not be recorded.';
  }
}
