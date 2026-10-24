import { router } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { openDeal } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { Badge, Card, Divider, EmptyState, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, hhmmFromMinutes, todayYMD, type YMD } from '@/lib/dates';
import { formatDay, formatTime } from '@/lib/format';
import { CATEGORY_META } from '@/lib/meta';
import {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_MAX_REMINDERS,
  IOS_PENDING_LIMIT,
  planReminders,
  type Reminder,
  type ReminderKind,
} from '@/lib/reminders';
import type { Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

type Theme = ReturnType<typeof useTheme>;

const KIND_LABEL: Record<ReminderKind, string> = {
  today: 'Deal day',
  starts: 'Starts',
  ending: 'Ending soon',
  'last-day': 'Last day',
  digest: 'Morning digest',
  'heads-up': 'Heads-up',
  credits: 'Card credits',
  'week-preview': 'Week preview',
  refresh: 'New deals',
};

function kindColor(kind: ReminderKind, theme: Theme, deal?: Deal): string {
  switch (kind) {
    case 'heads-up':
      return theme.tint;
    case 'last-day':
      return theme.danger;
    case 'ending':
      return theme.warning;
    case 'starts':
      return theme.success;
    case 'credits':
      return CATEGORY_META.card.color;
    case 'today':
      return deal ? CATEGORY_META[deal.category].color : theme.tint;
    default:
      return theme.textSecondary;
  }
}

function dayLabel(day: YMD, today: YMD): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return formatDay(day);
}

/** Where tapping a reminder goes, mirroring what tapping the real notification does. */
function targetOf(r: Reminder): (() => void) | undefined {
  const { dealId } = r;
  if (dealId) return () => openDeal(dealId);
  if (r.kind === 'credits') return () => router.navigate('/cards');
  if (r.kind === 'week-preview') return () => router.navigate('/week');
  return undefined;
}

export default function ScheduledScreen() {
  const { deals, file, prefs, used, permission, scheduledCount } = useAppState();

  const { today, groups, total } = useMemo(() => {
    const now = new Date();
    const list = planReminders({ deals, benefits: file.benefits, cards: file.cards, prefs, used, now });
    // planReminders sorts by fire time, so each day's reminders are already contiguous.
    const byDay: { day: YMD; items: Reminder[] }[] = [];
    for (const r of list) {
      const last = byDay[byDay.length - 1];
      if (last && last.day === r.day) last.items.push(r);
      else byDay.push({ day: r.day, items: [r] });
    }
    return { today: todayYMD(now), groups: byDay, total: list.length };
  }, [deals, file.benefits, file.cards, prefs, used]);

  let queued: string;
  if (permission === 'unsupported') queued = 'Preview only — browsers don’t get these reminders.';
  else if (permission === 'granted') queued = `Queued on device right now: ${scheduledCount ?? '—'}`;
  else queued = 'Notifications aren’t allowed on this phone yet, so nothing is queued. Turn them on in Alerts.';

  return (
    <Screen tabScreen={false}>
      <View style={styles.intro}>
        <ThemedText type="small" themeColor="textSecondary">
          Deal Radar rebuilds this list every time you open the app. iPhones hold {IOS_PENDING_LIMIT} pending
          reminders, so it keeps the next {DEFAULT_MAX_REMINDERS}.
        </ThemedText>
        <ThemedText type="smallBold">{queued}</ThemedText>
        {total ? (
          <ThemedText type="small" themeColor="textSecondary">
            {total === 1 ? '1 reminder' : `${total} reminders`} planned over the next {DEFAULT_HORIZON_DAYS}{' '}
            days.
          </ThemedText>
        ) : null}
      </View>

      {groups.length === 0 ? (
        prefs.notificationsEnabled ? (
          <EmptyState
            title="Nothing coming up"
            body={
              `No reminders in the next ${DEFAULT_HORIZON_DAYS} days. ` +
              'Check your categories and restaurants in Alerts.'
            }
          />
        ) : (
          <EmptyState
            title="Reminders are turned off"
            body="Switch on Deal reminders in the Alerts tab to get pings for the deals you follow."
          />
        )
      ) : (
        groups.map((g) => {
          const label = dayLabel(g.day, today);
          const count = g.items.length === 1 ? '1 reminder' : `${g.items.length} reminders`;
          const detail = label === formatDay(g.day) ? count : `${formatDay(g.day)} · ${count}`;
          return (
            <Fragment key={g.day}>
              <SectionHeader title={label} detail={detail} />
              <Card>
                {g.items.map((r, i) => (
                  <Fragment key={r.id}>
                    {i > 0 ? <Divider /> : null}
                    <ReminderRow reminder={r} />
                  </Fragment>
                ))}
              </Card>
            </Fragment>
          );
        })
      )}
    </Screen>
  );
}

function ReminderRow({ reminder: r }: { reminder: Reminder }) {
  const theme = useTheme();
  const { getDeal } = useAppState();
  const deal = r.dealId ? getDeal(r.dealId) : undefined;
  const time = formatTime(hhmmFromMinutes(r.fireAt.getHours() * 60 + r.fireAt.getMinutes()));
  const onPress = targetOf(r);

  const body = (
    <View style={styles.row}>
      <View style={styles.top}>
        <ThemedText type="smallBold">{time}</ThemedText>
        <Badge label={KIND_LABEL[r.kind]} color={kindColor(r.kind, theme, deal)} />
        <View style={styles.fill} />
        {onPress ? (
          <ThemedText type="smallBold" themeColor="textSecondary">
            ›
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="default">{r.title}</ThemedText>
      {r.body ? (
        <ThemedText type="small" themeColor="textSecondary">
          {r.body}
        </ThemedText>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.75 },
  intro: { gap: Spacing.one },
  row: { gap: Spacing.half, paddingVertical: Spacing.half },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
