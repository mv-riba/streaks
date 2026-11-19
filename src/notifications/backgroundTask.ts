/**
 * Background handling of "Yes, completed" / "Not yet" while the app is backgrounded or
 * not running (§8.4). Must be imported at the top level of the app entry so the task is
 * defined before the OS delivers the response.
 *
 * PLATFORM LIMITATION: whether the OS wakes the app to run this depends on the
 * platform and its state (e.g. Android won't run it after a user force-stops the app;
 * iOS gives a few seconds of background time). The answer is written to the durable
 * queue first, so if the network call can't finish it syncs on the next app open. If
 * the task does not run at all on a configuration, see OPEN_APP_ON_COMPLETE.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { notificationsSupported } from './scheduler';
import { handleCheckinResponse, type MinimalResponse } from './responses';

export const BACKGROUND_NOTIFICATION_TASK = 'streaks-checkin-response';

function asResponse(data: unknown): MinimalResponse | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  // Payload shape differs slightly between platforms/SDKs; accept the documented
  // NotificationResponse shape, possibly wrapped in { data: ... }.
  const candidate = (d.actionIdentifier ? d : (d.data as Record<string, unknown> | undefined)) ?? null;
  if (candidate && typeof candidate.actionIdentifier === 'string' && candidate.notification) {
    return candidate as unknown as MinimalResponse;
  }
  return null;
}

if (notificationsSupported) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) return;
    const response = asResponse(data);
    if (response) await handleCheckinResponse(response);
  });
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((e) =>
    console.warn('Background notification task not registered', e),
  );
}
