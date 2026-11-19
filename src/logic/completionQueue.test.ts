import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompletionQueue, memoryStore, type PendingCompletion } from './completionQueue';

const item = (streakId: string, date: string): PendingCompletion => ({
  streakId, date, source: 'manual', timeZone: 'Europe/Helsinki', recordedAt: '2026-11-19T10:00:00Z',
});

test('enqueue prevents local duplicates', async () => {
  const q = new CompletionQueue(memoryStore());
  assert.equal(await q.enqueue(item('a', '2026-11-19')), true);
  assert.equal(await q.enqueue(item('a', '2026-11-19')), false);
  assert.equal(await q.enqueue(item('b', '2026-11-19')), true);
  assert.equal((await q.list()).length, 2);
});

test('flush removes confirmed, keeps retryable, never discards rejected silently', async () => {
  const q = new CompletionQueue(memoryStore());
  await q.enqueue(item('ok', '2026-11-19'));
  await q.enqueue(item('dupe', '2026-11-19'));
  await q.enqueue(item('bad', '2026-11-19'));
  await q.enqueue(item('net', '2026-11-19'));
  await q.enqueue(item('after', '2026-11-19'));
  const res = await q.flush(async (i) => {
    if (i.streakId === 'ok') return { kind: 'created' };
    if (i.streakId === 'dupe') return { kind: 'already_completed' };
    if (i.streakId === 'bad') return { kind: 'rejected', reason: 'streak_archived' };
    return { kind: 'retry', reason: 'offline' };
  });
  assert.deepEqual(res, { confirmed: 2, remaining: 2, rejected: 1 });
  assert.deepEqual((await q.list()).map((i) => i.streakId), ['net', 'after']);
  const rejected = await q.listRejected();
  assert.equal(rejected[0]!.reason, 'streak_archived');
});

test('a throwing sender is treated as retryable', async () => {
  const q = new CompletionQueue(memoryStore());
  await q.enqueue(item('a', '2026-11-19'));
  await q.flush(async () => { throw new Error('Network request failed'); });
  assert.equal((await q.list()).length, 1);
});

test('concurrent enqueues from the same context do not lose writes', async () => {
  const q = new CompletionQueue(memoryStore());
  await Promise.all(Array.from({ length: 20 }, (_, i) => q.enqueue(item(`s${i}`, '2026-11-19'))));
  assert.equal((await q.list()).length, 20);
});

test('corrupt storage does not crash', async () => {
  const store = memoryStore();
  store.data.set('streaks.pendingCompletions.v1', '{not json');
  const q = new CompletionQueue(store);
  assert.deepEqual(await q.list(), []);
});

test('clearAll on logout', async () => {
  const q = new CompletionQueue(memoryStore());
  await q.enqueue(item('a', '2026-11-19'));
  await q.clearAll();
  assert.deepEqual(await q.list(), []);
});
