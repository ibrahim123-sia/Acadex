// Roles & permissions: built-in roles (read-only) and the school's custom roles.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Permission } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Dialog, ErrorState, Field, Input, PageHeader, Spinner, Textarea, useToast } from '@/components/ui';

interface Role {
  id: number;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: Permission[];
  members: number;
}

const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: 'School office', prefixes: ['school.', 'students.', 'staff.', 'classes.', 'academics.', 'announcements.', 'roles.', 'records.', 'audit.'] },
  { title: 'Finance', prefixes: ['fees.'] },
  { title: 'Teaching', prefixes: ['teaching.', 'attendance.', 'grades.', 'assignments.'] },
  { title: 'Learners & families', prefixes: ['learner.', 'submissions.', 'guardian.'] },
];

function RoleDialog({ role, open, onClose }: { role: Role | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const catalogue = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ key: Permission; description: string }[]>('/school/permissions'), enabled: open });
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<Permission>>(new Set(role?.permissions ?? []));
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, permissions: [...selected] };
      return role ? api.patch(`/school/roles/${role.id}`, body) : api.post('/school/roles', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
  });
  const grouped = useMemo(() => {
    const items = catalogue.data ?? [];
    return GROUPS.map((g) => ({ ...g, items: items.filter((p) => g.prefixes.some((pre) => p.key.startsWith(pre))) })).filter((g) => g.items.length);
  }, [catalogue.data]);
  const toggle = (p: Permission) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <Dialog open={open} onClose={onClose} title={role ? t('roles.edit', 'Edit role') : t('roles.new', 'New role')} className="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Exam controller" required maxLength={80} />}</Field>
        <Field label={t('roles.description', 'Description')} optional>
          {(a) => <Textarea {...a} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}
        </Field>
        {catalogue.isPending ? (
          <Spinner />
        ) : (
          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">{t('roles.permissions', 'What can people with this role do?')}</legend>
            {grouped.map((g) => (
              <div key={g.title}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t(`roles.group.${g.title}`, g.title)}</div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {g.items.map((p) => (
                    <li key={p.key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-surface-2">
                        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                        <span>
                          {t(`permission.${p.key}`, p.description)}
                          <code className="block text-[11px] text-fg-muted">{p.key}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </fieldset>
        )}
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!name.trim() || selected.size === 0}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AdminRoles() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ role: Role | null } | null>(null);
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/school/roles') });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/school/roles/${id}`),
    onSuccess: () => {
      toast('success', t('roles.deleted', 'Role deleted'));
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title={t('nav.roles', 'Roles & permissions')}
        subtitle={t('roles.subtitle', 'Built-in roles, plus your own (for example "Exam controller" or "Accountant"). Assign roles from the Students and Teachers pages.')}
        actions={
          <Button onClick={() => setEditing({ role: null })}>
            <Plus className="size-4" /> {t('roles.new', 'New role')}
          </Button>
        }
      />
      {roles.isPending ? (
        <Spinner />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => roles.refetch()} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {roles.data.map((r) => (
            <li key={r.id}>
              <Card className="h-full p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      {r.name} {r.is_system && <Lock className="size-3.5 text-fg-muted" aria-label={t('roles.builtIn', 'Built-in')} />}
                    </div>
                    <div className="text-xs text-fg-muted">{t('roles.members', '{{count}} people', { count: r.members })}</div>
                  </div>
                  {!r.is_system && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ role: r })} aria-label={t('common.edit', 'Edit')}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" loading={del.isPending && del.variables === r.id} onClick={() => del.mutate(r.id)} aria-label={t('common.delete', 'Delete')}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
                {r.description && <p className="mt-2 text-sm text-fg-muted">{r.description}</p>}
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {r.permissions.map((p) => (
                    <li key={p}>
                      <Badge>{p}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <RoleDialog key={editing.role?.id ?? 'new'} role={editing.role} open onClose={() => setEditing(null)} />}
    </>
  );
}
