import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DealCard } from '@/components/deal-card';
import { MonthGrid, type DayMark } from '@/components/month-grid';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, ChipRow, EmptyState, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { periodBounds, type PeriodBounds, type UsedCredits } from '@/lib/benefits';
import { benefitAppliesToUser } from '@/lib/card-variants';
import { addDays, diffDays, firstOfMonth, lastOfMonth, shiftMonth, ymdParts, type YMD } from '@/lib/dates';
import {
  formatDays,
  formatLongDay,
  formatShortDate,
  formatTimeRange,
  money,
  MONTHS_LONG,
  relativeDay,
} from '@/lib/format';
import { CARD_META, CATEGORY_META } from '@/lib/meta';
import { compareDeals, dealKind, isCalendarDay, isOneDay, nextOccurrence, occursOn } from '@/lib/occurrences';
import { CATEGORIES, type Benefit, type Category, type Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

type CategoryFilter = Record<Category, boolean>;

const ALL_CATEGORIES = Object.fromEntries(CATEGORIES.map((c) => [c, true])) as CategoryFilter;

interface CreditReset {
  benefit: Benefit;
  period: PeriodBounds;
  /** Only the current period can be marked used; later ones count as unused. */
  current: boolean;
  used: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function monthOf(day: YMD): { year: number; month: number } {
  const { y, m } = ymdParts(day);
  return { year: y, month: m };
}

export default function CalendarScreen() {
  const { today, deals, file, prefs, used, syncing, refresh, setBenefitUsed } = useAppState();
  const [view, setView] = useState(() => monthOf(today));
  const [selected, setSelected] = useState<YMD>(today);
  const [cats, setCats] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [showCredits, setShowCredits] = useState(true);
  const [showAlso, setShowAlso] = useState(false);

  const { year, month } = view;
  const monthStart = firstOfMonth(year, month);
  const monthEnd = lastOfMonth(year, month);
  const filtered = CATEGORIES.some((c) => !cats[c]);

  const shown = useMemo(() => {
    const hidden = new Set(prefs.hiddenDeals);
    return deals.filter((d) => cats[d.category] && !hidden.has(d.id));
  }, [deals, prefs.hiddenDeals, cats]);

  const resets = useMemo(
    () =>
      showCredits
        ? creditResets(
            file.benefits.filter((b) => benefitAppliesToUser(b, file.cards, prefs.cardVariants)),
            used,
            today,
            monthStart,
            monthEnd,
          )
        : new Map<YMD, CreditReset[]>(),
    [showCredits, file.benefits, file.cards, prefs.cardVariants, used, today, monthStart, monthEnd],
  );

  const marks = useMemo(() => {
    const inMonth = shown.filter(
      (d) => dealKind(d) !== 'ongoing' && d.start <= monthEnd && (!d.end || d.end >= monthStart),
    );
    const out: Record<YMD, DayMark> = {};
    for (let day = monthStart; day <= monthEnd; day = addDays(day, 1)) {
      const on = inMonth.filter((d) => isCalendarDay(d, day));
      const credit = resets.get(day)?.some((r) => !r.used) ?? false;
      if (!on.length && !credit) continue;
      const present = new Set(on.map((d) => d.category));
      out[day] = {
        colors: CATEGORIES.filter((c) => present.has(c)).map((c) => CATEGORY_META[c].color),
        count: on.length,
        credit,
      };
    }
    return out;
  }, [shown, resets, monthStart, monthEnd]);

  const dayDeals = useMemo(
    () => shown.filter((d) => isCalendarDay(d, selected)).sort(compareDeals),
    [shown, selected],
  );
  const alsoRunning = useMemo(
    () =>
      shown
        .filter((d) => dealKind(d) !== 'ongoing' && occursOn(d, selected) && !isCalendarDay(d, selected))
        .sort(compareDeals),
    [shown, selected],
  );
  const dayCredits = resets.get(selected) ?? [];
  const openCredits = dayCredits.filter((r) => !r.used).length;

  const goMonth = (n: number) => {
    const next = shiftMonth(year, month, n);
    setView(next);
    // Keep the day list in step with the grid so it never describes a day that is off screen.
    const nextStart = firstOfMonth(next.year, next.month);
    const nextEnd = lastOfMonth(next.year, next.month);
    setSelected(today >= nextStart && today <= nextEnd ? today : nextStart);
  };
  const goToday = () => {
    setView(monthOf(today));
    setSelected(today);
  };
  const toggleCategory = (c: Category) => setCats((prev) => ({ ...prev, [c]: !prev[c] }));

  const rel = Math.abs(diffDays(today, selected)) <= 1 ? relativeDay(selected, today) : undefined;
  const summary = [
    rel,
    dayDeals.length ? plural(dayDeals.length, 'deal') : undefined,
    openCredits ? `${plural(openCredits, 'credit')} to use` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  let emptyBody: string | undefined;
  if (alsoRunning.length) emptyBody = `${plural(alsoRunning.length, 'longer promo')} still running below.`;
  else if (filtered) emptyBody = 'Some categories are filtered out above.';

  return (
    <Screen title="Calendar" onRefresh={refresh} refreshing={syncing}>
      <View style={styles.header}>
        <Button
          label="‹"
          accessibilityLabel="Previous month"
          small
          variant="secondary"
          style={styles.arrow}
          onPress={() => goMonth(-1)}
        />
        <ThemedText type="heading" style={styles.monthLabel} numberOfLines={1}>
          {MONTHS_LONG[month - 1]} {year}
        </ThemedText>
        <Button
          label="›"
          accessibilityLabel="Next month"
          small
          variant="secondary"
          style={styles.arrow}
          onPress={() => goMonth(1)}
        />
        <Button label="Today" small onPress={goToday} />
      </View>

      <ChipRow>
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={CATEGORY_META[c].short}
            color={CATEGORY_META[c].color}
            selected={cats[c]}
            onPress={() => toggleCategory(c)}
          />
        ))}
        <Chip label="💳 Card credits" selected={showCredits} onPress={() => setShowCredits((v) => !v)} />
      </ChipRow>

      <Legend cats={cats} showCredits={showCredits} />

      <Card style={styles.gridCard}>
        <MonthGrid
          year={year}
          month={month}
          today={today}
          selected={selected}
          onSelect={setSelected}
          marks={marks}
        />
      </Card>

      <SectionHeader title={formatLongDay(selected)} detail={summary || undefined} />

      {dayDeals.length === 0 && dayCredits.length === 0 ? (
        <EmptyState title="No deals marked for this day" body={emptyBody} />
      ) : null}

      {dayDeals.map((d) => (
        <DealCard key={d.id} deal={d} note={dayNote(d, selected)} />
      ))}

      {alsoRunning.length > 0 ? (
        <>
          <SectionHeader
            title={`Also running (${alsoRunning.length})`}
            detail="Longer promos in the middle of their run"
            action={
              <Button
                label={showAlso ? 'Hide' : 'Show'}
                small
                variant="secondary"
                onPress={() => setShowAlso((v) => !v)}
              />
            }
          />
          {showAlso ? alsoRunning.map((d) => <DealCard key={d.id} deal={d} />) : null}
        </>
      ) : null}

      {dayCredits.length > 0 ? (
        <>
          <SectionHeader title="Card credits" detail="Unused credits are lost at midnight" />
          {dayCredits.map((r) => (
            <CreditCard
              key={r.benefit.id}
              reset={r}
              muted={prefs.mutedBenefits.includes(r.benefit.id)}
              onToggleUsed={() => setBenefitUsed(r.benefit, !r.used)}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function Legend({ cats, showCredits }: { cats: CategoryFilter; showCredits: boolean }) {
  return (
    <View style={styles.legend}>
      {CATEGORIES.map((c) => (
        <View key={c} style={[styles.legendItem, !cats[c] && styles.legendOff]}>
          <View style={[styles.legendDot, { backgroundColor: CATEGORY_META[c].color }]} />
          <ThemedText type="tiny" themeColor="textSecondary">
            {CATEGORY_META[c].short}
          </ThemedText>
        </View>
      ))}
      <View style={[styles.legendItem, !showCredits && styles.legendOff]}>
        <ThemedText type="tiny" themeColor="textSecondary">
          💳 Credit resets
        </ThemedText>
      </View>
    </View>
  );
}

function CreditCard({
  reset,
  muted,
  onToggleUsed,
}: {
  reset: CreditReset;
  muted: boolean;
  onToggleUsed: () => void;
}) {
  const theme = useTheme();
  const { benefit: b, period, current, used } = reset;
  const name = b.cardName ?? CARD_META[b.card].name;
  let status = 'Not used yet';
  if (used) status = '✓ Used';
  else if (!current) status = `Available from ${formatShortDate(period.start)}`;
  const merchants = b.merchants?.length
    ? `${b.merchants.slice(0, 3).join(', ')}${b.merchants.length > 3 ? ` +${b.merchants.length - 3}` : ''}`
    : undefined;
  const detail = [
    b.amount != null ? money(b.amount) : undefined,
    merchants,
    muted ? '🔕 reminders off' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card accent={CARD_META[b.card].color} style={styles.creditCard}>
      <ThemedText type="smallBold">
        {name}: {b.title} resets tonight
      </ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
      <View style={styles.creditStatus}>
        <ThemedText
          type="smallBold"
          style={[styles.fill, { color: used ? theme.success : theme.textSecondary }]}>
          {status}
        </ThemedText>
        {current ? (
          <Button label={used ? 'Undo' : 'Mark used'} small variant="secondary" onPress={onToggleUsed} />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Credits whose period ends in the visible month, from today on. Past periods are
 * left out: they are over, and only the current period's used state is stored.
 */
function creditResets(
  benefits: Benefit[],
  used: UsedCredits,
  today: YMD,
  monthStart: YMD,
  monthEnd: YMD,
): Map<YMD, CreditReset[]> {
  const out = new Map<YMD, CreditReset[]>();
  const from = monthStart > today ? monthStart : today;
  if (from > monthEnd) return out;
  for (const benefit of benefits) {
    const currentKey = periodBounds(benefit.period, today)?.key;
    for (
      let p = periodBounds(benefit.period, from);
      p && p.end <= monthEnd;
      p = periodBounds(benefit.period, addDays(p.end, 1))
    ) {
      const current = p.key === currentKey;
      const list = out.get(p.end) ?? [];
      list.push({ benefit, period: p, current, used: current && used[benefit.id] === p.key });
      out.set(p.end, list);
    }
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) => a.benefit.card.localeCompare(b.benefit.card) || a.benefit.title.localeCompare(b.benefit.title),
    );
  }
  return out;
}

/** "Starts" / "Last day" when the selected day is the edge of a deal's run; otherwise the card's default. */
function dayNote(d: Deal, day: YMD): string | undefined {
  const time = d.startTime || d.endTime ? ` · ${formatTimeRange(d.startTime, d.endTime)}` : '';
  const kind = dealKind(d);
  if (kind === 'dated' && !isOneDay(d)) {
    if (day === d.end) return `Last day${time}`;
    if (day === d.start) return `Starts · through ${formatShortDate(d.end!)}${time}`;
  }
  if (kind === 'weekly') {
    const first = day === nextOccurrence(d, d.start);
    const last = !!d.end && !nextOccurrence(d, addDays(day, 1));
    const every = `every ${formatDays(d.days ?? [])}`;
    if (first && last) return `One day only${time}`;
    if (first) return `Starts · ${every}${time}${d.end ? ` · thru ${formatShortDate(d.end)}` : ''}`;
    if (last) return `Last day · ${every}${time}`;
  }
  return undefined;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  arrow: { minWidth: 44, minHeight: 44 },
  monthLabel: { flex: 1, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  legendOff: { opacity: 0.4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  gridCard: { padding: Spacing.two },
  creditCard: { paddingVertical: Spacing.two + Spacing.one },
  creditStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
