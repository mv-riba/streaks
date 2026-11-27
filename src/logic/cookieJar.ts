/**
 * Minimal cookie jar used to persist the Neon Auth session on Android/iOS.
 *
 * Neon Auth (Managed Better Auth) keeps the session only in an HttpOnly cookie set by the
 * auth server; the SDK has no storage option. Browsers keep that cookie themselves, but on
 * React Native we send requests with `credentials: 'omit'` and manage the cookie here, so it
 * lives in AsyncStorage and survives an app restart. Pure logic — no React Native imports —
 * so it is unit-tested in Node.
 */

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface StoredCookie {
  value: string;
  /** Epoch ms; null = no expiry given (kept until the server clears it). */
  expiresAt: number | null;
}

export type CookieMap = Record<string, StoredCookie>;

export interface ParsedSetCookie {
  name: string;
  value: string;
  expiresAt: number | null;
  /** True when the server is deleting the cookie (Max-Age<=0, past Expires, or empty value). */
  deleted: boolean;
}

/**
 * Splits a combined `Set-Cookie` header. React Native and Node join multiple Set-Cookie
 * headers with ", ", which also appears inside `Expires=Wed, 21 Oct …`, so only split on a
 * comma that is followed by `name=`.
 */
export function splitSetCookieHeader(header: string): string[] {
  return header
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSetCookie(cookie: string, now = Date.now()): ParsedSetCookie | null {
  const [pair = '', ...attrs] = cookie.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let expiresAt: number | null = null;
  let maxAgeSeen = false;
  for (const attr of attrs) {
    const [rawKey = '', ...rest] = attr.split('=');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'max-age') {
      const secs = Number(val);
      if (Number.isFinite(secs)) {
        expiresAt = now + secs * 1000;
        maxAgeSeen = true;
      }
    } else if (key === 'expires' && !maxAgeSeen) {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) expiresAt = t;
    }
  }
  const deleted = value === '' || (expiresAt !== null && expiresAt <= now);
  return { name, value, expiresAt, deleted };
}

export function applySetCookie(jar: CookieMap, header: string | null, now = Date.now()): CookieMap {
  if (!header) return jar;
  const next: CookieMap = { ...jar };
  for (const raw of splitSetCookieHeader(header)) {
    const c = parseSetCookie(raw, now);
    if (!c) continue;
    if (c.deleted) delete next[c.name];
    else next[c.name] = { value: c.value, expiresAt: c.expiresAt };
  }
  return next;
}

export function cookieHeader(jar: CookieMap, now = Date.now()): string {
  return Object.entries(jar)
    .filter(([, c]) => c.expiresAt === null || c.expiresAt > now)
    .map(([name, c]) => `${name}=${c.value}`)
    .join('; ');
}

/** better-fetch request/response context, reduced to what the plugin touches. */
interface RequestContext {
  url: string | URL;
  headers: Headers | Record<string, string>;
}
interface ResponseContext {
  response: Response;
  request: { url: string | URL };
}

function setHeader(headers: RequestContext['headers'], name: string, value: string) {
  if (typeof (headers as Headers).set === 'function') (headers as Headers).set(name, value);
  else (headers as Record<string, string>)[name] = value;
}
function hasHeader(headers: RequestContext['headers'], name: string): boolean {
  if (typeof (headers as Headers).has === 'function') return (headers as Headers).has(name);
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

export interface CookieJarPluginOptions {
  storage: KeyValueStorage;
  storageKey: string;
  /** Only requests whose URL starts with this get the cookie (the Neon Auth base URL). */
  authUrl: string;
  /**
   * Sent as `Origin` on native requests. Better Auth rejects cookie-authenticated POSTs
   * (sign-out, password reset, …) without a trusted Origin, and native fetch sends none.
   */
  origin: string;
}

/**
 * A better-fetch plugin (passed via Neon's `auth.fetchOptions.plugins`) that attaches the
 * stored cookie + Origin to every Neon Auth request and stores any Set-Cookie it returns.
 */
export function createCookieJarPlugin({ storage, storageKey, authUrl, origin }: CookieJarPluginOptions) {
  let jar: CookieMap | null = null;
  let writing: Promise<void> = Promise.resolve();

  async function load(): Promise<CookieMap> {
    if (jar) return jar;
    try {
      const raw = await storage.getItem(storageKey);
      jar = raw ? (JSON.parse(raw) as CookieMap) : {};
    } catch {
      jar = {};
    }
    return jar;
  }

  async function save(next: CookieMap) {
    jar = next;
    const body = Object.keys(next).length ? JSON.stringify(next) : null;
    writing = writing.then(() => (body ? storage.setItem(storageKey, body) : storage.removeItem(storageKey))).catch(() => undefined);
    await writing;
  }

  const isAuthUrl = (url: string | URL) => url.toString().startsWith(authUrl);

  return {
    id: 'streaks-native-cookie-jar',
    name: 'streaks-native-cookie-jar',
    hooks: {
      async onRequest(ctx: RequestContext) {
        if (!isAuthUrl(ctx.url)) return;
        const header = cookieHeader(await load());
        if (header) setHeader(ctx.headers, 'Cookie', header);
        if (!hasHeader(ctx.headers, 'Origin')) setHeader(ctx.headers, 'Origin', origin);
      },
      async onResponse(ctx: ResponseContext) {
        if (!isAuthUrl(ctx.request.url)) return;
        const header = ctx.response.headers.get('set-cookie');
        if (header) await save(applySetCookie(await load(), header));
      },
    },
    /** Drops the stored session (used if sign-out cannot reach the server). */
    async clear() {
      await save({});
    },
  };
}
