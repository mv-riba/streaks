/**
 * Native date/time picker on Android/iOS, HTML input on web. Values are plain strings:
 * date 'YYYY-MM-DD', time 'HH:MM' — no timezone conversion anywhere.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatLocalDate, formatTimeLabel, parseLocalDate, type LocalDate } from '../../logic/dates';
import { colors, fonts, radius, space, TOUCH, type } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');

export function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'time',
      value,
      'aria-label': label,
      onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
      style: webInputStyle,
    });
  }
  const [h, m] = value.split(':').map(Number);
  const asDate = new Date(2000, 0, 1, h ?? 20, m ?? 0);
  const handle = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };
  if (Platform.OS === 'ios') {
    return <DateTimePicker value={asDate} mode="time" display="spinner" onChange={handle} accessibilityLabel={label} />;
  }
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${formatTimeLabel(value)}`} onPress={() => setOpen(true)} style={styles.field}>
        <Text style={styles.value}>{formatTimeLabel(value)}</Text>
        <Text style={type.small}>Change</Text>
      </Pressable>
      {open ? <DateTimePicker value={asDate} mode="time" onChange={handle} /> : null}
    </View>
  );
}

export function DateInput({
  value,
  onChange,
  minimumDate,
  label,
}: {
  value: LocalDate;
  onChange: (v: LocalDate) => void;
  minimumDate: LocalDate;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value,
      min: minimumDate,
      'aria-label': label,
      onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
      style: webInputStyle,
    });
  }
  const p = parseLocalDate(value);
  const min = parseLocalDate(minimumDate);
  const handle = (e: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (e.type === 'set' && d) onChange(formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  };
  const pretty = new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${pretty}`} onPress={() => setOpen(true)} style={styles.field}>
        <Text style={styles.value}>{value === minimumDate ? `Today · ${pretty}` : pretty}</Text>
        <Text style={type.small}>Change</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={new Date(p.year, p.month - 1, p.day)}
          minimumDate={new Date(min.year, min.month - 1, min.day)}
          mode="date"
          onChange={handle}
        />
      ) : null}
    </View>
  );
}

const webInputStyle: React.CSSProperties = {
  minHeight: TOUCH,
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surface,
  padding: `0 ${space.lg}px`,
  fontFamily: fonts.regular,
  fontSize: 16,
  color: colors.forest,
  width: '100%',
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
  field: {
    minHeight: TOUCH,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: { fontFamily: fonts.medium, fontSize: 16, color: colors.forest },
});
