import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Laptop, LogOut, MailCheck, ShieldCheck, Smartphone } from 'lucide-react';
import { HOME_ROUTE, type AuthResponse } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { Alert, Badge, Button, Card, CopyButton, Dialog, ErrorState, Field, Input, PageHeader, PasswordInput, Spinner, useToast } from '@/components/ui';
import { AuthLayout } from '../auth/AuthLayout';
import { NewPasswordForm } from '../auth/NewPasswordForm';
import { MfaSetup } from './MfaSetup';

/** Forced: an account still on a temporary password. */
export function ForcedPasswordChangePage() {
  const { t } = useTranslation();
  const { applySession, user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  return (
    <AuthLayout>
      <div className="mb-2 flex items-center gap-2 text-primary">
        <KeyRound className="size-5" aria-hidden />
        <h2 className="text-xl font-bold text-fg">{t('auth.changePasswordTitle', 'Choose your own password')}</h2>
      </div>
      <p className="mb-6 text-sm text-fg-muted">{t('auth.forcedChange', 'You signed in with a temporary password. Set a new one to continue.')}</p>
      <NewPasswordForm
        withCurrent={t('auth.currentPassword', 'Current password')}
        submitLabel={t('auth.savePassword', 'Save password')}
        error={error}
        onSubmit={async ({ password, current }) => {
          setError('');
          try {
            const res = await api.post<AuthResponse>('/auth/change-password', { current_password: current, new_password: password });
            applySession(res);
            navigate(user ? HOME_ROUTE[user.role] : '/', { replace: true });
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      />
      <button type="button" onClick={() => void logout()} className="mt-4 w-full text-center text-sm text-fg-muted hover:underline">
        {t('common.signOut', 'Sign out')}
      </button>
    </AuthLayout>
  );
}

/** Forced: an administrator who must enrol in 2FA. */
export function ForcedMfaSetupPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <div className="mb-2 flex items-center gap-2 text-primary">
        <ShieldCheck className="size-5" aria-hidden />
        <h2 className="text-xl font-bold text-fg">{t('auth.mfaSetupTitle', 'Set up two-step verification')}</h2>
      </div>
      <p className="mb-6 text-sm text-fg-muted">{t('auth.mfaSetupRequired', 'Your role requires two-step verification. It takes a minute.')}</p>
      <MfaSetup onDone={() => navigate(user ? HOME_ROUTE[user.role] : '/', { replace: true })} />
      <button type="button" onClick={() => void logout()} className="mt-4 w-full text-center text-sm text-fg-muted hover:underline">
        {t('common.signOut', 'Sign out')}
      </button>
    </AuthLayout>
  );
}

interface Session {
  id: string;
  created_at: string;
  last_used_at: string;
  user_agent: string;
  ip: string;
  current: boolean;
}

function deviceName(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SecurityPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { applySession, user } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [pwError, setPwError] = useState('');

  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ email_verified: boolean }>('/auth/me') });
  const mfa = useQuery({ queryKey: ['mfa'], queryFn: () => api.get<{ enabled: boolean; required: boolean; recovery_codes_remaining: number }>('/auth/mfa') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<Session[]>('/auth/sessions') });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: (r) => {
      toast('success', t('account.signedOutOthers', 'Signed out of {{count}} other device(s)', { count: r.revoked }));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const verifyEmail = useMutation({
    mutationFn: () => api.post('/auth/verify-email/request'),
    onSuccess: () => toast('success', t('account.verificationSent', 'Check your inbox for the confirmation link.')),
  });

  return (
    <>
      <PageHeader title={t('nav.security', 'Security')} subtitle={user?.email} />
      {me.data && !me.data.email_verified && (
        <Alert tone="warning" className="mb-6" title={t('account.unverifiedTitle', 'Your email address is not confirmed')}>
          <p>{t('account.unverifiedBody', 'Confirm it so you can always reset your password.')}</p>
          <Button size="sm" variant="outline" className="mt-2" loading={verifyEmail.isPending} onClick={() => verifyEmail.mutate()}>
            <MailCheck className="size-4" /> {t('account.sendVerification', 'Send confirmation email')}
          </Button>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <KeyRound className="size-4" aria-hidden /> {t('account.password', 'Password')}
          </h2>
          <p className="mb-4 text-sm text-fg-muted">{t('account.passwordHelp', 'Changing it signs you out on your other devices.')}</p>
          <NewPasswordForm
            withCurrent={t('auth.currentPassword', 'Current password')}
            submitLabel={t('auth.savePassword', 'Save password')}
            error={pwError}
            onSubmit={async ({ password, current }) => {
              setPwError('');
              try {
                applySession(await api.post<AuthResponse>('/auth/change-password', { current_password: current, new_password: password }));
                toast('success', t('account.passwordChanged', 'Password changed'));
                void qc.invalidateQueries({ queryKey: ['sessions'] });
              } catch (e) {
                setPwError(errorMessage(e));
              }
            }}
          />
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4" aria-hidden /> {t('account.twoFactor', 'Two-step verification')}
          </h2>
          {mfa.isPending ? (
            <Spinner />
          ) : mfa.isError ? (
            <ErrorState error={mfa.error} onRetry={() => mfa.refetch()} />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={mfa.data.enabled ? 'success' : 'neutral'}>{mfa.data.enabled ? t('account.on', 'On') : t('account.off', 'Off')}</Badge>
                {mfa.data.enabled && (
                  <span className="text-fg-muted">
                    {t('account.recoveryRemaining', '{{count}} recovery codes left', { count: mfa.data.recovery_codes_remaining })}
                  </span>
                )}
              </div>
              <p className="text-fg-muted">{t('account.twoFactorHelp', 'Ask for a code from your phone when you sign in, so a stolen password is not enough.')}</p>
              {mfa.data.enabled ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCodesOpen(true)}>
                    {t('account.newCodes', 'New recovery codes')}
                  </Button>
                  {!mfa.data.required && (
                    <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
                      {t('account.turnOff', 'Turn off')}
                    </Button>
                  )}
                </div>
              ) : (
                <Button size="sm" onClick={() => setSetupOpen(true)}>
                  {t('auth.turnOn', 'Turn on')}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t('account.devices', "Where you're signed in")}</h2>
          {(sessions.data?.length ?? 0) > 1 && (
            <Button variant="outline" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
              <LogOut className="size-4 rtl:rotate-180" /> {t('account.signOutOthers', 'Sign out all other devices')}
            </Button>
          )}
        </div>
        {sessions.isPending ? (
          <Spinner />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                {/Android|iPhone|iPad|Mobile/.test(s.user_agent) ? <Smartphone className="size-5 text-fg-muted" aria-hidden /> : <Laptop className="size-5 text-fg-muted" aria-hidden />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">
                    {deviceName(s.user_agent)} {s.current && <Badge tone="success">{t('account.thisDevice', 'This device')}</Badge>}
                  </div>
                  <div className="text-xs text-fg-muted">
                    {t('account.lastActive', 'Last active {{when}}', { when: formatRelative(s.last_used_at) })}
                    {s.ip && ` · ${s.ip}`}
                  </div>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    {t('account.signOutDevice', 'Sign out')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={setupOpen} onClose={() => setSetupOpen(false)} title={t('auth.mfaSetupTitle', 'Set up two-step verification')}>
        {setupOpen && (
          <MfaSetup
            onDone={() => {
              setSetupOpen(false);
              void qc.invalidateQueries({ queryKey: ['mfa'] });
              void qc.invalidateQueries({ queryKey: ['sessions'] });
            }}
          />
        )}
      </Dialog>
      <DisableMfaDialog open={disableOpen} onClose={() => setDisableOpen(false)} />
      <RecoveryCodesDialog open={codesOpen} onClose={() => setCodesOpen(false)} />
    </>
  );
}

function DisableMfaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { password, code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mfa'] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('account.turnOffTitle', 'Turn off two-step verification?')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label={t('auth.password', 'Password')}>{(a) => <PasswordInput {...a} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Field label={t('auth.code', 'Code')}>{(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />}</Field>
        {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={m.isPending}>
            {t('account.turnOff', 'Turn off')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RecoveryCodesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/auth/mfa/recovery-codes', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfa'] }),
  });
  const close = () => {
    m.reset();
    setCode('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('account.newCodes', 'New recovery codes')}>
      {m.data ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">{t('auth.recoveryHelp', "Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again.")}</p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-sm" dir="ltr">
            {m.data.recovery_codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <CopyButton text={m.data.recovery_codes.join('\n')} />
            <Button onClick={close}>{t('auth.savedCodes', "I've saved them")}</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <p className="text-sm text-fg-muted">{t('account.newCodesHelp', 'Your old recovery codes will stop working.')}</p>
          <Field label={t('auth.code', 'Code')}>{(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />}</Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <Button type="submit" loading={m.isPending}>
            {t('account.generate', 'Generate')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
