// Web has no system tab bar, so draw a phone-style one at the bottom.
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

const TABS = [
  { name: 'index', href: '/', label: 'Today', icon: '🔥' },
  { name: 'calendar', href: '/calendar', label: 'Calendar', icon: '📅' },
  { name: 'week', href: '/week', label: 'Weekly', icon: '🔁' },
  { name: 'cards', href: '/cards', label: 'Cards', icon: '💳' },
  { name: 'alerts', href: '/alerts', label: 'Alerts', icon: '🔔' },
] as const;

export default function AppTabs() {
  const theme = useTheme();
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        {/* expo-router's Slot only accepts a flat style object on its child. */}
        <View
          style={StyleSheet.flatten([
            styles.bar,
            { backgroundColor: theme.backgroundElement, borderTopColor: theme.border },
          ])}>
          {TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton icon={t.icon}>{t.label}</TabButton>
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, icon, ref: _ref, ...props }: TabTriggerSlotProps & { icon: string }) {
  const theme = useTheme();
  return (
    <Pressable {...props} style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
      <ThemedText style={styles.icon}>{icon}</ThemedText>
      <ThemedText type="tiny" style={{ color: isFocused ? theme.tint : theme.textSecondary }}>
        {children}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  tab: { flex: 1, maxWidth: MaxContentWidth / 5, alignItems: 'center', gap: 2 },
  icon: { fontSize: 20, lineHeight: 24 },
});
