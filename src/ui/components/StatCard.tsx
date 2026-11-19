import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

export function StatCard({ value, label, emphasis }: { value: string; label: string; emphasis?: boolean }) {
  return (
    <View style={[styles.card, emphasis && styles.emphasis]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={emphasis ? type.display : type.stat}>{value}</Text>
      <Text style={[type.small, { marginTop: space.xs }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  emphasis: { backgroundColor: colors.sage, borderColor: colors.softGreen },
});
