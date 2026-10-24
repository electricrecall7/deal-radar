// Best-effort background refresh. The OS decides when (often overnight), so the
// "time for your weekly deal search" reminder is the reliable fallback.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { loadPersisted, reschedule, syncDeals } from '@/state/engine';

import { notifyNow } from './notifications';
import { wantsDeal } from './prefs';

export const SYNC_TASK = 'deal-radar-sync';

if (Platform.OS !== 'web') {
  TaskManager.defineTask(SYNC_TASK, async () => {
    try {
      const p = await loadPersisted();
      const result = await syncDeals(p.file, p.prefs.dataUrl, p.sync);
      if (result.changed && p.prefs.notificationsEnabled) {
        const fresh = result.file.deals.filter((d) => result.newIds.includes(d.id) && wantsDeal(d, p.prefs));
        if (fresh.length) {
          await notifyNow(
            `${fresh.length} new deal${fresh.length === 1 ? '' : 's'} found`,
            fresh.slice(0, 4).map((d) => `${d.restaurant}: ${d.title}`).join('\n'),
            { kind: 'new-deals' },
          );
        }
      }
      await reschedule({ ...p, file: result.file, sync: result.meta });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundSync() {
  if (Platform.OS === 'web') return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 12 * 60 });
  } catch (e) {
    console.warn('Background refresh unavailable', e);
  }
}
