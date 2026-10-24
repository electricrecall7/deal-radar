import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { openDeal } from '@/components/deal-card';
import { ThemedText } from '@/components/themed-text';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Screen,
  SectionHeader,
  Segmented,
  ToggleRow,
} from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hhmmFromMinutes, toYMD, type YMD } from '@/lib/dates';
import { formatDay, formatTime, relativeDay } from '@/lib/format';
import { CATEGORY_META } from '@/lib/meta';
import { notifyNow, type PermissionState } from '@/lib/notifications';
import { isOver } from '@/lib/occurrences';
import { DEFAULT_DEALS_URL, isRestaurantMuted, restaurantKey, type Override, type Prefs } from '@/lib/prefs';
import { CATEGORIES, type Category, type Deal, type Resource } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

const DIGEST_OPTIONS = ['07:00', '08:00', '09:00', '10:00', '11:00'].map((t) => ({
  label: formatTime(t),
  value: t,
}));
const LEAD_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
];
const EXPIRY_OPTIONS = [
  { label: 'Off', value: -1 },
  { label: 'Last day', value: 0 },
  { label: '1 day', value: 1 },
  { label: '2 days', value: 2 },
  { label: '3 days', value: 3 },
];
const CREDIT_OPTIONS = [
  { label: 'Off', value: -1 },
  { label: 'Last day', value: 0 },
  { label: '3 days', value: 3 },
  { label: '5 days', value: 5 },
  { label: '7 days', value: 7 },
];

const RESOURCE_KIND: Record<Resource['kind'], string> = {
  app: 'App',
  site: 'Website',
  reddit: 'Reddit',
  newsletter: 'Newsletter',
  social: 'Social',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function digestHelp(time: string): string {
  return (
    `“Happening today” reminders and card-credit nudges arrive at ${formatTime(time)}. ` +
    'Deals that end early in the day ping sooner.'
  );
}

function leadHelp(min: number): string {
  if (min <= 0) return 'No extra ping before timed drops — you still get the morning reminder.';
  return `An extra ping ${min} minutes before deals that start at a set time, like a 1 PM app drop.`;
}

function expiryHelp(days: number): string {
  if (days < 0) return 'No reminders when a multi-day deal is about to end.';
  if (days === 0) return 'One ping on the last day of a multi-day deal.';
  const when = days === 1 ? 'the day' : `${days} days`;
  return `A ping ${when} before a multi-day deal ends, and again on its last day.`;
}

function creditHelp(days: number): string {
  if (days < 0) return 'No reminders before card credits reset.';
  const skip = 'Credits you mark as used are skipped.';
  if (days === 0) return `One ping on the last day of each credit period. ${skip}`;
  return `A ping ${days} days before monthly, quarterly and yearly credits reset, and on the last day. ${skip}`;
}

/** 'today at 9:14 AM', 'Wed at 6 PM', 'Oct 3 at 10 AM' */
function formatWhen(iso: string, today: YMD): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const rel = relativeDay(toYMD(d), today);
  const day = rel === 'Today' || rel === 'Yesterday' ? rel.toLowerCase() : rel;
  return `${day} at ${formatTime(hhmmFromMinutes(d.getHours() * 60 + d.getMinutes()))}`;
}

function openLink(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}

const isWebUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export default function AlertsScreen() {
  const theme = useTheme();
  const {
    today,
    file,
    deals,
    customDeals,
    prefs,
    sync,
    syncing,
    scheduledCount,
    permission,
    updatePrefs,
    setDealOverride,
    toggleRestaurantMuted,
    setRestaurantsMuted,
    toggleHidden,
    refresh,
    requestNotifications,
  } = useAppState();

  const [testNote, setTestNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    updatePrefs((p) => ({ ...p, [key]: value }));
  }

  const liveDeals = useMemo(() => {
    const hidden = new Set(prefs.hiddenDeals);
    return deals.filter((d) => !hidden.has(d.id) && !isOver(d, today));
  }, [deals, prefs.hiddenDeals, today]);

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
    for (const d of liveDeals) if (!isRestaurantMuted(prefs, d.restaurant)) counts[d.category]++;
    return counts;
  }, [liveDeals, prefs]);

  const restaurants = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; count: number }>();
    for (const d of liveDeals) {
      const key = restaurantKey(d.restaurant);
      const r = byKey.get(key);
      if (r) r.count++;
      else byKey.set(key, { key, name: d.restaurant.trim(), count: 1 });
    }
    return [...byKey.values()].sort((a, b) => compareNames(a.name, b.name));
  }, [liveDeals]);

  const visible = useMemo(() => {
    const q = restaurantKey(query);
    return q ? restaurants.filter((r) => r.key.includes(q)) : restaurants;
  }, [restaurants, query]);

  // Every muted restaurant, including ones with no current deals, so each can always be unmuted here.
  const muted = useMemo(() => {
    const names = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const d of deals) {
      const key = restaurantKey(d.restaurant);
      if (!names.has(key)) names.set(key, d.restaurant.trim());
      if (!isOver(d, today)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return prefs.mutedRestaurants
      .map((key) => ({ key, name: names.get(key) ?? titleCase(key), count: counts.get(key) ?? 0 }))
      .sort((a, b) => compareNames(a.name, b.name));
  }, [deals, prefs.mutedRestaurants, today]);

  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const overrides = useMemo(() => {
    const out: { deal: Deal; value: Override }[] = [];
    for (const [id, value] of Object.entries(prefs.dealOverrides)) {
      const deal = byId.get(id);
      if (deal) out.push({ deal, value });
    }
    return out.sort((a, b) => byRestaurant(a.deal, b.deal));
  }, [byId, prefs.dealOverrides]);
  const hiddenDeals = useMemo(
    () =>
      prefs.hiddenDeals
        .map((id) => byId.get(id))
        .filter((d): d is Deal => !!d)
        .sort(byRestaurant),
    [byId, prefs.hiddenDeals],
  );

  function sendTest() {
    setTestNote(null);
    notifyNow('Deal Radar test', 'Reminders are working.')
      .then(() => setTestNote('Sent — it should pop up in a moment.'))
      .catch((e) => setTestNote(`Couldn’t send: ${e instanceof Error ? e.message : String(e)}`));
  }

  function applyUrl(next: string) {
    const url = next.trim();
    if (!isWebUrl(url)) {
      setUrlError('Enter a full web address that starts with https://');
      return;
    }
    setUrlError(null);
    setUrlDraft(null);
    if (url !== prefs.dataUrl) setPref('dataUrl', url);
    // Pass the URL along: the saved setting only updates on the next render.
    refresh(url);
  }

  const urlValue = urlDraft ?? prefs.dataUrl;
  const urlDirty = urlDraft !== null && urlDraft.trim() !== prefs.dataUrl;
  const updatedDay = file.updatedAt.slice(0, 10);
  const updatedLabel = /^\d{4}-\d{2}-\d{2}$/.test(updatedDay) ? formatDay(updatedDay) : file.updatedAt;
  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
  ];

  return (
    <Screen title="Alerts" subtitle="Choose what pings you">
      <Card>
        <PermissionStatus
          permission={permission}
          onAllow={() => {
            requestNotifications().catch(() => undefined);
          }}
        />
        <Divider />
        <ToggleRow
          label="Deal reminders"
          detail={
            prefs.notificationsEnabled
              ? 'The settings below decide which ones you get.'
              : 'Off — nothing will ping you.'
          }
          value={prefs.notificationsEnabled}
          onValueChange={(v) => updatePrefs((p) => ({ ...p, notificationsEnabled: v }))}
        />
        <Divider />
        <View style={styles.inlineRow}>
          <ThemedText type="small" style={styles.fill}>
            Queued on this phone: {permission === 'granted' ? (scheduledCount ?? '—') : '—'}
          </ThemedText>
          <Button
            small
            variant="secondary"
            label="See what’s scheduled"
            onPress={() => router.push('/scheduled')}
          />
        </View>
        <Button
          variant="secondary"
          label="Send a test notification"
          onPress={sendTest}
          disabled={permission !== 'granted'}
        />
        {testNote ? (
          <ThemedText type="small" themeColor="textSecondary">
            {testNote}
          </ThemedText>
        ) : null}
      </Card>

      <SectionHeader title="Timing" detail="When reminders arrive" />
      <Setting label="Morning reminder" help={digestHelp(prefs.digestTime)}>
        <Segmented
          options={DIGEST_OPTIONS}
          value={prefs.digestTime}
          onChange={(v) => setPref('digestTime', v)}
        />
      </Setting>
      <Setting label="Heads-up before timed drops" help={leadHelp(prefs.leadMinutes)}>
        <Segmented
          options={LEAD_OPTIONS}
          value={prefs.leadMinutes}
          onChange={(v) => setPref('leadMinutes', v)}
        />
      </Setting>
      <Setting label="Ending deals" help={expiryHelp(prefs.expiryDaysBefore)}>
        <Segmented
          options={EXPIRY_OPTIONS}
          value={prefs.expiryDaysBefore}
          onChange={(v) => setPref('expiryDaysBefore', v)}
        />
      </Setting>
      <Setting label="Card credits" help={creditHelp(prefs.benefitDaysBefore)}>
        <Segmented
          options={CREDIT_OPTIONS}
          value={prefs.benefitDaysBefore}
          onChange={(v) => setPref('benefitDaysBefore', v)}
        />
      </Setting>
      <Card>
        <ToggleRow
          label="Remind me about every weekly special"
          detail="Off: weekly deals (kids-eat-free nights, happy hours, Taco Tuesday) appear on the Weekly tab and in the Sunday preview but don't ping you. To get one, open it and choose Always."
          value={prefs.weeklyReminders}
          onValueChange={(v) => setPref('weeklyReminders', v)}
        />
        <Divider />
        <ToggleRow
          label="Sunday evening preview"
          detail="A 6 PM rundown of the deals coming up that week."
          value={prefs.weeklyPreview}
          onValueChange={(v) => setPref('weeklyPreview', v)}
        />
        <Divider />
        <ToggleRow
          label="Monday reminder to run the deal search"
          detail="10 AM. New deals and codes show up after you run “Search deals” on your PC and upload them."
          value={prefs.refreshNudge}
          onValueChange={(v) => setPref('refreshNudge', v)}
        />
        <Divider />
        <ToggleRow
          label="Include unconfirmed deals"
          detail="Deals the weekly check found but couldn’t verify yet."
          value={prefs.includeUnconfirmed}
          onValueChange={(v) => setPref('includeUnconfirmed', v)}
        />
      </Card>

      <SectionHeader title="Categories" detail="A deal set to “Always” pings even if its category is off." />
      <Card>
        {CATEGORIES.map((cat, i) => {
          const meta = CATEGORY_META[cat];
          return (
            <Fragment key={cat}>
              {i > 0 ? <Divider /> : null}
              <ToggleRow
                label={`${meta.emoji}  ${meta.label}`}
                detail={plural(categoryCounts[cat], 'deal')}
                value={prefs.categories[cat]}
                onValueChange={(v) => updatePrefs((p) => ({ ...p, categories: { ...p.categories, [cat]: v } }))}
              />
            </Fragment>
          );
        })}
      </Card>

      <SectionHeader
        title="Muted restaurants"
        detail="Their deals are hidden everywhere and never send reminders."
      />
      {muted.length ? (
        <Card>
          {muted.map((m, i) => (
            <Fragment key={m.key}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.inlineRow}>
                <View style={styles.fill}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    🔇 {m.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {m.count ? `${plural(m.count, 'deal')} hidden` : 'No current deals'}
                  </ThemedText>
                </View>
                <Button small label="Unmute" onPress={() => setRestaurantsMuted([m.name], false)} />
              </View>
            </Fragment>
          ))}
          {muted.length > 1 ? (
            <>
              <Divider />
              <Button
                small
                variant="secondary"
                label="Unmute all"
                onPress={() => setRestaurantsMuted(muted.map((m) => m.name), false)}
              />
            </>
          ) : null}
        </Card>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing muted. Long-press any deal, tap Mute on a deal’s page, or switch a restaurant off below.
        </ThemedText>
      )}

      <SectionHeader title="All restaurants" detail="Switch one off to mute it." />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search restaurants"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Search restaurants"
        style={inputStyle}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {plural(restaurants.length, 'restaurant')} with current deals
        {query.trim() ? ` · ${visible.length} shown` : ''}
      </ThemedText>
      {visible.length ? (
        <Card>
          {visible.map((r, i) => {
            const isMuted = isRestaurantMuted(prefs, r.name);
            return (
              <Fragment key={r.key}>
                {i > 0 ? <Divider /> : null}
                <ToggleRow
                  label={r.name}
                  detail={isMuted ? `Muted · ${plural(r.count, 'deal')} hidden` : plural(r.count, 'deal')}
                  value={!isMuted}
                  onValueChange={() => toggleRestaurantMuted(r.name)}
                />
              </Fragment>
            );
          })}
        </Card>
      ) : (
        <EmptyState
          title={query.trim() ? 'No matches' : 'No restaurants yet'}
          body={query.trim() ? `Nothing matches “${query.trim()}”.` : 'They show up once the deal list loads.'}
        />
      )}

      <SectionHeader title="Your choices" detail="Deals you switched on or off by hand, and deals you hid." />
      {overrides.length === 0 && hiddenDeals.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing yet. Pick “Always” or “Never” on a deal, or hide it, and it shows up here so you can undo it.
        </ThemedText>
      ) : null}
      {overrides.length ? (
        <Card>
          <ThemedText type="tiny" themeColor="textSecondary">
            PER-DEAL SWITCHES
          </ThemedText>
          {overrides.map(({ deal, value }, i) => (
            <Fragment key={deal.id}>
              {i > 0 ? <Divider /> : null}
              <ChoiceRow deal={deal}>
                <Badge
                  label={value === 'on' ? 'Always' : 'Never'}
                  color={value === 'on' ? theme.success : theme.danger}
                />
                <Button small variant="secondary" label="Reset" onPress={() => setDealOverride(deal.id, null)} />
              </ChoiceRow>
            </Fragment>
          ))}
        </Card>
      ) : null}
      {hiddenDeals.length ? (
        <Card>
          <ThemedText type="tiny" themeColor="textSecondary">
            HIDDEN
          </ThemedText>
          {hiddenDeals.map((deal, i) => (
            <Fragment key={deal.id}>
              {i > 0 ? <Divider /> : null}
              <ChoiceRow deal={deal}>
                <Button small variant="secondary" label="Unhide" onPress={() => toggleHidden(deal.id)} />
              </ChoiceRow>
            </Fragment>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Data" detail="Where the deal list comes from" />
      <Card>
        <ThemedText type="smallBold">
          Deal list updated {updatedLabel} · {plural(file.deals.length, 'deal')}
        </ThemedText>
        {customDeals.length ? (
          <ThemedText type="small" themeColor="textSecondary">
            Plus {customDeals.length} you added on this phone.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {sync.lastAttempt
            ? `Last checked ${formatWhen(sync.lastAttempt, today)}`
            : 'Not checked yet — using the list that came with the app.'}
          {sync.error && sync.lastSuccess ? ` · last good download ${formatWhen(sync.lastSuccess, today)}` : ''}
        </ThemedText>
        {sync.error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            Last check failed: {sync.error}
          </ThemedText>
        ) : null}
        {sync.dropped ? (
          <ThemedText type="small" themeColor="textSecondary">
            {sync.dropped === 1 ? '1 entry' : `${sync.dropped} entries`} in the last download didn’t look right
            and {sync.dropped === 1 ? 'was' : 'were'} skipped.
          </ThemedText>
        ) : null}
        <Button
          label={syncing ? 'Checking…' : 'Check for new deals now'}
          disabled={syncing}
          onPress={() => {
            refresh();
          }}
        />
        <Divider />
        <ThemedText type="smallBold">Deals file address</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          A GitHub Action re-checks every deal each week and publishes this file. The app downloads it when you
          open it (if the copy here is over 6 hours old) and whenever you tap the button above.
        </ThemedText>
        <TextInput
          value={urlValue}
          onChangeText={(t) => {
            setUrlDraft(t);
            setUrlError(null);
          }}
          onSubmitEditing={() => applyUrl(urlValue)}
          placeholder={DEFAULT_DEALS_URL}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          accessibilityLabel="Deals file address"
          style={inputStyle}
        />
        {urlError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {urlError}
          </ThemedText>
        ) : null}
        <View style={styles.inlineRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
            {prefs.dataUrl === DEFAULT_DEALS_URL ? 'Using the default address.' : 'Using a custom address.'}
          </ThemedText>
          <Button small label="Save" disabled={!urlDirty} onPress={() => applyUrl(urlValue)} />
          <Button
            small
            variant="secondary"
            label="Use default"
            disabled={prefs.dataUrl === DEFAULT_DEALS_URL && urlDraft === null}
            onPress={() => applyUrl(DEFAULT_DEALS_URL)}
          />
        </View>
      </Card>

      {file.resources.length ? (
        <>
          <SectionHeader title="Resources" detail="Apps, sites and feeds worth checking yourself." />
          {file.resources.map((r, i) => (
            <ResourceCard key={`${r.name}-${i}`} resource={r} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** "raising cane's" -> "Raising Cane's", for a muted restaurant that no longer has deals to borrow a name from. */
const titleCase = (key: string) => key.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function byRestaurant(a: Deal, b: Deal): number {
  return compareNames(a.restaurant, b.restaurant) || compareNames(a.title, b.title);
}

function PermissionStatus({ permission, onAllow }: { permission: PermissionState; onAllow: () => void }) {
  switch (permission) {
    case 'granted':
      return (
        <View style={styles.permission}>
          <ThemedText type="smallBold">🔔 Reminders are on for this phone</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Deal Radar schedules them on the phone itself, so they arrive even without a connection.
          </ThemedText>
        </View>
      );
    case 'undetermined':
      return (
        <View style={styles.permission}>
          <ThemedText type="smallBold">Notifications aren’t allowed yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Allow them so Deal Radar can remind you about drops, last days and card credits.
          </ThemedText>
          <Button label="Allow notifications" onPress={onAllow} />
        </View>
      );
    case 'denied':
      return (
        <View style={styles.permission}>
          <ThemedText type="smallBold">🔕 Notifications are blocked</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Turn on notifications for Deal Radar in Settings to get reminders.
          </ThemedText>
          <Button label="Open Settings" onPress={() => Linking.openSettings().catch(() => undefined)} />
        </View>
      );
    default:
      return (
        <View style={styles.permission}>
          <ThemedText type="smallBold">Reminders only work in the phone app.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            You can still set everything up here; it applies once you open Deal Radar on your phone.
          </ThemedText>
        </View>
      );
  }
}

function Setting({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <View style={styles.setting}>
      <View>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {help}
        </ThemedText>
      </View>
      {children}
    </View>
  );
}

function ChoiceRow({ deal, children }: { deal: Deal; children: ReactNode }) {
  return (
    <View style={styles.inlineRow}>
      <Pressable
        onPress={() => openDeal(deal.id)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.fill, pressed && styles.pressed]}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {CATEGORY_META[deal.category].emoji} {deal.restaurant}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {deal.title}
        </ThemedText>
      </Pressable>
      {children}
    </View>
  );
}

function ResourceCard({ resource }: { resource: Resource }) {
  const { url } = resource;
  return (
    <Card onPress={url ? () => openLink(url) : undefined}>
      <View style={styles.inlineRow}>
        <ThemedText type="smallBold" style={styles.fill}>
          {resource.name}
        </ThemedText>
        <Badge label={RESOURCE_KIND[resource.kind]} />
        {url ? (
          <ThemedText type="small" themeColor="textSecondary">
            ↗
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small">{resource.why}</ThemedText>
      {resource.checkWhen ? (
        <ThemedText type="small" themeColor="textSecondary">
          When to check: {resource.checkWhen}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.75 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  permission: { gap: Spacing.two },
  setting: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
