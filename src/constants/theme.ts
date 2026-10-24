import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#16181C',
    background: '#F5F4F0',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#ECE9E2',
    textSecondary: '#5E636E',
    border: '#E3DFD6',
    tint: '#D9480F',
    tintSoft: '#FFE8DC',
    onTint: '#FFFFFF',
    success: '#2B8A3E',
    warning: '#C76A00',
    danger: '#C92A2A',
    onDanger: '#FFFFFF',
  },
  dark: {
    text: '#F2F1EE',
    background: '#0E0F11',
    backgroundElement: '#1A1C20',
    backgroundSelected: '#272A2F',
    textSecondary: '#A4A9B2',
    border: '#2D3036',
    tint: '#FF7B3A',
    tintSoft: '#3A2216',
    onTint: '#140A04',
    success: '#5CCB71',
    warning: '#FFB050',
    danger: '#FF6B6B',
    // Like onTint: white on the lighter dark-mode danger fails contrast, so text on it is near-black.
    onDanger: '#1A0505',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

/** Room to leave under scrolling content so the tab bar doesn't cover it. */
export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 90 }) ?? 0;
export const MaxContentWidth = 720;
