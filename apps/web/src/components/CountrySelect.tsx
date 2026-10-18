// Choose an institution's country. The currency, timezone, formats, week start and payment
// gateways follow from it (packages/shared countries.ts).
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { COUNTRIES, onlineGatewaysFor } from '@acadex/shared';
import { Select } from '@/components/ui';

const SORTED = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
const GATEWAY_LABEL = { stripe: 'Stripe', jazzcash: 'JazzCash', easypaisa: 'Easypaisa' } as const;

export const CountrySelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>>(function CountrySelect(props, ref) {
  return (
    <Select ref={ref} {...props}>
      {SORTED.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  );
});

/** "Online payments: JazzCash, Easypaisa" for the country. */
export const gatewaysText = (country: string) => onlineGatewaysFor(country).map((g) => GATEWAY_LABEL[g]).join(', ');
