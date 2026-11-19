import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, dayOfWeek, monthGrid, shiftMonth, todayInTimeZone, zonedTimeToInstant,
  isLocalDate, normalizeTime, greetingForHour,
} from './dates';

test('addDays / diffDays across month, year and DST boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  // DST change days (EU: 29 Mar / 25 Oct 2026) still count as exactly one day
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-11-19', '2026-11-10'), -9);
});

test('isLocalDate validation', () => {
  assert.equal(isLocalDate('2026-02-29'), false);
  assert.equal(isLocalDate('2028-02-29'), true);
  assert.equal(isLocalDate('2026-13-01'), false);
  assert.equal(isLocalDate('26-01-01'), false);
});

test('todayInTimeZone uses the local calendar date, not UTC', () => {
  const instant = new Date('2026-11-19T23:30:00Z');
  assert.equal(todayInTimeZone('UTC', instant), '2026-11-19');
  assert.equal(todayInTimeZone('Europe/Helsinki', instant), '2026-11-20');
  assert.equal(todayInTimeZone('America/New_York', instant), '2026-11-19');
  assert.equal(todayInTimeZone('Pacific/Kiritimati', new Date('2026-11-19T10:30:00Z')), '2026-11-20');
});

test('zonedTimeToInstant keeps the local wall-clock time across DST (§13)', () => {
  // Helsinki is UTC+2 in winter, UTC+3 in summer. 20:00 local must stay 20:00 local.
  assert.equal(zonedTimeToInstant('2026-03-28', '20:00', 'Europe/Helsinki').toISOString(), '2026-03-28T18:00:00.000Z');
  assert.equal(zonedTimeToInstant('2026-03-29', '20:00', 'Europe/Helsinki').toISOString(), '2026-03-29T17:00:00.000Z');
  assert.equal(zonedTimeToInstant('2026-10-25', '20:00', 'Europe/Helsinki').toISOString(), '2026-10-25T18:00:00.000Z');
  assert.equal(zonedTimeToInstant('2026-07-01', '08:30', 'America/New_York').toISOString(), '2026-07-01T12:30:00.000Z');
  assert.equal(zonedTimeToInstant('2026-12-01', '08:30', 'America/New_York').toISOString(), '2026-12-01T13:30:00.000Z');
});

test('zonedTimeToInstant: non-existent time in spring-forward gap moves forward, not backward', () => {
  // US DST 2026-03-08: 02:00 → 03:00 in New York; 02:30 does not exist.
  const t = zonedTimeToInstant('2026-03-08', '02:30', 'America/New_York');
  assert.ok(t.getTime() >= new Date('2026-03-08T07:00:00Z').getTime());
  assert.equal(todayInTimeZone('America/New_York', t), '2026-03-08');
});

test('monthGrid respects the locale first weekday', () => {
  // November 2026 starts on a Sunday.
  assert.equal(dayOfWeek('2026-11-01'), 0);
  const sundayFirst = monthGrid(2026, 11, 0);
  assert.equal(sundayFirst[0]![0], '2026-11-01');
  const mondayFirst = monthGrid(2026, 11, 1);
  assert.deepEqual(mondayFirst[0]!.slice(0, 7), [null, null, null, null, null, null, '2026-11-01']);
  for (const g of [sundayFirst, mondayFirst]) {
    assert.equal(g.flat().filter(Boolean).length, 30);
    assert.ok(g.every((w) => w.length === 7));
  }
});

test('shiftMonth', () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 11, -13), { year: 2025, month: 10 });
});

test('normalizeTime and greeting', () => {
  assert.equal(normalizeTime('20:00:00'), '20:00');
  assert.equal(normalizeTime('8:5'), '08:05');
  assert.equal(greetingForHour(6), 'Good morning');
  assert.equal(greetingForHour(13), 'Good afternoon');
  assert.equal(greetingForHour(22), 'Good evening');
  assert.equal(greetingForHour(2), 'Good evening');
});
