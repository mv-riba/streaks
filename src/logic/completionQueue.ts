/**
 * Durable queue of completions that have been recorded on the device but not yet
 * confirmed by the server (offline taps, notification actions processed in the
 * background). Nothing is ever silently discarded (§8.8): entries are removed only when
 * the server confirms them, or moved to `rejected` with a reason the UI can show.
 */
import type { LocalDate } from './dates';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type CompletionSource = 'manual' | 'notification';

export interface PendingCompletion {
  streakId: string;
  date: LocalDate;
  source: CompletionSource;
  timeZone: string;
  recordedAt: string; // ISO UTC
}

export interface RejectedCompletion extends PendingCompletion {
  reason: string;
}

export type SendResult =
  | { kind: 'created' }
  | { kind: 'already_completed' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'retry'; reason: string };

const PENDING_KEY = 'streaks.pendingCompletions.v1';
const REJECTED_KEY = 'streaks.rejectedCompletions.v1';

export const pendingKey = (p: { streakId: string; date: LocalDate }) => `${p.streakId}|${p.date}`;

export class CompletionQueue {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private store: KeyValueStore) {}

  /** Serialise all read-modify-write cycles within this JS context. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private async read<T>(key: string): Promise<T[]> {
    try {
      const raw = await this.store.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write<T>(key: string, items: T[]) {
    return this.store.setItem(key, JSON.stringify(items));
  }

  list(): Promise<PendingCompletion[]> {
    return this.exclusive(() => this.read<PendingCompletion>(PENDING_KEY));
  }

  listRejected(): Promise<RejectedCompletion[]> {
    return this.exclusive(() => this.read<RejectedCompletion>(REJECTED_KEY));
  }

  /** Adds a pending completion. Returns false if one already exists for that streak/day. */
  enqueue(item: PendingCompletion): Promise<boolean> {
    return this.exclusive(async () => {
      const items = await this.read<PendingCompletion>(PENDING_KEY);
      if (items.some((i) => pendingKey(i) === pendingKey(item))) return false;
      items.push(item);
      await this.write(PENDING_KEY, items);
      return true;
    });
  }

  remove(key: string): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.read<PendingCompletion>(PENDING_KEY);
      await this.write(
        PENDING_KEY,
        items.filter((i) => pendingKey(i) !== key),
      );
    });
  }

  dismissRejected(): Promise<void> {
    return this.exclusive(() => this.store.removeItem(REJECTED_KEY));
  }

  clearAll(): Promise<void> {
    return this.exclusive(async () => {
      await this.store.removeItem(PENDING_KEY);
      await this.store.removeItem(REJECTED_KEY);
    });
  }

  /**
   * Sends every pending item. Confirmed items are removed; rejected ones are moved to
   * the rejected list; retryable failures (network) stay queued. Stops at the first
   * retryable failure, since the rest would most likely fail the same way.
   */
  flush(send: (item: PendingCompletion) => Promise<SendResult>) {
    return this.exclusive(async () => {
      const items = await this.read<PendingCompletion>(PENDING_KEY);
      const remaining: PendingCompletion[] = [];
      const rejected = await this.read<RejectedCompletion>(REJECTED_KEY);
      let confirmed = 0;
      let stop = false;
      for (const item of items) {
        if (stop) {
          remaining.push(item);
          continue;
        }
        let result: SendResult;
        try {
          result = await send(item);
        } catch (e) {
          result = { kind: 'retry', reason: e instanceof Error ? e.message : String(e) };
        }
        if (result.kind === 'created' || result.kind === 'already_completed') confirmed++;
        else if (result.kind === 'rejected') rejected.push({ ...item, reason: result.reason });
        else {
          remaining.push(item);
          stop = true;
        }
      }
      await this.write(PENDING_KEY, remaining);
      await this.write(REJECTED_KEY, rejected);
      return { confirmed, remaining: remaining.length, rejected: rejected.length };
    });
  }
}

export function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.has(k) ? data.get(k)! : null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
  };
}
