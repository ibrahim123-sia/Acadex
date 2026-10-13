// Formatting in the signed-in school's currency, locale and timezone.
// (Full i18n with react-i18next arrives in Phase 0B; this only replaces the hard-coded PKR / UTC.)
import { getSchool } from './api';

function settings() {
  const s = getSchool() || {};
  return { currency: s.currency || 'PKR', locale: s.locale || 'en-PK', timeZone: s.timezone || 'Asia/Karachi' };
}

export function formatMoney(amount, currency) {
  const s = settings();
  const cur = currency || s.currency;
  try {
    return new Intl.NumberFormat(s.locale, { style: 'currency', currency: cur, trailingZeroDisplay: 'stripIfInteger' }).format(Number(amount || 0));
  } catch {
    return `${cur} ${Number(amount || 0).toLocaleString()}`;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Date-only values ('2026-03-02') are calendar dates and are shown as-is; timestamps are
// shown in the school's timezone.
export function formatDate(value) {
  if (!value) return '—';
  const s = settings();
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const d = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(s.locale, { timeZone: dateOnly ? 'UTC' : s.timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const s = settings();
  return new Intl.DateTimeFormat(s.locale, { timeZone: s.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

// Today's calendar date (YYYY-MM-DD) in the school's timezone.
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
