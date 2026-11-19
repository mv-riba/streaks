/**
 * Handling the user's answer to a daily check-in (§8.4–8.6). Used by the foreground
 * listener, the cold-start path and the background task, so behaviour is identical.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { recordCompletion, type RecordOutcome } from '../data/completions';
import { deviceTimeZone, todayInTimeZone } from '../logic/dates';
import { ACTION_COMPLETE, ACTION_NOT_YET, validateCheckinResponse } from '../logic/notificationPlan';

const HANDLED_KEY = 'streaks.handledResponses.v1';

export type ResponseResult =
  | { kind: 'completed'; streakId: string; outcome: RecordOutcome }
  | { kind: 'not_yet' }
  | { kind: 'expired' }
  | { kind: 'opened'; streakId: string }
  | { kind: 'ignored' };

async function handledList(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HANDLED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Marked only after processing, so a crash mid-way means a (harmless, idempotent) retry. */
async function markHandled(id: string): Promise<void> {
  const list = await handledList();
  await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify([...list, id].slice(-50))).catch(() => undefined);
}

export interface MinimalResponse {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data: unknown } } };
}

export async function handleCheckinResponse(response: MinimalResponse): Promise<ResponseResult> {
  const id = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if ((await handledList()).includes(id)) return { kind: 'ignored' };
  const result = await processResponse(response);
  await markHandled(id);
  return result;
}

async function processResponse(response: MinimalResponse): Promise<ResponseResult> {
  const { actionIdentifier } = response;
  const { identifier, content } = response.notification.request;

  const dismiss = () => Notifications.dismissNotificationAsync(identifier).catch(() => undefined);

  if (actionIdentifier === ACTION_NOT_YET) {
    // §8.5: no record, no reset, no repeat prompt for today.
    await dismiss();
    return { kind: 'not_yet' };
  }

  const today = todayInTimeZone(deviceTimeZone());
  const check = validateCheckinResponse(content.data, today);

  if (actionIdentifier === ACTION_COMPLETE) {
    await dismiss();
    if (!check.ok) return check.reason === 'invalid_payload' ? { kind: 'ignored' } : { kind: 'expired' };
    // Same business logic as a manual tap; persisted locally first so it survives offline.
    const outcome = await recordCompletion(check.streakId, 'notification', check.date);
    return { kind: 'completed', streakId: check.streakId, outcome };
  }

  if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    // Tapped the notification body: open that streak. Nothing is recorded (§8.1).
    if (check.ok) return { kind: 'opened', streakId: check.streakId };
    const data = content.data as { streakId?: string } | null;
    return data?.streakId ? { kind: 'opened', streakId: data.streakId } : { kind: 'ignored' };
  }
  return { kind: 'ignored' };
}
