import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { GraduationCap, ShieldCheck } from 'lucide-react';
import { HOME_ROUTE, loginBody, mfaCode } from '@acadex/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { AuthLayout } from './AuthLayout';

/** Only same-app paths are allowed as a post-login destination (no open redirects). */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

export function LoginPage() {
  const { t } = useTranslation();
  const { status, user, login, verifyMfa } = useAuth();
  const [params] = useSearchParams();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState('');

  const creds = useForm<z.input<typeof loginBody>>({ resolver: zodResolver(loginBody), defaultValues: { email: '', password: '' } });
  const mfa = useForm<{ code: string }>({ resolver: zodResolver(z.object({ code: mfaCode })), defaultValues: { code: '' } });

  if (status === 'authenticated' && user) return <Navigate to={safeNext(params.get('next')) ?? HOME_ROUTE[user.role]} replace />;

  const onCredentials = creds.handleSubmit(async ({ email, password }) => {
    setError('');
    try {
      const challenge = await login(email, password);
      if (challenge) setMfaToken(challenge.mfaToken);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const onCode = mfa.handleSubmit(async ({ code }) => {
    setError('');
    try {
      await verifyMfa(mfaToken!, code);
    } catch (e) {
      setError(errorMessage(e));
      if ((e as { code?: string }).code === 'MFA_CHALLENGE_EXPIRED') setMfaToken(null);
    }
  });

  return (
    <AuthLayout>
      {!mfaToken ? (
        <>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <GraduationCap className="size-5" aria-hidden />
            <span className="font-semibold">{t('auth.welcome', 'Welcome back')}</span>
          </div>
          <h2 className="text-2xl font-bold">{t('auth.signInTitle', 'Sign in to your account')}</h2>
          <p className="mb-6 mt-1 text-sm text-fg-muted">{t('auth.signInSubtitle', 'Enter your details to continue')}</p>
          <form onSubmit={onCredentials} className="space-y-4" noValidate>
            <Field label={t('auth.email', 'Email')} error={creds.formState.errors.email?.message}>
              {(a) => <Input {...a} type="email" autoComplete="username" placeholder="you@institution.edu" {...creds.register('email')} />}
            </Field>
            <Field label={t('auth.password', 'Password')} error={creds.formState.errors.password?.message}>
              {(a) => <PasswordInput {...a} autoComplete="current-password" {...creds.register('password')} />}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" loading={creds.formState.isSubmitting}>
              {t('auth.signIn', 'Sign in')}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <Link to="/forgot-password" className="text-primary hover:underline">
              {t('auth.forgot', 'Forgot your password?')}
            </Link>
          </div>
          {import.meta.env.DEV && (
            <div className="mt-6 rounded-lg border border-border bg-surface p-3 text-xs text-fg-muted">
              <div className="mb-1 font-semibold">Demo accounts (password Acadex@123)</div>
              <div>superadmin@acadex.com · admin@greenwood.edu · ali.sheikh.t0@greenwood.edu</div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ShieldCheck className="size-5" aria-hidden />
            <span className="font-semibold">{t('auth.mfaTitle', 'Two-step verification')}</span>
          </div>
          <p className="mb-6 text-sm text-fg-muted">{t('auth.mfaSubtitle', 'Enter the 6-digit code from your authenticator app, or a recovery code.')}</p>
          <form onSubmit={onCode} className="space-y-4" noValidate>
            <Field label={t('auth.code', 'Code')} error={mfa.formState.errors.code?.message}>
              {(a) => <Input {...a} autoFocus inputMode="text" autoComplete="one-time-code" className="text-center font-mono text-lg tracking-widest" {...mfa.register('code')} />}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" loading={mfa.formState.isSubmitting}>
              {t('auth.verify', 'Verify')}
            </Button>
          </form>
          <button type="button" onClick={() => setMfaToken(null)} className="mt-4 w-full text-center text-sm text-primary hover:underline">
            {t('auth.backToSignIn', 'Back to sign in')}
          </button>
        </>
      )}
    </AuthLayout>
  );
}
