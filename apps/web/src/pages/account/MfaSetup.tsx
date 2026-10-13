import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import type { AuthResponse } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, CopyButton, Field, Input, Spinner } from '@/components/ui';

/** Enrol an authenticator app: QR code → confirm with a code → show recovery codes once. */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { applySession } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const setup = useMutation({ mutationFn: () => api.post<{ secret: string; otpauth_url: string }>('/auth/mfa/totp/setup') });
  const enable = useMutation({
    mutationFn: (c: string) => api.post<AuthResponse & { recovery_codes: string[] }>('/auth/mfa/totp/enable', { code: c }),
    onSuccess: (res) => {
      applySession(res);
      setRecovery(res.recovery_codes);
    },
  });

  // start enrolment once
  const { mutate: startSetup } = setup;
  useEffect(() => startSetup(), [startSetup]);
  useEffect(() => {
    if (setup.data) void QRCode.toDataURL(setup.data.otpauth_url, { margin: 1, width: 200 }).then(setQr);
  }, [setup.data]);

  if (recovery) {
    return (
      <div className="space-y-4">
        <h3 className="font-semibold">{t('auth.recoveryTitle', 'Save your recovery codes')}</h3>
        <p className="text-sm text-fg-muted">
          {t('auth.recoveryHelp', "Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again.")}
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-sm" dir="ltr">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={recovery.join('\n')} />
          <Button onClick={onDone}>{t('auth.savedCodes', "I've saved them")}</Button>
        </div>
      </div>
    );
  }

  if (setup.isError) return <Alert tone="danger">{errorMessage(setup.error)}</Alert>;
  if (!setup.data) return <Spinner />;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate(code.trim());
      }}
    >
      <p className="text-sm">{t('auth.scanQr', 'Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).')}</p>
      <div className="flex justify-center">
        {qr ? <img src={qr} alt="QR code for your authenticator app" className="size-48 rounded-lg bg-white p-2" /> : <Spinner />}
      </div>
      <div className="text-sm">
        <div className="text-fg-muted">{t('auth.manualKey', 'Or enter this key manually')}</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs" dir="ltr">
            {setup.data.secret}
          </code>
          <CopyButton text={setup.data.secret} />
        </div>
      </div>
      <Field label={t('auth.enterCode', 'Enter the 6-digit code the app shows')}>
        {(a) => (
          <Input
            {...a}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="text-center font-mono text-lg tracking-widest"
          />
        )}
      </Field>
      {enable.isError && <Alert tone="danger">{errorMessage(enable.error)}</Alert>}
      <Button type="submit" className="w-full" disabled={code.length !== 6} loading={enable.isPending}>
        {t('auth.turnOn', 'Turn on')}
      </Button>
    </form>
  );
}
