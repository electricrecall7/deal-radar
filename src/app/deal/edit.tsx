import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { DateField, Field, FormInput, parseDateInput, parseTimeInput, TimeField } from '@/components/date-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Divider, EmptyState, Screen, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { lastOfMonth, ymdParts, type YMD } from '@/lib/dates';
import { formatDays, WEEKDAYS_SHORT } from '@/lib/format';
import { CARD_META, CATEGORY_META, CHANNEL_LABEL } from '@/lib/meta';
import { restaurantKey } from '@/lib/prefs';
import {
  CARD_IDS,
  CATEGORIES,
  CHANNELS,
  DealSchema,
  type CardId,
  type Category,
  type Channel,
  type Deal,
} from '@/lib/schema';
import { useAppState } from '@/state/app-state';

interface Form {
  restaurant: string;
  title: string;
  category: Category;
  card?: CardId;
  channel?: Channel;
  code: string;
  start: string;
  /** '' = no end date. */
  end: string;
  days: number[];
  startTime: string;
  endTime: string;
  details: string;
  location: string;
  sourceUrl: string;
  local: boolean;
}

type FieldKey = 'restaurant' | 'title' | 'start' | 'end' | 'startTime' | 'endTime';
type Errors = Partial<Record<FieldKey, string>>;

const MAX_SUGGESTIONS = 5;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function asCategory(v: string | undefined): Category {
  return CATEGORIES.find((c) => c === v) ?? 'app';
}

function asCard(v: string | undefined): CardId | undefined {
  return CARD_IDS.find((c) => c === v);
}

export default function EditDealScreen() {
  const params = useLocalSearchParams<{ id?: string; category?: string; card?: string }>();
  const { ready, getDeal } = useAppState();
  const existing = params.id ? getDeal(params.id) : undefined;

  // Custom deals load from storage; wait so an edit doesn't start from a blank form.
  if (!ready) return <Screen tabScreen={false}>{null}</Screen>;

  if (params.id && !existing?.custom) {
    return (
      <Screen tabScreen={false}>
        <Stack.Screen options={{ title: 'Edit deal' }} />
        <EmptyState
          title={existing ? 'Only deals you added can be edited' : 'This deal no longer exists'}
          body={existing ? 'Published deals are updated by the weekly search.' : undefined}
        />
        <Button label="Back" variant="secondary" onPress={goBack} />
      </Screen>
    );
  }

  return (
    <DealEditor
      key={existing?.id ?? 'new'}
      existing={existing}
      category={asCategory(params.category)}
      card={asCard(params.card)}
    />
  );
}

function initialForm(existing: Deal | undefined, category: Category, card: CardId | undefined, today: YMD): Form {
  if (existing) {
    return {
      restaurant: existing.restaurant,
      title: existing.title,
      category: existing.category,
      card: existing.card,
      channel: existing.channel,
      code: existing.code ?? '',
      start: existing.start,
      end: existing.end ?? '',
      days: existing.days ?? [],
      startTime: existing.startTime ?? '',
      endTime: existing.endTime ?? '',
      details: existing.details ?? '',
      location: existing.location ?? '',
      sourceUrl: existing.sourceUrl ?? '',
      local: existing.local ?? false,
    };
  }
  const isCard = category === 'card';
  const { y, m } = ymdParts(today);
  return {
    restaurant: '',
    title: '',
    category,
    card,
    channel: isCard ? 'card' : undefined,
    code: '',
    start: today,
    end: isCard ? lastOfMonth(y, m) : '',
    days: [],
    startTime: '',
    endTime: '',
    details: '',
    location: '',
    sourceUrl: '',
    local: false,
  };
}

/** Whether nothing was changed; weekdays compare as a set since taps add them in any order. */
function sameForm(a: Form, b: Form): boolean {
  const days = (f: Form) => [...f.days].sort((x, y) => x - y).join(',');
  return (Object.keys(a) as (keyof Form)[]).every((k) => (k === 'days' ? days(a) === days(b) : a[k] === b[k]));
}

function validate(f: Form): Errors {
  const e: Errors = {};
  if (!f.restaurant.trim()) e.restaurant = 'Enter the restaurant or store.';
  if (!f.title.trim()) e.title = 'Say what the deal is.';

  const start = parseDateInput(f.start);
  if (!start) e.start = 'Enter a real date as YYYY-MM-DD.';
  if (f.end.trim()) {
    const end = parseDateInput(f.end);
    if (!end) e.end = 'Enter a real date as YYYY-MM-DD, or pick “No end date”.';
    else if (start && end < start) e.end = 'The end date is before the start date.';
  }

  const st = f.startTime.trim() ? parseTimeInput(f.startTime) : undefined;
  const et = f.endTime.trim() ? parseTimeInput(f.endTime) : undefined;
  if (st === null) e.startTime = 'Use 24-hour HH:MM, like 13:30.';
  if (et === null) e.endTime = 'Use 24-hour HH:MM, like 18:00.';
  else if (st && et && et <= st) e.endTime = 'Must be after the start time.';
  return e;
}

function normalizeUrl(text: string): string | undefined {
  const s = text.trim();
  if (!s) return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

/** The form as a Deal-shaped object; DealSchema has the final say. */
function toDeal(f: Form, existing: Deal | undefined, today: YMD): unknown {
  const opt = (s: string) => s.trim() || undefined;
  const sourceUrl = normalizeUrl(f.sourceUrl);
  const startTime = opt(f.startTime);
  const endTime = opt(f.endTime);
  return {
    ...existing,
    id: existing?.id ?? `custom-${Date.now().toString(36)}`,
    restaurant: f.restaurant.trim().replace(/\s+/g, ' '),
    title: f.title.trim(),
    category: f.category,
    card: f.category === 'card' ? f.card : undefined,
    channel: f.channel,
    code: opt(f.code),
    start: parseDateInput(f.start) ?? f.start,
    end: f.end.trim() ? (parseDateInput(f.end) ?? f.end) : undefined,
    days: f.days.length ? [...f.days].sort((a, b) => a - b) : undefined,
    startTime: startTime ? (parseTimeInput(startTime) ?? startTime) : undefined,
    endTime: endTime ? (parseTimeInput(endTime) ?? endTime) : undefined,
    details: opt(f.details),
    location: opt(f.location),
    sourceUrl,
    // A name saved for the old link would mislabel a new one.
    sourceName: sourceUrl && sourceUrl === existing?.sourceUrl ? existing.sourceName : undefined,
    local: f.local || undefined,
    status: 'confirmed',
    custom: true,
    firstSeen: existing?.firstSeen ?? today,
  };
}

function DealEditor({
  existing,
  category,
  card,
}: {
  existing: Deal | undefined;
  category: Category;
  card: CardId | undefined;
}) {
  const theme = useTheme();
  const { today, deals, saveCustomDeal } = useAppState();
  const [initial] = useState(() => initialForm(existing, category, card, today));
  const [form, setForm] = useState<Form>(initial);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set once the deal is saved or the user agreed to discard it, so leaving isn't questioned again.
  const [leaving, setLeaving] = useState(false);

  // Cancel, the back button and swiping the modal down all land here while there are unsaved edits.
  const allowLeave = usePreventRemove(!leaving && !sameForm(form, initial), ({ repeat }) => {
    const discard = () => {
      setLeaving(true);
      repeat();
    };
    const title = existing ? 'Discard your changes?' : 'Discard this deal?';
    const message = 'What you entered hasn’t been saved.';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title} ${message}`)) discard();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const touch = (key: FieldKey) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  const errors = useMemo(() => validate(form), [form]);
  const shown = (key: FieldKey) => (submitted || touched[key] ? errors[key] : undefined);
  const hasErrors = Object.keys(errors).length > 0;

  const restaurants = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const d of deals) {
      const key = restaurantKey(d.restaurant);
      if (!byKey.has(key)) byKey.set(key, d.restaurant.trim());
    }
    return [...byKey.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [deals]);

  const suggestions = useMemo(() => {
    const q = restaurantKey(form.restaurant);
    if (!q) return [];
    const starts: string[] = [];
    const contains: string[] = [];
    for (const [key, name] of restaurants) {
      if (key === q) continue;
      if (key.startsWith(q)) starts.push(name);
      else if (key.includes(q)) contains.push(name);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [restaurants, form.restaurant]);

  const pickCategory = (c: Category) =>
    setForm((f) => ({ ...f, category: c, channel: c === 'card' && !f.channel ? 'card' : f.channel }));

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }));

  const save = () => {
    setSubmitted(true);
    if (hasErrors) {
      setSaveError(null);
      return;
    }
    const parsed = DealSchema.safeParse(toDeal(form, existing, today));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setSaveError(`Couldn’t save: ${issue.path.join('.') || 'deal'} — ${issue.message}`);
      return;
    }
    saveCustomDeal(parsed.data);
    // The new state hasn't rendered yet, so lift the guard directly before navigating.
    setLeaving(true);
    allowLeave();
    goBack();
  };

  const isCard = form.category === 'card';
  const title = existing ? 'Edit deal' : isCard ? 'Add a card offer' : 'Add a deal';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <Stack.Screen options={{ title }} />
      <Screen tabScreen={false}>
        <Field label="Restaurant" error={shown('restaurant')}>
          <FormInput
            value={form.restaurant}
            onChangeText={(v) => set('restaurant', v)}
            onBlur={() => touch('restaurant')}
            placeholder="e.g. Whataburger"
            autoCapitalize="words"
            autoCorrect={false}
            invalid={!!shown('restaurant')}
            accessibilityLabel="Restaurant"
          />
          {suggestions.length ? (
            <View style={styles.wrap}>
              {suggestions.map((name) => (
                <Chip key={name} label={name} onPress={() => set('restaurant', name)} />
              ))}
            </View>
          ) : null}
        </Field>

        <Field label="Title" error={shown('title')}>
          <FormInput
            value={form.title}
            onChangeText={(v) => set('title', v)}
            onBlur={() => touch('title')}
            placeholder={isCard ? 'e.g. Spend $15, get $5 back' : 'e.g. Free fries with any purchase'}
            invalid={!!shown('title')}
            accessibilityLabel="Title"
          />
        </Field>

        <Field label="Category">
          <View style={styles.wrap}>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={`${CATEGORY_META[c].emoji} ${CATEGORY_META[c].label}`}
                color={CATEGORY_META[c].color}
                selected={form.category === c}
                onPress={() => pickCategory(c)}
              />
            ))}
          </View>
        </Field>

        {isCard ? (
          <Field label="Card" hint="Which card the offer is loaded on.">
            <View style={styles.wrap}>
              {CARD_IDS.map((c) => (
                <Chip
                  key={c}
                  label={CARD_META[c].name}
                  color={CARD_META[c].color}
                  selected={form.card === c}
                  onPress={() => set('card', form.card === c ? undefined : c)}
                />
              ))}
            </View>
          </Field>
        ) : null}

        <Field label="How to redeem">
          <View style={styles.wrap}>
            {CHANNELS.map((c) => (
              <Chip
                key={c}
                label={CHANNEL_LABEL[c]}
                selected={form.channel === c}
                onPress={() => set('channel', form.channel === c ? undefined : c)}
              />
            ))}
          </View>
        </Field>

        <Field label="Promo code" hint="Optional">
          <FormInput
            value={form.code}
            onChangeText={(v) => set('code', v)}
            placeholder="e.g. FREEFRIES"
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Promo code"
          />
        </Field>

        <Divider />

        <DateField
          label="Start date"
          value={form.start}
          onChangeText={(v) => set('start', v)}
          onBlur={() => touch('start')}
          today={today}
          error={shown('start')}
        />
        <DateField
          label="End date"
          value={form.end}
          onChangeText={(v) => set('end', v)}
          onBlur={() => touch('end')}
          today={today}
          anchor={parseDateInput(form.start)}
          allowEmpty
          error={shown('end')}
        />

        <Field
          label="Repeats weekly on"
          hint={
            form.days.length
              ? `Every ${formatDays(form.days)} between the start and end dates.`
              : 'None picked = every day between the start and end dates.'
          }>
          <View style={styles.wrap}>
            {WEEKDAYS_SHORT.map((name, d) => (
              <Chip key={name} label={name} selected={form.days.includes(d)} onPress={() => toggleDay(d)} />
            ))}
          </View>
        </Field>

        <View style={styles.row}>
          <View style={styles.fill}>
            <TimeField
              label="Start time"
              value={form.startTime}
              onChangeText={(v) => set('startTime', v)}
              onBlur={() => touch('startTime')}
              error={shown('startTime')}
            />
          </View>
          <View style={styles.fill}>
            <TimeField
              label="End time"
              value={form.endTime}
              onChangeText={(v) => set('endTime', v)}
              onBlur={() => touch('endTime')}
              error={shown('endTime')}
            />
          </View>
        </View>

        <Divider />

        <Field label="Details" hint="Optional: minimum spend, limits, which items.">
          <FormInput
            value={form.details}
            onChangeText={(v) => set('details', v)}
            placeholder="Anything you need to remember at the counter"
            multiline
            accessibilityLabel="Details"
          />
        </Field>

        <Field label="Location" hint="Optional. Opens in Google Maps from the deal page.">
          <FormInput
            value={form.location}
            onChangeText={(v) => set('location', v)}
            placeholder="e.g. 1234 Zarzamora St"
            accessibilityLabel="Location"
          />
        </Field>

        <Field label="Source link" hint="Optional">
          <FormInput
            value={form.sourceUrl}
            onChangeText={(v) => set('sourceUrl', v)}
            placeholder="https://…"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Source link"
          />
        </Field>

        <ToggleRow
          label="San Antonio only"
          detail="Only at San Antonio-area locations or events."
          value={form.local}
          onValueChange={(v) => set('local', v)}
        />

        {submitted && hasErrors ? (
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            Fix the fields marked in red, then save again.
          </ThemedText>
        ) : null}
        {saveError ? (
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {saveError}
          </ThemedText>
        ) : null}

        <View style={styles.row}>
          <View style={styles.fill}>
            <Button label="Cancel" variant="secondary" onPress={goBack} />
          </View>
          <View style={styles.fill}>
            <Button label={existing ? 'Save changes' : 'Save deal'} onPress={save} />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
