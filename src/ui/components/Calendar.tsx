/** Monthly completion calendar (PRD §7.4). Shows every completion record, not just the current run. */
import { getCalendars, getLocales } from 'expo-localization';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, monthGrid, parseLocalDate, shiftMonth, type LocalDate } from '../../logic/dates';
import { colors, fonts, radius, space, TOUCH, type } from '../theme';

/** 0 = Sunday … 6 = Saturday, from the device's calendar locale. */
function localeFirstWeekday(): number {
  try {
    const fw = getCalendars()[0]?.firstWeekday; // 1 = Sunday … 7 = Saturday
    if (fw && fw >= 1 && fw <= 7) return fw - 1;
  } catch {
    /* ignore */
  }
  return 1;
}

function localeTag(): string | undefined {
  try {
    return getLocales()[0]?.languageTag;
  } catch {
    return undefined;
  }
}

type DayState = 'completed' | 'pending' | 'missed' | 'before' | 'future';

export function Calendar({
  today,
  startDate,
  completed,
  pending,
}: {
  today: LocalDate;
  startDate: LocalDate;
  completed: Set<LocalDate>;
  pending: Set<LocalDate>;
}) {
  const t = parseLocalDate(today);
  const [view, setView] = useState({ year: t.year, month: t.month });
  const firstWeekday = useMemo(localeFirstWeekday, []);
  const locale = useMemo(localeTag, []);
  const weeks = useMemo(() => monthGrid(view.year, view.month, firstWeekday), [view, firstWeekday]);

  const title = new Date(view.year, view.month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  // Weekday labels starting from the locale's first day (2023-01-01 was a Sunday).
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = parseLocalDate(addDays('2023-01-01', (firstWeekday + i) % 7));
    return new Date(d.year, d.month - 1, d.day).toLocaleDateString(locale, { weekday: 'narrow' });
  });

  const stateOf = (d: LocalDate): DayState => {
    if (completed.has(d)) return 'completed'; // always shown, even after a break
    if (pending.has(d)) return 'pending';
    if (d > today) return 'future';
    if (d < startDate) return 'before';
    if (d === today) return 'future'; // today is still open, not missed
    return 'missed';
  };

  const go = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta));
  const isCurrentMonth = view.year === t.year && view.month === t.month;

  return (
    <View>
      <View style={styles.header}>
        <NavButton label="Previous month" glyph="‹" onPress={() => go(-1)} />
        <Pressable
          onPress={() => setView({ year: t.year, month: t.month })}
          accessibilityRole="button"
          accessibilityLabel={isCurrentMonth ? title : `${title}. Go to current month`}
          style={{ flex: 1, alignItems: 'center' }}
        >
          <Text style={type.heading}>{title}</Text>
          {!isCurrentMonth ? <Text style={type.small}>Back to today</Text> : null}
        </Pressable>
        <NavButton label="Next month" glyph="›" onPress={() => go(1)} />
      </View>

      <View style={styles.week}>
        {weekdayLabels.map((l, i) => (
          <Text key={i} style={[styles.cell, styles.weekday]} importantForAccessibility="no">
            {l}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.week}>
          {week.map((d, di) => {
            if (!d) return <View key={di} style={styles.cell} />;
            const s = stateOf(d);
            const isToday = d === today;
            const label = `${new Date(parseLocalDate(d).year, parseLocalDate(d).month - 1, parseLocalDate(d).day).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}: ${
              { completed: 'completed', pending: 'saved, waiting to sync', missed: 'not completed', before: 'before start', future: isToday ? 'today, not yet completed' : 'upcoming' }[s]
            }`;
            return (
              <View key={di} style={styles.cell} accessible accessibilityLabel={label}>
                <View style={[styles.day, dayStyles[s], isToday && styles.today]}>
                  <Text style={[styles.dayText, dayText[s]]}>{parseLocalDate(d).day}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      <View style={styles.legend}>
        <Legend swatch={dayStyles.completed} label="Completed" />
        <Legend swatch={dayStyles.missed} label="Missed" />
        <Legend swatch={{ ...dayStyles.future, borderWidth: 1, borderColor: colors.border }} label="Upcoming" />
      </View>
    </View>
  );
}

function NavButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.nav, pressed && { backgroundColor: colors.sage }]}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: colors.forest }}>{glyph}</Text>
    </Pressable>
  );
}

function Legend({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <View style={[{ width: 14, height: 14, borderRadius: 7 }, swatch]} />
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const dayStyles: Record<DayState, object> = {
  completed: { backgroundColor: colors.softGreen },
  pending: { borderWidth: 2, borderColor: colors.softGreen, borderStyle: 'dashed' },
  missed: { backgroundColor: colors.neutralDay },
  before: {},
  future: { backgroundColor: 'transparent' },
};
const dayText: Record<DayState, object> = {
  completed: { color: colors.white, fontFamily: fonts.bold },
  pending: { color: colors.forest },
  missed: { color: colors.muted },
  before: { color: colors.faint },
  future: { color: colors.faint },
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  nav: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  weekday: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, aspectRatio: undefined, paddingVertical: space.sm },
  day: { width: '82%', aspectRatio: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.forest },
  dayText: { fontFamily: fonts.regular, fontSize: 14 },
  legend: { flexDirection: 'row', gap: space.lg, justifyContent: 'center', marginTop: space.lg, flexWrap: 'wrap' },
});
