/** "Daily check-in" configuration block (PRD §6.4), shared by Create and Edit. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { notificationsSupported } from '../../notifications/scheduler';
import { colors, fonts, radius, space, TOUCH, type } from '../theme';
import { TimeInput } from './DateTimeInput';

export function CheckinSettings({
  enabled,
  time,
  onChange,
}: {
  enabled: boolean;
  time: string;
  onChange: (next: { enabled: boolean; time: string }) => void;
}) {
  return (
    <View>
      <Text style={[type.heading, { marginBottom: space.xs }]} accessibilityRole="header">
        Daily check-in
      </Text>
      <Text style={[type.small, { marginBottom: space.lg }]}>
        Would you like us to ask you whether you've completed this activity each day?
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: space.md }}>
        <Choice
          selected={enabled}
          title="Yes, ask me every day"
          subtitle="Answer straight from the notification."
          onPress={() => onChange({ enabled: true, time })}
        />
        {enabled ? (
          <View style={{ paddingLeft: space.md }}>
            <Text style={[type.label, { marginBottom: space.sm }]}>ASK ME AT</Text>
            <TimeInput label="Check-in time" value={time} onChange={(t) => onChange({ enabled: true, time: t })} />
            <Text style={[type.small, { marginTop: space.sm }]}>
              {notificationsSupported
                ? "We'll ask your phone for permission to send this check-in when you save."
                : 'Check-in prompts are delivered by the Streaks app on your phone. In the browser, mark days complete yourself.'}
            </Text>
          </View>
        ) : null}
        <Choice
          selected={!enabled}
          title="No, I'll track it manually"
          subtitle="You can turn check-ins on later."
          onPress={() => onChange({ enabled: false, time })}
        />
      </View>
    </View>
  );
}

function Choice({ selected, title, subtitle, onPress }: { selected: boolean; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={title}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.dot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: colors.forest }}>{title}</Text>
        <Text style={type.small}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    minHeight: TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceSelected: { borderColor: colors.forest, backgroundColor: colors.sage },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.forest },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.forest },
});
