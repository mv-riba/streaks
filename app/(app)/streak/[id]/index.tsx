/** Streak detail (PRD §7): stats, calendar, and the only place to edit. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useStore } from '../../../../src/data/store';
import { formatTimeLabel } from '../../../../src/logic/dates';
import { Calendar } from '../../../../src/ui/components/Calendar';
import { ConfirmDialog } from '../../../../src/ui/components/ConfirmDialog';
import { OverflowMenu } from '../../../../src/ui/components/Menu';
import { Banner, Button, Card, IconButton, Loading, Screen } from '../../../../src/ui/components/Primitives';
import { StatCard } from '../../../../src/ui/components/StatCard';
import { daysLabel, statusText } from '../../../../src/ui/components/StreakCard';
import { colors, space, type } from '../../../../src/ui/theme';

export default function StreakDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const store = useStore();
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streak = store.streaks.find((s) => s.id === id);
  if (!streak) {
    if (store.loading) return <Loading />;
    return (
      <Screen>
        <IconButton label="Back" glyph="‹" onPress={() => router.replace('/')} />
        <Text style={[type.title, { marginTop: space.xl }]}>This streak isn’t available.</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: space.sm }]}>It may have been archived or deleted.</Text>
      </Screen>
    );
  }

  const stats = store.statsFor(streak);
  const pendingToday = store.isPendingToday(streak.id);
  const done = stats.completedToday || pendingToday;

  const act = async (kind: 'archive' | 'delete') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'archive') await store.archive(streak.id);
      else await store.remove(streak.id);
      setConfirm(null);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton label="Back to your streaks" glyph="‹" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <OverflowMenu
          items={[
            { label: 'Edit name & description', onPress: () => router.push(`/streak/${streak.id}/edit?section=details`) },
            { label: 'Daily check-in settings', onPress: () => router.push(`/streak/${streak.id}/edit?section=checkin`) },
            { label: 'Archive streak', onPress: () => setConfirm('archive') },
            { label: 'Delete streak', onPress: () => setConfirm('delete'), destructive: true },
          ]}
        />
      </View>

      <Text style={[type.label, { marginTop: space.md }]} numberOfLines={1}>
        MY STREAKS / {streak.name.toUpperCase()}
      </Text>
      <Text style={[type.title, { marginTop: space.xs }]} accessibilityRole="header">{streak.name}</Text>
      {streak.description ? <Text style={[type.body, { color: colors.muted, marginTop: space.xs }]}>{streak.description}</Text> : null}
      <Text style={[type.small, { marginTop: space.sm, marginBottom: space.lg }]}>
        {streak.checkin_enabled && streak.checkin_time ? `Daily check-in · ${formatTimeLabel(streak.checkin_time)}` : 'No daily check-in'}
      </Text>

      {error ? <Banner tone="warn" text={error} /> : null}
      {store.notice ? <Banner text={store.notice} onDismiss={() => store.setNotice(null)} /> : null}

      <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
        <StatCard value={daysLabel(stats.current)} label="Current streak" emphasis />
      </View>
      <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.lg }}>
        <StatCard value={String(stats.longest)} label="Longest streak" />
        <StatCard value={String(stats.total)} label="Total completed days" />
      </View>

      <Text style={[type.body, { marginBottom: space.md }]}>{statusText(stats, pendingToday)}</Text>
      {!done && stats.status !== 'scheduled' ? (
        <Button
          title="Mark complete"
          icon="✓"
          loading={completing}
          style={{ marginBottom: space.lg }}
          onPress={async () => {
            setCompleting(true);
            try {
              await store.complete(streak.id);
            } finally {
              setCompleting(false);
            }
          }}
        />
      ) : null}

      <Card>
        <Calendar today={store.today} startDate={streak.start_date} completed={store.completedDates(streak.id)} pending={store.pendingDates(streak.id)} />
      </Card>

      <ConfirmDialog
        visible={confirm === 'archive'}
        title="Archive this streak?"
        message="It will leave your Home screen and stop daily check-ins. Its history is kept."
        confirmLabel="Archive"
        busy={busy}
        onConfirm={() => act('archive')}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'delete'}
        title="Delete permanently?"
        message={`This removes “${streak.name}” and all ${stats.total} completed days. This can’t be undone. If you just want to stop tracking it, archive it instead.`}
        confirmLabel="Delete forever"
        destructive
        busy={busy}
        onConfirm={() => act('delete')}
        onCancel={() => setConfirm(null)}
      />
    </Screen>
  );
}
