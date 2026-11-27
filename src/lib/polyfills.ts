/**
 * Globals @neon/neon-js expects that Hermes / React Native's fetch polyfill may not provide.
 * Each is installed only when missing, so web and Node keep their native implementations.
 */

// Used by the Supabase-compatible auth adapter's onAuthStateChange as a subscription id
// (not a secret), so a Math.random v4 UUID is sufficient when crypto.randomUUID is absent.
const g = globalThis as { crypto?: { randomUUID?: () => string } };
if (typeof g.crypto?.randomUUID !== 'function') {
  const randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  if (g.crypto) {
    try {
      g.crypto.randomUUID = randomUUID;
    } catch {
      /* read-only crypto object: leave it */
    }
  } else {
    g.crypto = { randomUUID };
  }
}

// The SDK serves its cached session with the static Response.json(); whatwg-fetch lacks it.
const R = Response as unknown as { json?: (data: unknown, init?: ResponseInit) => Response };
if (typeof R.json !== 'function') {
  R.json = (data, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), { ...init, headers });
  };
}

export {};
