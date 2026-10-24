import { router } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { BenefitRow, SourceLink } from '@/components/benefit-row';
import { DealCard } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, ChipRow, Divider, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { benefitDaysLeft, isBenefitUsed } from '@/lib/benefits';
import { benefitAppliesTo, selectedVariant, shortVariantName } from '@/lib/card-variants';
import { money } from '@/lib/format';
import { CARD_META } from '@/lib/meta';
import { compareDeals, isOver } from '@/lib/occurrences';
import { CARD_IDS, type Benefit, type CardId, type CardInfo, type Deal, type Period } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

/** Credits resetting within this many days count toward the summary's heads-up line. */
const RESET_WINDOW_DAYS = 7;

const AMEX_TIP = 'Amex Offers are targeted: save the ones you add in the Amex app here so you get expiry reminders.';

const TIPS: Record<CardId, string> = {
  'amex-gold': AMEX_TIP,
  'amex-platinum': AMEX_TIP,
  'capital-one': 'Check Capital One Offers and Capital One Dining in the app.',
  citi: 'Citi Merchant Offers are targeted and must be enrolled before you pay.',
};

// Monthly credits first (the ones most likely to lapse), standing perks last.
const PERIOD_ORDER: Record<Period, number> = { monthly: 0, quarterly: 1, semiannual: 2, annual: 3, none: 4 };

interface Issuer {
  card: CardId;
  variants: CardInfo[];
  variant?: CardInfo;
  benefits: Benefit[];
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

const cents = (n: number) => Math.round(n * 100) / 100;

export default function CardsScreen() {
  const { file, deals, prefs, used, today, updatePrefs, refresh, syncing } = useAppState();

  const issuers = useMemo<Issuer[]>(() => {
    const hidden = new Set(prefs.hiddenDeals);
    return CARD_IDS.map((card) => {
      const variants = file.cards.filter((c) => c.card === card);
      const variant = selectedVariant(variants, prefs.cardVariants[card]);
      const benefits = file.benefits
        .filter((b) => b.card === card && benefitAppliesTo(b, variant))
        .sort((a, b) => PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]);
      const offers = deals
        .filter((d) => d.category === 'card' && d.card === card && !hidden.has(d.id) && !isOver(d, today))
        .sort(byEndDate);
      return { card, variants, variant, benefits, offers };
    });
  }, [file, deals, prefs.hiddenDeals, prefs.cardVariants, today]);

  const summary = useMemo(() => {
    const byCard: Partial<Record<CardId, MonthlyTotals>> = {};
    let left = 0;
    let total = 0;
    let resetting = 0;
    for (const { card, benefits } of issuers) {
      for (const b of benefits) {
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

  const chooseVariant = (card: CardId, id: string) =>
    updatePrefs((p) => ({ ...p, cardVariants: { ...p.cardVariants, [card]: id } }));

  return (
    <Screen title="Cards" subtitle="Credits, earn rates and card offers" onRefresh={refresh} refreshing={syncing}>
      <Summary left={summary.left} total={summary.total} resetting={summary.resetting} />
      {issuers.map((issuer) => (
        <IssuerSection
          key={issuer.card}
          issuer={issuer}
          monthly={summary.byCard[issuer.card]}
          onChooseVariant={chooseVariant}
        />
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

function IssuerSection({
  issuer,
  monthly,
  onChooseVariant,
}: {
  issuer: Issuer;
  monthly?: MonthlyTotals;
  onChooseVariant: (card: CardId, id: string) => void;
}) {
  const theme = useTheme();
  const { card, variants, variant, benefits, offers } = issuer;
  const meta = CARD_META[card];

  return (
    <View style={styles.section}>
      <View style={styles.issuerHeader}>
        <View style={[styles.stripe, { backgroundColor: meta.color }]} />
        <View style={styles.fill}>
          <ThemedText type="heading" accessibilityRole="header">
            {meta.name}
          </ThemedText>
          {variant ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {variant.name}
            </ThemedText>
          ) : null}
        </View>
        {monthly && monthly.total > 0 ? (
          <ThemedText type="smallBold" themeColor={monthly.left > 0 ? 'text' : 'textSecondary'}>
            {money(cents(monthly.left))} left
          </ThemedText>
        ) : null}
      </View>

      {variant ? (
        <Card>
          {variants.length > 1 ? (
            <ChipRow>
              {variants.map((v) => (
                <Chip
                  key={v.id}
                  label={shortVariantName(v.name)}
                  selected={v.id === variant.id}
                  color={meta.color}
                  onPress={() => onChooseVariant(card, v.id)}
                />
              ))}
            </ChipRow>
          ) : null}
          <VariantInfo variant={variant} />
        </Card>
      ) : null}

      {benefits.length > 0 ? (
        <>
          <GroupLabel>Credits & perks</GroupLabel>
          <Card>
            {benefits.map((b, i) => (
              <Fragment key={b.id}>
                {i > 0 ? <Divider /> : null}
                <BenefitRow benefit={b} />
              </Fragment>
            ))}
          </Card>
        </>
      ) : null}

      {!variant && benefits.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No card details yet. The weekly update fills these in.
        </ThemedText>
      ) : null}

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

function VariantInfo({ variant }: { variant: CardInfo }) {
  const fee =
    variant.annualFee === undefined
      ? ''
      : variant.annualFee === 0
        ? 'No annual fee'
        : `${money(variant.annualFee)} annual fee`;

  return (
    <>
      {fee ? (
        <ThemedText type="small" themeColor="textSecondary">
          {fee}
        </ThemedText>
      ) : null}
      {variant.earn.length > 0 ? (
        <View style={styles.earnList}>
          {variant.earn.map((e, i) => (
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
      {variant.notes ? (
        <ThemedText type="small" themeColor="textSecondary">
          {variant.notes}
        </ThemedText>
      ) : null}
      {variant.sourceUrl ? <SourceLink url={variant.sourceUrl} label="Card details" /> : null}
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
