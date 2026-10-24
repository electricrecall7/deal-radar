import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CategoryFilter,
  matchesCategoryFilter,
  type CategoryFilterValue,
} from '@/components/category-filter';
import { DealCard } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { EmptyState, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { addDays, nextWeekday, weekday, type YMD } from '@/lib/dates';
import { formatDays, formatShortDate, formatTimeRange, WEEKDAYS_LONG } from '@/lib/format';
import { compareDeals, dealKind, isOver } from '@/lib/occurrences';
import { isDealHidden } from '@/lib/prefs';
import type { Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

interface WeekDay {
  day: YMD;
  dow: number;
  items: { deal: Deal; note: string }[];
}

export default function WeeklyScreen() {
  const { today, deals, prefs, refresh, syncing } = useAppState();
  const [filter, setFilter] = useState<CategoryFilterValue>('all');

  const weekly = useMemo(() => {
    return deals
      .filter((d) => dealKind(d) === 'weekly' && !isOver(d, today) && !isDealHidden(d, prefs))
      .filter((d) => matchesCategoryFilter(d, filter))
      .sort(compareDeals);
  }, [deals, prefs, today, filter]);

  const week = useMemo<WeekDay[]>(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const day = addDays(today, i);
        const dow = weekday(day);
        const items: WeekDay['items'] = [];
        for (const deal of weekly) {
          if (!deal.days?.includes(dow)) continue;
          const note = weeklyNote(deal, day, today);
          if (note) items.push({ deal, note });
        }
        return { day, dow, items };
      }),
    [weekly, today],
  );

  return (
    <Screen title="Weekly" subtitle="Deals that repeat every week" onRefresh={refresh} refreshing={syncing}>
      <CategoryFilter value={filter} onChange={setFilter} />

      {weekly.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No weekly deals yet' : 'No weekly deals for this filter'}
          body={
            filter === 'all'
              ? 'Repeating deals like Taco Tuesday show up here once the weekly search finds them.'
              : 'Try All to see every repeating deal.'
          }
        />
      ) : (
        week.map(({ day, dow, items }) => (
          <View key={day} style={styles.section}>
            <SectionHeader title={dayTitle(day, dow, today)} />
            {items.length > 0 ? (
              items.map(({ deal, note }) => <DealCard key={deal.id} deal={deal} note={note} />)
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing weekly on {WEEKDAYS_LONG[dow]}
              </ThemedText>
            )}
          </View>
        ))
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.tip}>
        Mute a restaurant in Alerts → Restaurants, or tap a deal to choose Always / Never.
      </ThemedText>
    </Screen>
  );
}

function dayTitle(day: YMD, dow: number, today: YMD): string {
  return day === today ? `Today · ${WEEKDAYS_LONG[dow]}` : `${WEEKDAYS_LONG[dow]} · ${formatShortDate(day)}`;
}

/**
 * The line under a weekly deal in one day's section, or null when the deal has no
 * occurrence left on that weekday (its window ends before the next one).
 */
function weeklyNote(d: Deal, day: YMD, today: YMD): string | null {
  const first = d.start > day ? nextWeekday(d.start, weekday(day)) : day;
  if (d.end && first > d.end) return null;
  const isLast = !!d.end && addDays(first, 7) > d.end;

  const parts: string[] = [];
  if (d.days && d.days.length > 1) parts.push(`Every ${formatDays(d.days)}`);
  parts.push(formatTimeRange(d.startTime, d.endTime) || 'All day');
  if (first !== day && isLast) parts.push(`Only ${formatShortDate(first)}`);
  else if (first !== day) parts.push(`Starts ${formatShortDate(first)}`);
  else if (isLast) parts.push(first === today ? 'Last one today' : `Last one ${formatShortDate(first)}`);
  else if (d.end) parts.push(`thru ${formatShortDate(d.end)}`);

  const note = parts.join(' · ');
  return note.charAt(0).toUpperCase() + note.slice(1);
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  tip: { textAlign: 'center', marginTop: Spacing.three },
});
