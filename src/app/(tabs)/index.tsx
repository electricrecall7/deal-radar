import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CategoryFilter,
  matchesCategoryFilter,
  type CategoryFilterValue,
} from '@/components/category-filter';
import { DealCard } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Screen, SectionHeader } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { benefitDaysLeft, isBenefitUsed, type UsedCredits } from '@/lib/benefits';
import { benefitAppliesToUser } from '@/lib/card-variants';
import { addDays, diffDays, toYMD, weekday, type YMD } from '@/lib/dates';
import {
  daysLeftLabel,
  formatLongDay,
  formatShortDate,
  formatTimeRange,
  relativeDay,
  WEEKDAYS_SHORT,
} from '@/lib/format';
import { CARD_META, CHANNEL_LABEL } from '@/lib/meta';
import { compareDeals, dealKind, isOver, LONG_PROMO_DAYS, occursOn, spanDays } from '@/lib/occurrences';
import { wantsBenefit, type Prefs } from '@/lib/prefs';
import type { Benefit, CardInfo, Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

const ENDING_SOON_DAYS = 3;
const CREDIT_WARN_DAYS = 5;
const COMING_UP_DAYS = 7;
const NEW_WINDOW_DAYS = 7;
const NEW_PREVIEW = 6;

type PerkGroup = 'birthday' | 'signup' | 'other';
const PERK_LABEL: Record<PerkGroup, string> = {
  birthday: 'Birthday treats',
  signup: 'Sign-up rewards',
  other: 'Other perks',
};

interface TodaySections {
  ending: Deal[];
  happening: Deal[];
  /** Long promos that started earlier and aren't ending soon; folded away so today's list stays short. */
  alsoRunning: Deal[];
  comingUp: { day: YMD; deals: Deal[] }[];
  fresh: Deal[];
  perks: { group: PerkGroup; deals: Deal[] }[];
  perkCount: number;
}

interface CreditRow {
  benefit: Benefit;
  left: number;
  used: boolean;
}

export default function TodayScreen() {
  const theme = useTheme();
  const {
    today,
    file,
    deals,
    prefs,
    used,
    sync,
    syncing,
    permission,
    refresh,
    requestNotifications,
    setBenefitUsed,
  } = useAppState();

  const [filter, setFilter] = useState<CategoryFilterValue>('all');
  const [alsoOpen, setAlsoOpen] = useState(false);
  const [newAll, setNewAll] = useState(false);
  const [newPinned, setNewPinned] = useState(false);
  const [perksOpen, setPerksOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // Credits marked used from this screen stay put with an Undo until the screen remounts.
  const [justUsed, setJustUsed] = useState<string[]>([]);

  const unhidden = useMemo(() => {
    const hidden = new Set(prefs.hiddenDeals);
    return deals.filter((d) => !hidden.has(d.id));
  }, [deals, prefs.hiddenDeals]);

  const visible = useMemo(() => unhidden.filter((d) => matchesCategoryFilter(d, filter)), [unhidden, filter]);
  const sections = useMemo(() => buildSections(visible, today, sync.newIds), [visible, today, sync.newIds]);

  const activeCount = useMemo(() => unhidden.filter((d) => !isOver(d, today)).length, [unhidden, today]);
  const newCount = useMemo(() => {
    const ids = new Set(sync.newIds ?? []);
    return unhidden.filter((d) => ids.has(d.id) && !isOver(d, today)).length;
  }, [unhidden, sync.newIds, today]);

  const showCredits = filter === 'all' || filter === 'card';
  const credits = useMemo(
    () => (showCredits ? creditRows(file.benefits, file.cards, prefs, used, today, justUsed) : []),
    [showCredits, file.benefits, file.cards, prefs, used, today, justUsed],
  );

  const { ending, happening, alsoRunning, comingUp, fresh, perks, perkCount } = sections;
  const lists = [ending, credits, happening, alsoRunning, comingUp, fresh];
  const nothing = perkCount === 0 && lists.every((l) => l.length === 0);
  const updated = updatedDay(file.updatedAt);
  const denied = permission === 'denied';

  const enableReminders = async () => {
    if (denied) {
      Linking.openSettings().catch(() => undefined);
      return;
    }
    setRequesting(true);
    try {
      await requestNotifications();
    } finally {
      setRequesting(false);
    }
  };

  const toggleNewPinned = () => {
    if (!newPinned) setFilter('all');
    setNewPinned(!newPinned);
  };

  const markUsed = (b: Benefit) => {
    setBenefitUsed(b, true);
    setJustUsed((ids) => (ids.includes(b.id) ? ids : [...ids, b.id]));
  };
  const undoUsed = (b: Benefit) => {
    setBenefitUsed(b, false);
    setJustUsed((ids) => ids.filter((id) => id !== b.id));
  };

  const freshShown = newPinned || newAll ? fresh : fresh.slice(0, NEW_PREVIEW);
  const newSection =
    fresh.length > 0 ? (
      <View style={styles.section}>
        <SectionHeader
          title="New this week"
          detail={`${fresh.length} added in the last ${NEW_WINDOW_DAYS} days`}
        />
        {freshShown.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
        {!newPinned && fresh.length > NEW_PREVIEW ? (
          <Disclosure
            label={newAll ? 'Show fewer' : `Show all ${fresh.length}`}
            open={newAll}
            onPress={() => setNewAll(!newAll)}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <Screen
      title="Today"
      subtitle={`${formatLongDay(today)} · San Antonio`}
      onRefresh={refresh}
      refreshing={syncing}
      right={<Button label="+ Add" small onPress={() => router.push('/deal/edit')} />}>
      <View>
        <ThemedText type="small" themeColor="textSecondary">
          {updated ? `List updated ${formatShortDate(updated)}` : 'Saved list'} · {activeCount}{' '}
          {activeCount === 1 ? 'deal' : 'deals'}
          {syncing ? ' · checking…' : ''}
        </ThemedText>
        {sync.error ? (
          <ThemedText type="small" themeColor="warning">
            Couldn’t check for new deals — showing your saved list
          </ThemedText>
        ) : null}
      </View>

      {permission === 'undetermined' || denied ? (
        <Card>
          <ThemedText type="heading">{denied ? 'Reminders are blocked' : 'Turn on reminders'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {denied
              ? 'Notifications are off for Deal Radar. Turn them on in your phone’s Settings to get deal ' +
                'and credit reminders.'
              : 'Get a heads-up the morning of a deal, before timed drops, and before card credits reset. ' +
                'You pick what in Alerts.'}
          </ThemedText>
          <View style={styles.start}>
            <Button
              label={denied ? 'Open Settings' : 'Turn on reminders'}
              small
              disabled={requesting}
              onPress={enableReminders}
            />
          </View>
        </Card>
      ) : null}

      {newCount > 0 ? (
        <Pressable
          onPress={toggleNewPinned}
          accessibilityRole="button"
          accessibilityState={{ expanded: newPinned }}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: theme.tintSoft, borderColor: theme.tint },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={[styles.fill, { color: theme.tint }]}>
            ✨ {newCount} new {newCount === 1 ? 'deal' : 'deals'} found this week
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {newPinned ? 'Hide' : 'See them'}
          </ThemedText>
        </Pressable>
      ) : null}

      <CategoryFilter value={filter} onChange={setFilter} />

      {newPinned ? newSection : null}

      {ending.length > 0 || credits.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Ending soon" />
          {ending.map((d) => (
            <DealCard key={d.id} deal={d} note={endingNote(d, today)} />
          ))}
          {credits.map((row) => (
            <CreditCard
              key={row.benefit.id}
              row={row}
              onMark={() => markUsed(row.benefit)}
              onUndo={() => undoUsed(row.benefit)}
            />
          ))}
        </View>
      ) : null}

      {happening.length > 0 || alsoRunning.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Happening today" />
          {happening.map((d) => (
            <DealCard key={d.id} deal={d} note={happeningNote(d, today)} />
          ))}
          {alsoRunning.length > 0 ? (
            <Disclosure
              label={`Also running (${alsoRunning.length})`}
              open={alsoOpen}
              onPress={() => setAlsoOpen(!alsoOpen)}
            />
          ) : null}
          {alsoOpen ? alsoRunning.map((d) => <DealCard key={d.id} deal={d} />) : null}
        </View>
      ) : null}

      {comingUp.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Coming up" detail={`Starting in the next ${COMING_UP_DAYS} days`} />
          {comingUp.map(({ day, deals: list }) => (
            <View key={day} style={styles.group}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {dayHeading(day, today)}
              </ThemedText>
              {list.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {newPinned ? null : newSection}

      {perkCount > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Always on" detail="Sign-up and birthday perks, any day" />
          <Disclosure
            label={perksOpen ? 'Hide perks' : `Show ${perkCount} ${perkCount === 1 ? 'perk' : 'perks'}`}
            open={perksOpen}
            onPress={() => setPerksOpen(!perksOpen)}
          />
          {perksOpen
            ? perks.map(({ group, deals: list }) => (
                <View key={group} style={styles.group}>
                  {perks.length > 1 ? (
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {PERK_LABEL[group]}
                    </ThemedText>
                  ) : null}
                  {list.map((d) => (
                    <DealCard key={d.id} deal={d} note={perkNote(d, today)} />
                  ))}
                </View>
              ))
            : null}
        </View>
      ) : null}

      {nothing ? (
        filter === 'all' ? (
          <EmptyState
            title="No deals right now"
            body="Pull down to check for new ones, or tap + Add to save one you found."
          />
        ) : (
          <EmptyState
            title="Nothing for this filter right now"
            body="Try All, or pull down to check for new deals."
          />
        )
      ) : null}
    </Screen>
  );
}

function CreditCard({ row, onMark, onUndo }: { row: CreditRow; onMark: () => void; onUndo: () => void }) {
  const { benefit: b, left, used } = row;
  const card = CARD_META[b.card];
  return (
    <Card accent={card.color} style={styles.compact}>
      <View style={styles.creditRow}>
        <View style={styles.fill}>
          <ThemedText type="smallBold" numberOfLines={2}>
            💳 {card.name}: {b.title}
          </ThemedText>
          <ThemedText type="small" themeColor={used ? 'success' : left <= 1 ? 'warning' : 'textSecondary'}>
            {used ? 'Marked used for this period' : capitalize(daysLeftLabel(left))}
          </ThemedText>
          {b.merchants && b.merchants.length > 0 ? (
            <ThemedText type="tiny" themeColor="textSecondary" numberOfLines={1}>
              {b.merchants.join(', ')}
            </ThemedText>
          ) : null}
        </View>
        {used ? (
          <Button label="Undo" small variant="secondary" onPress={onUndo} />
        ) : (
          <Button label="Mark used" small onPress={onMark} />
        )}
      </View>
    </Card>
  );
}

function Disclosure({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.disclosure,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={styles.fill}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {open ? '▾' : '▸'}
      </ThemedText>
    </Pressable>
  );
}

function buildSections(visible: Deal[], today: YMD, newIds: string[] | undefined): TodaySections {
  const soon = addDays(today, ENDING_SOON_DAYS);
  const ending: Deal[] = [];
  for (const d of visible) {
    if (dealKind(d) !== 'dated' || !d.end || (spanDays(d) ?? 0) === 0) continue;
    if (d.start <= today && d.end >= today && d.end <= soon) ending.push(d);
  }
  ending.sort(byEnd);
  const endingIds = new Set(ending.map((d) => d.id));

  const happening: Deal[] = [];
  const alsoRunning: Deal[] = [];
  for (const d of visible) {
    if (endingIds.has(d.id) || !occursOn(d, today)) continue;
    const kind = dealKind(d);
    if (kind === 'ongoing') {
      if (d.start === today) happening.push(d);
    } else if (kind === 'weekly' || d.start === today || (spanDays(d) ?? 0) <= LONG_PROMO_DAYS) {
      happening.push(d);
    } else {
      alsoRunning.push(d);
    }
  }
  happening.sort(compareDeals);
  alsoRunning.sort(byEnd);

  const lastComing = addDays(today, COMING_UP_DAYS);
  const starting = new Map<YMD, Deal[]>();
  for (const d of visible) {
    // Weekly deals repeat, so they live on the Weekly tab instead.
    if (dealKind(d) === 'weekly' || d.start <= today || d.start > lastComing) continue;
    const list = starting.get(d.start) ?? [];
    list.push(d);
    starting.set(d.start, list);
  }
  const comingUp: TodaySections['comingUp'] = [];
  for (let i = 1; i <= COMING_UP_DAYS; i++) {
    const day = addDays(today, i);
    const list = starting.get(day);
    if (list) comingUp.push({ day, deals: list.sort(compareDeals) });
  }

  const newSet = new Set(newIds ?? []);
  const since = addDays(today, -NEW_WINDOW_DAYS);
  const fresh = visible
    .filter(
      (d) =>
        !isOver(d, today) &&
        (newSet.has(d.id) || (!!d.firstSeen && d.firstSeen >= since && d.firstSeen <= today)),
    )
    .sort((a, b) => {
      const fa = a.firstSeen ?? today;
      const fb = b.firstSeen ?? today;
      if (fa !== fb) return fa > fb ? -1 : 1;
      return compareDeals(a, b);
    });

  const groups: Record<PerkGroup, Deal[]> = { birthday: [], signup: [], other: [] };
  let perkCount = 0;
  for (const d of visible) {
    if (dealKind(d) !== 'ongoing') continue;
    groups[perkGroup(d)].push(d);
    perkCount++;
  }
  const perks = (['birthday', 'signup', 'other'] as const)
    .filter((g) => groups[g].length > 0)
    .map((group) => ({ group, deals: groups[group].sort(compareDeals) }));

  return { ending, happening, alsoRunning, comingUp, fresh, perks, perkCount };
}

function creditRows(
  benefits: Benefit[],
  cards: CardInfo[],
  prefs: Prefs,
  used: UsedCredits,
  today: YMD,
  justUsed: string[],
): CreditRow[] {
  const rows: CreditRow[] = [];
  for (const b of benefits) {
    // wantsBenefit also drops perks with period 'none' and credits muted in Alerts.
    if (!wantsBenefit(b, prefs) || !benefitAppliesToUser(b, cards, prefs.cardVariants)) continue;
    const left = benefitDaysLeft(b, today);
    if (left === undefined || left > CREDIT_WARN_DAYS) continue;
    const isUsed = isBenefitUsed(b, used, today);
    if (isUsed && !justUsed.includes(b.id)) continue;
    rows.push({ benefit: b, left, used: isUsed });
  }
  return rows.sort(
    (a, b) =>
      a.left - b.left ||
      CARD_META[a.benefit.card].name.localeCompare(CARD_META[b.benefit.card].name) ||
      a.benefit.title.localeCompare(b.benefit.title),
  );
}

function byEnd(a: Deal, b: Deal): number {
  const ea = a.end ?? '9999-12-31';
  const eb = b.end ?? '9999-12-31';
  if (ea !== eb) return ea < eb ? -1 : 1;
  return compareDeals(a, b);
}

function withTime(text: string, d: Deal): string {
  const time = formatTimeRange(d.startTime, d.endTime);
  return time ? `${text} · ${time}` : text;
}

function endingNote(d: Deal, today: YMD): string {
  const end = d.end ?? today;
  const n = diffDays(today, end);
  const when = n <= 0 ? 'Ends today' : n === 1 ? 'Ends tomorrow' : `Ends ${WEEKDAYS_SHORT[weekday(end)]}`;
  return withTime(when, d);
}

/** Only multi-day promos that start today need a custom line; describeWhen covers the rest. */
function happeningNote(d: Deal, today: YMD): string | undefined {
  if (dealKind(d) !== 'dated' || !d.end || d.start !== today || d.end === today) return undefined;
  return withTime(`Starts today · thru ${formatShortDate(d.end)}`, d);
}

function perkNote(d: Deal, today: YMD): string {
  const parts: string[] = [];
  if (d.channel && d.channel !== 'any') parts.push(CHANNEL_LABEL[d.channel]);
  if (d.start > today) parts.push(`Starts ${formatShortDate(d.start)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Anytime';
}

function perkGroup(d: Deal): PerkGroup {
  const tags = (d.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => t.includes('birthday')) || /birthday/i.test(d.title)) return 'birthday';
  if (tags.some((t) => /sign|join|welcome|new.?member|loyalty|reward/.test(t))) return 'signup';
  if (/sign[- ]?up|\bjoin\b|new members?|first order|download/i.test(d.title)) return 'signup';
  return 'other';
}

/** 'Tomorrow · Oct 25', 'Mon · Oct 26'; a week out relativeDay is already a date, so use the weekday. */
function dayHeading(day: YMD, today: YMD): string {
  const date = formatShortDate(day);
  const rel = relativeDay(day, today);
  return `${rel === date ? WEEKDAYS_SHORT[weekday(day)] : rel} · ${date}`;
}

/** updatedAt is an ISO timestamp; show it as the phone's local calendar day. */
function updatedDay(iso: string): YMD | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : toYMD(new Date(t));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.75 },
  start: { alignItems: 'flex-start' },
  section: { gap: Spacing.two },
  group: { gap: Spacing.two, marginTop: Spacing.one },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  compact: { paddingVertical: Spacing.two + Spacing.one },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
