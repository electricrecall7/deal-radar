// Form building blocks for the deal editor: a themed text input, a labeled field,
// and date / time fields that accept typed values plus quick picks.
import type { ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, daysInMonth, lastOfMonth, pad2, ymdParts, type YMD } from '@/lib/dates';
import { formatDay, formatTime } from '@/lib/format';

import { ThemedText } from './themed-text';
import { Chip } from './ui';

// Android's number pads have no '-' or ':', so only iOS gets the narrower keyboard.
const NUMERIC_KEYBOARD: TextInputProps['keyboardType'] = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

/** '2026-10-27', '2026-10-7' or '20261027' -> '2026-10-27'; null when it isn't a real day. */
export function parseDateInput(text: string): YMD | null {
  const s = text.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** '13:00', '9:30' or '0930' -> 'HH:MM'; null when it isn't a valid 24-hour time. */
export function parseTimeInput(text: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

export function FormInput({ style, invalid = false, multiline, ...rest }: TextInputProps & { invalid?: boolean }) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      selectionColor={theme.tint}
      multiline={multiline}
      {...rest}
      style={[
        styles.input,
        multiline && styles.multiline,
        {
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderColor: invalid ? theme.danger : theme.border,
        },
        style,
      ]}
    />
  );
}

/** Label, control, then either the error (in red) or a muted hint. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {children}
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function DateField({
  label,
  value,
  onChangeText,
  today,
  anchor,
  allowEmpty = false,
  error,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  today: YMD;
  /** Where "+1 week" and "End of month" count from (the start date, for an end date). Defaults to today. */
  anchor?: YMD | null;
  /** Adds a "No end date" pick; an empty value then means the deal has no end. */
  allowEmpty?: boolean;
  error?: string;
  onBlur?: () => void;
}) {
  const base = anchor ?? today;
  const { y, m } = ymdParts(base);
  const quick = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: '+1 week', value: addDays(base, 7) },
    { label: 'End of month', value: lastOfMonth(y, m) },
    ...(allowEmpty ? [{ label: 'No end date', value: '' }] : []),
  ];
  const parsed = parseDateInput(value);
  const current = parsed ?? value.trim();
  const hint = parsed ? formatDay(parsed) : !value.trim() && allowEmpty ? 'No end date' : 'YYYY-MM-DD';

  return (
    <Field label={label} hint={hint} error={error}>
      <FormInput
        value={value}
        onChangeText={onChangeText}
        placeholder={allowEmpty ? 'YYYY-MM-DD or leave empty' : 'YYYY-MM-DD'}
        keyboardType={NUMERIC_KEYBOARD}
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={10}
        invalid={!!error}
        accessibilityLabel={label}
        onBlur={() => {
          if (parsed && parsed !== value) onChangeText(parsed);
          onBlur?.();
        }}
      />
      <View style={styles.wrap}>
        {quick.map((q) => (
          <Chip key={q.label} label={q.label} selected={current === q.value} onPress={() => onChangeText(q.value)} />
        ))}
      </View>
    </Field>
  );
}

export function TimeField({
  label,
  value,
  onChangeText,
  error,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  onBlur?: () => void;
}) {
  const parsed = parseTimeInput(value);
  const hint = parsed ? formatTime(parsed) : value.trim() ? '24-hour HH:MM' : 'Optional, 24-hour';
  return (
    <Field label={label} hint={hint} error={error}>
      <FormInput
        value={value}
        onChangeText={onChangeText}
        placeholder="HH:MM"
        keyboardType={NUMERIC_KEYBOARD}
        autoCorrect={false}
        maxLength={5}
        invalid={!!error}
        accessibilityLabel={label}
        onBlur={() => {
          if (parsed && parsed !== value) onChangeText(parsed);
          onBlur?.();
        }}
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one + 2 },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 44,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
