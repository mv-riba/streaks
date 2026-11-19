/** How notifications behave while the app is open. Imported once from the root layout. */
import * as Notifications from 'expo-notifications';
import { isCompletedLocally } from '../data/store';
import { isCheckinPayload } from '../logic/notificationPlan';
import { notificationsSupported } from './scheduler';

if (notificationsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const d = n.request.content.data;
      // Extra §8.7 guard: if the day was completed after the prompt was scheduled, stay quiet.
      const suppress = isCheckinPayload(d) && isCompletedLocally(d.streakId, d.date);
      return { shouldShowBanner: !suppress, shouldShowList: !suppress, shouldPlaySound: !suppress, shouldSetBadge: false };
    },
  });
}
