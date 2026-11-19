/** Home screen card (PRD §5.4). View + complete only — no editing controls (§5.7). */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTimeLabel } from '../../logic/dates';
import type { StreakStats } from '../../logic/streaks';
import type { Streak } from '../../data/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Button } from './Primitives';

export const daysLabel = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function statusText(stats: StreakStats, pending: boolean): string {
  if (pending) return 'Saved on this device · will sync when online';
  switch (stats.status) {
    case 'completed_today':
      return 'Completed today';
    case 'ongoing':
      return 'Ongoing · today is still open';
    case 'broken':
      return 'Fresh start — today can be day one.';
    case 'not_started':
      return 'Ready when you are — today can be day one.';
    case 'scheduled':
      return 'Starts soon';
  }
}

export function StreakCard({
  streak,
  stats,
  pending,
  completing,
  onComplete,
  onOpen,
}: {
  streak: Streak;
  stats: StreakStats;
  pending: boolean;
  completing: boolean;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const done = stats.completedToday || pending;
  const scale = useRef(new Animated.Value(1)).current;
  const prevDone = useRef(done);
  useEffect(() => {
    if (done && !prevDone.current) {
      // Subtle celebration on completion (§12.5)
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.03, duration: 140, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    }
    prevDone.current = done;
  }, [done, scale]);

  const checkin = streak.checkin_enabled && streak.checkin_time ? `Daily check-in · ${formatTimeLabel(streak.checkin_time)}` : 'No daily check-in';

  return (
    <Animated.View style={[styles.card, done && styles.cardDone, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${streak.name}. Current streak ${daysLabel(stats.current)}. ${statusText(stats, pending)}. Open details.`}
        onPress={onOpen}
        style={{ paddingBottom: space.md }}
      >
        <View style={styles.row}>
          <Text style={[type.heading, { flex: 1 }]} numberOfLines={2}>
            {streak.name}
          </Text>
          <Text style={[type.body, { color: colors.muted }]}>›</Text>
        </View>
        <Text style={[type.display, { marginTop: space.sm }]}>{daysLabel(stats.current)}</Text>
        <Text style={[type.small, { marginTop: space.xs }]}>{checkin}</Text>
        <Text style={[styles.status, stats.status === 'broken' && !pending && { color: '#8A5A44' }]}>{statusText(stats, pending)}</Text>
      </Pressable>
      {done ? (
        <View style={styles.donePill} accessibilityLabel={pending ? 'Saved, waiting to sync' : 'Completed today'}>
          <Text style={styles.doneText}>{pending ? '◌  Saved' : '✓  Completed today'}</Text>
        </View>
      ) : stats.status === 'scheduled' ? null : (
        <Button title="Mark complete" icon="✓" onPress={onComplete} loading={completing} accessibilityLabel={`Mark ${streak.name} complete for today`} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.lg,
  },
  cardDone: { backgroundColor: colors.sage, borderColor: colors.softGreen },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  status: { fontFamily: fonts.medium, fontSize: 14, color: colors.forest, marginTop: space.sm },
  donePill: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.softGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: fonts.medium, fontSize: 16, color: colors.white },
});
