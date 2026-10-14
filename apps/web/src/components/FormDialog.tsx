// A small form dialog for settings-style records: named fields → a JSON body, server errors
// shown in place. Mounted fresh for each opening (useFormDialog), so initial values are current.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field, Input, MutationError, Select } from '@/components/ui';

export type Values = Record<string, string>;

export interface FormField {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  /** a select instead of a text input */
  options?: { value: string; label: string }[];
  hint?: string;
  dir?: 'ltr';
}

/** A small form dialog: fields → JSON body; server errors shown in place. */
export function FormDialog({
  open,
  title,
  initial,
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: Values;
  fields: FormField[];
  submitLabel: string;
  onSubmit: (v: Values) => Promise<unknown>;
  onClose: () => void;
}) {
  // mounted fresh for each opening (see useFormDialog), so the initial values are always current
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>(initial);
  const m = useMutation({ mutationFn: onSubmit, onSuccess: () => close() });
  const close = () => {
    m.reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(values);
  };
  return (
    <Dialog open={open} onClose={close} title={title}>
      <form className="space-y-4" noValidate onSubmit={submit}>
        {fields.map((f) => (
          <Field key={f.name} label={f.label} optional={f.optional} hint={f.hint}>
            {(a) =>
              f.options ? (
                <Select {...a} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...a} type={f.type ?? 'text'} dir={f.dir} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              )
            }
          </Field>
        ))}
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" loading={m.isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Open a FormDialog with fresh initial values each time. */
export function useFormDialog() {
  const [state, setState] = useState<{ title: string; initial: Values; submit: (v: Values) => Promise<unknown> } | null>(null);
  return { state, open: setState, close: () => setState(null) };
}

export const nullIfEmpty = (v: string | undefined) => (v === undefined || v === '' ? null : v);

