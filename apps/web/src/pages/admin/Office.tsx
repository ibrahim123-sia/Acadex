// Announcements (fees moved to /finance).
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Megaphone, Plus } from 'lucide-react';
import { announcementBody, AUDIENCES } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Pager, Select, Spinner, Textarea } from '@/components/ui';

// ---------------- announcements ----------------
interface Announcement {
  id: number;
  title: string;
  description: string;
  target_audience: string;
  created_at?: string;
  end_date: string | null;
}

export function AnnouncementList({ path }: { path: string }) {
  const { t } = useTranslation();
  const list = usePagedList<Announcement>(path, {}, 20);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data.rows.length)
    return (
      <Card>
        <EmptyState title={t('admin.noAnnouncements', 'No announcements yet')} />
      </Card>
    );
  return (
    <>
      <ul className="space-y-3">
        {list.data.rows.map((a) => (
          <li key={a.id}>
            <Card className="flex items-start gap-3 p-5">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                <Megaphone className="size-[18px]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.title}</div>
                <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{a.description}</p>
                {a.end_date && <div className="mt-1 text-xs text-fg-muted">{t('admin.until', 'Until {{date}}', { date: formatDate(a.end_date) })}</div>}
              </div>
              <Badge tone="info">{t(`audience.${a.target_audience}`, a.target_audience)}</Badge>
            </Card>
          </li>
        ))}
      </ul>
      <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />
    </>
  );
}

export function AdminAnnouncements() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof announcementBody>>({ resolver: zodResolver(announcementBody), defaultValues: { title: '', target_audience: 'All', description: '', end_date: '' } });
  const m = useMutation({
    mutationFn: (v: z.input<typeof announcementBody>) => api.post('/announcements', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/announcements'] });
      form.reset();
      setOpen(false);
    },
  });
  useEffect(() => {
    if (!open) m.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = form.formState.errors;
  return (
    <>
      <PageHeader
        title={t('nav.announcements', 'Announcements')}
        subtitle={t('admin.announcementsSubtitle', 'Notices for the institution')}
        actions={
          can('announcements.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.newAnnouncement', 'New announcement')}
            </Button>
          )
        }
      />
      <AnnouncementList path="/institution/announcements" />
      <Dialog open={open} onClose={() => setOpen(false)} title={t('admin.newAnnouncement', 'New announcement')}>
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label={t('admin.title', 'Title')} error={e.title?.message}>
            {(a) => <Input {...a} {...form.register('title')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.audience', 'Audience')}>
              {(a) => (
                <Select {...a} {...form.register('target_audience')}>
                  {AUDIENCES.map((x) => (
                    <option key={x} value={x}>
                      {t(`audience.${x}`, x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('admin.showUntil', 'Show until')} optional>
              {(a) => <Input {...a} type="date" {...form.register('end_date')} />}
            </Field>
          </div>
          <Field label={t('admin.message', 'Message')} error={e.description?.message}>
            {(a) => <Textarea {...a} rows={5} {...form.register('description')} />}
          </Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('admin.publish', 'Publish')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
