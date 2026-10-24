import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { periodBounds, type UsedCredits } from '@/lib/benefits';
import { todayYMD, type YMD } from '@/lib/dates';
import { getPermission, requestPermission, type PermissionState } from '@/lib/notifications';
import { DEFAULT_PREFS, restaurantKey, type Override, type Prefs } from '@/lib/prefs';
import type { Benefit, Deal, DealsFile } from '@/lib/schema';
import { saveJSON } from '@/lib/storage';
import { onlyHeldCards } from '@/lib/wallet';

import {
  allDeals,
  BUNDLED,
  KEYS,
  loadPersisted,
  reschedule,
  syncDeals,
  type SyncMeta,
  type UserKey,
} from './engine';

/** Re-download when the app opens if the last good sync is older than this. */
const STALE_MS = 6 * 60 * 60 * 1000;

export interface AppStateValue {
  ready: boolean;
  today: YMD;
  /** The downloaded deal list, limited to the user's own cards (see wallet.ts). */
  file: DealsFile;
  /** Published deals plus the ones added on this phone. */
  deals: Deal[];
  customDeals: Deal[];
  prefs: Prefs;
  used: UsedCredits;
  sync: SyncMeta;
  syncing: boolean;
  /** How many reminders are queued on the phone right now (null until first scheduled). */
  scheduledCount: number | null;
  permission: PermissionState;
  getDeal: (id: string) => Deal | undefined;
  updatePrefs: (fn: (p: Prefs) => Prefs) => void;
  /** null clears the per-deal choice so the restaurant/category switches apply again. */
  setDealOverride: (id: string, value: Override | null) => void;
  toggleRestaurantMuted: (restaurant: string) => void;
  setRestaurantsMuted: (restaurants: string[], muted: boolean) => void;
  toggleHidden: (id: string) => void;
  toggleBenefitMuted: (id: string) => void;
  setBenefitUsed: (benefit: Benefit, used: boolean) => void;
  saveCustomDeal: (deal: Deal) => void;
  deleteCustomDeal: (id: string) => void;
  /** Check for a newer deals file; `url` overrides the saved data URL (used right after changing it). */
  refresh: (url?: string) => Promise<void>;
  requestNotifications: () => Promise<PermissionState>;
  rescheduleNow: () => Promise<number>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(todayYMD());
  const [file, setFile] = useState<DealsFile>(BUNDLED);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [used, setUsed] = useState<UsedCredits>({});
  const [customDeals, setCustomDeals] = useState<Deal[]>([]);
  const [sync, setSync] = useState<SyncMeta>({});
  const [syncing, setSyncing] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number | null>(null);
  const [permission, setPermission] = useState<PermissionState>('undetermined');

  // Latest values for callbacks that run outside render (AppState listener, refresh). A layout effect
  // runs before any child's passive effect, so a child calling refresh() never sees stale values.
  const latest = useRef({ file, prefs, sync });
  useLayoutEffect(() => {
    latest.current = { file, prefs, sync };
  });
  const syncingRef = useRef(false);
  // User data that exists but couldn't be read at launch; its first automatic save is skipped so a
  // flaky read doesn't overwrite real settings with defaults.
  const skipFirstSave = useRef(new Set<UserKey>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, perm] = await Promise.all([loadPersisted(), getPermission().catch(() => 'unsupported' as const)]);
      if (cancelled) return;
      skipFirstSave.current = new Set(p.failed);
      latest.current = { file: p.file, prefs: p.prefs, sync: p.sync };
      setFile(p.file);
      setPrefs(p.prefs);
      setUsed(p.used);
      setCustomDeals(p.custom);
      setSync(p.sync);
      setPermission(perm);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (url?: string) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const { file: current, prefs: p, sync: meta } = latest.current;
      // Handlers like RefreshControl may pass an event; only a string is a URL override.
      const source = typeof url === 'string' ? url : p.dataUrl;
      const result = await syncDeals(current, source, meta);
      latest.current = { ...latest.current, file: result.file, sync: result.meta };
      setSync(result.meta);
      if (result.changed) setFile(result.file);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Keep `today` right if the app stays open past midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const now = todayYMD();
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh when the data is stale: on launch and each time the app comes back to the foreground.
  useEffect(() => {
    if (!ready) return;
    const refreshIfStale = () => {
      setToday(todayYMD());
      const last = latest.current.sync.lastSuccess;
      if (!last || Date.now() - Date.parse(last) > STALE_MS) refresh();
    };
    refreshIfStale();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      refreshIfStale();
      getPermission().then(setPermission).catch(() => undefined);
    });
    return () => sub.remove();
  }, [ready, refresh]);

  // Persist user data (skipping the first save of anything that failed to load).
  const persist = useCallback((key: UserKey, value: unknown) => {
    if (skipFirstSave.current.delete(key)) return;
    saveJSON(KEYS[key], value);
  }, []);
  useEffect(() => {
    if (ready) persist('prefs', prefs);
  }, [ready, prefs, persist]);
  useEffect(() => {
    if (ready) persist('used', used);
  }, [ready, used, persist]);
  useEffect(() => {
    if (ready) persist('custom', customDeals);
  }, [ready, customDeals, persist]);

  // Syncing compares against the full download; everything the user sees uses only their own cards.
  const shownFile = useMemo(() => onlyHeldCards(file), [file]);

  const rescheduleNow = useCallback(
    () =>
      reschedule({ file: shownFile, prefs, used, custom: customDeals, sync }).then((n) => {
        // null: a newer reschedule replaced this one, and it will report its own count.
        if (n !== null) setScheduledCount(n);
        return n ?? 0;
      }),
    [shownFile, prefs, used, customDeals, sync],
  );

  // Rebuild the reminder queue (debounced) whenever anything that feeds it changes.
  useEffect(() => {
    if (!ready || permission !== 'granted') return;
    const t = setTimeout(() => {
      rescheduleNow().catch((e) => console.warn('Reschedule failed', e));
    }, 800);
    return () => clearTimeout(t);
  }, [ready, permission, today, rescheduleNow]);

  const deals = useMemo(() => allDeals(file, customDeals), [file, customDeals]);
  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  const updatePrefs = useCallback((fn: (p: Prefs) => Prefs) => setPrefs((p) => fn(p)), []);
  const getDeal = useCallback((id: string) => byId.get(id), [byId]);

  const value: AppStateValue = {
    ready,
    today,
    file: shownFile,
    deals,
    customDeals,
    prefs,
    used,
    sync,
    syncing,
    scheduledCount,
    permission,
    getDeal,
    updatePrefs,
    setDealOverride: (id, v) =>
      setPrefs((p) => {
        const dealOverrides = { ...p.dealOverrides };
        if (v) dealOverrides[id] = v;
        else delete dealOverrides[id];
        return { ...p, dealOverrides };
      }),
    toggleRestaurantMuted: (restaurant) =>
      setPrefs((p) => {
        const key = restaurantKey(restaurant);
        const muted = p.mutedRestaurants.includes(key);
        return {
          ...p,
          mutedRestaurants: muted ? p.mutedRestaurants.filter((k) => k !== key) : [...p.mutedRestaurants, key],
        };
      }),
    setRestaurantsMuted: (restaurants, muted) =>
      setPrefs((p) => {
        const keys = new Set(restaurants.map(restaurantKey));
        const rest = p.mutedRestaurants.filter((k) => !keys.has(k));
        return { ...p, mutedRestaurants: muted ? [...rest, ...keys] : rest };
      }),
    toggleHidden: (id) =>
      setPrefs((p) => ({
        ...p,
        hiddenDeals: p.hiddenDeals.includes(id) ? p.hiddenDeals.filter((x) => x !== id) : [...p.hiddenDeals, id],
      })),
    toggleBenefitMuted: (id) =>
      setPrefs((p) => ({
        ...p,
        mutedBenefits: p.mutedBenefits.includes(id) ? p.mutedBenefits.filter((x) => x !== id) : [...p.mutedBenefits, id],
      })),
    setBenefitUsed: (benefit, isUsed) =>
      setUsed((u) => {
        // Same day the screens use, so the switch and the label always agree.
        const period = periodBounds(benefit.period, today);
        const next = { ...u };
        if (isUsed && period) next[benefit.id] = period.key;
        else delete next[benefit.id];
        return next;
      }),
    saveCustomDeal: (deal) =>
      setCustomDeals((list) => {
        const d = { ...deal, custom: true };
        return list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d];
      }),
    deleteCustomDeal: (id) => setCustomDeals((list) => list.filter((x) => x.id !== id)),
    refresh,
    requestNotifications: async () => {
      const p = await requestPermission();
      setPermission(p);
      return p;
    },
    rescheduleNow,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState must be used inside AppStateProvider');
  return v;
}
