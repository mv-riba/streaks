/** Create streak (PRD §6). */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useStore } from '../../../src/data/store';
import { deviceTimeZone, todayInTimeZone } from '../../../src/logic/dates';
import { CheckinSettings } from '../../../src/ui/components/CheckinSettings';
import { DateInput } from '../../../src/ui/components/DateTimeInput';
import { Banner, Button, Card, Field, IconButton, Screen } from '../../../src/ui/components/Primitives';
import { colors, space, type } from '../../../src/ui/theme';

const EXAMPLES = ['Read for 20 minutes', 'Go for a run', 'Meditate', 'Drink 2 litres of water', 'Learn a language'];

export default function CreateStreak() {
  const router = useRouter();
  const { create } = useStore();
  const today = todayInTimeZone(deviceTimeZone());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [checkin, setCheckin] = useState({ enabled: false, time: '20:00' }); // opt-in by default (§6.4)
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setNameError('Give your activity a name.');
    if (trimmed.length > 80) return setNameError('Keep it under 80 characters.');
    setBusy(true);
    setError(null);
    try {
      await create({
        name: trimmed,
        description: description.trim() || null,
        start_date: startDate,
        checkin_enabled: checkin.enabled,
        checkin_time: checkin.enabled ? checkin.time : null,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message || 'Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
        <IconButton label="Back" glyph="‹" onPress={() => router.back()} />
        <Text style={[type.title, { marginLeft: space.sm }]} accessibilityRole="header">New streak</Text>
      </View>
      {error ? <Banner tone="warn" text={error} /> : null}
      <Card>
        <Field
          label="Activity"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setNameError(null);
          }}
          placeholder={EXAMPLES[0]}
          maxLength={80}
          error={nameError}
          autoFocus
          returnKeyType="next"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.sm, marginBottom: space.lg }}>
          {EXAMPLES.map((ex) => (
            <Text
              key={ex}
              onPress={() => setName(ex)}
              accessibilityRole="button"
              accessibilityLabel={`Use example: ${ex}`}
              style={[type.small, { backgroundColor: colors.sage, color: colors.forest, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 999, overflow: 'hidden' }]}
            >
              {ex}
            </Text>
          ))}
        </View>
        <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={280} multiline />
        <Text style={[type.label, { marginBottom: space.sm }]}>FREQUENCY</Text>
        <Text style={[type.body, { marginBottom: space.lg }]}>Every day</Text>
        <Text style={[type.label, { marginBottom: space.sm }]}>START DATE</Text>
        <DateInput label="Start date" value={startDate} minimumDate={today} onChange={setStartDate} />
      </Card>
      <Card>
        <CheckinSettings enabled={checkin.enabled} time={checkin.time} onChange={setCheckin} />
      </Card>
      <Button title="Save streak" onPress={save} loading={busy} />
    </Screen>
  );
}
