# Known gaps — for later

What Acadex deliberately does **not** do yet, why, and what it would take. Nothing here is a
bug: each item is a decision or a limit to revisit when a customer needs it. Read this before
onboarding an institution from a new country or with special requirements.

## Mukhtasar (Roman Urdu)

- **Zaban:** interface sirf English mein hai. Urdu aur Arabic bani hui thi, hata di gayi (git
  history mein mehfooz hai).
- **Database:** filhal sirf ek. Kisi mulk ka "data hamare mulk mein rahe" wala qanoon ho to
  abhi poora nahi hota.
- **Payments:** Pakistan mein JazzCash aur Easypaisa, baqi har mulk mein Stripe. Jahan Stripe
  nahi chalta wahan sirf bank transfer ya cash ki entry.
- **Baqi kamiyan:** fees par tax (VAT/GST), Hijri calendar, ek institution ke kayi timezones, aur
  har mulk ke wakeel se legal pages ka review.
- **Scope se bahar:** certifications (SOC 2, ISO waghera) hum nahi karte. Institution ko apni
  koi certification ya accreditation chahiye to woh khud bahar se karwata hai, Acadex ke zariye
  nahi.

## How an institution's country works today

Choosing the country (platform registration, public sign-up, Settings) sets the currency,
timezone, number/date format (English with the region's style), the first day of the week, and
the online payment gateway — see `packages/shared/src/countries.ts` and `apps/api/src/lib/country.ts`.

| Country | Online payments | Also everywhere |
|---|---|---|
| Pakistan | JazzCash, Easypaisa | bank transfer (pay to the IBAN with the invoice number), cash / cheque entered by the office |
| Every other country | Stripe | same |

The currency can be changed until the first fee invoice exists; after that it is locked
(`CURRENCY_LOCKED`), because fee amounts are stored in it.

## Gaps

### 1. One database, one region
All institutions share one PostgreSQL database (Neon) in one region — a product decision for now.
Some customers (EU schools under GDPR, some Gulf governments) require data to stay in their
country or region.
**When needed:** a second deployment per region (its own database and R2 bucket, its own
`APP_URL`), and the platform deciding at sign-up which region a new institution goes to. The code
already takes all of this from configuration; nothing is hard-coded to one region.

### 2. Payment gateways beyond Pakistan and Stripe
Only JazzCash and Easypaisa (Pakistan) and Stripe (everywhere else) are built. Stripe accepts
merchants only in the countries it supports (stripe.com/global); a school in another country can
still record bank transfers and cash, but not take card payments online.
**When needed:** add a driver in `apps/api/src/lib/finance/providers.ts` (the interface:
create checkout, verify the callback, settlements for reconciliation) and list it for its
country in `LOCAL_GATEWAYS` in `packages/shared/src/countries.ts` — e.g. Razorpay (India),
Paystack / Flutterwave (Africa), PayTabs (Gulf).

### 3. Acadex's own billing by card
The platform's invoices to institutions can be paid through Stripe Checkout, which needs a Stripe
account for the business that owns Acadex. Stripe does not onboard businesses registered in
Pakistan (check when it matters). Until then, institutions pay by bank transfer and the platform
marks the invoice paid (already built).
**When needed:** a Stripe account through a company in a supported country, or a Pakistani
gateway for platform invoices.

### 4. Platform prices in a few currencies
Plans have prices in PKR, USD, AED, SAR and GBP. An institution whose currency is not one of them
is billed in USD.
**When needed:** add the currency's price to the plan (platform → Plans); no code change.

### 5. Tax on school fees
Fee invoices that schools send to families have no VAT / GST line. (Acadex's own invoices to
institutions do have a tax label and rate.) Some countries charge VAT on private education
(depending on the country and the kind of school).
**When needed:** a tax rate per fee head or per institution, shown on vouchers and receipts, plus
tax reports.

### 6. Hijri calendar
Dates are Gregorian. Saudi institutions often show Hijri dates as well.
**When needed:** an institution setting to show the Hijri date beside the Gregorian one
(`Intl.DateTimeFormat` with `calendar: 'islamic-umalqura'` covers formatting); the academic
calendar itself can stay Gregorian.

### 7. One timezone per institution
An institution — including all its campuses — has one timezone. A network with campuses in
different timezones would see times in the main campus's timezone.
**When needed:** an optional timezone per campus, used for attendance days, due dates and
timetables of that campus.

### 8. Interface language: English only
The interface is English only (decision of 2026-10-18). Urdu and Arabic translations (≈2,700
strings each, with right-to-left layout) were built and then removed; they are in git history at
`apps/web/src/locales/ur.json` and `ar.json` (for example in commit `12382d1`). Every string still
goes through `t('key', 'English')`, and the layout uses logical CSS properties, so a language can
come back as one file.
**When needed:** restore or add `locales/<lang>.json`, list it in `apps/web/src/lib/i18n.ts`,
bring back a language picker, and translate the strings added since.

The AI is English only too (decision of 2026-10-18): the tutor and help assistant reply in English
whatever language a question is in, captions are made in English, and the copilot no longer offers
translated versions of material or captions.

### 9. Text messages and WhatsApp per country
SMS goes through Twilio and WhatsApp through Meta's Cloud API. Sender IDs, registration rules and
template approval differ by country (and prices too).
**When needed:** check the customer's country with the provider before promising SMS / WhatsApp,
and register the sender and templates there.

### 10. Legal texts per country
The privacy policy, terms, data processing agreement and sub-processor list are general templates
written with GDPR, COPPA, FERPA and Pakistan's rules in mind. They have not been reviewed by a
lawyer for any particular country.
**When needed:** a lawyer's review before relying on them in a new market.

## Out of scope

- **Certifications of Acadex** (SOC 2, ISO 27001 and similar audits): not pursued. Acadex follows
  good security practice (see [security.md](security.md)) but is not certified.
- **Institutions' own certifications and accreditations** (e.g. a school's accreditation by a
  board, or a quality certification): the institution arranges these itself, outside Acadex.
  Acadex only provides the data and reports they may use (for example outcome attainment / OBE
  reports and transcripts) and the course-completion certificates it issues to students.
