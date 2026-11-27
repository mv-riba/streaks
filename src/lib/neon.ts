import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createStreaksClient } from './createNeonClient';

const url = process.env.EXPO_PUBLIC_NEON_URL;

/**
 * Origin native builds send to Neon Auth. Better Auth rejects cookie-authenticated POSTs
 * (sign-out, password reset, …) without a trusted Origin, and native fetch sends none.
 * It must be listed in Neon Auth's trusted domains (`neon neon-auth domain add …`).
 */
const nativeOrigin = process.env.EXPO_PUBLIC_NEON_AUTH_ORIGIN || 'https://streaks.mvriba.com';

/** False when .env is missing — the app shows a setup screen instead of failing silently. */
export const neonConfigured = Boolean(url && /^https:\/\/ep-[^/]+\/[^/]+$/.test(url.replace(/\/$/, '')));

// `||`, not `??`: CI passes an unset variable as an empty string, and createClient throws on ''.
const { client, clearStoredSession } = createStreaksClient({
  url: url || 'https://ep-not-configured.us-east-2.aws.neon.tech/neondb',
  // Web: the browser keeps Neon Auth's session cookie. Native: we keep it in AsyncStorage.
  native: Platform.OS === 'web' ? undefined : { storage: AsyncStorage, origin: nativeOrigin },
});

export const neon = client;
export { clearStoredSession };
