// My privacy: the consents I have given (for myself or my children), and my requests for a
// copy of my data, a correction or deletion.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CONSENT_KINDS } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Alert, Button, Card, EmptyState, Field, MutationError, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';

const CONSENT_TEXT: Record<string, string> = {
  data_processing: 'The institution may keep and use the data it needs to teach and run the school',
  photos: 'Photos and videos may be used in class and school communications',
  ai_features: 'AI features (the tutor, writing help) may be used — names and contact details are never sent',
  messaging: 'Teachers may message, with guardians copied for students under 18',
  marketing: 'News about events and offers from the institution',
};

export function PrivacyCenterPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const consents = useQuery({ queryKey: ['/privacy/consents'], queryFn: () => api.get<{ kind: string; student_id: number | null; granted: boolean; created_at: string; student: string | null }[]>('/privacy/consents') });
  const kids = useQuery({ queryKey: ['/parent/children'], queryFn: () => api.get<{ id: number; first_name: string; last_name: string }[]>('/parent/children'), enabled: user?.role === 'parent' });
  const requests = useQuery({ queryKey: ['/privacy/requests', 'mine'], queryFn: () => api.get<{ id: number; kind: string; status: string; created_at: string; due_at: string; response: string; export_id: number | null }[]>('/privacy/requests') });
  const give = useMutation({ mutationFn: (v: { kind: string; granted: boolean; student_id: number | null }) => api.post('/privacy/consents', v), onSuccess: () => consents.refetch() });
  const [req, setReq] = useState({ kind: 'access', details: '' });
  const ask = useMutation({ mutationFn: () => api.post('/privacy/requests', req), onSuccess: () => { setReq({ kind: 'access', details: '' }); void requests.refetch(); } });
  const subjects: { id: number | null; name: string }[] = user?.role === 'parent' ? (kids.data ?? []).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}` })) : [{ id: null, name: t('priv.me', 'Me') }];
  const current = (kind: string, sid: number | null) => consents.data?.find((c) => c.kind === kind && (c.student_id ?? null) === sid);
  return (
    <>
      <PageHeader title={t('nav.privacy', 'Privacy')} subtitle={t('priv.mySubtitle', 'What you have agreed to, and your data')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">{t('priv.consents', 'Consents')}</h2>
          {subjects.map((s) => (
            <div key={s.id ?? 'me'} className="space-y-2">
              {user?.role === 'parent' && <h3 className="text-sm font-medium">{s.name}</h3>}
              {CONSENT_KINDS.map((k) => {
                const c = current(k, s.id);
                return (
                  <label key={k} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={!!c?.granted} onChange={(e) => give.mutate({ kind: k, granted: e.target.checked, student_id: s.id })} />
                    <span>{t(`consent.text.${k}`, CONSENT_TEXT[k]!)}{c && <span className="block text-xs text-fg-muted">{c.granted ? t('priv.givenOn', 'given {{d}}', { d: formatDate(c.created_at) }) : t('priv.withdrawnOn', 'withdrawn {{d}}', { d: formatDate(c.created_at) })}</span>}</span>
                  </label>
                );
              })}
            </div>
          ))}
          <MutationError error={give.error} />
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">{t('priv.yourData', 'Your data')}</h2>
          <p className="text-sm text-fg-muted">{t('priv.yourDataHelp', 'Ask for a copy of everything the institution holds about you, a correction, or for your account to be deleted. The institution answers within 30 days.')}</p>
          <Field label={t('priv.iWant', 'I would like')}>{(a) => <Select {...a} value={req.kind} onChange={(e) => setReq({ ...req, kind: e.target.value })}><option value="access">{t('priv.k.access', 'a copy of my data')}</option><option value="correction">{t('priv.k.correction', 'a correction')}</option><option value="deletion">{t('priv.k.deletion', 'my account deleted')}</option></Select>}</Field>
          <Field label={t('priv.details', 'Details')} optional>{(a) => <Textarea {...a} rows={3} value={req.details} onChange={(e) => setReq({ ...req, details: e.target.value })} />}</Field>
          {req.kind === 'deletion' && <Alert tone="warning">{t('priv.deletionNote', 'Records the institution must keep by law (results, fee receipts) stay, without your contact details.')}</Alert>}
          <MutationError error={ask.error} />
          <Button loading={ask.isPending} onClick={() => ask.mutate()}>{t('priv.send', 'Send request')}</Button>
          {!requests.data?.length ? <EmptyState title={t('priv.noRequests', 'No requests')} /> : (
            <ul className="divide-y divide-border text-sm">
              {requests.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{t(`priv.k.${r.kind}`, r.kind)} · {formatDate(r.created_at)}{r.response && <span className="block text-xs">{r.response}</span>}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={r.status === 'open' ? 'pending' : r.status === 'done' ? 'approved' : 'rejected'} label={r.status} />
                    {r.export_id && <Button size="sm" variant="outline" onClick={() => api.download(`/institution/exports/${r.export_id}/download`, 'my-data.zip')}>{t('common.download', 'Download')}</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
