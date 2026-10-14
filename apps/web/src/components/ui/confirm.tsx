// Confirmation for destructive actions: says what will happen, optionally makes the person
// type a word (for permanent deletion), and shows the error in place if it fails.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { Dialog } from './dialog';
import { MutationError } from './feedback';
import { Input } from './field';

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = true,
  typeToConfirm,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  danger?: boolean;
  /** the word the person must type to enable the button */
  typeToConfirm?: string;
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={title}>
      <div className="space-y-4">
        {children && <div className="text-sm text-fg-muted">{children}</div>}
        {typeToConfirm && (
          <label className="block text-sm">
            {t('confirm.type', 'Type {{word}} to confirm', { word: typeToConfirm })}
            <Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        <MutationError error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!!typeToConfirm && typed !== typeToConfirm} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
