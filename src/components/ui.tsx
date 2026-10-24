// Small shared building blocks so every screen looks the same.
import type { ReactNode, RefObject } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

type Theme = ReturnType<typeof useTheme>;

const WHITE = '#FFFFFF';
const INK = Colors.light.text;

/** WCAG relative luminance of a '#RRGGBB' color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text color for a solid fill. Tint and danger use the theme's pairing; other fills (category and card
 * colors, the same in both schemes) get white or dark ink, whichever reads better, since white fails on
 * the lighter ones such as Amex Gold or the orange Deals color.
 */
function textOn(fill: string, theme: Theme): string {
  if (fill === theme.tint) return theme.onTint;
  if (fill === theme.danger) return theme.onDanger;
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return WHITE;
  return contrast(fill, INK) > contrast(fill, WHITE) ? INK : WHITE;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
  onRefresh,
  refreshing = false,
  tabScreen = true,
  scrollRef,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Tab screens leave room for the tab bar; pushed screens don't need to. */
  tabScreen?: boolean;
  scrollRef?: RefObject<ScrollViewInstance | null>;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={tabScreen ? ['top'] : []} style={[styles.fill, { backgroundColor: theme.background }]}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.scroll, { paddingBottom: (tabScreen ? BottomTabInset : 0) + Spacing.five }]}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} /> : undefined
        }>
        <View style={styles.column}>
          {(title || right) && (
            <View style={styles.header}>
              <View style={styles.fill}>
                {title ? <ThemedText type="title">{title}</ThemedText> : null}
                {subtitle ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {subtitle}
                  </ThemedText>
                ) : null}
              </View>
              {right}
            </View>
          )}
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.fill}>
        <ThemedText type="heading">{title}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function Card({
  children,
  onPress,
  style,
  accent,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Color bar on the left edge. */
  accent?: string;
}) {
  const theme = useTheme();
  const body = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
        style,
      ]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed} accessibilityRole="button">
      {body}
    </Pressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const theme = useTheme();
  const active = color ?? theme.tint;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? active : theme.backgroundElement,
          borderColor: selected ? active : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={{ color: selected ? textOn(active, theme) : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {children}
    </ScrollView>
  );
}

export function Badge({
  label,
  color,
  solid = false,
  style,
}: {
  label: string;
  color?: string;
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const c = color ?? theme.textSecondary;
  // An outline label sits on the card, where brand colors such as Capital One red are too dark to read in
  // dark mode; the border keeps the color cue. Uncolored badges stay muted.
  const fg = solid ? textOn(c, theme) : color ? theme.text : theme.textSecondary;
  return (
    <View style={[styles.badge, solid ? { backgroundColor: c } : { borderColor: c, borderWidth: 1 }, style]}>
      <ThemedText type="tiny" style={{ color: fg }}>
        {label}
      </ThemedText>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  small = false,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  small?: boolean;
  disabled?: boolean;
  /** For icon-like labels such as ‹ and ›. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.tint : variant === 'danger' ? theme.danger : theme.backgroundSelected;
  const fg = variant === 'primary' ? theme.onTint : variant === 'danger' ? theme.onDanger : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1 },
        style,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={{ color: fg }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function ToggleRow({
  label,
  detail,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.fill}>
        <ThemedText type="default">{label}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
        thumbColor="#FFFFFF"
        accessibilityLabel={label}
      />
    </View>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={3}
            style={[styles.segment, selected && { backgroundColor: theme.backgroundElement }]}>
            <ThemedText
              type="smallBold"
              themeColor={selected ? 'text' : 'textSecondary'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {body}
        </ThemedText>
      ) : null}
    </View>
  );
}

// Chips stay compact; the slop (covered by ChipRow's padding) brings the touch area to 48.
const CHIP_HIT_SLOP = { top: 4, bottom: 4 };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, marginTop: Spacing.two },
  card: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  pressed: { opacity: 0.75 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipRow: { gap: Spacing.two, paddingVertical: Spacing.one },
  badge: { borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start' },
  button: { borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: Spacing.three, alignItems: 'center' },
  buttonSmall: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  segmented: { flexDirection: 'row', borderRadius: Radius.sm, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: 6,
  },
  divider: { height: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.four },
});
