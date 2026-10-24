import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { benefitDaysLeft, isBenefitUsed } from '@/lib/benefits';
import { daysLeftLabel, formatShortDate, money, periodLabel } from '@/lib/format';
import type { Benefit, Period } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

import { ThemedText } from './themed-text';
import { Badge } from './ui';

/** An unused credit this close to resetting is flagged so it doesn't go to waste. */
const URGENT_DAYS = 3;

const PERIOD_NOUN: Record<Period, string> = {
  monthly: 'month',
  quarterly: 'quarter',
  semiannual: 'half',
  annual: 'year',
  none: '',
};

export function openSource(url: string) {
  // The in-app browser can be unavailable (no browser installed, some web setups); fall back to the OS.
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}

export function SourceLink({ url, label = 'Source' }: { url: string; label?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => openSource(url)}
      accessibilityRole="link"
      hitSlop={6}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
      <ThemedText type="link" style={{ color: theme.tint }}>
        {label} ↗
      </ThemedText>
    </Pressable>
  );
}

/** One card credit or perk: tap to expand, switch to mark it used, bell to mute its reminders. */
export function BenefitRow({ benefit }: { benefit: Benefit }) {
  const theme = useTheme();
  const { today, used, prefs, setBenefitUsed, toggleBenefitMuted } = useAppState();
  const [open, setOpen] = useState(false);

  const resets = benefit.period !== 'none';
  const isUsed = isBenefitUsed(benefit, used, today);
  const muted = prefs.mutedBenefits.includes(benefit.id);
  const remindersOff = !prefs.notificationsEnabled || prefs.benefitDaysBefore < 0;
  const daysLeft = benefitDaysLeft(benefit, today);
  const urgent = !isUsed && daysLeft !== undefined && daysLeft <= URGENT_DAYS;
  const amount =
    benefit.amount !== undefined ? `${money(benefit.amount)} ${periodLabel(benefit.period)}`.trim() : '';
  const merchants = benefit.merchants?.length ? benefit.merchants.join(', ') : '';
  const usedLabel = `Used this ${PERIOD_NOUN[benefit.period]}`;

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={open ? 'Hides details' : 'Shows details'}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
          <ThemedText type="default" themeColor={isUsed ? 'textSecondary' : 'text'}>
            {benefit.title}
          </ThemedText>
          {amount ? <ThemedText type="smallBold">{amount}</ThemedText> : null}
          {merchants ? (
            <ThemedText type="small" themeColor="textSecondary">
              {merchants}
            </ThemedText>
          ) : null}
          <View style={styles.badges}>
            {benefit.enrollment ? <Badge label="Enroll first" color={theme.tint} /> : null}
            {benefit.status === 'unconfirmed' ? <Badge label="Unconfirmed" color={theme.warning} /> : null}
            {resets && daysLeft !== undefined ? (
              <Badge label={daysLeftLabel(daysLeft)} color={urgent ? theme.danger : undefined} solid={urgent} />
            ) : null}
            <ThemedText type="tiny" themeColor="textSecondary" style={styles.more}>
              {open ? 'Less ▴' : 'More ▾'}
            </ThemedText>
          </View>
        </Pressable>
        {resets ? (
          <Pressable
            onPress={() => toggleBenefitMuted(benefit.id)}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityState={{ checked: !muted }}
            accessibilityLabel={`Reminders for ${benefit.title}`}
            accessibilityHint={remindersOff ? 'Credit reminders are turned off in Alerts' : undefined}
            style={({ pressed }) => [styles.bell, remindersOff && styles.dim, pressed && styles.pressed]}>
            <ThemedText type="default">{muted ? '🔕' : '🔔'}</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {resets ? (
        <View style={styles.usedRow}>
          <ThemedText type="small" themeColor={isUsed ? 'success' : 'text'} style={styles.fill}>
            {isUsed ? `✓ ${usedLabel}` : usedLabel}
          </ThemedText>
          <Switch
            value={isUsed}
            onValueChange={(v) => setBenefitUsed(benefit, v)}
            trackColor={{ true: theme.success, false: theme.backgroundSelected }}
            thumbColor="#FFFFFF"
            accessibilityLabel={`${benefit.title}: ${usedLabel.toLowerCase()}`}
          />
        </View>
      ) : null}

      {open ? (
        <View style={[styles.details, { borderLeftColor: theme.border }]}>
          {benefit.details ? <ThemedText type="small">{benefit.details}</ThemedText> : null}
          {benefit.howToUse ? (
            <View>
              <ThemedText type="smallBold">How to use</ThemedText>
              <ThemedText type="small">{benefit.howToUse}</ThemedText>
            </View>
          ) : null}
          {benefit.notes ? (
            <ThemedText type="small" themeColor="textSecondary">
              {benefit.notes}
            </ThemedText>
          ) : null}
          {benefit.cardName || benefit.verifiedAt ? (
            <ThemedText type="tiny" themeColor="textSecondary">
              {[
                benefit.cardName ? `Only on ${benefit.cardName}` : '',
                benefit.verifiedAt ? `Checked ${formatShortDate(benefit.verifiedAt)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          ) : null}
          {benefit.sourceUrl ? <SourceLink url={benefit.sourceUrl} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { gap: Spacing.one },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  main: { flex: 1, gap: Spacing.half },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.half },
  more: { marginLeft: 'auto' },
  bell: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.half },
  dim: { opacity: 0.4 },
  usedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  details: { gap: Spacing.two, borderLeftWidth: 2, paddingLeft: Spacing.two, marginTop: Spacing.one },
  link: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.75 },
});
