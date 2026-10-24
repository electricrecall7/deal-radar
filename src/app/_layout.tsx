import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { NotificationRouter } from '@/components/notification-router';
import { Colors } from '@/constants/theme';
import { configureNotificationHandler } from '@/lib/notifications';
import { AppStateProvider, useAppState } from '@/state/app-state';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

function SplashGate() {
  const { ready } = useAppState();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];

  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...navTheme,
        colors: { ...navTheme.colors, primary: colors.tint, background: colors.background, card: colors.backgroundElement },
      }}>
      <AppStateProvider>
        <SplashGate />
        <NotificationRouter />
        <Stack screenOptions={{ headerTintColor: colors.tint, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="deal/[id]" options={{ title: 'Deal' }} />
          <Stack.Screen name="deal/edit" options={{ title: 'Add a deal', presentation: 'modal' }} />
          <Stack.Screen name="scheduled" options={{ title: 'Upcoming reminders' }} />
        </Stack>
      </AppStateProvider>
    </ThemeProvider>
  );
}
