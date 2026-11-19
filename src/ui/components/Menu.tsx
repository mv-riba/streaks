/** Top-right ⋯ menu for the streak detail page (PRD §7.5). */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space, TOUCH } from '../theme';
import { IconButton } from './Primitives';

export interface MenuItem {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function OverflowMenu({ items, label = 'Streak settings' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={label} glyph="⋯" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu">
          <View style={styles.menu} accessibilityRole="menu">
            {items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.sage }]}
              >
                <Text style={[styles.text, item.destructive && { color: colors.danger }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(52,75,58,0.15)', alignItems: 'flex-end', paddingTop: 64, paddingRight: space.lg },
  menu: { backgroundColor: colors.cream, borderRadius: radius.md, paddingVertical: space.sm, minWidth: 240, borderWidth: 1, borderColor: colors.border },
  item: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.lg },
  text: { fontFamily: fonts.medium, fontSize: 16, color: colors.forest },
});
