/**
 * Daily check-in scheduling with Expo Notifications (§8.8).
 * Local notifications only exist on Android/iOS; on web every function here is a no-op
 * and the UI explains that check-ins are delivered by the phone app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { deviceTimeZone, type LocalDate } from '../logic/dates';
import {
  ACTION_COMPLETE,
  ACTION_NOT_YET,
  CHECKIN_CATEGORY,
  isCheckinPayload,
  planCheckins,
  reconcilePlan,
  type PlanStreak,
} from '../logic/notificationPlan';

export const notificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * PLATFORM NOTE: with `false`, tapping "Yes, completed" records the completion without
 * opening the app, via the background task in backgroundTask.ts. If device testing shows
 * the OS does not run that task on some configuration (for example, after the app was
 * force-stopped on Android), set this to `true`: the app then opens briefly and records
 * it — the closest reliable behaviour (PRD §17).
 */
export const OPEN_APP_ON_COMPLETE = false;

const CHANNEL_ID = 'daily-checkin';
const MAPPING_KEY = 'streaks.notificationMapping.v1';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function setupNotifications(): Promise<void> {
  if (!notificationsSupported) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Daily check-ins',
      description: 'Asks whether you completed an activity today',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY, [
    { identifier: ACTION_COMPLETE, buttonTitle: 'Yes, completed', options: { opensAppToForeground: OPEN_APP_ON_COMPLETE } },
    { identifier: ACTION_NOT_YET, buttonTitle: 'Not yet', options: { opensAppToForeground: false } },
  ]);
}

export async function getPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asks only when needed; called the first time a user enables a check-in (§4.2). */
export async function ensurePermission(): Promise<PermissionState> {
  const current = await getPermission();
  if (current !== 'undetermined') return current;
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return p.granted ? 'granted' : 'denied';
}

export interface ScheduleInput {
  streaks: PlanStreak[];
  completedDates: Record<string, Iterable<LocalDate>>;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Makes the OS schedule match the desired plan: cancels stale/duplicate prompts and
 * schedules missing ones. Serialised so overlapping calls can't create duplicates.
 */
export function reconcileSchedules(input: ScheduleInput): Promise<void> {
  const run = async () => {
    if (!notificationsSupported) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const existing = scheduled.map((r) => ({
      identifier: r.identifier,
      key: isCheckinPayload(r.content.data) ? (r.content.data.key as string) : null,
    }));
    const permission = await getPermission();
    const timeZone = deviceTimeZone();
    const desired =
      permission === 'granted'
        ? planCheckins({ streaks: input.streaks, completedDates: input.completedDates, now: new Date(), timeZone })
        : [];
    const { toCancel, toSchedule } = reconcilePlan(desired, existing);
    for (const id of toCancel) await Notifications.cancelScheduledNotificationAsync(id);
    for (const p of toSchedule) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: p.title,
          body: p.body,
          data: p.payload as unknown as Record<string, unknown>,
          categoryIdentifier: CHECKIN_CATEGORY,
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: p.fireAt,
          channelId: CHANNEL_ID,
        },
      });
    }
    // Local mapping (§10.4): streak ↔ notification id ↔ time ↔ timezone. Informational only —
    // Server-side streak settings stay the source of truth and are re-applied on every reconcile.
    const now = await Notifications.getAllScheduledNotificationsAsync();
    const mapping = now
      .filter((r) => isCheckinPayload(r.content.data))
      .map((r) => {
        const d = r.content.data as Record<string, string>;
        return { identifier: r.identifier, streakId: d.streakId, date: d.date, time: d.time, timeZone: d.timeZone };
      });
    await AsyncStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
  };
  const next = chain.then(run, run);
  chain = next.catch((e) => console.warn('reconcile failed', e));
  return next;
}

/** Removes an already-displayed prompt once the activity is completed elsewhere (§8.7). */
export async function dismissPresentedPrompt(streakId: string, date: LocalDate): Promise<void> {
  if (!notificationsSupported) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const d = n.request.content.data;
      if (isCheckinPayload(d) && d.streakId === streakId && d.date === date) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    /* not supported on every OS version — nothing else to do */
  }
}

/** Logout / account deletion: no prompts for a signed-out user (§13). */
export async function clearAllSchedules(): Promise<void> {
  await AsyncStorage.removeItem(MAPPING_KEY);
  if (!notificationsSupported) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}
