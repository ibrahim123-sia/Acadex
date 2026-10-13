import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Dialog, MutationError, Select, Spinner } from './ui';

interface Role {
  id: number;
  key: string;
  name: string;
  is_system: boolean;
}

/** Which roles one person holds in the institution, with add/remove. */
export function UserRolesDialog({ userId, name, onClose }: { userId: number | null; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const held = useQuery({
    queryKey: ['user-roles', userId],
    queryFn: () => api.get<Role[]>(`/institution/users/${userId}/roles`),
    enabled: userId != null,
  });
  const all = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/institution/roles'), enabled: userId != null });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['user-roles', userId] });
    void qc.invalidateQueries({ queryKey: ['roles'] });
  };
  const add = useMutation({ mutationFn: (roleId: number) => api.post(`/institution/users/${userId}/roles`, { role_id: roleId }), onSuccess: () => (setPick(''), invalidate()) });
  const remove = useMutation({ mutationFn: (roleId: number) => api.delete(`/institution/users/${userId}/roles/${roleId}`), onSuccess: invalidate });

  const available = (all.data ?? []).filter((r) => !held.data?.some((h) => h.id === r.id));
  return (
    <Dialog open={userId != null} onClose={onClose} title={t('roles.forUser', 'Roles of {{name}}', { name })}>
      {held.isPending || all.isPending ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ul className="flex flex-wrap gap-2">
            {held.data?.map((r) => (
              <li key={r.id}>
                <Badge tone={r.is_system ? 'info' : 'neutral'} className="gap-1 py-1">
                  {r.name}
                  <button type="button" onClick={() => remove.mutate(r.id)} aria-label={t('roles.remove', 'Remove {{role}}', { role: r.name })} className="ms-1 hover:text-danger">
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
            {!held.data?.length && <li className="text-sm text-fg-muted">{t('roles.none', 'No roles')}</li>}
          </ul>
          <MutationError error={remove.error ?? add.error} />
          <div className="flex gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('roles.addRole', 'Add a role')}>
              <option value="">{t('roles.addRole', 'Add a role')}…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button disabled={!pick} loading={add.isPending} onClick={() => add.mutate(Number(pick))}>
              {t('common.add', 'Add')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
