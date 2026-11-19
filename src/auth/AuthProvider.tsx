import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { deleteAccount as apiDeleteAccount, syncProfile } from '../data/api';
import { completionQueue, flushCompletions } from '../data/completions';
import { supabase } from '../lib/supabase';
import { deviceTimeZone } from '../logic/dates';
import { clearAllSchedules } from '../notifications/scheduler';

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

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'That email and password don’t match.';
  if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox.';
  if (m.includes('already registered')) return 'An account with this email already exists. Try logging in.';
  if (m.includes('password should be')) return 'Use a password with at least 8 characters.';
  if (m.includes('token has expired') || m.includes('invalid otp') || m.includes('otp')) return 'That code is invalid or has expired. Request a new one.';
  if (m.includes('network') || m.includes('fetch')) return 'You seem to be offline. Check your connection and try again.';
  return message;
}

async function wrap<T>(p: Promise<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyAuthError(error.message));
  return data;
}

/** User-specific local state that must not survive logout (§13). */
async function clearLocalUserState() {
  await clearAllSchedules().catch(() => undefined);
  await completionQueue.clearAll().catch(() => undefined);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && s?.user) {
        // Create or retrieve the profile and record the device timezone (§4.2).
        syncProfile(s.user.id, s.user.email, deviceTimeZone());
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initializing,
      async signIn(email, password) {
        await wrap(supabase.auth.signInWithPassword({ email: email.trim(), password }));
      },
      async signUp(email, password) {
        const data = await wrap(
          supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { timezone: deviceTimeZone() } },
          }),
        );
        return { needsConfirmation: !data.session };
      },
      async requestPasswordReset(email) {
        await wrap(supabase.auth.resetPasswordForEmail(email.trim()));
      },
      async confirmPasswordReset(email, code, newPassword) {
        await wrap(supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' }));
        await wrap(supabase.auth.updateUser({ password: newPassword }));
      },
      async unsyncedCount() {
        await flushCompletions().catch(() => undefined);
        return (await completionQueue.list()).length;
      },
      async signOut() {
        await clearLocalUserState();
        await supabase.auth.signOut();
      },
      async deleteAccount() {
        await apiDeleteAccount();
        await clearLocalUserState();
        await supabase.auth.signOut().catch(() => undefined);
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
