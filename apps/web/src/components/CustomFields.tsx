// Inputs for an institution's custom fields (text, number, date, choice, yes/no).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, Input, Select } from '@/components/ui';

export interface CustomFieldDef {
  id: number;
  entity: 'student' | 'staff' | 'guardian';
  key: string;
  label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
  required: boolean;
}
export type CustomValues = Record<string, string | number | boolean | null>;

export const useCustomFields = (entity: CustomFieldDef['entity']) =>
  useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => api.get<CustomFieldDef[]>('/institution/custom-fields'),
    staleTime: 5 * 60 * 1000,
    select: (all) => all.filter((f) => f.entity === entity),
  });

export function CustomFieldInputs({ defs, values, onChange, errors = {} }: { defs: CustomFieldDef[]; values: CustomValues; onChange: (v: CustomValues) => void; errors?: Record<string, string> }) {
  if (!defs.length) return null;
  const set = (k: string, v: CustomValues[string]) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {defs.map((d) => (
        <Field key={d.key} label={d.label} optional={!d.required} error={errors[`custom_data.${d.key}`]}>
          {(a) =>
            d.field_type === 'select' ? (
              <Select {...a} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value || null)}>
                <option value="">—</option>
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : d.field_type === 'checkbox' ? (
              <label className="flex h-10 items-center gap-2 text-sm">
                <input {...a} type="checkbox" checked={values[d.key] === true} onChange={(e) => set(d.key, e.target.checked)} />
                {d.label}
              </label>
            ) : (
              <Input {...a} type={d.field_type === 'number' ? 'number' : d.field_type === 'date' ? 'date' : 'text'} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value === '' ? null : d.field_type === 'number' ? Number(e.target.value) : e.target.value)} />
            )
          }
        </Field>
      ))}
    </div>
  );
}

/** Read-only display of custom values. */
export function CustomFieldValues({ defs, values }: { defs: CustomFieldDef[]; values: CustomValues }) {
  const shown = defs.filter((d) => values[d.key] !== undefined && values[d.key] !== null && values[d.key] !== '');
  if (!shown.length) return null;
  return (
    <>
      {shown.map((d) => (
        <div key={d.key}>
          <dt className="text-xs text-fg-muted">{d.label}</dt>
          <dd>{d.field_type === 'checkbox' ? (values[d.key] ? '✓' : '—') : String(values[d.key])}</dd>
        </div>
      ))}
    </>
  );
}
