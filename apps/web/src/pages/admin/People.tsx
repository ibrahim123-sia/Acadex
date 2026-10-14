// People directories: students, staff and guardians — with filters, admission / hiring with
// invitations, roles, and links to each person's record.
import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { MailPlus, Plus, Search, UserCog } from 'lucide-react';
import { createStudentBody, createTeacherBody } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, usePagedList } from '@/lib/queries';
import { useTerms } from '@/lib/terms';
import { Avatar } from '@/components/FileImage';
import { CustomFieldInputs, useCustomFields, type CustomValues } from '@/components/CustomFields';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import { UserRolesDialog } from '@/components/UserRolesDialog';
import { Alert, Badge, Button, DataTable, Dialog, Field, Input, PageHeader, Pager, Select, StatusBadge, useToast } from '@/components/ui';
import { sectionName, useSectionOptions, useStructure } from './structure-data';

interface StudentRow {
  id: number;
  roll_no: string | null;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  section_id: number | null;
  section_name: string | null;
  section_label: string | null;
  campus_name: string | null;
  has_photo: boolean;
  fee_status: string;
  user_id: number | null;
  invite_pending: boolean;
}

interface StaffRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  designation: string;
  staff_type: 'teaching' | 'non_teaching';
  employment_type: string;
  status: string;
  campus_name: string | null;
  department_name: string | null;
  courses: number;
  credit_hours: number;
  periods_per_week: number;
  homerooms: number;
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

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="ps-9" aria-label={t('common.search', 'Search')} />
    </div>
  );
}

// ---------------------------------------------------------------- students

function AdmitStudentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const qc = useQueryClient();
  const sections = useSectionOptions({}, open);
  const defs = useCustomFields('student');
  const [custom, setCustom] = useState<CustomValues>({});
  const [invite, setInvite] = useState<{ name: string; invite: Invite } | null>(null);
  const form = useForm<z.input<typeof createStudentBody>, unknown, z.output<typeof createStudentBody>>({
    resolver: zodResolver(createStudentBody),
    defaultValues: { first_name: '', last_name: '', email: '', gender: 'Male', section_id: '', guardian_name: '', guardian_phone: '', roll_no: '', dob: '' },
  });
  const m = useMutation({
    mutationFn: (v: z.output<typeof createStudentBody>) => api.post<{ first_name: string; last_name: string; invite: Invite }>('/institution/students', { ...v, custom_data: custom }),
    onSuccess: (r) => {
      setInvite({ name: `${r.first_name} ${r.last_name}`, invite: r.invite });
      void qc.invalidateQueries({ queryKey: ['/institution/students'] });
    },
  });
  const close = () => {
    setInvite(null);
    setCustom({});
    form.reset();
    m.reset();
    onClose();
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={close} title={t('admin.admitTerm', 'Admit a {{student}}', { student: term('student', false, { lower: true }) })} className="max-w-2xl">
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
            <Field label={t('common.email', 'Email')} hint={t('admin.inviteHint', 'The invitation to set a password goes here.')} error={e.email?.message}>
              {(a) => <Input {...a} type="email" dir="ltr" {...form.register('email')} />}
            </Field>
            <Field label={term('section')} optional>
              {(a) => (
                <Select {...a} {...form.register('section_id')}>
                  <option value="">—</option>
                  {sections.data
                    ?.filter((s) => s.status === 'active')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {sectionName(c)}
                        {c.campus_name ? ` · ${c.campus_name}` : ''}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label={t('common.gender', 'Gender')}>
              {(a) => (
                <Select {...a} {...form.register('gender')}>
                  <option value="Male">{t('common.male', 'Male')}</option>
                  <option value="Female">{t('common.female', 'Female')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('people.dob', 'Date of birth')} optional error={e.dob?.message}>
              {(a) => <Input {...a} type="date" {...form.register('dob')} />}
            </Field>
            <Field label={t('people.rollNo', 'Roll number')} optional>
              {(a) => <Input {...a} dir="ltr" {...form.register('roll_no')} />}
            </Field>
          </div>
          <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{term('guardian')}</legend>
            <Field label={t('common.name', 'Name')} optional>
              {(a) => <Input {...a} {...form.register('guardian_name')} />}
            </Field>
            <Field label={t('common.phone', 'Phone')} optional>
              {(a) => <Input {...a} type="tel" dir="ltr" {...form.register('guardian_phone')} />}
            </Field>
          </fieldset>
          <CustomFieldInputs defs={defs.data ?? []} values={custom} onChange={setCustom} />
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('admin.admitTerm', 'Admit a {{student}}', { student: term('student', false, { lower: true }) })}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function AdminStudents() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const structure = useStructure();
  const sections = useSectionOptions();
  const [search, setSearch] = useState('');
  const [campus, setCampus] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('active');
  const debounced = useDebounced(search);
  const [open, setOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<{ id: number; name: string } | null>(null);
  const list = usePagedList<StudentRow>('/institution/students', { search: debounced, campus_id: campus, section_id: section, status });
  const resend = useResendInvite();
  const multiCampus = (structure.data?.campuses.length ?? 0) > 1;
  return (
    <>
      <PageHeader
        title={term('student', true)}
        subtitle={list.data && t('admin.studentCount', '{{count}} students', { count: list.data.total })}
        actions={
          can('students.manage') && (
            <div className="flex gap-2">
              {can('imports.run') && (
                <Link to="/admin/imports#students">
                  <Button variant="outline">{t('imports.bulk', 'Import')}</Button>
                </Link>
              )}
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" /> {t('admin.admitTerm', 'Admit a {{student}}', { student: term('student', false, { lower: true }) })}
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.searchStudents', 'Search by name or roll number…')} />
        {multiCampus && (
          <Select className="w-auto" value={campus} onChange={(e) => setCampus(e.target.value)} aria-label={term('campus')}>
            <option value="">{t('structure.allCampuses', 'All campuses')}</option>
            {structure.data?.campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select className="w-auto" value={section} onChange={(e) => setSection(e.target.value)} aria-label={term('section')}>
          <option value="">{t('people.allSections', 'All {{sections}}', { sections: term('section', true, { lower: true }) })}</option>
          {sections.data
            ?.filter((s) => !campus || String(s.campus_id) === campus)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {sectionName(s)}
              </option>
            ))}
        </Select>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status', 'Status')}>
          {(['active', 'inactive', 'graduated', 'left', 'all'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`studentStatus.${s}`, s === 'graduated' ? 'Alumni' : s)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={debounced ? t('admin.noMatches', 'No students match your search') : t('admin.noStudents', 'No students yet')}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (s) => (
              <Link to={`/admin/students/${s.id}`} className="flex items-center gap-3">
                <Avatar name={`${s.first_name} ${s.last_name}`} className="size-8 text-xs" />
                <span>
                  <span className="font-medium text-primary hover:underline">
                    {s.first_name} {s.last_name}
                  </span>
                  <span className="block font-mono text-xs text-fg-muted">{s.roll_no ?? ''}</span>
                </span>
                {s.invite_pending && <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge>}
              </Link>
            ),
          },
          { key: 'section', header: term('section'), cell: (s) => (s.section_name ? sectionName({ name: s.section_name, label: s.section_label }) : '—') },
          ...(multiCampus ? [{ key: 'campus', header: term('campus'), cell: (s: StudentRow) => s.campus_name ?? '—', hideOnMobile: true }] : []),
          { key: 'fee', header: t('nav.fees', 'Fees'), cell: (s) => <StatusBadge value={s.fee_status} label={t(`status.${s.fee_status}`, s.fee_status)} />, hideOnMobile: true },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (s) => (
              <div className="flex justify-end gap-1">
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

// ---------------------------------------------------------------- staff

function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const qc = useQueryClient();
  const structure = useStructure();
  const [invite, setInvite] = useState<{ name: string; invite: Invite | null } | null>(null);
  const form = useForm<z.input<typeof createTeacherBody>, unknown, z.output<typeof createTeacherBody>>({
    resolver: zodResolver(createTeacherBody),
    defaultValues: { first_name: '', last_name: '', email: '', gender: 'Male', phone: '', qualification: '', designation: '', staff_type: 'teaching', employment_type: 'full_time', campus_id: '', department_id: '', employee_no: '', create_account: true },
  });
  const staffType = form.watch('staff_type');
  const m = useMutation({
    mutationFn: (v: z.output<typeof createTeacherBody>) => api.post<{ first_name: string; last_name: string; invite: Invite | null }>('/institution/teachers', v),
    onSuccess: (r) => {
      setInvite({ name: `${r.first_name} ${r.last_name}`, invite: r.invite });
      void qc.invalidateQueries({ queryKey: ['/institution/teachers'] });
      void qc.invalidateQueries({ queryKey: ['staff-options'] });
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
    <Dialog open={open} onClose={close} title={t('staff.add', 'Add a staff member')} className="max-w-2xl">
      {invite ? (
        invite.invite ? (
          <InviteNotice title={t('admin.teacherAdded', '{{name}} added', { name: invite.name })} invite={invite.invite} onDone={close} />
        ) : (
          <div className="space-y-4">
            <Alert tone="success">{t('staff.addedNoAccount', '{{name}} added (no sign-in account).', { name: invite.name })}</Alert>
            <div className="flex justify-end">
              <Button onClick={close}>{t('common.done', 'Done')}</Button>
            </div>
          </div>
        )
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate({ ...v, create_account: v.staff_type === 'teaching' ? true : v.create_account }))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('people.firstName', 'First name')} error={e.first_name?.message}>
              {(a) => <Input {...a} {...form.register('first_name')} />}
            </Field>
            <Field label={t('people.lastName', 'Last name')} error={e.last_name?.message}>
              {(a) => <Input {...a} {...form.register('last_name')} />}
            </Field>
            <Field label={t('common.email', 'Email')} error={e.email?.message}>
              {(a) => <Input {...a} type="email" dir="ltr" {...form.register('email')} />}
            </Field>
            <Field label={t('common.phone', 'Phone')} optional>
              {(a) => <Input {...a} type="tel" dir="ltr" {...form.register('phone')} />}
            </Field>
            <Field label={t('staff.type', 'Staff type')}>
              {(a) => (
                <Select {...a} {...form.register('staff_type')}>
                  <option value="teaching">{t('staff.teaching', 'Teaching ({{teacher}})', { teacher: term('teacher', false, { lower: true }) })}</option>
                  <option value="non_teaching">{t('staff.nonTeaching', 'Non-teaching (office, library, transport…)')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('staff.designation', 'Designation')} optional>
              {(a) => <Input {...a} placeholder={t('staff.designationExample', 'Senior Teacher, Accountant…')} {...form.register('designation')} />}
            </Field>
            {(structure.data?.campuses.length ?? 0) > 1 && (
              <Field label={term('campus')} optional>
                {(a) => (
                  <Select {...a} {...form.register('campus_id')}>
                    <option value="">{t('sections.mainCampus', 'Main')}</option>
                    {structure.data?.campuses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {(structure.data?.departments.length ?? 0) > 0 && (
              <Field label={term('department')} optional>
                {(a) => (
                  <Select {...a} {...form.register('department_id')}>
                    <option value="">—</option>
                    {structure.data?.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('staff.employment', 'Employment')}>
              {(a) => (
                <Select {...a} {...form.register('employment_type')}>
                  {(['full_time', 'part_time', 'visiting', 'contract'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`employment.${x}`, x.replace('_', ' '))}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('staff.employeeNo', 'Employee number')} optional>
              {(a) => <Input {...a} dir="ltr" {...form.register('employee_no')} />}
            </Field>
            <Field label={t('people.qualification', 'Qualification')} optional>
              {(a) => <Input {...a} placeholder="M.Sc Mathematics" {...form.register('qualification')} />}
            </Field>
          </div>
          {staffType === 'non_teaching' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('create_account')} />
              {t('staff.createAccount', 'Give them a sign-in (invitation by email)')}
            </label>
          )}
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('staff.add', 'Add a staff member')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function AdminTeachers() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const structure = useStructure();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [campus, setCampus] = useState('');
  const [type, setType] = useState('all');
  const debounced = useDebounced(search);
  const [rolesFor, setRolesFor] = useState<{ id: number; name: string } | null>(null);
  const list = usePagedList<StaffRow>('/institution/teachers', { search: debounced, campus_id: campus, staff_type: type });
  const resend = useResendInvite();
  const multiCampus = (structure.data?.campuses.length ?? 0) > 1;
  return (
    <>
      <PageHeader
        title={t('nav.staff', 'Staff')}
        subtitle={list.data && t('staff.count', '{{count}} people', { count: list.data.total })}
        actions={
          can('staff.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('staff.add', 'Add a staff member')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t('staff.search', 'Search by name, email or employee number…')} />
        {multiCampus && (
          <Select className="w-auto" value={campus} onChange={(e) => setCampus(e.target.value)} aria-label={term('campus')}>
            <option value="">{t('structure.allCampuses', 'All campuses')}</option>
            {structure.data?.campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label={t('staff.type', 'Staff type')}>
          <option value="all">{t('staff.everyone', 'Everyone')}</option>
          <option value="teaching">{term('teacher', true)}</option>
          <option value="non_teaching">{t('staff.nonTeachingShort', 'Non-teaching')}</option>
        </Select>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('admin.noTeachers', 'No staff yet')}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (r) => (
              <Link to={`/admin/teachers/${r.id}`} className="block">
                <span className="font-medium text-primary hover:underline">
                  {r.first_name} {r.last_name}
                </span>
                <span className="block text-xs text-fg-muted">{r.designation || (r.staff_type === 'teaching' ? term('teacher') : t('staff.nonTeachingShort', 'Non-teaching'))}</span>
                {r.invite_pending && <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge>}
              </Link>
            ),
          },
          ...(multiCampus ? [{ key: 'campus', header: term('campus'), cell: (r: StaffRow) => r.campus_name ?? '—', hideOnMobile: true }] : []),
          { key: 'dept', header: term('department'), cell: (r) => r.department_name ?? '—', hideOnMobile: true },
          {
            key: 'load',
            header: t('staff.load', 'Teaching load'),
            cell: (r) =>
              r.staff_type === 'teaching' ? (
                <span className="text-sm">
                  {t('staff.loadSummary', '{{courses}} courses', { courses: r.courses })}
                  {r.credit_hours > 0 && ` · ${r.credit_hours} cr`}
                  {r.periods_per_week > 0 && ` · ${r.periods_per_week}/wk`}
                </span>
              ) : (
                '—'
              ),
          },
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
      <AddStaffDialog open={open} onClose={() => setOpen(false)} />
      <UserRolesDialog userId={rolesFor?.id ?? null} name={rolesFor?.name ?? ''} onClose={() => setRolesFor(null)} />
    </>
  );
}

// ---------------------------------------------------------------- guardians

interface GuardianRow {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  has_account: boolean;
  invite_pending: boolean;
  children: { id: number; name: string; relationship: string }[];
}

export function AdminGuardians() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const list = usePagedList<GuardianRow>('/institution/guardians', { search: debounced });
  const [invite, setInvite] = useState<{ name: string; invite: Invite } | null>(null);
  const inviteOne = useMutation({
    mutationFn: (g: GuardianRow) => api.post<{ invite: Invite }>(`/institution/guardians/${g.id}/invite`).then((r) => ({ ...r, name: `${g.first_name} ${g.last_name}` })),
    onSuccess: (r) => {
      setInvite({ name: r.name, invite: r.invite });
      void qc.invalidateQueries({ queryKey: ['/institution/guardians'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const inviteAll = useMutation({
    mutationFn: () => api.post<{ invited: number; skipped: number }>('/institution/bulk-invite', { kind: 'guardians' }),
    onSuccess: (r) => {
      toast('success', t('guardians.invitedAll', '{{n}} invitations sent ({{skipped}} without an email or already using the portal)', { n: r.invited, skipped: r.skipped }));
      void qc.invalidateQueries({ queryKey: ['/institution/guardians'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title={term('guardian', true)}
        subtitle={t('guardians.subtitle', 'Linked to students; each can be allowed to see grades, fees and messages')}
        actions={
          can('guardians.manage') && (
            <Button variant="outline" loading={inviteAll.isPending} onClick={() => inviteAll.mutate()}>
              <MailPlus className="size-4" /> {t('guardians.inviteAll', 'Invite everyone to the parent portal')}
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchBox value={search} onChange={setSearch} placeholder={t('guardians.search', 'Name, phone or email…')} />
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('guardians.empty', 'No guardians yet — they are added with each student')}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (g) => (
              <div>
                <div className="font-medium">
                  {g.first_name} {g.last_name}
                </div>
                <div className="text-xs text-fg-muted" dir="ltr">
                  {[g.phone, g.email].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            ),
          },
          {
            key: 'children',
            header: term('student', true),
            cell: (g) => (
              <div className="flex flex-wrap gap-1">
                {g.children.map((c) => (
                  <Link key={c.id} to={`/admin/students/${c.id}`} className="text-sm text-primary hover:underline">
                    {c.name}
                  </Link>
                ))}
              </div>
            ),
          },
          {
            key: 'portal',
            header: t('guardians.portalShort', 'Parent portal'),
            cell: (g) =>
              g.has_account ? (
                g.invite_pending ? <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge> : <Badge tone="success">{t('guardians.active', 'Active')}</Badge>
              ) : g.email && can('guardians.manage') ? (
                <Button variant="ghost" size="sm" loading={inviteOne.isPending && inviteOne.variables?.id === g.id} onClick={() => inviteOne.mutate(g)}>
                  <MailPlus className="size-4" /> {t('guardians.inviteShort', 'Invite')}
                </Button>
              ) : (
                <span className="text-xs text-fg-muted">{g.email ? '—' : t('guardians.noEmail', 'No email')}</span>
              ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <Dialog open={!!invite} onClose={() => setInvite(null)} title={t('guardians.invited', 'Invitation sent')}>
        {invite && <InviteNotice title={invite.name} invite={invite.invite} onDone={() => setInvite(null)} />}
      </Dialog>
    </>
  );
}
