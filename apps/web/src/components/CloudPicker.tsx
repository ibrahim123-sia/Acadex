// Pick a file from Google Drive or OneDrive and add it to a course as a link. Uses the
// providers' own pickers in the browser (Google Picker API, OneDrive file picker v7.2); nothing
// passes through Acadex's servers. Shown only when the keys are configured:
//   VITE_GOOGLE_API_KEY + VITE_GOOGLE_CLIENT_ID     VITE_ONEDRIVE_CLIENT_ID
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

export interface PickedFile {
  name: string;
  url: string;
  source: 'google_drive' | 'onedrive';
}

const env = import.meta.env as Record<string, string | undefined>;
const GOOGLE_KEY = env.VITE_GOOGLE_API_KEY;
const GOOGLE_CLIENT = env.VITE_GOOGLE_CLIENT_ID;
const ONEDRIVE_CLIENT = env.VITE_ONEDRIVE_CLIENT_ID;

export const cloudPickerAvailable = () => !!(GOOGLE_KEY && GOOGLE_CLIENT) || !!ONEDRIVE_CLIENT;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pickFromDrive(): Promise<PickedFile | null> {
  await Promise.all([loadScript('https://apis.google.com/js/api.js'), loadScript('https://accounts.google.com/gsi/client')]);
  const w = window as any;
  await new Promise<void>((r) => w.gapi.load('picker', () => r()));
  const token: string = await new Promise((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp: { access_token?: string; error?: string }) => (resp.access_token ? resolve(resp.access_token) : reject(new Error(resp.error ?? 'no token'))),
    });
    client.requestAccessToken();
  });
  return new Promise((resolve) => {
    const picker = new w.google.picker.PickerBuilder()
      .addView(w.google.picker.ViewId.DOCS)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_KEY)
      .setCallback((data: any) => {
        if (data.action === w.google.picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({ name: d.name, url: d.url, source: 'google_drive' });
        } else if (data.action === w.google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}

async function pickFromOneDrive(): Promise<PickedFile | null> {
  await loadScript('https://js.live.net/v7.2/OneDrive.js');
  const w = window as any;
  return new Promise((resolve) => {
    w.OneDrive.open({
      clientId: ONEDRIVE_CLIENT,
      action: 'share',
      multiSelect: false,
      advanced: { redirectUri: window.location.origin },
      success: (files: any) => {
        const f = files.value[0];
        resolve({ name: f.name, url: f.permissions?.[0]?.link?.webUrl ?? f.webUrl, source: 'onedrive' });
      },
      cancel: () => resolve(null),
      error: () => resolve(null),
    });
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function CloudPicker({ onPicked }: { onPicked: (f: PickedFile) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const run = async (which: 'drive' | 'onedrive') => {
    setBusy(which);
    setError('');
    try {
      const f = which === 'drive' ? await pickFromDrive() : await pickFromOneDrive();
      if (f) onPicked(f);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!cloudPickerAvailable()) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {GOOGLE_KEY && GOOGLE_CLIENT && <Button type="button" size="sm" variant="outline" loading={busy === 'drive'} onClick={() => void run('drive')}>{t('cloud.drive', 'From Google Drive')}</Button>}
      {ONEDRIVE_CLIENT && <Button type="button" size="sm" variant="outline" loading={busy === 'onedrive'} onClick={() => void run('onedrive')}>{t('cloud.onedrive', 'From OneDrive')}</Button>}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
