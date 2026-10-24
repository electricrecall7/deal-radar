// Chip filter shared by the Today and Weekly tabs.
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_META } from '@/lib/meta';
import type { Category, Deal } from '@/lib/schema';

import { Chip, ChipRow } from './ui';

export type CategoryFilterValue = 'all' | 'codes' | Category | 'local';

const OPTIONS: { value: CategoryFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'codes', label: 'Promo codes' },
  { value: 'freebie', label: 'Free' },
  { value: 'app', label: 'App' },
  { value: 'deal', label: 'Deals' },
  { value: 'card', label: 'Cards' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'local', label: 'SA only' },
];

export function categoryFilterLabel(value: CategoryFilterValue): string {
  return OPTIONS.find((o) => o.value === value)?.label ?? 'All';
}

export function matchesCategoryFilter(deal: Deal, filter: CategoryFilterValue): boolean {
  if (filter === 'all') return true;
  if (filter === 'local') return !!deal.local;
  if (filter === 'codes') return !!deal.code;
  // A restaurant deal that needs a specific card still belongs with the card offers.
  if (filter === 'card') return deal.category === 'card' || !!deal.card;
  return deal.category === filter;
}

export function CategoryFilter({
  value,
  onChange,
}: {
  value: CategoryFilterValue;
  onChange: (v: CategoryFilterValue) => void;
}) {
  const theme = useTheme();
  return (
    <ChipRow>
      {OPTIONS.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={value === o.value}
          onPress={() => onChange(o.value)}
          color={o.value === 'all' || o.value === 'local' || o.value === 'codes' ? theme.tint : CATEGORY_META[o.value].color}
        />
      ))}
    </ChipRow>
  );
}
