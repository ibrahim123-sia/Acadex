// Per-institution locale helpers: the institution's timezone decides what "today" is, and its
// currency/locale decide how money is printed (PDFs, emails).
export { isValidCurrency, isValidLocale, isValidTimeZone } from '@acadex/shared';

/** YYYY-MM-DD of `at` as seen on a wall clock in `timeZone`. */
export function todayIn(timeZone: string, at: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function formatMoney(amount: number | string | null | undefined, currency = 'PKR', locale = 'en-PK'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount || 0));
}

export function formatDate(
  value: string | number | Date,
  { timeZone = 'UTC', locale = 'en-PK' }: { timeZone?: string; locale?: string } = {}
): string {
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value)
  );
}

/** Minutes after local midnight of `at` in `timeZone`. */
export function minutesIn(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}
