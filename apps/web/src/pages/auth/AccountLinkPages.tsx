// Pages reached from emailed links: accept an invitation, reset a password, confirm an
// email address — plus "forgot password". Tokens come from the URL fragment.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { HOME_ROUTE, passwordResetRequestBody, type AuthResponse } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';
import { AuthLayout, tokenFromHash } from './AuthLayout';
import { NewPasswordForm } from './NewPasswordForm';

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const { applySession } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(tokenFromHash);
  const [error, setError] = useState('');
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ email: string; full_name: string; school_name: string | null }>(`/auth/invites/${token}`),
    enabled: !!token,
    retry: false,
  });

  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">{t('auth.inviteTitle', 'Activate your account')}</h2>
      {!token || invite.isError ? (
        <Alert tone="danger" className="mt-4">
          {t('auth.inviteInvalid', 'This invitation link is invalid or has expired. Ask your school for a new one.')}
        </Alert>
      ) : invite.isPending ? (
        <Spinner />
      ) : (
        <>
          <p className="mb-6 mt-1 text-sm text-fg-muted">
            {t('auth.inviteSubtitle', '{{name}}, set a password to join {{school}}.', { name: invite.data.full_name, school: invite.data.school_name ?? 'Acadex' })}
          </p>
          <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">{invite.data.email}</p>
          <NewPasswordForm
            submitLabel={t('auth.activate', 'Activate account')}
            error={error}
            onSubmit={async ({ password }) => {
              setError('');
              try {
                const res = await api.post<AuthResponse>('/auth/invites/accept', { token, password }, { noRefresh: true });
                history.replaceState(null, '', window.location.pathname); // drop the token from the URL
                applySession(res);
                navigate(HOME_ROUTE[res.user.role], { replace: true });
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const form = useForm<{ email: string }>({ resolver: zodResolver(passwordResetRequestBody), defaultValues: { email: '' } });
  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">{t('auth.forgotTitle', 'Reset your password')}</h2>
      {sentTo ? (
        <Alert tone="success" className="mt-4">
          {t('auth.forgotSent', "If an account exists for {{email}}, we've sent a reset link. It's valid for 1 hour.", { email: sentTo })}
        </Alert>
      ) : (
        <>
          <p className="mb-6 mt-1 text-sm text-fg-muted">{t('auth.forgotSubtitle', "Enter your email and we'll send you a link to choose a new password.")}</p>
          <form
            className="space-y-4"
            noValidate
            onSubmit={form.handleSubmit(async ({ email }) => {
              setError('');
              try {
                await api.post('/auth/password-reset/request', { email }, { noRefresh: true });
                setSentTo(email);
              } catch (e) {
                setError(errorMessage(e));
              }
            })}
          >
            <Field label={t('auth.email', 'Email')} error={form.formState.errors.email?.message}>
              {(a) => <Input {...a} type="email" autoComplete="email" {...form.register('email')} />}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              {t('auth.sendLink', 'Send link')}
            </Button>
          </form>
        </>
      )}
      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-primary hover:underline">
          {t('auth.backToSignIn', 'Back to sign in')}
        </Link>
      </div>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [token] = useState(tokenFromHash);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  return (
    <AuthLayout>
      <h2 className="mb-6 text-2xl font-bold">{t('auth.resetTitle', 'Choose a new password')}</h2>
      {done ? (
        <>
          <Alert tone="success">{t('auth.resetDone', 'Your password has been changed. You can sign in now.')}</Alert>
          <Link to="/login" className="mt-4 block text-center text-sm text-primary hover:underline">
            {t('auth.goToSignIn', 'Sign in')}
          </Link>
        </>
      ) : !token ? (
        <Alert tone="danger">{t('auth.resetInvalid', 'This reset link is invalid or has expired. Request a new one.')}</Alert>
      ) : (
        <NewPasswordForm
          submitLabel={t('auth.savePassword', 'Save password')}
          error={error}
          onSubmit={async ({ password }) => {
            setError('');
            try {
              await api.post('/auth/password-reset/confirm', { token, password }, { noRefresh: true });
              history.replaceState(null, '', window.location.pathname);
              setDone(true);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  useEffect(() => {
    const token = tokenFromHash();
    if (!token) return setState('failed');
    api
      .post('/auth/verify-email/confirm', { token }, { noRefresh: true })
      .then(() => {
        history.replaceState(null, '', window.location.pathname);
        setState('done');
      })
      .catch(() => setState('failed'));
  }, []);
  return (
    <AuthLayout>
      <div className="mb-4 flex items-center gap-2 text-primary">
        <MailCheck className="size-5" aria-hidden />
        <h2 className="text-xl font-bold text-fg">{t('auth.verifyTitle', 'Confirm your email')}</h2>
      </div>
      {state === 'working' && <Spinner />}
      {state === 'done' && <Alert tone="success">{t('auth.verifyDone', 'Your email address is confirmed.')}</Alert>}
      {state === 'failed' && <Alert tone="danger">{t('auth.verifyFailed', 'This confirmation link is invalid or has expired.')}</Alert>}
      <Link to="/" className="mt-4 block text-center text-sm text-primary hover:underline">
        {t('auth.goToSignIn', 'Sign in')}
      </Link>
    </AuthLayout>
  );
}
