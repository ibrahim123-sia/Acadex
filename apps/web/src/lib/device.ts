// The device side of reach: low-bandwidth mode, the service worker (installable app, offline
// shell), content saved for offline use, and smaller image uploads.
import { useSyncExternalStore } from 'react';
import { api } from './api';

// ---------------------------------------------------------------- low-bandwidth mode

const LB_KEY = 'acadex.lowBandwidth';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const v = localStorage.getItem(LB_KEY);
    if (v != null) return v === '1';
  } catch {
    /* private mode */
  }
  // the browser's data saver, or a 2G connection, turns it on until the person chooses
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (!!c.saveData || /(^|-)2g$/.test(c.effectiveType ?? ''));
}

let current = typeof window === 'undefined' ? false : read();
const apply = () => document.documentElement.toggleAttribute('data-low-bandwidth', current);
if (typeof document !== 'undefined') apply();

let chosenHere = false;

export function setLowBandwidth(on: boolean, { sync = true } = {}) {
  // the saved preference from the server never overrides a choice made on this page
  if (!sync && chosenHere) return;
  if (sync) chosenHere = true;
  current = on;
  try {
    localStorage.setItem(LB_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  apply();
  listeners.forEach((l) => l());
  if (sync) void api.put('/notifications/account-preferences', { low_bandwidth: on }).catch(() => {});
}

/** Whether low-bandwidth mode is on (no autoplay, embeds and media on request, smaller uploads). */
export function useLowBandwidth(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => false
  );
}

// ---------------------------------------------------------------- service worker and offline

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

const SAVED_KEY = 'acadex.saved';
export interface SavedItem {
  key: string;
  title: string;
  course: string;
  link: string;
  saved_at: string;
  urls: string[];
}

export const savedItems = {
  list(): SavedItem[] {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedItem[];
    } catch {
      return [];
    }
  },
  has: (key: string) => savedItems.list().some((s) => s.key === key),
  write(list: SavedItem[]) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      /* storage full */
    }
  },
};

export const offlineSupported = () => typeof caches !== 'undefined';

/** Saves API reads (and files) into the offline cache so the item opens without a connection. */
export async function saveForOffline(item: Omit<SavedItem, 'saved_at'>): Promise<void> {
  const cache = await caches.open('acadex-offline');
  for (const path of item.urls) {
    const url = api.url(path);
    const res = await api.raw(path);
    if (!res.ok) throw new Error(`Could not save ${path}`);
    await cache.put(url, res);
  }
  savedItems.write([{ ...item, saved_at: new Date().toISOString() }, ...savedItems.list().filter((s) => s.key !== item.key)]);
}

export async function removeOffline(key: string): Promise<void> {
  const item = savedItems.list().find((s) => s.key === key);
  if (item && offlineSupported()) {
    const cache = await caches.open('acadex-offline');
    for (const path of item.urls) await cache.delete(api.url(path), { ignoreVary: true });
  }
  savedItems.write(savedItems.list().filter((s) => s.key !== key));
}

/** Signed-in data must not outlive the session on a shared device. */
export async function clearOfflineData(): Promise<void> {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* private mode */
  }
  if (offlineSupported()) await Promise.all([caches.delete('acadex-api'), caches.delete('acadex-offline')]);
  navigator.serviceWorker?.controller?.postMessage('clear');
}

// ---------------------------------------------------------------- smaller uploads

/**
 * Large photos are resized in the browser before upload (≤ 2000 px, or 1280 px in
 * low-bandwidth mode), as JPEG. Other files are sent as they are.
 */
export async function shrinkImage(file: File): Promise<File> {
  const low = current;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < (low ? 300_000 : 1_500_000) || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = low ? 1280 : 2000;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', low ? 0.7 : 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
