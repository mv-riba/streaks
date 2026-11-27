/**
 * App state for the signed-in user: active streaks, completion history, device-only
 * pending completions and connectivity. Every mutation re-reconciles notification
 * schedules so the OS always matches the database (§8.8).
 */
import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { deviceTimeZone, todayInTimeZone, type LocalDate } from '../logic/dates';
import { computeStreakStats, type StreakStats } from '../logic/streaks';
import type { PlanStreak } from '../logic/notificationPlan';
import { dismissPresentedPrompt, ensurePermission, reconcileSchedules, notificationsSupported, type PermissionState } from '../notifications/scheduler';
import * as api from './api';
import { completionQueue, flushCompletions, recordCompletion } from './completions';
import type { CheckinPatch, NewStreakInput, Streak, StreakDetailsPatch } from './types';

type DateSets = Record<string, Set<LocalDate>>;

interface StoreValue {
  streaks: Streak[];
  loading: boolean;
  error: string | null;
  online: boolean;
  notice: string | null;
  today: LocalDate;
  setNotice(text: string | null): void;
  refresh(): Promise<void>;
  statsFor(streak: Streak): StreakStats;
  completedDates(streakId: string): Set<LocalDate>;
  pendingDates(streakId: string): Set<LocalDate>;
  isPendingToday(streakId: string): boolean;
  complete(streakId: string): Promise<void>;
  create(input: NewStreakInput): Promise<{ permission: PermissionState | null }>;
  updateDetails(id: string, patch: StreakDetailsPatch): Promise<void>;
  updateCheckin(id: string, patch: CheckinPatch): Promise<{ permission: PermissionState | null }>;
  archive(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Looked up by the foreground notification handler to suppress already-done prompts. */
let completedLookup: (streakId: string, date: LocalDate) => boolean = () => false;
export const isCompletedLocally = (streakId: string, date: LocalDate) => completedLookup(streakId, date);

function toPlan(s: Streak): PlanStreak {
  return {
    id: s.id,
    name: s.name,
    checkinEnabled: s.checkin_enabled,
    checkinTime: s.checkin_time,
    isActive: s.is_active,
    startDate: s.start_date,
  };
}

function useToday(): LocalDate {
  const [today, setToday] = useState(() => todayInTimeZone(deviceTimeZone()));
  useEffect(() => {
    const tick = () => setToday(todayInTimeZone(deviceTimeZone()));
    const id = setInterval(tick, 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return today;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const today = useToday();
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [completed, setCompleted] = useState<DateSets>({});
  const [pending, setPending] = useState<DateSets>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ streaks, completed, pending });
  latest.current = { streaks, completed, pending };

  const merged = useCallback((c: DateSets, p: DateSets): Record<string, LocalDate[]> => {
    const out: Record<string, LocalDate[]> = {};
    for (const [id, set] of Object.entries(c)) out[id] = [...set];
    for (const [id, set] of Object.entries(p)) out[id] = [...(out[id] ?? []), ...set];
    return out;
  }, []);

  const reschedule = useCallback(
    (s: Streak[], c: DateSets, p: DateSets) =>
      reconcileSchedules({ streaks: s.map(toPlan), completedDates: merged(c, p) }).catch(() => undefined),
    [merged],
  );

  const loadPending = useCallback(async (): Promise<DateSets> => {
    const out: DateSets = {};
    for (const p of await completionQueue.list()) (out[p.streakId] ??= new Set()).add(p.date);
    return out;
  }, []);

  const surfaceRejections = useCallback(async () => {
    const rejected = await completionQueue.listRejected();
    if (rejected.length > 0) {
      setNotice(api.friendlyRejection(rejected[rejected.length - 1]!.reason));
      await completionQueue.dismissRejected();
    }
  }, []);

  const lastTimeZone = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    // Device timezone changed (travel / settings): update the profile. Schedules follow
    // automatically because the timezone is part of each notification's key (§13).
    const tz = deviceTimeZone();
    if (lastTimeZone.current !== null && lastTimeZone.current !== tz) {
      api.syncProfile(userId, session?.user.email, tz);
    }
    lastTimeZone.current = tz;
    try {
      await flushCompletions().catch(() => undefined);
      const s = await api.fetchActiveStreaks();
      const rows = await api.fetchCompletions(s.map((x) => x.id));
      const c: DateSets = {};
      for (const r of rows) (c[r.streak_id] ??= new Set()).add(r.completed_date);
      const p = await loadPending();
      setStreaks(s);
      setCompleted(c);
      setPending(p);
      setError(null);
      await surfaceRejections();
      reschedule(s, c, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      // Offline: still show device-only completions so nothing looks lost.
      setPending(await loadPending());
    } finally {
      setLoading(false);
    }
  }, [userId, session?.user.email, loadPending, reschedule, surfaceRejections]);

  // Load on sign-in; reset on sign-out.
  useEffect(() => {
    if (!userId) {
      setStreaks([]);
      setCompleted({});
      setPending({});
      setLoading(true);
      return;
    }
    refresh();
  }, [userId, refresh]);

  // Re-sync when the app returns to the foreground, connectivity returns, or the day changes.
  useEffect(() => {
    if (!userId) return;
    const app = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    let wasOnline = true;
    const net = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected !== false && state.isInternetReachable !== false;
      if (!wasOnline && isOnline) refresh(); // flush device-only completions
      wasOnline = isOnline;
      setOnline(isOnline);
    });
    return () => {
      app.remove();
      net();
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (userId) reschedule(latest.current.streaks, latest.current.completed, latest.current.pending);
  }, [today, userId, reschedule]);

  completedLookup = (streakId, date) =>
    Boolean(latest.current.completed[streakId]?.has(date) || latest.current.pending[streakId]?.has(date));

  const complete = useCallback(
    async (streakId: string) => {
      const date = todayInTimeZone(deviceTimeZone());
      const outcome = await recordCompletion(streakId, 'manual', date);
      const p = await loadPending();
      let c = latest.current.completed;
      if (outcome.status === 'confirmed') {
        c = { ...c, [streakId]: new Set([...(c[streakId] ?? []), date]) };
        setCompleted(c);
      } else if (outcome.status === 'rejected') {
        setNotice(api.friendlyRejection(outcome.reason));
        await completionQueue.dismissRejected();
      }
      setPending(p);
      // Never ask about a day that is done; remove a prompt already on screen (§8.7).
      dismissPresentedPrompt(streakId, date);
      reschedule(latest.current.streaks, c, p);
    },
    [loadPending, reschedule],
  );

  /** Requests permission the first time a check-in is enabled (§4.2, §6.5). */
  const permissionFor = useCallback(async (enabled: boolean): Promise<PermissionState | null> => {
    if (!enabled || !notificationsSupported) return null;
    const result = await ensurePermission();
    if (result === 'denied') {
      setNotice('Streak saved. To get daily check-ins, allow notifications for Streaks in your device settings.');
    }
    return result;
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      streaks,
      loading,
      error,
      online,
      notice,
      today,
      setNotice,
      refresh,
      statsFor: (s) =>
        computeStreakStats([...(completed[s.id] ?? []), ...(pending[s.id] ?? [])], today, s.start_date),
      completedDates: (id) => completed[id] ?? new Set(),
      pendingDates: (id) => pending[id] ?? new Set(),
      isPendingToday: (id) => Boolean(pending[id]?.has(today)) && !completed[id]?.has(today),
      complete,
      async create(input) {
        const created = await api.createStreak(input);
        const next = [...latest.current.streaks, created];
        setStreaks(next);
        const permission = await permissionFor(input.checkin_enabled);
        reschedule(next, latest.current.completed, latest.current.pending);
        return { permission };
      },
      async updateDetails(id, patch) {
        const updated = await api.updateStreakDetails(id, patch);
        const next = latest.current.streaks.map((s) => (s.id === id ? updated : s));
        setStreaks(next);
        reschedule(next, latest.current.completed, latest.current.pending); // name is in the prompt text
      },
      async updateCheckin(id, patch) {
        const updated = await api.updateCheckin(id, patch);
        const next = latest.current.streaks.map((s) => (s.id === id ? updated : s));
        setStreaks(next);
        const permission = await permissionFor(patch.checkin_enabled);
        reschedule(next, latest.current.completed, latest.current.pending);
        return { permission };
      },
      async archive(id) {
        await api.archiveStreak(id);
        const next = latest.current.streaks.filter((s) => s.id !== id);
        setStreaks(next);
        reschedule(next, latest.current.completed, latest.current.pending);
      },
      async remove(id) {
        await api.deleteStreak(id);
        const next = latest.current.streaks.filter((s) => s.id !== id);
        setStreaks(next);
        reschedule(next, latest.current.completed, latest.current.pending);
      },
    }),
    [streaks, completed, pending, loading, error, online, notice, today, refresh, complete, permissionFor, reschedule],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
