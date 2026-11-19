/** Connects notification responses to the app while it is running or launched from a tap. */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useStore } from '../data/store';
import { handleCheckinResponse, type ResponseResult } from './responses';
import { notificationsSupported, setupNotifications } from './scheduler';

export function NotificationBridge() {
  const { session } = useAuth();
  const { refresh, setNotice } = useStore();
  const router = useRouter();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (!notificationsSupported) return;
    setupNotifications().catch((e) => console.warn('notification setup failed', e));
  }, []);

  useEffect(() => {
    if (!notificationsSupported || !signedIn) return;

    const after = (r: ResponseResult) => {
      if (r.kind === 'completed') {
        if (r.outcome.status === 'pending') setNotice('Check-in saved on this device. It will sync when you’re back online.');
        refresh();
      } else if (r.kind === 'expired') {
        setNotice('That check-in was for an earlier day, so it wasn’t recorded.');
      } else if (r.kind === 'opened') {
        router.push(`/streak/${r.streakId}`);
      }
    };

    // App launched from a notification (cold start).
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) handleCheckinResponse(r).then(after);
    });
    // App running (foreground or background-but-alive).
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleCheckinResponse(r).then(after);
    });
    return () => sub.remove();
  }, [signedIn, refresh, setNotice, router]);

  return null;
}
