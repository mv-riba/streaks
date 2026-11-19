/**
 * Edit streak (PRD §7.5). Details and daily check-in are saved independently, so changing
 * the notification never touches the activity details and vice versa. History is never
 * modified here.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useStore } from '../../../../src/data/store';
import { normalizeTime } from '../../../../src/logic/dates';
import { CheckinSettings } from '../../../../src/ui/components/CheckinSettings';
import { Banner, Button, Card, Field, IconButton, Loading, Screen } from '../../../../src/ui/components/Primitives';
import { space, type } from '../../../../src/ui/theme';

export default function EditStreak() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string }>();
  const router = useRouter();
  const store = useStore();
  const streak = store.streaks.find((s) => s.id === id);

  const [name, setName] = useState(streak?.name ?? '');
  const [description, setDescription] = useState(streak?.description ?? '');
  const [checkin, setCheckin] = useState({
    enabled: streak?.checkin_enabled ?? false,
    time: streak?.checkin_time ? normalizeTime(streak.checkin_time) : '20:00',
  });
  const [busy, setBusy] = useState<'details' | 'checkin' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  if (!streak) return store.loading ? <Loading /> : <Screen><Text style={type.title}>This streak isn’t available.</Text></Screen>;

  const saveDetails = async () => {
    if (!name.trim()) return setNameError('Give your activity a name.');
    setBusy('details');
    setMessage(null);
    try {
      await store.updateDetails(streak.id, { name, description: description.trim() || null });
      setMessage({ text: 'Details saved.', tone: 'info' });
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  const saveCheckin = async () => {
    setBusy('checkin');
    setMessage(null);
    try {
      const { permission } = await store.updateCheckin(streak.id, {
        checkin_enabled: checkin.enabled,
        checkin_time: checkin.enabled ? checkin.time : null,
      });
      if (permission === 'denied') store.setNotice(null);
      setMessage(
        permission === 'denied'
          ? { text: 'Saved. Notifications are off for Streaks — allow them in your device settings to get check-ins.', tone: 'warn' }
          : { text: checkin.enabled ? 'Check-in saved. Your history is unchanged.' : 'Check-ins turned off. You can still mark days complete.', tone: 'info' },
      );
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  const details = (
    <Card key="details">
      <Text style={[type.heading, { marginBottom: space.lg }]}>Activity</Text>
      <Field label="Name" value={name} onChangeText={(t) => { setName(t); setNameError(null); }} maxLength={80} error={nameError} />
      <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={280} multiline />
      <Button title="Save details" onPress={saveDetails} loading={busy === 'details'} disabled={busy !== null} />
    </Card>
  );
  const checkinCard = (
    <Card key="checkin">
      <CheckinSettings enabled={checkin.enabled} time={checkin.time} onChange={setCheckin} />
      <Button title="Save check-in" onPress={saveCheckin} loading={busy === 'checkin'} disabled={busy !== null} style={{ marginTop: space.xl }} />
    </Card>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
        <IconButton label="Back" glyph="‹" onPress={() => router.back()} />
        <Text style={[type.title, { marginLeft: space.sm, flex: 1 }]} numberOfLines={1} accessibilityRole="header">
          Edit streak
        </Text>
      </View>
      {message ? <Banner text={message.text} tone={message.tone} onDismiss={() => setMessage(null)} /> : null}
      {section === 'checkin' ? [checkinCard, details] : [details, checkinCard]}
    </Screen>
  );
}
