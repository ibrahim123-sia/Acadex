// Public verification of an ID card or certificate (what the QR code opens). No sign-in.
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleX, ShieldQuestion } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card, Spinner } from '@/components/ui';

interface Result {
  kind: 'id_card' | 'document';
  status: 'valid' | 'revoked' | 'expired' | 'inactive';
  valid: boolean;
  institution: string;
  name: string;
  holder_type?: 'student' | 'staff';
  valid_until?: string;
  title?: string;
  serial_no?: string;
  issued_at?: string;
}

export function VerifyPage() {
  const { code = '' } = useParams();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['verify', code], queryFn: () => api.get<Result>(`/public/verify/${encodeURIComponent(code)}`), retry: false });
  const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
  return (
    <main className="grid min-h-full place-items-center bg-background p-4">
      <Card className="w-full max-w-md p-6 text-center">
        {q.isPending ? (
          <Spinner />
        ) : q.data ? (
          <>
            {q.data.valid ? <CircleCheck className="mx-auto size-14 text-success" aria-hidden /> : <CircleX className="mx-auto size-14 text-danger" aria-hidden />}
            <h1 className="mt-3 text-xl font-semibold">
              {q.data.valid
                ? t('verify.valid', 'Genuine and valid')
                : t(`verify.${q.data.status}`, { revoked: 'This has been revoked', expired: 'This card has expired', inactive: 'No longer enrolled / employed', valid: '' }[q.data.status])}
            </h1>
            <dl className="mt-5 space-y-2 text-start text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">{t('verify.issuer', 'Issued by')}</dt>
                <dd className="font-medium">{q.data.institution}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">{t('verify.what', 'Document')}</dt>
                <dd>{q.data.kind === 'id_card' ? (q.data.holder_type === 'staff' ? t('verify.staffCard', 'Staff ID card') : t('verify.studentCard', 'Student ID card')) : q.data.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">{t('verify.name', 'Name')}</dt>
                <dd>{q.data.name}</dd>
              </div>
              {q.data.serial_no && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">{t('verify.serial', 'Number')}</dt>
                  <dd className="font-mono">{q.data.serial_no}</dd>
                </div>
              )}
              {q.data.valid_until && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">{t('verify.validUntil', 'Valid until')}</dt>
                  <dd>{formatDate(q.data.valid_until)}</dd>
                </div>
              )}
              {q.data.issued_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">{t('verify.issued', 'Issued')}</dt>
                  <dd>{formatDate(q.data.issued_at)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-5 text-xs text-fg-muted">{t('verify.privacy', 'Only the first name and last initial are shown. Compare them with the document in front of you.')}</p>
          </>
        ) : (
          <>
            <ShieldQuestion className="mx-auto size-14 text-fg-muted" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold">{notFound ? t('verify.unknown', 'We could not find this code') : t('verify.error', 'Could not check right now')}</h1>
            <p className="mt-2 text-sm text-fg-muted">{notFound ? t('verify.unknownHelp', 'The document may be forged, or the code was typed incorrectly.') : t('verify.errorHelp', 'Please try again in a moment.')}</p>
          </>
        )}
        <p className="mt-6 font-mono text-xs text-fg-muted">{code}</p>
      </Card>
    </main>
  );
}
