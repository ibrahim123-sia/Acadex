-- Per-school locale: currency for fees and PDFs, IANA timezone for "today" (attendance,
-- due dates), BCP-47 locale for number/date formatting. Defaults match existing tenants.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'PKR';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS locale   TEXT NOT NULL DEFAULT 'en-PK';

DO $$ BEGIN
  ALTER TABLE schools ADD CONSTRAINT schools_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
