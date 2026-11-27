import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { deleteAccount as apiDeleteAccount, syncProfile } from '../data/api';
import { completionQueue, flushCompletions } from '../data/completions';
import { AppState } from 'react-native';
import { clearStoredSession, neon } from '../lib/neon';
import { deviceTimeZone } from '../logic/dates';
import { clearAllSchedules } from '../notifications/scheduler';
import { lastKnownSession, rememberSession } from './lastSession';

interface AuthContextValue {
  session: Session | null;
  initializing: boolean;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the user must confirm their email before signing in. */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  /** Number of device-only completions that would be lost by signing out now. */
  unsyncedCount(): Promise<number>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

/** Session shape of the Supabase-compatible Neon Auth adapter. */
export type Session = NonNullable<Awaited<ReturnType<typeof neon.auth.getSession>>['data']['session']>;

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid email or password')) return 'That email and password don’t match.';
  if (m.includes('email not confirmed') || m.includes('email not verified')) return 'Please confirm your email first — check your inbox.';
  if (m.includes('already registered') || m.includes('already exists')) return 'An account with this email already exists. Try logging in.';
  if (m.includes('password should be') || m.includes('password too short') || m.includes('security requirements'))
    return 'Use a password with at least 8 characters.';
  if (m.includes('token has expired') || m.includes('otp') || m.includes('too many attempts')) return 'That code is invalid or has expired. Request a new one.';
  if (m.includes('network') || m.includes('fetch')) return 'You seem to be offline. Check your connection and try again.';
  return message;
}

async function wrap<R extends { data: unknown; error: { message: string } | null }>(p: Promise<R>): Promise<R['data']> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyAuthError(error.message));
  return data;
}

/** Better Auth's own methods (email OTP) throw on HTTP errors instead of returning `error`. */
async function wrapBetterAuth(p: BetterAuthResult): Promise<unknown> {
  try {
    const { data, error } = await p;
    if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
    return data;
  } catch (e) {
    throw new Error(friendlyAuthError((e as Error).message ?? String(e)));
  }
}

type BetterAuthResult = Promise<{ data: unknown; error: { message?: string } | null }>;
/**
 * The Better Auth client behind the Supabase-compatible adapter. Its declared type omits the
 * managed plugins, so describe the email-OTP methods used here (Better Auth emailOTP plugin).
 */
interface EmailOtpClient {
  emailOtp: {
    sendVerificationOtp(input: { email: string; type: 'forget-password' | 'email-verification' | 'sign-in' }): BetterAuthResult;
    resetPassword(input: { email: string; otp: string; password: string }): BetterAuthResult;
  };
}
const betterAuth = () => neon.auth.getBetterAuthInstance() as unknown as EmailOtpClient;

/** User-specific local state that must not survive logout (§13). */
async function clearLocalUserState() {
  await clearAllSchedules().catch(() => undefined);
  await completionQueue.clearAll().catch(() => undefined);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;

    /** Asks Neon Auth for the session; falls back to the last known one when offline. */
    const resolveSession = async (isInitial: boolean) => {
      let resolved: Session | null;
      try {
        const { data, error } = await neon.auth.getSession();
        // `error` here is an auth error from the server (e.g. expired session): signed out.
        resolved = error ? null : data.session;
        void rememberSession(resolved);
      } catch {
        // Network failure: keep whoever was signed in on this device.
        if (!isInitial) return;
        resolved = await lastKnownSession<Session>();
      }
      if (cancelled) return;
      setSession(resolved);
      setInitializing(false);
      if (isInitial && resolved?.user) {
        // Create or retrieve the profile and record the device timezone (§4.2). This
        // replaces Supabase's on_auth_user_created trigger.
        syncProfile(resolved.user.id, resolved.user.email, deviceTimeZone());
      }
    };
    void resolveSession(true);

    // The Neon adapter only reports changes made in *other* browser tabs here (it relays
    // them through localStorage); changes in this tab/app are applied by adoptSession below.
    const { data } = neon.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION is handled by resolveSession (the adapter reports null when offline).
      if (event === 'INITIAL_SESSION') return;
      setSession(s);
      void rememberSession(s);
      if (event === 'SIGNED_IN' && s?.user) syncProfile(s.user.id, s.user.email, deviceTimeZone());
    });
    // Re-check with the server when the app returns to the foreground (e.g. after an offline start).
    const app = AppState.addEventListener('change', (state) => state === 'active' && void resolveSession(false));
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
      app.remove();
    };
  }, []);

  /** Applies a session returned by sign-in / sign-up in this app (see onAuthStateChange note). */
  const adoptSession = async (s: Session | null) => {
    setSession(s);
    await rememberSession(s);
    // Create or retrieve the profile and record the device timezone (§4.2). This replaces
    // Supabase's on_auth_user_created trigger.
    if (s?.user) syncProfile(s.user.id, s.user.email, deviceTimeZone());
  };

  const forgetSessionLocally = async () => {
    await clearStoredSession();
    await rememberSession(null);
    setSession(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initializing,
      async signIn(email, password) {
        const data = await wrap(neon.auth.signInWithPassword({ email: email.trim(), password }));
        await adoptSession(data.session);
      },
      async signUp(email, password) {
        // No user metadata: adoptSession upserts the profile with the device timezone,
        // replacing Supabase's handle_new_user trigger.
        const data = await wrap(neon.auth.signUp({ email: email.trim(), password }));
        if (data.session) await adoptSession(data.session);
        // Neon Auth's "Verify email at signup" is off for this project, so sign-up returns a
        // session. If it is ever turned on, this path tells the user to confirm their email.
        return { needsConfirmation: !data.session };
      },
      async requestPasswordReset(email) {
        // Emails a 6-digit code (Managed Better Auth email OTP, "forget-password" type).
        await wrapBetterAuth(betterAuth().emailOtp.sendVerificationOtp({ email: email.trim(), type: 'forget-password' }));
      },
      async confirmPasswordReset(email, code, newPassword) {
        await wrapBetterAuth(betterAuth().emailOtp.resetPassword({ email: email.trim(), otp: code.trim(), password: newPassword }));
        // Better Auth's reset does not sign in; do it so the screen can go straight to the app.
        const data = await wrap(neon.auth.signInWithPassword({ email: email.trim(), password: newPassword }));
        await adoptSession(data.session);
      },
      async unsyncedCount() {
        await flushCompletions().catch(() => undefined);
        return (await completionQueue.list()).length;
      },
      async signOut() {
        await clearLocalUserState();
        await neon.auth.signOut().catch(() => null);
        // Even if the server call failed (offline), this device is signed out.
        await forgetSessionLocally();
      },
      async deleteAccount() {
        // delete_my_account() also removes the server session, so sign-out may fail: the
        // local session is dropped either way.
        await apiDeleteAccount();
        await clearLocalUserState();
        await neon.auth.signOut().catch(() => undefined);
        await forgetSessionLocally();
      },
    }),
    [session, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
