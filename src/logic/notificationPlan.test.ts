import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCheckins, reconcilePlan, daysAheadFor, validateCheckinResponse, notificationKey, type PlanStreak,
} from './notificationPlan';

const TZ = 'Europe/Helsinki';
const NOW = new Date('2026-11-19T10:00:00Z'); // 12:00 in Helsinki, Thu 19 Nov

const reading: PlanStreak = { id: 'r', name: 'Read for 20 minutes', checkinEnabled: true, checkinTime: '20:00:00', isActive: true, startDate: '2026-11-01' };
const workout: PlanStreak = { id: 'w', name: 'Morning workout', checkinEnabled: false, checkinTime: null, isActive: true, startDate: '2026-11-01' };
const meditate: PlanStreak = { id: 'm', name: 'Meditate', checkinEnabled: true, checkinTime: '21:00', isActive: true, startDate: '2026-11-01' };

test('one prompt per enabled streak per day at its own time (§8.2)', () => {
  const plan = planCheckins({ streaks: [reading, workout, meditate], completedDates: {}, now: NOW, timeZone: TZ, maxDays: 3 });
  assert.equal(plan.length, 6);
  assert.ok(plan.every((p) => p.payload.streakId !== 'w'));
  const firstReading = plan.find((p) => p.payload.streakId === 'r')!;
  assert.equal(firstReading.payload.date, '2026-11-19');
  assert.equal(firstReading.fireAt.toISOString(), '2026-11-19T18:00:00.000Z');
  assert.match(firstReading.body, /Read for 20 minutes/);
  const firstMeditate = plan.find((p) => p.payload.streakId === 'm')!;
  assert.equal(firstMeditate.fireAt.toISOString(), '2026-11-19T19:00:00.000Z');
});

test('already-completed day is never scheduled (§8.7)', () => {
  const plan = planCheckins({ streaks: [reading], completedDates: { r: ['2026-11-19'] }, now: NOW, timeZone: TZ, maxDays: 3 });
  assert.deepEqual(plan.map((p) => p.payload.date), ['2026-11-20', '2026-11-21']);
});

test("today's prompt is skipped once its time has passed", () => {
  const late = new Date('2026-11-19T19:30:00Z'); // 21:30 Helsinki
  const plan = planCheckins({ streaks: [reading], completedDates: {}, now: late, timeZone: TZ, maxDays: 3 });
  assert.deepEqual(plan.map((p) => p.payload.date), ['2026-11-20', '2026-11-21']);
});

test('archived, disabled and not-yet-started streaks', () => {
  const archived = { ...reading, isActive: false };
  const future = { ...reading, id: 'f', startDate: '2026-11-21' };
  const plan = planCheckins({ streaks: [archived, future], completedDates: {}, now: NOW, timeZone: TZ, maxDays: 4 });
  assert.deepEqual(plan.map((p) => p.payload.date), ['2026-11-21', '2026-11-22']);
});

test('budget stays under the iOS pending limit', () => {
  assert.equal(daysAheadFor(0), 0);
  assert.equal(daysAheadFor(1), 14);
  assert.equal(daysAheadFor(5), 12);
  assert.equal(daysAheadFor(100), 1);
  const many = Array.from({ length: 80 }, (_, i) => ({ ...reading, id: `s${i}` }));
  assert.ok(planCheckins({ streaks: many, completedDates: {}, now: NOW, timeZone: TZ }).length <= 60);
});

test('DST: prompt stays at the selected local time (§13)', () => {
  const beforeDst = new Date('2027-03-26T10:00:00Z');
  const plan = planCheckins({ streaks: [reading], completedDates: {}, now: beforeDst, timeZone: TZ, maxDays: 4 });
  const local = plan.map((p) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(p.fireAt));
  assert.deepEqual(local, ['20:00', '20:00', '20:00', '20:00']); // 28 Mar 2027 is the switch
  assert.notEqual(plan[1]!.fireAt.getUTCHours(), plan[3]!.fireAt.getUTCHours());
});

test('reconcile: unchanged kept, stale cancelled, duplicates cancelled, new scheduled', () => {
  const desired = planCheckins({ streaks: [reading], completedDates: {}, now: NOW, timeZone: TZ, maxDays: 2 });
  const [a, b] = desired;
  const { toCancel, toSchedule } = reconcilePlan(desired, [
    { identifier: 'n1', key: a!.key },
    { identifier: 'n2', key: a!.key }, // duplicate
    { identifier: 'n3', key: 'old|key' },
    { identifier: 'n4', key: null },
  ]);
  assert.deepEqual(toCancel.sort(), ['n2', 'n3', 'n4']);
  assert.deepEqual(toSchedule.map((p) => p.key), [b!.key]);
});

test('changing the time or timezone changes the key, forcing reschedule (§7.5, §8.8)', () => {
  const k1 = notificationKey('r', '2026-11-19', '20:00', TZ, 'Read');
  assert.notEqual(k1, notificationKey('r', '2026-11-19', '20:30', TZ, 'Read'));
  assert.notEqual(k1, notificationKey('r', '2026-11-19', '20:00', 'Europe/Berlin', 'Read'));
  assert.equal(k1, notificationKey('r', '2026-11-19', '20:00:00', TZ, 'Read'));
});

test('old notification validation (§13)', () => {
  const payload = { kind: 'checkin', streakId: 'r', date: '2026-11-19', time: '20:00', timeZone: TZ, key: 'k' };
  assert.deepEqual(validateCheckinResponse(payload, '2026-11-19'), { ok: true, streakId: 'r', date: '2026-11-19' });
  assert.deepEqual(validateCheckinResponse(payload, '2026-11-20'), { ok: false, reason: 'expired' });
  assert.deepEqual(validateCheckinResponse(payload, '2026-11-18'), { ok: false, reason: 'future' });
  assert.deepEqual(validateCheckinResponse({ foo: 1 }, '2026-11-19'), { ok: false, reason: 'invalid_payload' });
});
