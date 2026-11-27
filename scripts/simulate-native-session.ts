/**
 * Simulates the Android/iOS session path against the real Neon Auth server, in Node:
 * no browser cookie jar, no `document`, a file standing in for AsyncStorage, and a separate
 * process per phase standing in for "kill the app and reopen it".
 *
 *   EXPO_PUBLIC_NEON_URL=… SIM_STORE=/tmp/x.json SIM_EMAIL=… SIM_PASSWORD=… \
 *     npx tsx scripts/simulate-native-session.ts <signup|signin|restore|signout>
 *
 * This is not a substitute for checking on a device; it verifies the cookie-jar logic and
 * that the SDK works without browser globals.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// Remove globals Hermes lacks so the polyfills are exercised.
delete (Response as unknown as { json?: unknown }).json;
try {
  delete (globalThis.crypto as unknown as { randomUUID?: unknown }).randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
} catch {
  /* ignore */
}

const { url, store, email, password, origin } = {
  url: process.env.EXPO_PUBLIC_NEON_URL!,
  store: process.env.SIM_STORE!,
  email: process.env.SIM_EMAIL!,
  password: process.env.SIM_PASSWORD!,
  origin: process.env.SIM_ORIGIN ?? 'http://localhost',
};
const phase = process.argv[2];

const fileStorage = {
  async getItem(k: string) {
    if (!existsSync(store)) return null;
    return (JSON.parse(readFileSync(store, 'utf8')) as Record<string, string>)[k] ?? null;
  },
  async setItem(k: string, v: string) {
    const all = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : {};
    writeFileSync(store, JSON.stringify({ ...all, [k]: v }));
  },
  async removeItem(k: string) {
    if (!existsSync(store)) return;
    const all = JSON.parse(readFileSync(store, 'utf8'));
    delete all[k];
    if (Object.keys(all).length) writeFileSync(store, JSON.stringify(all));
    else rmSync(store);
  },
};

async function main() {
  const { createStreaksClient } = await import('../src/lib/createNeonClient');
  const { client } = createStreaksClient({ url, native: { storage: fileStorage, origin } });
  const log = (...a: unknown[]) => console.log(`[${phase}]`, ...a);
  log('polyfilled Response.json:', typeof (Response as unknown as { json?: unknown }).json, '| crypto.randomUUID:', typeof globalThis.crypto.randomUUID);

  if (phase === 'signup' || phase === 'signin') {
    const res =
      phase === 'signup'
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
    log('error:', res.error?.message ?? null, '| user:', res.data.user?.email ?? null, '| has session:', Boolean(res.data.session));
  }

  if (phase === 'restore' || phase === 'signup' || phase === 'signin') {
    const initial = await new Promise<string>((resolve) => {
      const { data } = client.auth.onAuthStateChange((event, s) => {
        if (event === 'INITIAL_SESSION') {
          data.subscription.unsubscribe();
          resolve(s?.user?.email ?? 'none');
        }
      });
    });
    log('INITIAL_SESSION user:', initial);
    const { data } = await client.auth.getSession();
    log('getSession user:', data.session?.user?.email ?? null, '| user id:', data.session?.user?.id ?? null);
    log('access_token is a JWT:', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(data.session?.access_token ?? ''));
    // Data API: a missing table proves the JWT was accepted (a bad token would be 401).
    const q = await client.from('streaks').select('id').limit(1);
    log('Data API ->', q.error ? `${q.status} ${q.error.code} ${q.error.message}` : `ok, ${q.data?.length} rows`);
  }

  if (phase === 'signout') {
    const { error } = await client.auth.signOut();
    log('signOut error:', error?.message ?? null);
    const { data } = await client.auth.getSession();
    log('session after signOut:', data.session?.user?.email ?? null);
  }
  log('stored cookie present:', Boolean(await fileStorage.getItem('streaks.neon-auth.cookies')));
}

main().catch((e) => {
  console.error(`[${phase}] crashed:`, e);
  process.exit(1);
});
