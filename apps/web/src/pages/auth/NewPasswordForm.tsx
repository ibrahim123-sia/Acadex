import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { newPassword } from '@acadex/shared';
import { Alert, Button, Field, PasswordInput } from '@/components/ui';

/** New password + confirmation with the platform's password rules. */
export function NewPasswordForm({
  submitLabel,
  onSubmit,
  error,
  withCurrent,
}: {
  submitLabel: string;
  onSubmit: (v: { password: string; current?: string }) => Promise<void>;
  error?: string;
  withCurrent?: string;
}) {
  const { t } = useTranslation();
  const schema = z
    .object({ current: withCurrent ? z.string().min(1, t('common.required', 'Required')) : z.string().optional(), password: newPassword, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('auth.passwordsDontMatch', 'The passwords do not match') });
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current: '', password: '', confirm: '' } });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => onSubmit({ password: v.password, current: v.current }))} className="space-y-4" noValidate>
      {withCurrent && (
        <Field label={withCurrent} error={e.current?.message}>
          {(a) => <PasswordInput {...a} autoComplete="current-password" {...form.register('current')} />}
        </Field>
      )}
      <Field label={t('auth.newPassword', 'New password')} hint={t('auth.passwordHint', 'At least 10 characters, with letters and numbers.')} error={e.password?.message}>
        {(a) => <PasswordInput {...a} autoComplete="new-password" {...form.register('password')} />}
      </Field>
      <Field label={t('auth.confirmPassword', 'Confirm new password')} error={e.confirm?.message}>
        {(a) => <PasswordInput {...a} autoComplete="new-password" {...form.register('confirm')} />}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
