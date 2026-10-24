import { router } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { BenefitRow, SourceLink } from '@/components/benefit-row';
import { DealCard } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Divider, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { benefitDaysLeft, isBenefitUsed } from '@/lib/benefits';
import { money } from '@/lib/format';
import { CARD_META } from '@/lib/meta';
import { compareDeals, isOver } from '@/lib/occurrences';
import { isDealHidden } from '@/lib/prefs';
import { CARD_IDS, type Benefit, type CardId, type CardInfo, type Deal, type Period } from '@/lib/schema';
import { MY_CARDS, namesHeldCard, shortCardName, type HeldCard } from '@/lib/wallet';
import { useAppState } from '@/state/app-state';

/** Credits resetting within this many days count toward the summary's heads-up line. */
const RESET_WINDOW_DAYS = 7;

const AMEX_TIP = 'Amex Offers are targeted: save the ones you add in the Amex app here so you get expiry reminders.';

const TIPS: Record<CardId, string> = {
  'amex-gold': AMEX_TIP,
  'amex-platinum': AMEX_TIP,
  'capital-one': 'Check Capital One Offers in the Capital One app for restaurant and delivery cash back.',
  citi: 'Citi Merchant Offers are targeted and must be enrolled before you pay.',
};

// Monthly credits first (the ones most likely to lapse), standing perks last.
const PERIOD_ORDER: Record<Period, number> = { monthly: 0, quarterly: 1, semiannual: 2, annual: 3, none: 4 };

interface HeldCardView {
  held: HeldCard;
  /** Earn rates and fee from deals.json, once the deal search has filled them in. */
  info?: CardInfo;
  benefits: Benefit[];
}

interface Issuer {
  card: CardId;
  cards: HeldCardView[];
  /** With two cards from one issuer: benefits that come with both. */
  shared: Benefit[];
  offers: Deal[];
}

interface MonthlyTotals {
  left: number;
  total: number;
}

/** Soonest-ending first; ongoing offers last. */
function byEndDate(a: Deal, b: Deal): number {
  if (a.end !== b.end) {
    if (!a.end) return 1;
    if (!b.end) return -1;
    return a.end < b.end ? -1 : 1;
  }
  return compareDeals(a, b);
}

const byPeriod = (list: Benefit[]) => [...list].sort((a, b) => PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]);

const cents = (n: number) => Math.round(n * 100) / 100;

export default function CardsScreen() {
  const { file, deals, prefs, used, today, refresh, syncing } = useAppState();

  // file only has the user's own cards and their benefits (see wallet.ts).
  const issuers = useMemo<Issuer[]>(
    () =>
      CARD_IDS.map((card) => {
        const mine = MY_CARDS.filter((h) => h.card === card);
        const benefits = file.benefits.filter((b) => b.card === card);
        const several = mine.length > 1;
        // With one card from an issuer every benefit is that card's; with two, ones naming a card go under it.
        const belongsTo = (b: Benefit, held: HeldCard) =>
          several ? !!b.cardName && namesHeldCard(held, card, b.cardName) : true;
        const cards = mine.map((held) => ({
          held,
          info: file.cards.find((c) => namesHeldCard(held, c.card, c.name)),
          benefits: byPeriod(benefits.filter((b) => belongsTo(b, held))),
        }));
        const shared = several ? byPeriod(benefits.filter((b) => !b.cardName?.trim())) : [];
        const offers = deals
          .filter((d) => d.category === 'card' && d.card === card && !isDealHidden(d, prefs) && !isOver(d, today))
          .sort(byEndDate);
        return { card, cards, shared, offers };
      }),
    [file, deals, prefs, today],
  );

  const summary = useMemo(() => {
    const byCard: Partial<Record<CardId, MonthlyTotals>> = {};
    let left = 0;
    let total = 0;
    let resetting = 0;
    for (const { card, cards, shared } of issuers) {
      for (const b of [...cards.flatMap((c) => c.benefits), ...shared]) {
        if (b.period === 'none') continue;
        const isUsed = isBenefitUsed(b, used, today);
        if (b.period === 'monthly' && b.amount) {
          const t = (byCard[card] ??= { left: 0, total: 0 });
          t.total += b.amount;
          total += b.amount;
          if (!isUsed) {
            t.left += b.amount;
            left += b.amount;
          }
        }
        const days = benefitDaysLeft(b, today);
        if (!isUsed && days !== undefined && days <= RESET_WINDOW_DAYS) resetting++;
      }
    }
    return { left: cents(left), total: cents(total), resetting, byCard };
  }, [issuers, used, today]);

  return (
    <Screen title="Cards" subtitle="Credits, earn rates and card offers" onRefresh={refresh} refreshing={syncing}>
      <Summary left={summary.left} total={summary.total} resetting={summary.resetting} />
      {issuers.map((issuer) => (
        <IssuerSection key={issuer.card} issuer={issuer} monthly={summary.byCard[issuer.card]} />
      ))}
    </Screen>
  );
}

function Summary({ left, total, resetting }: { left: number; total: number; resetting: number }) {
  const theme = useTheme();
  const share = total > 0 ? Math.min(1, left / total) : 0;
  const resetLine =
    resetting === 0
      ? `No unused credits reset in the next ${RESET_WINDOW_DAYS} days`
      : `${resetting} unused credit${resetting === 1 ? ' resets' : 's reset'} in the next ${RESET_WINDOW_DAYS} days`;

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        Credits left this month
      </ThemedText>
      {total > 0 ? (
        <>
          <ThemedText type="subtitle" accessibilityLabel={`${money(left)} of ${money(total)} left this month`}>
            {money(left)}{' '}
            <ThemedText type="default" themeColor="textSecondary">
              of {money(total)}
            </ThemedText>
          </ThemedText>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.bar, { width: `${share * 100}%`, backgroundColor: theme.success }]} />
          </View>
        </>
      ) : (
        <ThemedText type="default">No monthly credits listed for your cards yet</ThemedText>
      )}
      <ThemedText type="small" themeColor={resetting > 0 ? 'warning' : 'textSecondary'}>
        {resetLine}
      </ThemedText>
    </Card>
  );
}

function IssuerSection({ issuer, monthly }: { issuer: Issuer; monthly?: MonthlyTotals }) {
  const theme = useTheme();
  const { card, cards, shared, offers } = issuer;
  const meta = CARD_META[card];
  const several = cards.length > 1;
  const subtitle = several
    ? cards.map((c) => shortCardName(c.held.name)).join(' + ')
    : (cards[0]?.info?.name ?? cards[0]?.held.name);

  return (
    <View style={styles.section}>
      <View style={styles.issuerHeader}>
        <View style={[styles.stripe, { backgroundColor: meta.color }]} />
        <View style={styles.fill}>
          <ThemedText type="heading" accessibilityRole="header">
            {meta.name}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {monthly && monthly.total > 0 ? (
          <ThemedText type="smallBold" themeColor={monthly.left > 0 ? 'text' : 'textSecondary'}>
            {money(cents(monthly.left))} left
          </ThemedText>
        ) : null}
      </View>

      {cards.map(({ held, info, benefits }) => (
        <Fragment key={held.name}>
          <Card>
            {several ? <ThemedText type="smallBold">{info?.name ?? held.name}</ThemedText> : null}
            {info ? (
              <CardDetails info={info} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No details for this card yet. The next deal search fills them in.
              </ThemedText>
            )}
          </Card>
          {benefits.length > 0 ? (
            <BenefitList
              label={several ? `${shortCardName(held.name)} credits & perks` : 'Credits & perks'}
              benefits={benefits}
            />
          ) : null}
        </Fragment>
      ))}
      {shared.length > 0 ? <BenefitList label={`Every ${meta.name} card`} benefits={shared} /> : null}

      {offers.length > 0 ? (
        <>
          <GroupLabel>{`Card offers · ${offers.length}`}</GroupLabel>
          {offers.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </>
      ) : null}

      <ThemedText type="small" themeColor="textSecondary" style={[styles.tip, { borderLeftColor: theme.border }]}>
        {TIPS[card]}
      </ThemedText>
      <Button
        label={`Add an offer from your ${meta.name} account`}
        variant="secondary"
        onPress={() => router.push({ pathname: '/deal/edit', params: { category: 'card', card } })}
      />
    </View>
  );
}

function BenefitList({ label, benefits }: { label: string; benefits: Benefit[] }) {
  return (
    <>
      <GroupLabel>{label}</GroupLabel>
      <Card>
        {benefits.map((b, i) => (
          <Fragment key={b.id}>
            {i > 0 ? <Divider /> : null}
            <BenefitRow benefit={b} />
          </Fragment>
        ))}
      </Card>
    </>
  );
}

function CardDetails({ info }: { info: CardInfo }) {
  const fee =
    info.annualFee === undefined
      ? ''
      : info.annualFee === 0
        ? 'No annual fee'
        : `${money(info.annualFee)} annual fee`;

  return (
    <>
      {fee ? (
        <ThemedText type="small" themeColor="textSecondary">
          {fee}
        </ThemedText>
      ) : null}
      {info.earn.length > 0 ? (
        <View style={styles.earnList}>
          {info.earn.map((e, i) => (
            <View key={`${i}-${e.category}`} style={styles.earnRow}>
              <ThemedText type="smallBold" style={styles.rate}>
                {e.rate}
              </ThemedText>
              <View style={styles.fill}>
                <ThemedText type="small">{e.category}</ThemedText>
                {e.cap ? (
                  <ThemedText type="tiny" themeColor="textSecondary">
                    {e.cap}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {info.notes ? (
        <ThemedText type="small" themeColor="textSecondary">
          {info.notes}
        </ThemedText>
      ) : null}
      {info.sourceUrl ? <SourceLink url={info.sourceUrl} label="Card details" /> : null}
    </>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <ThemedText type="tiny" themeColor="textSecondary" style={styles.groupLabel}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  issuerHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stripe: { width: 5, alignSelf: 'stretch', borderRadius: Radius.pill },
  groupLabel: { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: Spacing.one },
  earnList: { gap: Spacing.one },
  earnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  rate: { minWidth: 48 },
  tip: { borderLeftWidth: 2, paddingLeft: Spacing.two },
  track: { height: 6, borderRadius: Radius.pill, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: Radius.pill },
});
