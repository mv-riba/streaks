/**
 * Offline cold start on Android/iOS. Supabase restored its session from AsyncStorage
 * without the network; Neon Auth has to ask the server (the session is a cookie), so with
 * no connection the app would look signed out and the offline completion queue would be
 * unusable. We keep the last server-confirmed session here and use it only when the server
 * can't be reached. Data requests still get a fresh JWT from the Neon client once online.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SESSION_STORAGE_KEY } from '../lib/createNeonClient';

const KEY = 'streaks.last-session';
const enabled = Platform.OS !== 'web';

export async function rememberSession<T extends object>(session: T | null): Promise<void> {
  if (!enabled) return;
  if (session) await AsyncStorage.setItem(KEY, JSON.stringify(session)).catch(() => undefined);
  else await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

/** The last confirmed session, but only while the auth cookie is still stored. */
export async function lastKnownSession<T>(): Promise<T | null> {
  if (!enabled) return null;
  try {
    const [raw, cookie] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(SESSION_STORAGE_KEY)]);
    return raw && cookie ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
