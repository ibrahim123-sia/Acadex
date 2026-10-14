// A protected image (student or staff photo): fetched with the access token, shown from an
// object URL, with initials while loading or when there is no photo.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export function Avatar({ fileId, name, className }: { fileId?: number | null; name: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId) return setUrl(null);
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    api
      .blob(`/files/${fileId}`, ctrl.signal)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return url ? (
    <img src={url} alt="" className={cn('size-10 shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary', className)}>
      {initials}
    </span>
  );
}
