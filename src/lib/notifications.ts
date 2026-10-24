import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Reminder } from './reminders';

export const CHANNEL_ID = 'deals';
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export function configureNotificationHandler() {
  if (!supported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Deal reminders',
    // eslint-plugin-import can't see enums re-exported with `export *`; they exist at runtime.
    // eslint-disable-next-line import/namespace
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export async function getPermission(): Promise<PermissionState> {
  if (!supported) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  // eslint-disable-next-line import/namespace
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.status === 'undetermined' || p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  if (!supported) return 'unsupported';
  // Android 13+ only shows the system prompt once a channel exists.
  await ensureChannel();
  const p = await Notifications.requestPermissionsAsync();
  return p.granted ? 'granted' : 'denied';
}

// Reschedules run one at a time, and only the newest plan is applied: an older run that is still
// scheduling would otherwise interleave with a newer run's cancel-all and leave a mixed queue.
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Replace every pending reminder with `reminders`. Returns how many were scheduled, or null when a
 * newer call superseded this one before it finished.
 */
export function scheduleReminders(reminders: Reminder[]): Promise<number | null> {
  const mine = ++generation;
  const run = queue.then(() => applyReminders(reminders, mine));
  queue = run.catch(() => undefined);
  return run;
}

async function applyReminders(reminders: Reminder[], mine: number): Promise<number | null> {
  const stale = () => mine !== generation;
  if (stale()) return null;
  if (!supported || (await getPermission()) !== 'granted') return 0;
  await ensureChannel();
  if (stale()) return null;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let count = 0;
  for (const r of reminders) {
    if (stale()) return null;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: { title: r.title, body: r.body, data: { dealId: r.dealId ?? null, kind: r.kind } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.fireAt, channelId: CHANNEL_ID },
      });
      count++;
    } catch (e) {
      console.warn(`Could not schedule ${r.id}`, e);
    }
  }
  return count;
}

export async function notifyNow(title: string, body: string, data: Record<string, unknown> = {}) {
  if (!supported || (await getPermission()) !== 'granted') return;
  await ensureChannel();
  // An immediate notification still needs the channel on Android, or it lands in "Miscellaneous".
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}
