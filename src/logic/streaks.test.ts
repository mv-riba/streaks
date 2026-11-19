import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreakStats, longestRun, canCompleteOn } from './streaks';

// Week of 2026-11-16 (Mon) … 2026-11-22 (Sun)
const MON = '2026-11-16', TUE = '2026-11-17', WED = '2026-11-18', THU = '2026-11-19',
  FRI = '2026-11-20', SAT = '2026-11-21', SUN = '2026-11-22';

test('PRD §9.3 table: Mon–Thu done, Fri missed, Sat–Sun done', () => {
  const done = [MON, TUE, WED, THU, SAT, SUN];
  assert.equal(computeStreakStats([MON], MON).current, 1);
  assert.equal(computeStreakStats([MON, TUE], TUE).current, 2);
  assert.equal(computeStreakStats([MON, TUE, WED], WED).current, 3);
  assert.equal(computeStreakStats([MON, TUE, WED, THU], THU).current, 4);
  // Friday pending: still 4
  assert.equal(computeStreakStats([MON, TUE, WED, THU], FRI).current, 4);
  assert.equal(computeStreakStats([MON, TUE, WED, THU], FRI).status, 'ongoing');
  // Saturday, Friday was missed: broken
  const satMorning = computeStreakStats([MON, TUE, WED, THU], SAT);
  assert.equal(satMorning.current, 0);
  assert.equal(satMorning.status, 'broken');
  assert.equal(satMorning.longest, 4);
  assert.equal(computeStreakStats([MON, TUE, WED, THU, SAT], SAT).current, 1);
  const end = computeStreakStats(done, SUN);
  assert.deepEqual(
    { current: end.current, longest: end.longest, total: end.total, status: end.status },
    { current: 2, longest: 4, total: 6, status: 'completed_today' },
  );
});

test('PRD §9.4: pending current day does not break the streak before midnight', () => {
  const s = computeStreakStats([MON, TUE], WED);
  assert.equal(s.current, 2);
  assert.equal(s.completedToday, false);
  assert.equal(computeStreakStats([MON, TUE, WED], WED).current, 3);
  assert.equal(computeStreakStats([MON, TUE], THU).current, 0);
});

test('PRD §7.4: non-consecutive history still counts toward total, current reflects latest run', () => {
  const s = computeStreakStats(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-10'], '2026-11-10');
  assert.equal(s.total, 4);
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
});

test('duplicates are ignored and order does not matter', () => {
  const s = computeStreakStats([TUE, MON, TUE, WED], WED);
  assert.equal(s.total, 3);
  assert.equal(s.current, 3);
});

test('not started / scheduled states', () => {
  assert.equal(computeStreakStats([], THU, THU).status, 'not_started');
  assert.equal(computeStreakStats([], THU, MON).status, 'not_started');
  assert.equal(computeStreakStats([], THU, FRI).status, 'scheduled');
  assert.equal(computeStreakStats([], THU).current, 0);
});

test('longest never decreases and is recomputed from records (§9.5)', () => {
  assert.equal(longestRun([]), 0);
  assert.equal(longestRun(['2026-01-01']), 1);
  assert.equal(longestRun(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06']), 3);
  // deleting a record shortens the computed longest correctly
  assert.equal(longestRun(['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06']), 2);
});

test('month and year boundaries, leap day', () => {
  assert.equal(computeStreakStats(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01').current, 3);
  assert.equal(computeStreakStats(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01').current, 3);
  assert.equal(computeStreakStats(['2027-02-28', '2027-03-01'], '2027-03-01').current, 2);
});

test('timezone travel west: a completion dated "tomorrow" is not lost', () => {
  // Completed 20 Nov in Helsinki, then flew to New York where it is still 19 Nov.
  const s = computeStreakStats([WED, THU, FRI], THU);
  assert.equal(s.completedToday, true);
  assert.equal(s.current, 3);
  assert.equal(s.total, 3);
});

test('canCompleteOn window', () => {
  assert.equal(canCompleteOn(THU, THU, MON), true);
  assert.equal(canCompleteOn(FRI, THU, MON), false);
  assert.equal(canCompleteOn('2026-11-15', THU, MON), false);
});
