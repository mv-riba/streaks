/**
 * The ONE completion path (§9.2). Manual taps, notification actions (foreground or
 * background) and offline retries all go through recordCompletion():
 *   1. validate the day locally,
 *   2. persist it to the durable on-device queue (so nothing is lost if the app dies),
 *   3. flush the queue to the server, which validates again and is authoritative.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CompletionQueue, type CompletionSource } from '../logic/completionQueue';
import { deviceTimeZone, todayInTimeZone, type LocalDate } from '../logic/dates';
import { sendCompletion } from './api';

export const completionQueue = new CompletionQueue(AsyncStorage);

export type RecordOutcome =
  | { status: 'confirmed' } // server has it
  | { status: 'pending' } // saved on device, will sync
  | { status: 'rejected'; reason: string };

export async function recordCompletion(
  streakId: string,
  source: CompletionSource,
  date: LocalDate = todayInTimeZone(deviceTimeZone()),
): Promise<RecordOutcome> {
  const timeZone = deviceTimeZone();
  await completionQueue.enqueue({ streakId, date, source, timeZone, recordedAt: new Date().toISOString() });
  await flushCompletions();
  const stillPending = (await completionQueue.list()).some((p) => p.streakId === streakId && p.date === date);
  if (stillPending) return { status: 'pending' };
  const rejected = (await completionQueue.listRejected()).find((r) => r.streakId === streakId && r.date === date);
  if (rejected) return { status: 'rejected', reason: rejected.reason };
  return { status: 'confirmed' };
}

/** Safe to call concurrently: the queue serialises flushes, so nothing is sent twice. */
export function flushCompletions() {
  return completionQueue.flush(sendCompletion);
}
