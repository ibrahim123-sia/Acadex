// Platform → Groups & team: groups of institutions with their (read-only) group administrators,
// and the platform's own administrators.
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { MailPlus, Plus, Trash2 } from 'lucide-react';
import { institutionAdminBody, institutionGroupBody } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import { Alert, Button, Card, ConfirmDialog, ErrorState, Field, Input, PageHeader, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui';

interface Person {
  id: number;
  full_name: string;
  email: string;
  status: 'invited' | 'active';
  is_active: boolean;
}

interface Group {
  id: number;
  name: string;
  slug: string;
  institutions: { id: number; name: string; slug: string }[];
  admins: Person[];
}

interface TeamMember extends Person {
  last_login_at: string | null;
  you: boolean;
}

type PersonForm = z.input<typeof institutionAdminBody>;

function PersonFields({ submitLabel, busy, error, onSubmit }: { submitLabel: string; busy: boolean; error: unknown; onSubmit: (v: PersonForm) => void }) {
  const { t } = useTranslation();
  const form = useForm<PersonForm>({ resolver: zodResolver(institutionAdminBody), defaultValues: { name: '', email: '' } });
  const e = form.formState.errors;
  return (
    <form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <Field label={t('common.name', 'Name')} error={e.name?.message}>
        {(a) => <Input {...a} {...form.register('name')} />}
      </Field>
      <Field label={t('common.email', 'Email')} error={e.email?.message}>
        {(a) => <Input {...a} type="email" dir="ltr" {...form.register('email')} />}
      </Field>
      <Button type="submit" loading={busy}>
        <MailPlus className="size-4" /> {submitLabel}
      </Button>
      {error ? <Alert tone="danger" className="sm:col-span-3">{errorMessage(error)}</Alert> : null}
    </form>
  );
}

function PersonLine({ p, onResend, resending, extra, actions }: { p: Person; onResend: () => void; resending: boolean; extra?: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="font-medium">{p.full_name}</div>
        <div className="truncate text-sm text-fg-muted" dir="ltr">
          {p.email}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <StatusBadge value={p.is_active ? p.status : 'disabled'} />
          {extra}
        </div>
      </div>
      <div className="flex gap-1">
        {p.status === 'invited' && p.is_active && (
          <Button variant="ghost" size="sm" loading={resending} onClick={onResend}>
            <MailPlus className="size-4" /> {t('platform.resend', 'Resend invitation')}
          </Button>
        )}
        {actions}
      </div>
    </li>
  );
}

function GroupsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['platform-groups'], queryFn: () => api.get<Group[]>('/platform/groups') });
  const [sent, setSent] = useState<Invite | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['platform-groups'] });

  const form = useForm<z.input<typeof institutionGroupBody>>({ resolver: zodResolver(institutionGroupBody), defaultValues: { name: '', slug: '' } });
  const create = useMutation({
    mutationFn: (v: z.input<typeof institutionGroupBody>) => api.post('/platform/groups', v),
    onSuccess: () => {
      form.reset();
      toast('success', t('platform.groupCreated', 'Group created'));
      refresh();
    },
  });
  const addAdmin = useMutation({
    mutationFn: ({ group, v }: { group: number; v: PersonForm }) => api.post<{ invite: Invite }>(`/platform/groups/${group}/admins`, v),
    onSuccess: (r) => {
      setSent(r.invite);
      refresh();
    },
  });
  const resend = useMutation({
    mutationFn: ({ group, user }: { group: number; user: number }) => api.post<{ invite: Invite }>(`/platform/groups/${group}/admins/${user}/invite`, {}),
    onSuccess: (r) => setSent(r.invite),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (group: number) => api.delete(`/platform/groups/${group}`),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });

  if (sent) return <InviteNotice title={t('platform.inviteSent', 'Invitation sent to {{email}}', { email: sent.email })} invite={sent} onDone={() => setSent(null)} />;
  if (groups.isPending) return <Spinner />;
  if (groups.isError) return <ErrorState error={groups.error} onRetry={() => groups.refetch()} />;
  const e = form.formState.errors;
  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">
        {t('platform.groupsHelp', 'A group is a school network or university system. Its group administrator sees every institution in it, read-only. Put an institution in a group from Institutions → Manage → Details.')}
      </p>
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{t('platform.newGroup', 'New group')}</h2>
        <form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label={t('common.name', 'Name')} error={e.name?.message}>
            {(a) => (
              <Input
                {...a}
                {...form.register('name', {
                  onChange: (ev) => form.setValue('slug', ev.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)),
                })}
              />
            )}
          </Field>
          <Field label={t('platform.slug', 'Address name')} error={e.slug?.message}>
            {(a) => <Input {...a} dir="ltr" {...form.register('slug')} />}
          </Field>
          <Button type="submit" loading={create.isPending}>
            <Plus className="size-4" /> {t('platform.createGroup', 'Create group')}
          </Button>
          {create.isError && <Alert tone="danger" className="sm:col-span-3">{errorMessage(create.error)}</Alert>}
        </form>
      </Card>
      {groups.data.length === 0 && <p className="text-sm text-fg-muted">{t('platform.noGroups', 'No groups yet.')}</p>}
      {groups.data.map((g) => (
        <Card key={g.id} className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{g.name}</h2>
              <div className="text-xs text-fg-muted" dir="ltr">
                {g.slug}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(g)} disabled={g.institutions.length > 0 || g.admins.length > 0} title={t('platform.deleteGroupHint', 'Only an empty group can be deleted')}>
              <Trash2 className="size-4" /> {t('common.delete', 'Delete')}
            </Button>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">{t('nav.institutions', 'Institutions')}</h3>
            {g.institutions.length ? (
              <p className="text-sm">{g.institutions.map((i) => i.name).join(' · ')}</p>
            ) : (
              <p className="text-sm text-fg-muted">{t('platform.groupEmpty', 'None yet — add one from Institutions → Manage.')}</p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">{t('platform.groupAdmins', 'Group administrators')}</h3>
            <ul className="divide-y divide-border">
              {g.admins.map((p) => (
                <PersonLine key={p.id} p={p} resending={resend.isPending && resend.variables?.user === p.id} onResend={() => resend.mutate({ group: g.id, user: p.id })} />
              ))}
            </ul>
            <div className="mt-3">
              <PersonFields
                submitLabel={t('platform.invite', 'Invite')}
                busy={addAdmin.isPending && addAdmin.variables?.group === g.id}
                error={addAdmin.variables?.group === g.id ? addAdmin.error : null}
                onSubmit={(v) => addAdmin.mutate({ group: g.id, v })}
              />
            </div>
          </div>
        </Card>
      ))}
      <ConfirmDialog
        open={!!deleting}
        title={t('platform.deleteGroupTitle', 'Delete {{name}}?', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete', 'Delete')}
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function TeamTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['platform-team'], queryFn: () => api.get<TeamMember[]>('/platform/team') });
  const [sent, setSent] = useState<Invite | null>(null);
  const [disabling, setDisabling] = useState<TeamMember | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['platform-team'] });
  const add = useMutation({
    mutationFn: (v: PersonForm) => api.post<{ invite: Invite }>('/platform/team', v),
    onSuccess: (r) => {
      setSent(r.invite);
      refresh();
    },
  });
  const resend = useMutation({
    mutationFn: (user: number) => api.post<{ invite: Invite }>(`/platform/team/${user}/invite`, {}),
    onSuccess: (r) => setSent(r.invite),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const setActive = useMutation({
    mutationFn: ({ user, active }: { user: number; active: boolean }) => api.patch(`/platform/team/${user}`, { active }),
    onSuccess: (_r, v) => {
      setDisabling(null);
      toast('success', v.active ? t('platform.accessOn', 'Access turned on') : t('platform.accessOff', 'Access turned off'));
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (sent) return <InviteNotice title={t('platform.inviteSent', 'Invitation sent to {{email}}', { email: sent.email })} invite={sent} onDone={() => setSent(null)} />;
  if (team.isPending) return <Spinner />;
  if (team.isError) return <ErrorState error={team.error} onRetry={() => team.refetch()} />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">{t('platform.teamHelp', 'Platform administrators can manage every institution, plan and AI setting. Give this only to people you trust, and ask them to turn on two-step verification (Security).')}</p>
      <Card className="p-4">
        <ul className="divide-y divide-border">
          {team.data.map((m) => (
            <PersonLine
              key={m.id}
              p={m}
              resending={resend.isPending && resend.variables === m.id}
              onResend={() => resend.mutate(m.id)}
              extra={
                <>
                  {m.you && <span>{t('platform.you', 'You')}</span>}
                  {m.last_login_at && <span>{t('platform.lastLogin', 'Last sign-in {{when}}', { when: formatDateTime(m.last_login_at) })}</span>}
                </>
              }
              actions={
                m.you ? null : m.is_active ? (
                  <Button variant="ghost" size="sm" onClick={() => setDisabling(m)}>
                    {t('platform.turnOff', 'Turn off access')}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" loading={setActive.isPending && setActive.variables?.user === m.id} onClick={() => setActive.mutate({ user: m.id, active: true })}>
                    {t('platform.turnOn', 'Turn access back on')}
                  </Button>
                )
              }
            />
          ))}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">{t('platform.addTeam', 'Add a platform administrator')}</h2>
        <PersonFields submitLabel={t('platform.invite', 'Invite')} busy={add.isPending} error={add.error} onSubmit={(v) => add.mutate(v)} />
      </Card>
      <ConfirmDialog
        open={!!disabling}
        title={t('platform.turnOffTitle', 'Turn off access for {{name}}?', { name: disabling?.full_name ?? '' })}
        confirmLabel={t('platform.turnOff', 'Turn off access')}
        busy={setActive.isPending}
        error={setActive.error}
        onConfirm={() => disabling && setActive.mutate({ user: disabling.id, active: false })}
        onClose={() => setDisabling(null)}
      >
        {t('platform.turnOffBody', 'They are signed out everywhere and cannot sign in until you turn access back on.')}
      </ConfirmDialog>
    </div>
  );
}

export function PlatformPeoplePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.groupsTeam', 'Groups & team')} subtitle={t('platform.peopleSubtitle', 'Groups of institutions, and who runs the platform')} />
      <Tabs
        tabs={[
          { id: 'groups', label: t('platform.groups', 'Groups'), content: () => <GroupsTab /> },
          { id: 'team', label: t('platform.team', 'Platform team'), content: () => <TeamTab /> },
        ]}
      />
    </>
  );
}
