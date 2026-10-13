// Formatting in the signed-in school's currency and timezone, in the user's language.
import type { SchoolSummary } from '@acadex/shared';
import i18n from './i18n';

let school: Pick<SchoolSummary, 'currency' | 'timezone' | 'locale'> | null = null;
export const setFormatSchool = (s: Pick<SchoolSummary, 'currency' | 'timezone' | 'locale'> | null) => {
  school = s;
};

/** The language's region-aware locale: the UI language, with the school's region (en-PK, ur-PK). */
function locale(): string {
  const lang = i18n.language || 'en';
  const region = school?.locale?.split('-')[1];
  return region ? `${lang}-${region}` : lang;
}
const timeZone = () => school?.timezone ?? 'Asia/Karachi';
const currency = () => school?.currency ?? 'PKR';

export function formatMoney(amount: number | string | null | undefined, cur?: string): string {
  const value = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur ?? currency(), trailingZeroDisplay: 'stripIfInteger' } as Intl.NumberFormatOptions).format(value);
  } catch {
    return `${cur ?? currency()} ${value.toLocaleString()}`;
  }
}

export const formatNumber = (n: number) => new Intl.NumberFormat(locale()).format(n);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar dates ('2026-03-02') are shown as-is; timestamps in the school's timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const d = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: dateOnly ? 'UTC' : timeZone(), dateStyle: 'medium' }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: timeZone(), dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatRelative(value: string | Date): string {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Today's calendar date (YYYY-MM-DD) in the school's timezone. */
export const todayISO = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
