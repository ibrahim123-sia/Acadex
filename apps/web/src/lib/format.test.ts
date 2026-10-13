import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, setFormatSchool, todayISO } from './format';

describe('formatting in the school locale', () => {
  it('uses the school currency', () => {
    setFormatSchool({ currency: 'USD', timezone: 'America/New_York', locale: 'en-US' });
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(25000)).toBe('$25,000');
    setFormatSchool({ currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' });
    expect(formatMoney(25000)).toMatch(/25,000/);
  });

  it('shows calendar dates without shifting the day', () => {
    setFormatSchool({ currency: 'PKR', timezone: 'Pacific/Kiritimati', locale: 'en-PK' });
    expect(formatDate('2026-03-02')).toMatch(/2/);
    expect(formatDate('2026-03-02')).not.toMatch(/\b3\b/);
    expect(formatDate(null)).toBe('—');
  });

  it("knows today's date in the school timezone", () => {
    setFormatSchool({ currency: 'PKR', timezone: 'Pacific/Kiritimati', locale: 'en-PK' });
    const k = todayISO();
    setFormatSchool({ currency: 'PKR', timezone: 'Pacific/Pago_Pago', locale: 'en-PK' });
    expect(todayISO()).not.toBe(k); // UTC+14 vs UTC-11 are always on different dates
  });
});
