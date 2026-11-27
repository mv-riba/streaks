import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySetCookie, cookieHeader, createCookieJarPlugin, parseSetCookie, splitSetCookieHeader } from './cookieJar';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const SESSION =
  '__Secure-neon-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=None; Partitioned';

test('parses the Neon Auth session cookie', () => {
  const c = parseSetCookie(SESSION, NOW);
  assert.deepEqual(c, {
    name: '__Secure-neon-auth.session_token',
    value: 'abc.def',
    expiresAt: NOW + 604800 * 1000,
    deleted: false,
  });
});

test('splits combined Set-Cookie headers without breaking on Expires dates', () => {
  const parts = splitSetCookieHeader(`a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Max-Age=10`);
  assert.deepEqual(parts, ['a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/', 'b=2; Max-Age=10']);
});

test('Max-Age=0 or empty value deletes the cookie', () => {
  let jar = applySetCookie({}, SESSION, NOW);
  assert.equal(cookieHeader(jar, NOW), '__Secure-neon-auth.session_token=abc.def');
  jar = applySetCookie(jar, '__Secure-neon-auth.session_token=; Max-Age=0; Path=/', NOW);
  assert.deepEqual(jar, {});
});

test('expired cookies are not sent', () => {
  const jar = applySetCookie({}, 'x=1; Max-Age=60', NOW);
  assert.equal(cookieHeader(jar, NOW + 30_000), 'x=1');
  assert.equal(cookieHeader(jar, NOW + 61_000), '');
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
  };
}

test('plugin stores Set-Cookie and replays it after a "restart"', async () => {
  const storage = memoryStorage();
  const opts = { storage, storageKey: 'k', authUrl: 'https://auth.example/db/auth', origin: 'https://app.example' };
  const first = createCookieJarPlugin(opts);
  await first.hooks.onResponse({
    request: { url: 'https://auth.example/db/auth/sign-in/email' },
    response: new Response('{}', { headers: { 'set-cookie': SESSION } }),
  });
  assert.ok(storage.data.get('k'));

  // A new plugin instance = the app was killed and reopened.
  const second = createCookieJarPlugin(opts);
  const headers = new Headers();
  await second.hooks.onRequest({ url: 'https://auth.example/db/auth/get-session', headers });
  assert.match(headers.get('cookie') ?? '', /^__Secure-neon-auth\.session_token=abc\.def$/);
  assert.equal(headers.get('origin'), 'https://app.example');

  // Requests to other hosts are left alone.
  const other = new Headers();
  await second.hooks.onRequest({ url: 'https://elsewhere.example/x', headers: other });
  assert.equal(other.get('cookie'), null);

  // Sign-out clears storage.
  await second.hooks.onResponse({
    request: { url: 'https://auth.example/db/auth/sign-out' },
    response: new Response('{}', { headers: { 'set-cookie': '__Secure-neon-auth.session_token=; Max-Age=0' } }),
  });
  assert.equal(storage.data.get('k'), undefined);
});
