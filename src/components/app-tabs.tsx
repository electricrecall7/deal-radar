import { NativeTabs } from 'expo-router/native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs tintColor={colors.tint} backgroundColor={colors.backgroundElement}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'flame', selected: 'flame.fill' }} md="local_fire_department" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="week">
        <NativeTabs.Trigger.Label>Weekly</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="repeat" md="event_repeat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="cards">
        <NativeTabs.Trigger.Label>Cards</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} md="credit_card" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
