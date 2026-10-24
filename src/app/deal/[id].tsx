import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';

import { confirmMute, countRestaurantDeals } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, Divider, EmptyState, Screen, SectionHeader, Segmented } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pad2, toYMD, weekday, type YMD } from '@/lib/dates';
import {
  describeWhen,
  formatDays,
  formatShortDate,
  formatTime,
  formatTimeRange,
  relativeDay,
  WEEKDAYS_SHORT,
} from '@/lib/format';
import { CARD_META, CATEGORY_META, CHANNEL_LABEL } from '@/lib/meta';
import type { PermissionState } from '@/lib/notifications';
import { dealKind, isOver, nextOccurrence } from '@/lib/occurrences';
import { dealNotifies, isRestaurantMuted, wantsDeal, type Override, type Prefs } from '@/lib/prefs';
import { DEFAULT_HORIZON_DAYS, planReminders } from '@/lib/reminders';
import type { Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

type Choice = 'default' | Override;

const CHOICES: { label: string; value: Choice }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Always', value: 'on' },
  { label: 'Never', value: 'off' },
];

/** Opened from a notification or a shared web link there may be nothing to go back to. */
function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function DealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, getDeal } = useAppState();
  const deal = id ? getDeal(id) : undefined;

  if (!deal) {
    return (
      <Screen tabScreen={false}>
        <Stack.Screen options={{ title: 'Deal' }} />
        {ready ? (
          <>
            <EmptyState
              title="This deal is no longer listed"
              body="It may have ended or been dropped in the latest weekly update."
            />
            <Button label="Back" variant="secondary" onPress={goBack} />
          </>
        ) : null}
      </Screen>
    );
  }
  return <DealDetail deal={deal} />;
}

function DealDetail({ deal }: { deal: Deal }) {
  const theme = useTheme();
  const {
    today,
    deals,
    prefs,
    used,
    permission,
    setDealOverride,
    toggleRestaurantMuted,
    toggleHidden,
    deleteCustomDeal,
    requestNotifications,
  } = useAppState();

  const meta = CATEGORY_META[deal.category];
  const hidden = prefs.hiddenDeals.includes(deal.id);
  const override = prefs.dealOverrides[deal.id];
  const muted = isRestaurantMuted(prefs, deal.restaurant);
  const kind = dealKind(deal);
  const over = isOver(deal, today);
  const next = over || kind === 'ongoing' ? undefined : nextOccurrence(deal, today);
  const time = formatTimeRange(deal.startTime, deal.endTime);
  const when = describeWhen(deal, today);
  const dates = dateLine(deal, today);

  const defaultOn = dealNotifies(deal, { ...prefs, dealOverrides: {} });
  const offReason = defaultOn ? null : defaultOffReason(deal, prefs);

  // Planned for this deal alone so a same-morning digest can't swallow its entries; times are the same.
  const plan = useMemo(() => {
    const reminders = planReminders({
      deals: [deal],
      benefits: [],
      prefs: { ...prefs, weeklyPreview: false, refreshNudge: false },
      used,
      now: new Date(),
    })
      .filter((r) => r.dealId === deal.id)
      .slice(0, 3);
    return { reminders, reason: reminders.length ? null : noRemindersReason(deal, prefs, today) };
  }, [deal, prefs, used, today]);

  const confirmDelete = () => {
    const run = () => {
      const id = deal.id;
      goBack();
      // Delete once the screen has slid away, so it doesn't flash "no longer listed" on the way out.
      setTimeout(() => {
        setDealOverride(id, null);
        deleteCustomDeal(id);
      }, 350);
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete “${deal.title}”? This can’t be undone.`)) run();
      return;
    }
    Alert.alert('Delete this deal?', `${deal.restaurant}: ${deal.title}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  return (
    <Screen tabScreen={false}>
      <Stack.Screen options={{ title: deal.restaurant }} />

      {muted ? (
        <Card style={{ backgroundColor: theme.backgroundSelected }}>
          <ThemedText type="smallBold">🔇 {deal.restaurant} is muted</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Its deals are hidden everywhere and never send reminders.
          </ThemedText>
          <Button label={`Unmute ${deal.restaurant}`} small onPress={() => toggleRestaurantMuted(deal.restaurant)} />
        </Card>
      ) : hidden ? (
        <Card style={{ backgroundColor: theme.backgroundSelected }}>
          <ThemedText type="smallBold">Hidden</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This deal doesn’t show in your lists and never sends reminders.
          </ThemedText>
        </Card>
      ) : null}

      <View style={styles.header}>
        <View style={styles.badges}>
          <Badge label={`${meta.emoji} ${meta.label}`} color={meta.color} solid />
          {deal.local ? <Badge label="SA" color={theme.tint} /> : null}
          {deal.card ? <Badge label={CARD_META[deal.card].name} color={CARD_META[deal.card].color} solid /> : null}
          {deal.custom ? <Badge label="Added by you" /> : null}
        </View>
        <ThemedText type="subtitle">{deal.title}</ThemedText>
        {deal.custom ? null : deal.status === 'confirmed' ? (
          <ThemedText type="smallBold" style={{ color: theme.success }}>
            ✓ Verified{deal.verifiedAt ? ` ${formatShortDate(deal.verifiedAt)}` : ''}
          </ThemedText>
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.warning }}>
            Unconfirmed — double-check in the app before you go
          </ThemedText>
        )}
        {deal.details ? <ThemedText type="default">{deal.details}</ThemedText> : null}
      </View>

      <Card>
        <ThemedText type="heading">{when}</ThemedText>
        {dates !== when ? <InfoLine label="Dates" value={dates} /> : null}
        {deal.days?.length ? <InfoLine label="Days" value={`Every ${formatDays(deal.days)}`} /> : null}
        {time ? <InfoLine label="Time" value={time.charAt(0).toUpperCase() + time.slice(1)} /> : null}
        {next ? <InfoLine label="Next" value={nextLabel(next, today)} /> : null}
        {over ? (
          <ThemedText type="smallBold" themeColor="textSecondary">
            This deal has ended.
          </ThemedText>
        ) : null}
      </Card>

      {deal.channel || deal.code || deal.location ? (
        <Card>
          <ThemedText type="heading">How to redeem</ThemedText>
          {deal.channel ? <InfoLine label="Where" value={CHANNEL_LABEL[deal.channel]} /> : null}
          {deal.code ? <CodeBox code={deal.code} /> : null}
          {deal.location ? (
            <View style={styles.locationRow}>
              <ThemedText type="default" style={styles.fill}>
                📍 {deal.location}
              </ThemedText>
              <Button label="Open in Maps" small variant="secondary" onPress={() => openMaps(deal.location!)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {deal.notes ? (
        <Card style={{ backgroundColor: theme.backgroundSelected }}>
          <ThemedText type="smallBold">Good to know</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {deal.notes}
          </ThemedText>
        </Card>
      ) : null}

      {deal.sourceUrl ? (
        <Button
          label={`Open source: ${deal.sourceName || hostOf(deal.sourceUrl)}`}
          variant="secondary"
          onPress={() => openSource(deal.sourceUrl!)}
        />
      ) : null}

      <SectionHeader title="Notifications" />
      {muted ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Muted restaurants never send reminders. Unmute {deal.restaurant} to choose reminders for this deal.
          </ThemedText>
        </Card>
      ) : (
        <Card>
          <Segmented
            options={CHOICES}
            value={override ?? 'default'}
            onChange={(v) => setDealOverride(deal.id, v === 'default' ? null : v)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Default follows your Alerts settings — currently{' '}
            <ThemedText type="smallBold" style={{ color: defaultOn ? theme.success : theme.textSecondary }}>
              {defaultOn ? 'on' : 'off'}
            </ThemedText>
            {offReason ? ` (${offReason})` : ''}.
            {override ? ` ${override === 'on' ? 'Always' : 'Never'} overrides them for this deal.` : ''}
          </ThemedText>
          <Divider />
          <ThemedText type="smallBold">Next reminders</ThemedText>
          {plan.reminders.length ? (
            plan.reminders.map((r) => (
              <ThemedText key={r.id} type="small">
                <ThemedText type="smallBold">{reminderWhen(r.fireAt)}</ThemedText> — {r.title}
              </ThemedText>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {plan.reason}
            </ThemedText>
          )}
          {plan.reminders.length && prefs.notificationsEnabled ? (
            <PermissionNote permission={permission} onAllow={() => requestNotifications().catch(() => undefined)} />
          ) : null}
        </Card>
      )}

      <Button label={hidden ? 'Unhide' : 'Hide this deal'} variant="secondary" onPress={() => toggleHidden(deal.id)} />
      {muted ? null : (
        <Button
          label={`Mute ${deal.restaurant}`}
          variant="secondary"
          onPress={() =>
            confirmMute(deal.restaurant, countRestaurantDeals(deals, deal.restaurant, today), () =>
              toggleRestaurantMuted(deal.restaurant),
            )
          }
        />
      )}

      {deal.custom ? (
        <View style={styles.actions}>
          <View style={styles.fill}>
            <Button
              label="Edit"
              variant="secondary"
              onPress={() => router.push({ pathname: '/deal/edit', params: { id: deal.id } })}
            />
          </View>
          <View style={styles.fill}>
            <Button label="Delete" variant="danger" onPress={confirmDelete} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.infoLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.fill}>
        {value}
      </ThemedText>
    </View>
  );
}

function CodeBox({ code }: { code: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
    } catch (e) {
      console.warn('Could not copy the code', e);
    }
  };

  const { stacked, size } = codeLayout(code.length);
  return (
    <View style={[styles.codeBox, stacked && styles.codeBoxStacked, { backgroundColor: theme.tintSoft }]}>
      <ThemedText type="code" selectable style={[!stacked && styles.fill, size, { color: theme.tint }]}>
        {code}
      </ThemedText>
      <Button
        label={copied ? 'Copied' : 'Copy'}
        small
        onPress={copy}
        style={[styles.copy, stacked && styles.copyStacked]}
      />
    </View>
  );
}

/**
 * A code that wraps mid-code is easy to misread at the counter, and adjustsFontSizeToFit doesn't work on
 * web. Monospace glyphs are ~0.6em wide, so on a 360pt phone 10 characters fit beside Copy at 24px; longer
 * codes move Copy to its own row (16 fit there at 24px) and only codes beyond that shrink.
 */
function codeLayout(length: number) {
  const size = length > 22 ? styles.codeSmall : length > 16 ? styles.codeMedium : styles.codeLarge;
  return { stacked: length > 10, size };
}

function PermissionNote({
  permission,
  onAllow,
}: {
  permission: PermissionState;
  onAllow: () => void;
}) {
  const theme = useTheme();
  if (permission === 'granted') return null;
  if (permission === 'undetermined') {
    return (
      <View style={styles.locationRow}>
        <ThemedText type="small" style={[styles.fill, { color: theme.warning }]}>
          Allow notifications so these can arrive.
        </ThemedText>
        <Button label="Allow" small onPress={onAllow} />
      </View>
    );
  }
  return (
    <ThemedText type="small" style={{ color: theme.warning }}>
      {permission === 'denied'
        ? 'Notifications are blocked in your phone’s Settings, so these won’t arrive.'
        : 'Reminders only arrive in the phone app.'}
    </ThemedText>
  );
}

function dateLine(deal: Deal, today: YMD): string {
  if (!deal.end) return deal.start > today ? `Starts ${formatShortDate(deal.start)} · no end date` : 'Ongoing';
  if (deal.start === deal.end) return `${formatShortDate(deal.start)} only`;
  return `${formatShortDate(deal.start)} – ${formatShortDate(deal.end)}`;
}

function nextLabel(day: YMD, today: YMD): string {
  const rel = relativeDay(day, today);
  const date = formatShortDate(day);
  return rel === date ? `${WEEKDAYS_SHORT[weekday(day)]}, ${date}` : `${rel} · ${date}`;
}

/** 'Tue Oct 27, 12:45 PM' */
function reminderWhen(at: Date): string {
  const hhmm = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  return `${WEEKDAYS_SHORT[at.getDay()]} ${formatShortDate(toYMD(at))}, ${formatTime(hhmm)}`;
}

/** Why the Default setting resolves to off; null when it doesn't. */
function defaultOffReason(deal: Deal, prefs: Prefs): string | null {
  if (prefs.hiddenDeals.includes(deal.id)) return 'it’s hidden';
  if (isRestaurantMuted(prefs, deal.restaurant)) return `${deal.restaurant} is muted`;
  if (!prefs.categories[deal.category]) return `the ${CATEGORY_META[deal.category].label} switch is off`;
  if (!prefs.includeUnconfirmed && deal.status === 'unconfirmed') return 'unconfirmed deals are switched off';
  if (dealKind(deal) === 'ongoing') return 'always-on perks don’t send reminders';
  if (dealKind(deal) === 'weekly' && !prefs.weeklyReminders) {
    return 'weekly specials only ping when you pick Always (or turn on weekly specials in Alerts)';
  }
  return null;
}

function noRemindersReason(deal: Deal, prefs: Prefs, today: YMD): string {
  if (!prefs.notificationsEnabled) return 'Notifications are turned off in Alerts.';
  if (prefs.hiddenDeals.includes(deal.id)) return 'Hidden deals never send reminders.';
  if (isRestaurantMuted(prefs, deal.restaurant)) return `${deal.restaurant} is muted, so it never sends reminders.`;
  if (!wantsDeal(deal, prefs)) {
    if (prefs.dealOverrides[deal.id] === 'off') return 'This deal is set to Never.';
    const why = defaultOffReason(deal, prefs);
    return why ? `None — ${why}.` : 'This deal is muted.';
  }
  if (isOver(deal, today)) return 'None — this deal has ended.';
  if (dealKind(deal) === 'weekly' && !prefs.weeklyReminders && prefs.dealOverrides[deal.id] !== 'on') {
    return 'Weekly specials don’t ping by default. Choose Always above to get a reminder each week.';
  }
  if (dealKind(deal) === 'ongoing') return 'Ongoing perks don’t send reminders; they stay on the Today screen.';
  const weeks = Math.round(DEFAULT_HORIZON_DAYS / 7);
  if (dealKind(deal) === 'dated' && prefs.expiryDaysBefore < 0) {
    return `No start dates in the next ${weeks} weeks, and ending reminders are off in Alerts.`;
  }
  return `No reminder dates in the next ${weeks} weeks.`;
}

function openMaps(location: string) {
  const query = encodeURIComponent(`${location}, San Antonio, TX`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch((e) =>
    console.warn('Could not open Maps', e),
  );
}

async function openSource(url: string) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await WebBrowser.openBrowserAsync(href);
  } catch {
    Linking.openURL(href).catch((e) => console.warn('Could not open the source link', e));
  }
}

// RN's URL polyfill doesn't implement `hostname` everywhere, so parse it by hand.
function hostOf(url: string): string {
  const m = /^(?:[a-z]+:\/\/)?([^/?#:]+)/i.exec(url.trim());
  return (m ? m[1] : url).replace(/^www\./i, '');
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { gap: Spacing.two },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  infoLine: { flexDirection: 'row', gap: Spacing.two },
  infoLabel: { width: 52 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  codeBoxStacked: { flexDirection: 'column', alignItems: 'stretch' },
  codeLarge: { fontSize: 24, lineHeight: 32, letterSpacing: 1.5 },
  codeMedium: { fontSize: 18, lineHeight: 24, letterSpacing: 1 },
  codeSmall: { fontSize: 15, lineHeight: 20, letterSpacing: 0.5 },
  // Wide enough for "Copied" too, so the code doesn't reflow when the label changes.
  copy: { minWidth: 80 },
  copyStacked: { alignSelf: 'flex-end' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
