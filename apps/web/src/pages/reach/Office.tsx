// The office's communication screens: messaging and safeguarding rules, emergency broadcasts,
// delivery logs with retry, and the Zoom / Teams / Meet connections.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Megaphone, RotateCcw } from 'lucide-react';
import { BROADCAST_CHANNELS, type MessagingSettings } from '@acadex/shared';
import { api } from '@/lib/api';
import { useChannels } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, ConfirmDialog, CopyButton, DataTable, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';

export function CommunicationPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('nav.communication', 'Communication')} subtitle={t('comm.subtitle', 'Messaging rules, emergency broadcasts, delivery and live-class accounts')} />
      <Tabs
        tabs={[
          { id: 'broadcast', label: t('comm.broadcast', 'Emergency broadcast'), hidden: !can('broadcast.send'), content: () => <BroadcastTab /> },
          { id: 'rules', label: t('comm.rules', 'Messaging rules'), hidden: !can('settings.manage'), content: () => <RulesTab /> },
          { id: 'delivery', label: t('comm.delivery', 'Delivery'), hidden: !can('delivery.read'), content: () => <DeliveryTab /> },
          { id: 'live', label: t('comm.live', 'Live classes'), hidden: !can('integrations.manage'), content: () => <IntegrationsTab /> },
        ]}
      />
    </>
  );
}

function RulesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/messaging/settings'], queryFn: () => api.get<{ messaging: MessagingSettings; notify_by_phone: boolean; drivers: { whatsapp: boolean } }>('/messaging/settings') });
  const [v, setV] = useState<{ messaging: MessagingSettings; notify_by_phone: boolean } | null>(null);
  const cur = v ?? q.data;
  const save = useMutation({ mutationFn: () => api.put('/messaging/settings', { messaging: cur!.messaging, notify_by_phone: cur!.notify_by_phone }), onSuccess: () => { toast('success', t('common.saved', 'Saved')); setV(null); void q.refetch(); } });
  if (q.error) return <ErrorState error={q.error} />;
  if (!cur || !q.data) return <Spinner />;
  const m = cur.messaging;
  const set = (patch: Partial<MessagingSettings>) => setV({ ...cur, messaging: { ...m, ...patch } });
  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={m.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {t('comm.enabled', 'Messaging is on')}</label>
      <Field label={t('comm.minorDm', 'Private messages between staff and students under 18')}>
        {(a) => (
          <Select {...a} value={m.minor_dm} onChange={(e) => set({ minor_dm: e.target.value as MessagingSettings['minor_dm'] })}>
            <option value="cc_guardians">{t('comm.minorCc', 'Allowed — the guardians receive a copy (recommended)')}</option>
            <option value="blocked">{t('comm.minorBlocked', 'Not allowed — use class groups')}</option>
            <option value="allowed">{t('comm.minorAllowed', 'Allowed without copies')}</option>
          </Select>
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.student_to_student} onChange={(e) => set({ student_to_student: e.target.checked })} /> {t('comm.s2s', 'Students may message classmates')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.guardian_to_teacher} onChange={(e) => set({ guardian_to_teacher: e.target.checked })} /> {t('comm.g2t', "Guardians may message their children's teachers")}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.profanity_filter} onChange={(e) => set({ profanity_filter: e.target.checked })} /> {t('comm.profanity', 'Mask bad language and flag it for review')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.notify_by_phone} onChange={(e) => setV({ ...cur, notify_by_phone: e.target.checked })} /> {t('comm.byPhone', 'People may choose to get notifications by WhatsApp (your institution pays for the messages)')}</label>
      {!q.data.drivers.whatsapp && <Alert>{t('comm.noWhatsapp', 'WhatsApp is not switched on (it is charged per message), so notifications go in the app, by email and by push.')}</Alert>}
      <Alert>{t('comm.kept', 'Every conversation is kept. People with the safeguarding permission can read any conversation; their reads are recorded.')}</Alert>
      <MutationError error={save.error} />
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
    </Card>
  );
}

function BroadcastTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const history = useQuery({ queryKey: ['/broadcasts'], queryFn: () => api.get<{ id: number; title: string; message: string; audience: string; channels: string[]; counts: { people?: number; emails_without_account?: number; texts_sent?: number; phones_without_account?: number }; created_at: string; sent_by: string | null }[]>('/broadcasts') });
  const channels = useChannels();
  const [v, setV] = useState({ title: '', message: '', audience: 'everyone', channels: BROADCAST_CHANNELS.filter((c) => c !== 'whatsapp') as string[] });
  const [confirm, setConfirm] = useState(false);
  const send = useMutation({
    mutationFn: () => api.post('/broadcasts', v),
    onSuccess: () => {
      toast('success', t('comm.sent', 'Broadcast is on its way'));
      setV({ ...v, title: '', message: '' });
      setConfirm(false);
      setTimeout(() => void history.refetch(), 1500);
    },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <Alert tone="warning">{t('comm.bcHelp', 'For emergencies only (closures, safety). It ignores quiet hours and reaches people on every channel you tick — including guardians who have no account, by email (and WhatsApp when it is switched on). Keep the email addresses of guardians up to date.')}</Alert>
        <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} maxLength={160} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t('comm.bcTitle', 'School closed tomorrow')} />}</Field>
        <Field label={t('msg.message', 'Message')} hint={`${v.message.length} / 1000`}>{(a) => <Textarea {...a} maxLength={1000} rows={4} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}</Field>
        <Field label={t('comm.audience', 'Who')}>
          {(a) => (
            <Select {...a} value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}>
              {['everyone', 'staff', 'students', 'guardians'].map((x) => <option key={x} value={x}>{t(`comm.aud.${x}`, x)}</option>)}
            </Select>
          )}
        </Field>
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1 text-sm font-medium">{t('comm.channels', 'Channels')}</legend>
          {BROADCAST_CHANNELS.filter((c) => c !== 'whatsapp' || channels.data?.whatsapp).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={c === 'app'} checked={v.channels.includes(c)} onChange={(e) => setV({ ...v, channels: e.target.checked ? [...v.channels, c] : v.channels.filter((x) => x !== c) })} /> {t(`comm.ch.${c}`, c)}
            </label>
          ))}
        </fieldset>
        <MutationError error={send.error} />
        <Button variant="danger" disabled={!v.title.trim() || !v.message.trim()} onClick={() => setConfirm(true)}><Megaphone className="size-4" /> {t('comm.sendNow', 'Send now')}</Button>
        <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => send.mutate()} title={t('comm.confirm', 'Send this broadcast now?')} confirmLabel={t('comm.sendNow', 'Send now')} busy={send.isPending} error={send.error}>
          <p className="text-sm">{v.title}</p>
        </ConfirmDialog>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('comm.history', 'Sent')}</h2>
        <ul className="divide-y divide-border text-sm">
          {history.data?.map((b) => (
            <li key={b.id} className="py-2">
              <div className="font-medium">{b.title}</div>
              <div className="text-xs text-fg-muted">{formatDateTime(b.created_at)} · {b.sent_by} · {t(`comm.aud.${b.audience}`, b.audience)} · {b.channels.join(', ')}</div>
              <div className="text-xs">{t('comm.reachedEmail', '{{people}} people with an account, {{emails}} guardians by email, {{texts}} WhatsApp messages', { people: b.counts.people ?? '…', emails: b.counts.emails_without_account ?? 0, texts: b.counts.texts_sent ?? 0 })}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function DeliveryTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [f, setF] = useState({ status: 'failed', channel: '' });
  const list = usePagedList<{ id: number; channel: string; status: string; error: string | null; attempts: number; created_at: string; to_address: string | null; person: string | null; title: string | null; retryable: boolean }>('/delivery-logs', { status: f.status || undefined, channel: f.channel || undefined });
  const retry = useMutation({ mutationFn: (id: number) => api.post<{ ok: boolean; error?: string }>(`/delivery-logs/${id}/retry`), onSuccess: (r) => { toast(r.ok ? 'success' : 'error', r.ok ? t('comm.retried', 'Sent again') : (r.error ?? '')); void list.refetch(); } });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label={t('common.status', 'Status')} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-40">
          <option value="">{t('common.all', 'All')}</option>
          {['failed', 'sent', 'skipped'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select aria-label={t('comm.channel', 'Channel')} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="w-40">
          <option value="">{t('common.all', 'All')}</option>
          {['email', 'push', 'whatsapp'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        empty={t('comm.noLogs', 'Nothing here')}
        columns={[
          { key: 'w', header: t('common.when', 'When'), cell: (r) => formatDateTime(r.created_at) },
          { key: 'c', header: t('comm.channel', 'Channel'), cell: (r) => <Badge>{r.channel}</Badge> },
          { key: 'p', header: t('comm.to', 'To'), cell: (r) => r.person ?? r.to_address ?? '—' },
          { key: 'n', header: t('comm.what', 'What'), cell: (r) => r.title ?? '—', hideOnMobile: true },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <span><StatusBadge value={r.status === 'sent' ? 'active' : r.status === 'failed' ? 'overdue' : 'inactive'} label={r.status} />{r.attempts > 1 && <span className="ms-1 text-xs text-fg-muted">×{r.attempts}</span>}</span> },
          { key: 'e', header: t('comm.error', 'Error'), cell: (r) => <span className="text-xs text-fg-muted">{r.error ?? ''}</span>, hideOnMobile: true },
          { key: 'r', header: '', cell: (r) => r.retryable && <Button size="sm" variant="outline" loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}><RotateCcw className="size-3.5" /> {t('comm.retry', 'Retry')}</Button> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </>
  );
}

interface LiveAccount { provider: 'zoom' | 'teams' | 'meet'; connected: boolean; enabled: boolean; config: Record<string, string>; has_secret: boolean; webhook_url: string | null }
const FIELDS: Record<LiveAccount['provider'], { key: string; label: string; secret?: boolean; multiline?: boolean }[]> = {
  zoom: [
    { key: 'account_id', label: 'Account ID' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client secret', secret: true },
    { key: 'webhook_secret', label: 'Webhook secret token', secret: true },
  ],
  teams: [
    { key: 'tenant_id', label: 'Directory (tenant) ID' },
    { key: 'client_id', label: 'Application (client) ID' },
    { key: 'client_secret', label: 'Client secret', secret: true },
    { key: 'organizer', label: 'Organizer (Microsoft 365 user email or id)' },
  ],
  meet: [
    { key: 'client_email', label: 'Service account email' },
    { key: 'private_key', label: 'Private key (PEM)', secret: true, multiline: true },
    { key: 'organizer', label: 'Organizer (Google Workspace user email)' },
  ],
};
const HELP: Record<LiveAccount['provider'], string> = {
  zoom: 'Create a Server-to-Server OAuth app in the Zoom Marketplace with the meeting:write scope; add the webhook URL below for recordings and attendance.',
  teams: 'Register an app in Microsoft Entra with the OnlineMeetings.ReadWrite.All application permission and an application access policy for the organizer.',
  meet: 'Create a Google Cloud service account with domain-wide delegation for the calendar.events scope.',
};

function IntegrationsTab() {
  const q = useQuery({ queryKey: ['/integrations/live'], queryFn: () => api.get<LiveAccount[]>('/integrations/live') });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  return <div className="grid gap-4 lg:grid-cols-3">{q.data.map((a) => <ProviderCard key={a.provider} a={a} onSaved={() => void q.refetch()} />)}</div>;
}

function ProviderCard({ a, onSaved }: { a: LiveAccount; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>({ ...a.config });
  const [enabled, setEnabled] = useState(a.connected ? a.enabled : true);
  const save = useMutation({ mutationFn: () => api.put('/integrations/live', { provider: a.provider, enabled, ...v }), onSuccess: () => { toast('success', t('common.saved', 'Saved')); onSaved(); } });
  const remove = useMutation({ mutationFn: () => api.delete(`/integrations/live/${a.provider}`), onSuccess: onSaved });
  const name = { zoom: 'Zoom', teams: 'Microsoft Teams', meet: 'Google Meet' }[a.provider];
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{name}</h2>{a.connected ? <Badge tone="success">{t('comm.connected', 'Connected')}</Badge> : <Badge>{t('comm.notConnected', 'Not connected')}</Badge>}</div>
      <p className="text-xs text-fg-muted">{t(`comm.help.${a.provider}`, HELP[a.provider])}</p>
      {FIELDS[a.provider].map((fd) => (
        <Field key={fd.key} label={t(`comm.f.${a.provider}.${fd.key}`, fd.label)} hint={fd.secret && a.has_secret ? t('comm.keep', 'Saved — leave empty to keep it') : undefined}>
          {(p) => (fd.multiline ? <Textarea {...p} rows={3} autoComplete="off" value={v[fd.key] ?? ''} onChange={(e) => setV({ ...v, [fd.key]: e.target.value })} /> : <Input {...p} type={fd.secret ? 'password' : 'text'} autoComplete="off" value={v[fd.key] ?? ''} onChange={(e) => setV({ ...v, [fd.key]: e.target.value })} />)}
        </Field>
      ))}
      {a.webhook_url && (
        <div className="text-xs">
          <div className="font-medium">{t('comm.webhook', 'Webhook URL')}</div>
          <div className="flex items-center gap-1 break-all"><code>{a.webhook_url}</code> <CopyButton text={a.webhook_url} /></div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('comm.useIt', 'Create meetings here')}</label>
      <MutationError error={save.error} />
      <div className="flex gap-2">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
        {a.connected && <Button size="sm" variant="ghost" onClick={() => remove.mutate()}>{t('comm.disconnect', 'Disconnect')}</Button>}
      </div>
    </Card>
  );
}
