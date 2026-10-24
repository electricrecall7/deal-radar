import { router } from 'expo-router';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { YMD } from '@/lib/dates';
import { describeWhen } from '@/lib/format';
import { CARD_META, CATEGORY_META } from '@/lib/meta';
import { dealKind, isOver } from '@/lib/occurrences';
import { dealNotifies, restaurantKey } from '@/lib/prefs';
import type { Deal } from '@/lib/schema';
import { useAppState } from '@/state/app-state';

import { ThemedText } from './themed-text';
import { Badge, Card } from './ui';

export function openDeal(id: string) {
  router.push({ pathname: '/deal/[id]', params: { id } });
}

/** Live deals from the same restaurant, for "hides all 6 KFC deals". */
export function countRestaurantDeals(deals: Deal[], restaurant: string, today: YMD): number {
  const key = restaurantKey(restaurant);
  return deals.filter((d) => restaurantKey(d.restaurant) === key && !isOver(d, today)).length;
}

function muteMessage(restaurant: string, count: number): string {
  const what = count > 1 ? `all ${count} ${restaurant} deals` : `${restaurant}’s deals`;
  return `Muting hides ${what} everywhere and stops their reminders. You can unmute it in Alerts.`;
}

export function confirmMute(restaurant: string, count: number, mute: () => void) {
  const message = muteMessage(restaurant, count);
  if (Platform.OS === 'web') {
    if (window.confirm(`Mute ${restaurant}? ${message}`)) mute();
    return;
  }
  Alert.alert(`Mute ${restaurant}?`, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Mute', style: 'destructive', onPress: mute },
  ]);
}

/**
 * A deal in a list: tap for details, long-press to hide it or mute its restaurant. Shows a muted bell
 * when it won't notify.
 */
export function DealCard({ deal, note }: { deal: Deal; note?: string }) {
  const theme = useTheme();
  const { prefs, today, deals, toggleHidden, toggleRestaurantMuted } = useAppState();
  const meta = CATEGORY_META[deal.category];
  const notifies = dealNotifies(deal, prefs);
  // Always-on perks never send reminders, so a bell would be misleading.
  const showBell = dealKind(deal) !== 'ongoing';

  const showMenu = () => {
    const count = countRestaurantDeals(deals, deal.restaurant, today);
    const mute = () => toggleRestaurantMuted(deal.restaurant);
    // Web has no three-button dialog, so it goes straight to the mute question.
    if (Platform.OS === 'web') {
      confirmMute(deal.restaurant, count, mute);
      return;
    }
    Alert.alert(deal.restaurant, muteMessage(deal.restaurant, count), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide this deal', onPress: () => toggleHidden(deal.id) },
      { text: 'Mute', style: 'destructive', onPress: mute },
    ]);
  };

  return (
    <Card accent={meta.color} onPress={() => openDeal(deal.id)} onLongPress={showMenu}>
      <View style={styles.top}>
        <ThemedText type="smallBold" style={styles.restaurant} numberOfLines={1}>
          {meta.emoji} {deal.restaurant}
        </ThemedText>
        {deal.card ? <Badge label={CARD_META[deal.card].name} color={CARD_META[deal.card].color} /> : null}
        {deal.local ? <Badge label="SA" color={theme.tint} /> : null}
        {deal.status === 'unconfirmed' ? <Badge label="Unconfirmed" color={theme.warning} /> : null}
        {deal.custom ? <Badge label="Mine" /> : null}
        {showBell ? (
          <ThemedText type="small" accessibilityLabel={notifies ? 'Reminders on' : 'Reminders off'}>
            {notifies ? '🔔' : '🔕'}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="default">{deal.title}</ThemedText>
      <View style={styles.bottom}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.when}>
          {note ?? describeWhen(deal, today)}
        </ThemedText>
        {deal.code ? (
          <View style={[styles.code, { backgroundColor: theme.tintSoft }]}>
            <ThemedText type="code" style={{ color: theme.tint }}>
              {deal.code}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  restaurant: { flexShrink: 1, marginRight: 'auto' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  when: { flex: 1 },
  code: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
});
