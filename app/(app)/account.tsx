/** Account & settings (PRD §3, §4.1). */
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { deviceTimeZone } from '../../src/logic/dates';
import { getPermission, notificationsSupported, type PermissionState } from '../../src/notifications/scheduler';
import { ConfirmDialog } from '../../src/ui/components/ConfirmDialog';
import { Banner, Button, Card, IconButton, Screen } from '../../src/ui/components/Primitives';
import { colors, space, type } from '../../src/ui/theme';

export default function Account() {
  const router = useRouter();
  const { session, signOut, deleteAccount, unsyncedCount } = useAuth();
  const [permission, setPermission] = useState<PermissionState>('unsupported');
  const [dialog, setDialog] = useState<null | 'logout' | 'delete'>(null);
  const [unsynced, setUnsynced] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPermission().then(setPermission);
    }, []),
  );

  const startLogout = async () => {
    const n = await unsyncedCount();
    setUnsynced(n);
    if (n === 0) await signOut();
    else setDialog('logout');
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (e) {
      setError((e as Error).message);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const permissionText: Record<PermissionState, string> = {
    granted: 'Allowed',
    denied: 'Off — enable in device settings to receive check-ins',
    undetermined: 'Not asked yet — we’ll ask when you turn on a check-in',
    unsupported: 'Check-ins are delivered by the Streaks phone app',
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
        <IconButton label="Back" glyph="‹" onPress={() => router.back()} />
        <Text style={[type.title, { marginLeft: space.sm }]} accessibilityRole="header">Account</Text>
      </View>
      {error ? <Banner tone="warn" text={error} /> : null}
      <Card>
        <Row label="Email" value={session?.user.email ?? ''} />
        <Row label="Time zone" value={deviceTimeZone()} />
        <Row label="Notifications" value={permissionText[permission]} />
        {notificationsSupported && permission === 'denied' ? (
          <Button title="Open device settings" variant="secondary" onPress={() => Linking.openSettings()} style={{ marginTop: space.md }} />
        ) : null}
      </Card>
      <Button title="Log out" variant="ghost" onPress={startLogout} />
      <Button title="Delete account" variant="danger" onPress={() => setDialog('delete')} style={{ marginTop: space.md }} />
      <Text style={[type.small, { textAlign: 'center', marginTop: space.xl }]}>Streaks {Constants.expoConfig?.version ?? ''}</Text>

      <ConfirmDialog
        visible={dialog === 'logout'}
        title="Log out now?"
        message={`${unsynced} completion${unsynced === 1 ? ' is' : 's are'} saved only on this device and haven’t synced yet. Logging out will discard ${unsynced === 1 ? 'it' : 'them'}. Reconnect first to keep ${unsynced === 1 ? 'it' : 'them'}.`}
        confirmLabel="Log out anyway"
        destructive
        onConfirm={async () => {
          setDialog(null);
          await signOut();
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        visible={dialog === 'delete'}
        title="Delete your account?"
        message="This permanently deletes your account, all your streaks and their complete history. This can’t be undone."
        confirmLabel="Delete my account"
        destructive
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={type.label}>{label.toUpperCase()}</Text>
      <Text style={[type.body, { marginTop: space.xs, color: colors.forest }]}>{value}</Text>
    </View>
  );
}
