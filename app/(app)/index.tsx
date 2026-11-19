/** Home (PRD §5): daily overview — view and complete only. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { useStore } from '../../src/data/store';
import { greetingForHour } from '../../src/logic/dates';
import { Banner, Button, IconButton, Loading } from '../../src/ui/components/Primitives';
import { StreakCard } from '../../src/ui/components/StreakCard';
import { colors, MAX_CONTENT_WIDTH, radius, space, type } from '../../src/ui/theme';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Home() {
  const router = useRouter();
  const store = useStore();
  const { session } = useAuth();
  const now = useClock();
  const [completing, setCompleting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (store.loading && store.streaks.length === 0 && !store.error) return <Loading />;

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const onComplete = async (id: string) => {
    setCompleting(id);
    try {
      await store.complete(id);
    } finally {
      setCompleting(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await store.refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.column}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={type.title} accessibilityRole="header">
                {greetingForHour(now.getHours())}.
              </Text>
              <Text style={[type.small, { marginTop: space.xs }]}>{dateLabel}</Text>
            </View>
            <IconButton label="Account" glyph={(session?.user.email?.[0] ?? '•').toUpperCase()} onPress={() => router.push('/account')} />
          </View>

          {!store.online ? <Banner text="You're offline. Completions are saved on this device and sync when you reconnect." /> : null}
          {store.error && store.online ? <Banner tone="warn" text="Couldn’t reach the server. Pull down to try again." /> : null}
          {store.notice ? <Banner text={store.notice} onDismiss={() => store.setNotice(null)} /> : null}

          {store.streaks.length === 0 ? (
            <EmptyState onCreate={() => router.push('/streak/new')} />
          ) : (
            <>
              <Text style={[type.heading, { marginBottom: space.xs }]}>Your streaks</Text>
              <Text style={[type.label, { marginBottom: space.lg }]}>TODAY</Text>
              {store.streaks.map((s) => (
                <StreakCard
                  key={s.id}
                  streak={s}
                  stats={store.statsFor(s)}
                  pending={store.isPendingToday(s.id)}
                  completing={completing === s.id}
                  onComplete={() => onComplete(s.id)}
                  onOpen={() => router.push(`/streak/${s.id}`)}
                />
              ))}
              <Button title="Add a new streak" icon="+" variant="ghost" onPress={() => router.push('/streak/new')} />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={styles.dots} importantForAccessibility="no-hide-descendants">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View key={i} style={[styles.dot, i < 4 && { backgroundColor: colors.softGreen }, i === 4 && { borderWidth: 2, borderColor: colors.forest }]} />
        ))}
      </View>
      <Text style={[type.title, { textAlign: 'center' }]} accessibilityRole="header">
        Build a streak. Build a habit.
      </Text>
      <Text style={[type.body, { color: colors.muted, textAlign: 'center', marginTop: space.md, marginBottom: space.xl }]}>
        Start with something small. Track your progress, one day at a time.
      </Text>
      <Button title="Track your first streak" onPress={onCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl * 2, alignItems: 'center' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xl },
  empty: { backgroundColor: colors.sage, borderRadius: radius.lg, padding: space.xl, paddingVertical: space.xxl, marginTop: space.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginBottom: space.xl },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.cream },
});
