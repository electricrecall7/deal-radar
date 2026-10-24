// Turns deals, card credits and preferences into the list of local
// notifications to schedule. Pure: no Expo imports, so it is unit-tested.
import { upcomingPeriods, type UsedCredits } from './benefits';
import { benefitAppliesToUser } from './card-variants';
import {
  addDays,
  atTime,
  diffDays,
  hhmmFromMinutes,
  minutesOf,
  nextWeekday,
  todayYMD,
  weekday,
  type YMD,
} from './dates';
import { formatShortDate, formatTime, WEEKDAYS_LONG, WEEKDAYS_SHORT } from './format';
import { CARD_META, CHANNEL_LABEL } from './meta';
import { dealKind, isCalendarDay, isOneDay, occursOn, spanDays } from './occurrences';
import { dealNotifies, wantsBenefit, wantsDeal, type Prefs } from './prefs';
import type { Benefit, CardInfo, Deal } from './schema';

export type ReminderKind =
  | 'today'
  | 'starts'
  | 'ending'
  | 'last-day'
  | 'digest'
  | 'heads-up'
  | 'credits'
  | 'week-preview'
  | 'refresh';

export interface Reminder {
  /** Stable key, also used as the notification identifier. */
  id: string;
  kind: ReminderKind;
  day: YMD;
  fireAt: Date;
  title: string;
  body: string;
  dealId?: string;
  benefitIds?: string[];
}

export interface PlanInput {
  deals: Deal[];
  benefits: Benefit[];
  prefs: Prefs;
  used: UsedCredits;
  /** Card variants from deals.json; when given, credits for variants the user doesn't hold are skipped. */
  cards?: CardInfo[];
  now: Date;
  horizonDays?: number;
  max?: number;
}

/** iOS keeps at most 64 pending local notifications per app; leave a little room. */
export const IOS_PENDING_LIMIT = 64;
export const DEFAULT_MAX_REMINDERS = 60;
export const DEFAULT_HORIZON_DAYS = 21;
/** Three or more same-time reminders on one day collapse into one digest. */
export const DIGEST_THRESHOLD = 3;

const EARLIEST_TIME = '07:00';
const PREVIEW_TIME = '18:00';
const REFRESH_TIME = '10:00';
/** A heads-up within this many minutes of the day reminder replaces it. */
const MERGE_WINDOW_MIN = 60;

type DealReminderKind = 'today' | 'starts' | 'ending' | 'last-day';

interface DayItem {
  deal: Deal;
  kind: DealReminderKind;
  time: string;
  title: string;
  body: string;
  line: string;
}

function howToRedeem(d: Deal): string {
  const parts: string[] = [];
  if (d.channel && d.channel !== 'any') parts.push(CHANNEL_LABEL[d.channel]);
  if (d.code) parts.push(`code ${d.code}`);
  if (d.local && d.location) parts.push(d.location);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

function timeHint(d: Deal): string {
  if (d.startTime) return ` · ${formatTime(d.startTime)}`;
  if (d.endTime) return ` · until ${formatTime(d.endTime)}`;
  return '';
}

/** When the morning reminder for a deal should fire on its day. */
function reminderTime(d: Deal, prefs: Prefs): string {
  const digest = minutesOf(prefs.digestTime);
  if (d.endTime && minutesOf(d.endTime) <= digest + 30) {
    const anchor = d.startTime ? minutesOf(d.startTime) : minutesOf(d.endTime) - 120;
    return hhmmFromMinutes(Math.max(minutesOf(EARLIEST_TIME), anchor - 30));
  }
  return prefs.digestTime;
}

function dayItem(d: Deal, day: YMD, prefs: Prefs): DayItem | null {
  const kind = dealKind(d);
  // Ongoing perks (sign-up and birthday rewards) live on the Today screen, not in notifications.
  if (kind === 'ongoing' || !occursOn(d, day)) return null;

  const what = `${d.title}${timeHint(d)}${howToRedeem(d)}`;
  const time = reminderTime(d, prefs);
  const make = (k: DealReminderKind, title: string, label: string): DayItem => ({
    deal: d,
    kind: k,
    time,
    title,
    body: what,
    line: `${label}${d.restaurant}: ${d.title}${timeHint(d)}`,
  });

  if (kind === 'weekly') return make('today', `Today: ${d.restaurant}`, '');
  if (spanDays(d) === 0) return make('today', `Today only: ${d.restaurant}`, '');

  const toEnd = diffDays(day, d.end!);
  if (toEnd === 0 && prefs.expiryDaysBefore >= 0) return make('last-day', `Last day: ${d.restaurant}`, 'Last day · ');
  // Only announce a start we knew about in advance; deals found already running just appear in the app.
  if (day === d.start && d.start > (d.firstSeen ?? '')) {
    const item = make('starts', `Starts today: ${d.restaurant}`, 'Starts · ');
    item.body = `${what} · through ${formatShortDate(d.end!)}`;
    return item;
  }
  if (prefs.expiryDaysBefore > 0 && toEnd === prefs.expiryDaysBefore) {
    const when = toEnd === 1 ? 'tomorrow' : `in ${toEnd} days`;
    return make('ending', `Ends ${when}: ${d.restaurant}`, `Ends ${when} · `);
  }
  return null;
}

function headsUp(d: Deal, day: YMD, prefs: Prefs): { time: string; title: string; body: string } | null {
  if (prefs.leadMinutes <= 0 || !d.startTime || !occursOn(d, day)) return null;
  // One-off timed events only (a 4 PM giveaway, an app drop). Recurring happy hours would ping
  // every day, so weekly specials get a heads-up only when switched to Always.
  const weeklyOptIn = dealKind(d) === 'weekly' && prefs.dealOverrides[d.id] === 'on';
  if (!isOneDay(d) && !weeklyOptIn) return null;
  const at = minutesOf(d.startTime) - prefs.leadMinutes;
  if (at < 0) return null;
  return {
    time: hhmmFromMinutes(at),
    title: `${d.restaurant} in ${prefs.leadMinutes} min`,
    body: `${d.title} starts at ${formatTime(d.startTime)}${howToRedeem(d)}`,
  };
}

const KIND_ORDER: Record<DealReminderKind, number> = { 'last-day': 0, starts: 1, ending: 2, today: 3 };

export function planReminders(input: PlanInput): Reminder[] {
  const { deals, benefits, prefs, used, now } = input;
  if (!prefs.notificationsEnabled) return [];
  const horizon = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const max = input.max ?? DEFAULT_MAX_REMINDERS;
  const today = todayYMD(now);
  const out: Reminder[] = [];
  const live = deals.filter((d) => !(d.end && d.end < today));
  const wanted = live.filter((d) => dealNotifies(d, prefs));

  for (let i = 0; i <= horizon; i++) {
    const day = addDays(today, i);
    const atDigest: DayItem[] = [];

    for (const d of wanted) {
      let item = dayItem(d, day, prefs);
      const heads = headsUp(d, day, prefs);
      if (heads) {
        out.push({
          id: `heads-up:${d.id}:${day}`,
          kind: 'heads-up',
          day,
          fireAt: atTime(day, heads.time),
          title: heads.title,
          body: heads.body,
          dealId: d.id,
        });
        if (item && Math.abs(minutesOf(item.time) - minutesOf(heads.time)) <= MERGE_WINDOW_MIN) item = null;
      }
      if (!item) continue;
      if (item.time === prefs.digestTime) atDigest.push(item);
      else out.push(toReminder(item, day));
    }

    if (atDigest.length >= DIGEST_THRESHOLD) {
      atDigest.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      const lastDays = atDigest.filter((x) => x.kind === 'last-day').length;
      out.push({
        id: `digest:${day}`,
        kind: 'digest',
        day,
        fireAt: atTime(day, prefs.digestTime),
        title: `${WEEKDAYS_LONG[weekday(day)]}: ${atDigest.length} deals for you${
          lastDays ? ` · ${lastDays} ending` : ''
        }`,
        body: atDigest.map((x) => x.line).join('\n'),
      });
    } else {
      for (const item of atDigest) out.push(toReminder(item, day));
    }
  }

  const held = input.cards ? benefits.filter((b) => benefitAppliesToUser(b, input.cards!, prefs.cardVariants)) : benefits;
  out.push(...creditReminders(held, prefs, used, today, horizon));

  if (prefs.weeklyPreview) {
    for (let sunday = nextWeekday(today, 0); diffDays(today, sunday) <= horizon; sunday = addDays(sunday, 7)) {
      // The preview covers everything the user hasn't muted, including weekly specials that don't ping.
      const body = weekPreviewBody(live.filter((d) => wantsDeal(d, prefs) && dealKind(d) !== 'ongoing'), sunday);
      if (!body) continue;
      out.push({
        id: `week-preview:${sunday}`,
        kind: 'week-preview',
        day: sunday,
        fireAt: atTime(sunday, PREVIEW_TIME),
        title: 'Your deal week ahead',
        body,
      });
    }
  }

  if (prefs.refreshNudge) {
    for (let monday = nextWeekday(today, 1); diffDays(today, monday) <= horizon; monday = addDays(monday, 7)) {
      out.push({
        id: `refresh:${monday}`,
        kind: 'refresh',
        day: monday,
        fireAt: atTime(monday, REFRESH_TIME),
        title: 'This week’s deals are in',
        body: 'Tap to load the new list and update your reminders.',
      });
    }
  }

  const soonest = now.getTime() + 60_000;
  return out
    .filter((r) => r.fireAt.getTime() > soonest)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, max);
}

function toReminder(item: DayItem, day: YMD): Reminder {
  return {
    id: `${item.kind}:${item.deal.id}:${day}`,
    kind: item.kind,
    day,
    fireAt: atTime(day, item.time),
    title: item.title,
    body: item.body,
    dealId: item.deal.id,
  };
}

function creditReminders(
  benefits: Benefit[],
  prefs: Prefs,
  used: UsedCredits,
  today: YMD,
  horizon: number,
): Reminder[] {
  if (prefs.benefitDaysBefore < 0) return [];
  const groups = new Map<string, { day: YMD; lastDay: boolean; items: Benefit[] }>();
  const add = (day: YMD, lastDay: boolean, b: Benefit) => {
    const key = `${day}:${lastDay ? 'last' : 'warn'}`;
    const g = groups.get(key) ?? { day, lastDay, items: [] };
    g.items.push(b);
    groups.set(key, g);
  };

  const lastDay = addDays(today, horizon);
  for (const b of benefits) {
    if (!wantsBenefit(b, prefs)) continue;
    // Look past the horizon by the warning lead so a warning inside it isn't lost to a period end outside it.
    for (const p of upcomingPeriods(b.period, today, horizon + Math.max(0, prefs.benefitDaysBefore))) {
      if (used[b.id] === p.key) continue;
      if (p.end <= lastDay) add(p.end, true, b);
      if (prefs.benefitDaysBefore > 0) {
        const warn = addDays(p.end, -prefs.benefitDaysBefore);
        if (warn >= today && warn > p.start && warn <= lastDay) add(warn, false, b);
      }
    }
  }

  return [...groups.entries()].map(([key, g]) => {
    const when = g.lastDay ? 'tonight' : `in ${prefs.benefitDaysBefore} day${prefs.benefitDaysBefore === 1 ? '' : 's'}`;
    const first = g.items[0];
    const title =
      g.items.length === 1
        ? `${CARD_META[first.card].name}: ${first.title} resets ${when}`
        : `${g.items.length} card credits reset ${when}`;
    const body =
      g.items.map((b) => `${CARD_META[b.card].short}: ${b.title}`).join(' · ') +
      (g.lastDay ? ' — use it or lose it.' : '');
    return {
      id: `credits:${key}`,
      kind: 'credits' as const,
      day: g.day,
      fireAt: atTime(g.day, prefs.digestTime),
      title,
      body,
      benefitIds: g.items.map((b) => b.id),
    };
  });
}

function weekPreviewBody(wanted: Deal[], sunday: YMD): string {
  const lines: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const day = addDays(sunday, i);
    const names = [...new Set(wanted.filter((d) => isCalendarDay(d, day)).map((d) => d.restaurant))];
    if (!names.length) continue;
    const shown = names.slice(0, 3).join(', ');
    lines.push(`${WEEKDAYS_SHORT[weekday(day)]}: ${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`);
  }
  return lines.join('\n');
}
