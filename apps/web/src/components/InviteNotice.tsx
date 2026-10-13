import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format';
import { Button, CopyButton } from './ui';

export interface Invite {
  email: string;
  url: string;
  expires_at: string;
}

/** After creating an account: the invitation went out by email; the link can also be shared. */
export function InviteNotice({ title, invite, onDone }: { title: string; invite: Invite; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-center">
      <CircleCheck className="mx-auto size-11 text-success" aria-hidden />
      <div className="text-lg font-semibold">{title}</div>
      <p className="text-sm text-fg-muted">
        {t('invite.sent', 'We emailed an invitation to {{email}}. They choose their own password when they open it.', { email: invite.email })}
      </p>
      <div className="rounded-lg border border-border bg-surface-2 p-3 text-start text-sm">
        <div className="text-xs text-fg-muted">{t('invite.shareLink', 'You can also share this link (for example on WhatsApp or printed):')}</div>
        <div className="mt-1 break-all font-mono text-xs" dir="ltr">
          {invite.url}
        </div>
        <div className="mt-1 text-xs text-fg-muted">{t('invite.expires', 'Valid until {{when}}, single use.', { when: formatDateTime(invite.expires_at) })}</div>
      </div>
      <div className="flex justify-center gap-2">
        <CopyButton text={invite.url} label={t('invite.copyLink', 'Copy link')} />
        <Button onClick={onDone}>{t('common.done', 'Done')}</Button>
      </div>
    </div>
  );
}
