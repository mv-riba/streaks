/**
 * Builds the Neon client (Managed Better Auth + Data API) with the Supabase-compatible API.
 * Kept free of React Native imports so scripts/simulate-native-session.ts can exercise
 * exactly the same configuration in Node.
 */
import './polyfills';
import { createClient } from '@neon/neon-js/supabase';
import { createCookieJarPlugin, type KeyValueStorage } from '../logic/cookieJar';

export const SESSION_STORAGE_KEY = 'streaks.neon-auth.cookies';

/** Same derivation @neon/neon-js uses: add the `.neonauth` host label and `/auth`. */
export function deriveAuthUrl(neonUrl: string): string {
  const u = new URL(neonUrl);
  const [ep, ...rest] = u.hostname.split('.');
  return `${u.protocol}//${[ep, 'neonauth', ...rest].join('.')}${u.pathname.replace(/\/$/, '')}/auth`;
}

export interface StreaksClientOptions {
  /** EXPO_PUBLIC_NEON_URL: https://<endpoint>.<cell>.<region>.aws.neon.tech/<database> */
  url: string;
  /**
   * Native (Android/iOS): persist the session cookie in `storage` and send `origin`.
   * Web: leave cookies to the browser.
   */
  native?: { storage: KeyValueStorage; origin: string };
}

export function createStreaksClient({ url, native }: StreaksClientOptions) {
  const cookieJar = native
    ? createCookieJarPlugin({
        storage: native.storage,
        storageKey: SESSION_STORAGE_KEY,
        authUrl: deriveAuthUrl(url),
        origin: native.origin,
      })
    : null;

  const client = createClient(url, {
    auth: cookieJar
      ? {
          fetchOptions: {
            // Don't let the platform cookie jar compete with ours.
            credentials: 'omit',
            plugins: [cookieJar],
          },
        }
      : {},
  });

  return { client, clearStoredSession: () => cookieJar?.clear() ?? Promise.resolve() };
}
