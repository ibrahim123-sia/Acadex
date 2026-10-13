// Per-school locale helpers: the school's timezone decides what "today" is, and its
// currency/locale decide how money is printed (PDFs, emails).

// YYYY-MM-DD of `at` as seen on a wall clock in `timeZone`.
function todayIn(timeZone, at = new Date()) {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidCurrency(code) {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch {
    return false;
  }
}

function isValidLocale(tag) {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

function formatMoney(amount, currency = 'PKR', locale = 'en-PK') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount || 0));
}

function formatDate(value, { timeZone = 'UTC', locale = 'en-PK' } = {}) {
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

module.exports = { todayIn, isValidTimeZone, isValidCurrency, isValidLocale, formatMoney, formatDate };
