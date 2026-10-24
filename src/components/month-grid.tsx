import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysInMonth, firstOfMonth, pad2, weekday, type YMD } from '@/lib/dates';
import { formatLongDay, WEEKDAYS_SHORT } from '@/lib/format';

import { ThemedText } from './themed-text';

export interface DayMark {
  /** Distinct category colors of the deals marked on this day. */
  colors: string[];
  count: number;
  /** An unused card credit resets at the end of this day. */
  credit: boolean;
}

const MAX_DOTS = 3;

/** Sun-first month calendar; cells flex so seven fit on the narrowest phone. */
export function MonthGrid({
  year,
  month,
  today,
  selected,
  onSelect,
  marks,
}: {
  year: number;
  /** 1-12 */
  month: number;
  today: YMD;
  selected: YMD;
  onSelect: (day: YMD) => void;
  marks: Record<YMD, DayMark>;
}) {
  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {WEEKDAYS_SHORT.map((w) => (
          <ThemedText key={w} type="tiny" themeColor="textSecondary" style={styles.weekday}>
            {w}
          </ThemedText>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week.find(Boolean)} style={styles.row}>
          {week.map((day, i) =>
            day ? (
              <DayCell
                key={day}
                day={day}
                mark={marks[day]}
                isToday={day === today}
                isPast={day < today}
                isSelected={day === selected}
                onSelect={onSelect}
              />
            ) : (
              <View key={`empty-${i}`} style={styles.cell} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function DayCell({
  day,
  mark,
  isToday,
  isPast,
  isSelected,
  onSelect,
}: {
  day: YMD;
  mark?: DayMark;
  isToday: boolean;
  isPast: boolean;
  isSelected: boolean;
  onSelect: (day: YMD) => void;
}) {
  const theme = useTheme();
  const count = mark?.count ?? 0;
  const dots = mark?.colors.slice(0, MAX_DOTS) ?? [];
  const extra = count > MAX_DOTS ? count - dots.length : 0;
  const label =
    `${formatLongDay(day)}, ${count === 0 ? 'no deals' : `${count} deal${count === 1 ? '' : 's'}`}` +
    (mark?.credit ? ', card credit resets' : '') +
    (isToday ? ', today' : '');

  return (
    <Pressable
      onPress={() => onSelect(day)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      style={({ pressed }) => [
        styles.cell,
        styles.day,
        { borderColor: isToday ? theme.tint : 'transparent' },
        isSelected && { backgroundColor: theme.tintSoft },
        pressed && styles.pressed,
      ]}>
      <ThemedText
        type={isToday || isSelected ? 'smallBold' : 'small'}
        themeColor={isToday ? 'tint' : isPast ? 'textSecondary' : 'text'}
        style={styles.number}>
        {Number(day.slice(8))}
      </ThemedText>
      <View style={styles.dots}>
        {dots.map((c) => (
          <View key={c} style={[styles.dot, { backgroundColor: c }]} />
        ))}
        {extra > 0 ? (
          <ThemedText type="tiny" themeColor="textSecondary" style={styles.more}>
            +{extra}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.creditSlot}>
        {mark?.credit ? <ThemedText style={styles.credit}>💳</ThemedText> : null}
      </View>
    </Pressable>
  );
}

/** Rows of seven, padded with nulls before the 1st and after the last day. */
function buildWeeks(year: number, month: number): (YMD | null)[][] {
  const cells: (YMD | null)[] = Array.from({ length: weekday(firstOfMonth(year, month)) }, () => null);
  const n = daysInMonth(year, month);
  for (let d = 1; d <= n; d++) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (YMD | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.half },
  row: { flexDirection: 'row', gap: Spacing.half },
  weekday: { flex: 1, textAlign: 'center', paddingBottom: Spacing.one },
  cell: { flex: 1, minWidth: 0, minHeight: 46 },
  day: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    paddingTop: 3,
    paddingBottom: 2,
    gap: 1,
  },
  pressed: { opacity: 0.75 },
  number: { lineHeight: 18 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  more: { fontSize: 9, lineHeight: 10 },
  creditSlot: { height: 11, justifyContent: 'center' },
  credit: { fontSize: 9, lineHeight: 11 },
});
