import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { Button } from './Primitives';

/** Cross-platform confirmation (RN's Alert does nothing on web). */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Close dialog">
        <Pressable style={styles.sheet} accessibilityRole="none" onPress={() => undefined}>
          <Text style={[type.heading, { marginBottom: space.sm }]} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[type.body, { color: colors.muted, marginBottom: space.xl }]}>{message}</Text>
          <View style={{ gap: space.md }}>
            <Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} loading={busy} />
            <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(52,75,58,0.35)', justifyContent: 'center', padding: space.xl },
  sheet: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: space.xl,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
});
