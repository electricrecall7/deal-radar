import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useAppState } from '@/state/app-state';

/** Opens the right screen when a reminder is tapped. */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { ready, refresh } = useAppState();

  useEffect(() => {
    if (!ready || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data as { dealId?: string | null; kind?: string };
    if (data.kind === 'refresh' || data.kind === 'new-deals') refresh();
    if (data.dealId) router.push({ pathname: '/deal/[id]', params: { id: data.dealId } });
    else if (data.kind === 'credits') router.navigate('/cards');
    else if (data.kind === 'week-preview') router.navigate('/week');
    else router.navigate('/');
    Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [ready, response, refresh]);

  return null;
}
