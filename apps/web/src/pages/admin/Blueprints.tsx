// Blueprints: a course built once (or copied from a course) and pushed to many sections or
// campuses. Changes made in a section's copy are kept when the blueprint is updated.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Layers, RefreshCw, Send } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Badge, Button, Card, DataTable, Dialog, Field, Input, PageHeader, Select, useToast } from '@/components/ui';

interface Blueprint {
  id: number;
  title: string;
  description: string;
  course_name: string | null;
  modules: number;
  courses: number;
}
interface Offering {
  id: number;
  name: string;
  code: string;
  section_name: string | null;
  section_label: string | null;
}

export function AdminBlueprints() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['blueprints'], queryFn: () => api.get<Blueprint[]>('/blueprints') });
  const offerings = useQuery({ queryKey: ['bp-offerings'], queryFn: () => api.all<Offering>('/institution/offerings') });
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [applyTo, setApplyTo] = useState<Blueprint | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['blueprints'] });
  const create = useMutation({
    mutationFn: () => api.post('/blueprints', { title, from_offering_id: from ? Number(from) : null }),
    onSuccess: () => {
      setTitle('');
      setFrom('');
      void refresh();
      toast('success', t('bp.created', 'Blueprint saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ offering_id: number; added: number }[]>(`/blueprints/${applyTo!.id}/apply`, { offering_ids: picked }),
    onSuccess: (r) => {
      setApplyTo(null);
      setPicked([]);
      void refresh();
      toast('success', t('bp.applied', 'Copied into {{n}} course(s)', { n: r.length }));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const push = useMutation({
    mutationFn: (id: number) => api.post<{ updated: number; added: number }[]>(`/blueprints/${id}/push`, {}),
    onSuccess: (r) => toast('success', t('bp.pushed', 'Updated {{n}} course(s); changes made in a course were kept', { n: r.length })),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const label = (o: Offering) => [o.name, [o.section_name, o.section_label].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return (
    <>
      <PageHeader title={t('nav.blueprints', 'Blueprints')} subtitle={t('bp.subtitle', 'Build a course once, use it in every section')} />
      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('bp.eg', 'e.g. Grade 7 Maths')} />}</Field>
          <Field label={t('bp.copyFrom', 'Copy from a course')} optional>
            {(a) => (
              <Select {...a} value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">{t('bp.empty', 'Start empty')}</option>
                {offerings.data?.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
              </Select>
            )}
          </Field>
          <Button type="submit" loading={create.isPending}><Layers className="size-4" /> {t('bp.create', 'Create blueprint')}</Button>
        </form>
      </Card>
      <DataTable
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        empty={t('bp.none', 'No blueprints yet')}
        columns={[
          { key: 't', header: t('common.title', 'Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
          { key: 'm', header: t('bp.modules', 'Modules'), cell: (r) => r.modules },
          { key: 'c', header: t('bp.usedIn', 'Used in'), cell: (r) => <Badge>{t('bp.courses', '{{n}} courses', { n: r.courses })}</Badge> },
          {
            key: 'a',
            header: '',
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setApplyTo(r)}><Send className="size-4" /> {t('bp.apply', 'Copy to courses')}</Button>
                {r.courses > 0 && <Button size="sm" variant="outline" onClick={() => push.mutate(r.id)} loading={push.isPending}><RefreshCw className="size-4" /> {t('bp.push', 'Push updates')}</Button>}
              </div>
            ),
          },
        ]}
      />
      {applyTo && (
        <Dialog open onClose={() => setApplyTo(null)} title={t('bp.applyTitle', 'Copy “{{t}}” to', { t: applyTo.title })}>
          <div className="space-y-3 p-5">
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {offerings.data?.map((o) => (
                <li key={o.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} /> {label(o)}
                  </label>
                </li>
              ))}
            </ul>
            <Button onClick={() => apply.mutate()} disabled={!picked.length} loading={apply.isPending}>{t('bp.applyN', 'Copy to {{n}} course(s)', { n: picked.length })}</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
