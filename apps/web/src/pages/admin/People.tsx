// Students and teachers: directories, admission / hiring with invitations, roles, resend invite.
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FileText, MailPlus, Plus, Search, UserCog } from 'lucide-react';
import { createStudentBody, createTeacherBody } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, usePagedList } from '@/lib/queries';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import { UserRolesDialog } from '@/components/UserRolesDialog';
import { Alert, Badge, Button, DataTable, Dialog, Field, Input, PageHeader, Pager, Select, StatusBadge, useToast } from '@/components/ui';

interface StudentRow {
  id: number;
  roll_no: string | null;
  first_name: string;
  last_name: string;
  email: string;
  gender: string | null;
  status: string;
  section_name: string | null;
  fee_status: string;
  user_id: number | null;
  invite_pending: boolean;
}

interface TeacherRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  qualification: string;
  subjects: number;
  user_id: number | null;
  invite_pending: boolean;
}

function useResendInvite() {
  const { t } = useTranslation();
  const toast = useToast();
  return useMutation({
    mutationFn: (userId: number) => api.post<{ invite: Invite }>(`/institution/users/${userId}/invite`),
    onSuccess: (r) => toast('success', t('invite.resent', 'New invitation sent to {{email}}', { email: r.invite.email })),
    onError: (e) => toast('error', errorMessage(e)),
  });
}

function AdmitStudentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [invite, setInvite] = useState<{ name: string; invite: Invite } | null>(null);
  const sections = useQuery({ queryKey: ['sections-all'], queryFn: () => api.get<{ id: number; name: string }[]>('/institution/sections', { pageSize: 100 }), enabled: open });
  const form = useForm<z.input<typeof createStudentBody>, unknown, z.output<typeof createStudentBody>>({
    resolver: zodResolver(createStudentBody),
    defaultValues: { first_name: '', last_name: '', email: '', gender: 'Male', age: '', section_id: '', guardian_name: '', guardian_phone: '', roll_no: '' },
  });
  const m = useMutation({
    mutationFn: (v: z.output<typeof createStudentBody>) => api.post<{ first_name: string; last_name: string; invite: Invite }>('/institution/students', v),
    onSuccess: (r) => {
      setInvite({ name: `${r.first_name} ${r.last_name}`, invite: r.invite });
      void qc.invalidateQueries({ queryKey: ['/institution/students'] });
    },
  });
  const close = () => {
    setInvite(null);
    form.reset();
    m.reset();
    onClose();
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={close} title={t('admin.admit', 'Admit a student')}>
      {invite ? (
        <InviteNotice title={t('admin.admitted', '{{name}} admitted', { name: invite.name })} invite={invite.invite} onDone={close} />
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('people.firstName', 'First name')} error={e.first_name?.message}>
              {(a) => <Input {...a} autoComplete="off" {...form.register('first_name')} />}
            </Field>
            <Field label={t('people.lastName', 'Last name')} error={e.last_name?.message}>
              {(a) => <Input {...a} autoComplete="off" {...form.register('last_name')} />}
            </Field>
          </div>
          <Field label={t('common.email', 'Email')} hint={t('admin.inviteHint', 'The invitation to set a password goes here.')} error={e.email?.message}>
            {(a) => <Input {...a} type="email" dir="ltr" {...form.register('email')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('common.gender', 'Gender')}>
              {(a) => (
                <Select {...a} {...form.register('gender')}>
                  <option value="Male">{t('common.male', 'Male')}</option>
                  <option value="Female">{t('common.female', 'Female')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('people.age', 'Age')} optional error={e.age?.message}>
              {(a) => <Input {...a} type="number" inputMode="numeric" {...form.register('age')} />}
            </Field>
            <Field label={t('common.class', 'Class')} optional>
              {(a) => (
                <Select {...a} {...form.register('section_id')}>
                  <option value="">—</option>
                  {sections.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('people.rollNo', 'Roll number')} optional>
              {(a) => <Input {...a} dir="ltr" {...form.register('roll_no')} />}
            </Field>
            <Field label={t('people.guardian', 'Guardian name')} optional>
              {(a) => <Input {...a} {...form.register('guardian_name')} />}
            </Field>
          </div>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('admin.admit', 'Admit a student')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function AdminStudents() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [open, setOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<{ id: number; name: string } | null>(null);
  const list = usePagedList<StudentRow>('/institution/students', { search: debounced });
  const resend = useResendInvite();
  const download = async (s: StudentRow) => {
    try {
      await api.download(`/pdf/report-card/${s.id}`, `report-card-${s.roll_no || s.id}.pdf`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader
        title={t('nav.students', 'Students')}
        subtitle={list.data ? t('admin.studentCount', '{{count}} students', { count: list.data.total }) : undefined}
        actions={
          can('students.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.admit', 'Admit a student')}
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.searchStudents', 'Search by name or roll number…')} className="ps-9" aria-label={t('common.search', 'Search')} />
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={debounced ? t('admin.noMatches', 'No students match your search') : t('admin.noStudents', 'No students yet')}
        columns={[
          { key: 'roll', header: t('people.rollNo', 'Roll number'), cell: (s) => <span className="font-mono text-xs">{s.roll_no ?? '—'}</span>, hideOnMobile: true },
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (s) => (
              <div>
                <div className="font-medium">
                  {s.first_name} {s.last_name}
                </div>
                {s.invite_pending && <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge>}
              </div>
            ),
          },
          { key: 'class', header: t('common.class', 'Class'), cell: (s) => s.section_name ?? '—' },
          { key: 'fee', header: t('nav.fees', 'Fees'), cell: (s) => <StatusBadge value={s.fee_status} label={t(`status.${s.fee_status}`, s.fee_status)} />, hideOnMobile: true },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (s) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => void download(s)} aria-label={t('admin.reportCard', 'Report card')}>
                  <FileText className="size-4" /> <span className="hidden md:inline">{t('admin.reportCard', 'Report card')}</span>
                </Button>
                {s.invite_pending && s.user_id && can('students.manage') && (
                  <Button variant="ghost" size="sm" loading={resend.isPending && resend.variables === s.user_id} onClick={() => resend.mutate(s.user_id!)} aria-label={t('invite.resend', 'Resend invitation')}>
                    <MailPlus className="size-4" />
                  </Button>
                )}
                {s.user_id && can('roles.manage') && (
                  <Button variant="ghost" size="sm" onClick={() => setRolesFor({ id: s.user_id!, name: `${s.first_name} ${s.last_name}` })} aria-label={t('nav.roles', 'Roles & permissions')}>
                    <UserCog className="size-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <AdmitStudentDialog open={open} onClose={() => setOpen(false)} />
      <UserRolesDialog userId={rolesFor?.id ?? null} name={rolesFor?.name ?? ''} onClose={() => setRolesFor(null)} />
    </>
  );
}

function AddTeacherDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [invite, setInvite] = useState<{ name: string; invite: Invite } | null>(null);
  const form = useForm<z.input<typeof createTeacherBody>, unknown, z.output<typeof createTeacherBody>>({
    resolver: zodResolver(createTeacherBody),
    defaultValues: { first_name: '', last_name: '', email: '', gender: 'Male', phone: '', qualification: '' },
  });
  const m = useMutation({
    mutationFn: (v: z.output<typeof createTeacherBody>) => api.post<{ first_name: string; last_name: string; invite: Invite }>('/institution/teachers', v),
    onSuccess: (r) => {
      setInvite({ name: `${r.first_name} ${r.last_name}`, invite: r.invite });
      void qc.invalidateQueries({ queryKey: ['/institution/teachers'] });
    },
  });
  const close = () => {
    setInvite(null);
    form.reset();
    m.reset();
    onClose();
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={close} title={t('admin.addTeacher', 'Add a teacher')}>
      {invite ? (
        <InviteNotice title={t('admin.teacherAdded', '{{name}} added', { name: invite.name })} invite={invite.invite} onDone={close} />
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('people.firstName', 'First name')} error={e.first_name?.message}>
              {(a) => <Input {...a} {...form.register('first_name')} />}
            </Field>
            <Field label={t('people.lastName', 'Last name')} error={e.last_name?.message}>
              {(a) => <Input {...a} {...form.register('last_name')} />}
            </Field>
          </div>
          <Field label={t('common.email', 'Email')} hint={t('admin.inviteHint', 'The invitation to set a password goes here.')} error={e.email?.message}>
            {(a) => <Input {...a} type="email" dir="ltr" {...form.register('email')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.gender', 'Gender')}>
              {(a) => (
                <Select {...a} {...form.register('gender')}>
                  <option value="Male">{t('common.male', 'Male')}</option>
                  <option value="Female">{t('common.female', 'Female')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('common.phone', 'Phone')} optional>
              {(a) => <Input {...a} type="tel" dir="ltr" {...form.register('phone')} />}
            </Field>
          </div>
          <Field label={t('people.qualification', 'Qualification')} optional>
            {(a) => <Input {...a} placeholder="M.Sc Mathematics" {...form.register('qualification')} />}
          </Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('admin.addTeacher', 'Add a teacher')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function AdminTeachers() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<{ id: number; name: string } | null>(null);
  const list = usePagedList<TeacherRow>('/institution/teachers');
  const resend = useResendInvite();
  return (
    <>
      <PageHeader
        title={t('nav.teachers', 'Teachers')}
        subtitle={t('admin.teachersSubtitle', 'Faculty directory')}
        actions={
          can('staff.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.addTeacher', 'Add a teacher')}
            </Button>
          )
        }
      />
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('admin.noTeachers', 'No teachers yet')}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (r) => (
              <div>
                <div className="font-medium">
                  {r.first_name} {r.last_name}
                </div>
                {r.invite_pending && <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge>}
              </div>
            ),
          },
          { key: 'email', header: t('common.email', 'Email'), cell: (r) => <span className="text-fg-muted" dir="ltr">{r.email}</span>, hideOnMobile: true },
          { key: 'phone', header: t('common.phone', 'Phone'), cell: (r) => <span dir="ltr">{r.phone || '—'}</span>, hideOnMobile: true },
          { key: 'qual', header: t('people.qualification', 'Qualification'), cell: (r) => r.qualification || '—', hideOnMobile: true },
          { key: 'subjects', header: t('admin.subjects', 'Subjects'), cell: (r) => r.subjects },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (r) => (
              <div className="flex justify-end gap-1">
                {r.invite_pending && r.user_id && can('staff.manage') && (
                  <Button variant="ghost" size="sm" loading={resend.isPending && resend.variables === r.user_id} onClick={() => resend.mutate(r.user_id!)} aria-label={t('invite.resend', 'Resend invitation')}>
                    <MailPlus className="size-4" />
                  </Button>
                )}
                {r.user_id && can('roles.manage') && (
                  <Button variant="ghost" size="sm" onClick={() => setRolesFor({ id: r.user_id!, name: `${r.first_name} ${r.last_name}` })} aria-label={t('nav.roles', 'Roles & permissions')}>
                    <UserCog className="size-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <AddTeacherDialog open={open} onClose={() => setOpen(false)} />
      <UserRolesDialog userId={rolesFor?.id ?? null} name={rolesFor?.name ?? ''} onClose={() => setRolesFor(null)} />
    </>
  );
}
