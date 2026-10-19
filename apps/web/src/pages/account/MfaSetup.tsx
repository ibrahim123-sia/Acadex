import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Mail, Smartphone } from 'lucide-react';
import { MFA_APP_ONLY_ROLES, type AuthResponse, type MfaStartResponse } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, CopyButton, Field, Input, Spinner } from '@/components/ui';

type Enabled = AuthResponse & { recovery_codes: string[] };

/** Turn on two-step verification: an authenticator app, or (except for platform owners) codes by email. */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const emailAllowed = !!user && !MFA_APP_ONLY_ROLES.includes(user.role);
  const [method, setMethod] = useState<'totp' | 'email' | null>(emailAllowed ? null : 'totp');

  if (method === 'totp') return <TotpSetup onDone={onDone} />;
  if (method === 'email') return <EmailSetup onDone={onDone} onBack={() => setMethod(null)} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">{t('auth.chooseMethod', 'How do you want to get your sign-in codes?')}</p>
      <button type="button" onClick={() => setMethod('totp')} className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-start hover:bg-surface-2">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="block font-medium">{t('auth.methodApp', 'Authenticator app (recommended)')}</span>
          <span className="block text-sm text-fg-muted">{t('auth.methodAppHelp', 'Google or Microsoft Authenticator on your phone. Works offline and is the safest.')}</span>
        </span>
      </button>
      <button type="button" onClick={() => setMethod('email')} className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-start hover:bg-surface-2">
        <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="block font-medium">{t('auth.methodEmail', 'Code by email')}</span>
          <span className="block text-sm text-fg-muted">{t('auth.methodEmailHelp', 'We email you a code each time you sign in. Nothing to install.')}</span>
        </span>
      </button>
    </div>
  );
}

/** Recovery codes, shown once after 2FA is turned on. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">{t('auth.recoveryTitle', 'Save your recovery codes')}</h3>
      <p className="text-sm text-fg-muted">
        {t('auth.recoveryHelp', "Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again.")}
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-sm" dir="ltr">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join('\n')} />
        <Button onClick={onDone}>{t('auth.savedCodes', "I've saved them")}</Button>
      </div>
    </div>
  );
}

function CodeInput({ label, code, setCode }: { label: string; code: string; setCode: (c: string) => void }) {
  return (
    <Field label={label}>
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
  );
}

/** Enrol an authenticator app: QR code → confirm with a code → show recovery codes once. */
function TotpSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { applySession } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const setup = useMutation({ mutationFn: () => api.post<{ secret: string; otpauth_url: string }>('/auth/mfa/totp/setup') });
  const enable = useMutation({
    mutationFn: (c: string) => api.post<Enabled>('/auth/mfa/totp/enable', { code: c }),
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

  if (recovery) return <RecoveryCodes codes={recovery} onDone={onDone} />;
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
      <CodeInput label={t('auth.enterCode', 'Enter the 6-digit code the app shows')} code={code} setCode={setCode} />
      {enable.isError && <Alert tone="danger">{errorMessage(enable.error)}</Alert>}
      <Button type="submit" className="w-full" disabled={code.length !== 6} loading={enable.isPending}>
        {t('auth.turnOn', 'Turn on')}
      </Button>
    </form>
  );
}

/** Codes by email: send a code → confirm it → show recovery codes once. */
function EmailSetup({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { applySession } = useAuth();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const send = useMutation({ mutationFn: () => api.post<MfaStartResponse>('/auth/mfa/email/setup') });
  const enable = useMutation({
    mutationFn: (c: string) => api.post<Enabled>('/auth/mfa/email/enable', { code: c }),
    onSuccess: (res) => {
      applySession(res);
      setRecovery(res.recovery_codes);
    },
  });
  const { mutate: sendCode } = send;
  useEffect(() => sendCode(), [sendCode]);

  if (recovery) return <RecoveryCodes codes={recovery} onDone={onDone} />;
  if (send.isError) return <Alert tone="danger">{errorMessage(send.error)}</Alert>;
  if (!send.data) return <Spinner />;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate(code.trim());
      }}
    >
      <p className="text-sm">
        {send.data.sent
          ? t('auth.emailCodeSent', 'We emailed a 6-digit code to {{email}}. It works for 10 minutes.', { email: send.data.email })
          : t('auth.emailCodeWait', 'A code was sent to {{email}} a moment ago. Use that one, or send a new one in a minute.', { email: send.data.email })}
      </p>
      <CodeInput label={t('auth.enterEmailCode', 'Enter the code from the email')} code={code} setCode={setCode} />
      {enable.isError && <Alert tone="danger">{errorMessage(enable.error)}</Alert>}
      <Button type="submit" className="w-full" disabled={code.length !== 6} loading={enable.isPending}>
        {t('auth.turnOn', 'Turn on')}
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="text-primary hover:underline">
          {t('common.back', 'Back')}
        </button>
        <button type="button" onClick={() => send.mutate()} disabled={send.isPending} className="text-primary hover:underline">
          {t('auth.mfaResend', 'Send a new code')}
        </button>
      </div>
    </form>
  );
}
