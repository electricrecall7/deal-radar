// Load / sync / schedule, kept free of React so it stays easy to test and reuse.
import bundledJson from '../../data/deals.json';

import type { UsedCredits } from '@/lib/benefits';
import { scheduleReminders } from '@/lib/notifications';
import { withDefaults, type Prefs } from '@/lib/prefs';
import { planReminders } from '@/lib/reminders';
import { parseDealsFile, type Deal, type DealsFile } from '@/lib/schema';
import { readJSON, saveJSON, type Stored } from '@/lib/storage';

export const KEYS = {
  file: 'dealradar:file',
  prefs: 'dealradar:prefs',
  used: 'dealradar:used',
  custom: 'dealradar:custom',
  sync: 'dealradar:sync',
} as const;

export interface SyncMeta {
  lastAttempt?: string;
  lastSuccess?: string;
  error?: string;
  /** Entries in the last download that failed validation. */
  dropped?: number;
  /** Deal ids that were new in the last download that changed anything. */
  newIds?: string[];
  /** The URL the saved deals file came from, so switching sources can accept an older file. */
  source?: string;
}

export interface Persisted {
  file: DealsFile;
  prefs: Prefs;
  used: UsedCredits;
  custom: Deal[];
  sync: SyncMeta;
}

export type UserKey = 'prefs' | 'used' | 'custom';

/** The deals.json that shipped inside this build; used until a download succeeds. */
export const BUNDLED: DealsFile = parseDealsFile(bundledJson).file;

const valueOf = <T,>(r: Stored<T>): T | null => (r.status === 'ok' ? r.value : null);

/** The downloaded deals file saved on the phone, if it parses. */
export function parseSavedFile(raw: unknown): DealsFile | null {
  try {
    return raw ? parseDealsFile(raw).file : null;
  } catch {
    return null;
  }
}

/**
 * Everything saved on the phone. `failed` lists user data that exists but couldn't be read, so the
 * caller doesn't overwrite it with defaults.
 */
export async function loadPersisted(): Promise<Persisted & { failed: UserKey[] }> {
  const [file, prefs, used, custom, sync] = await Promise.all([
    readJSON<unknown>(KEYS.file),
    readJSON<Partial<Prefs>>(KEYS.prefs),
    readJSON<UsedCredits>(KEYS.used),
    readJSON<Deal[]>(KEYS.custom),
    readJSON<SyncMeta>(KEYS.sync),
  ]);
  const cached = parseSavedFile(valueOf(file));
  const failed = (['prefs', 'used', 'custom'] as const).filter(
    (k) => ({ prefs, used, custom })[k].status === 'error',
  );
  return {
    file: cached && cached.updatedAt >= BUNDLED.updatedAt ? cached : BUNDLED,
    prefs: withDefaults(valueOf(prefs)),
    used: valueOf(used) ?? {},
    custom: valueOf(custom) ?? [],
    sync: valueOf(sync) ?? {},
    failed,
  };
}

export async function fetchDealsFile(url: string, timeoutMs = 15_000): Promise<{ file: DealsFile; dropped: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const bust = `${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    // The query string busts caches; a custom header would trigger a CORS preflight that GitHub rejects.
    const res = await fetch(url + bust, { signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    return parseDealsFile(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

export interface SyncResult {
  file: DealsFile;
  changed: boolean;
  newIds: string[];
  meta: SyncMeta;
}

/**
 * Download the published deals file; keeps `current` if the download fails or isn't newer. A file
 * from a different URL than last time is taken even if older (the user switched sources). The same
 * URL needs a strictly newer file, since a stale CDN copy right after a publish must not roll back.
 */
export async function syncDeals(current: DealsFile, url: string, previous: SyncMeta = {}): Promise<SyncResult> {
  const now = new Date().toISOString();
  try {
    const { file, dropped } = await fetchDealsFile(url);
    const sourceChanged = previous.source !== undefined && previous.source !== url;
    const changed = sourceChanged || file.updatedAt > current.updatedAt;
    const known = new Set(current.deals.map((d) => d.id));
    const newIds = changed ? file.deals.filter((d) => !known.has(d.id)).map((d) => d.id) : [];
    const meta: SyncMeta = {
      lastAttempt: now,
      lastSuccess: now,
      dropped,
      newIds: changed ? newIds : previous.newIds,
      source: url,
    };
    if (changed) await saveJSON(KEYS.file, file);
    await saveJSON(KEYS.sync, meta);
    return { file: changed ? file : current, changed, newIds, meta };
  } catch (e) {
    const meta: SyncMeta = { ...previous, lastAttempt: now, error: e instanceof Error ? e.message : String(e) };
    await saveJSON(KEYS.sync, meta);
    return { file: current, changed: false, newIds: [], meta };
  }
}

export function allDeals(file: DealsFile, custom: Deal[]): Deal[] {
  return [...file.deals, ...custom];
}

/** Replaces the phone's reminder queue; null when a newer reschedule superseded this one. */
export async function reschedule(p: Persisted, now = new Date()): Promise<number | null> {
  const reminders = planReminders({
    deals: allDeals(p.file, p.custom),
    benefits: p.file.benefits,
    prefs: p.prefs,
    used: p.used,
    cards: p.file.cards,
    now,
  });
  return scheduleReminders(reminders);
}
