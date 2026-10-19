// The public website: landing, pricing (plans from the platform), demo booking, self-serve
// sign-up, legal pages (privacy, terms, DPA, sub-processors, compliance), the public help
// center, and the cookie notice (only necessary cookies are used).
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3, Bot, Check, CreditCard, Globe2, HeartHandshake, MessagesSquare, ShieldCheck, Smartphone, Sparkles, WifiOff } from 'lucide-react';
import { HELP_ARTICLES, MODULE_LABELS, type ModuleKey } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/AppShell';
import { CountrySelect, gatewaysText } from '@/components/CountrySelect';
import { Alert, Button, Card, EmptyState, Field, Input, MutationError, Select, Spinner, Textarea } from '@/components/ui';

interface Plan {
  key: string;
  name: string;
  description: string;
  prices: Record<string, number>;
  limits: { students?: number | null; storage_mb?: number | null; ai_usd?: number | null; messages?: number | null };
  features: { modules?: ModuleKey[]; api?: boolean; sso?: boolean; white_label?: boolean; custom_domain?: boolean; lti?: boolean };
  trial_days: number;
}

function SiteLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="flex min-h-full flex-col bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 z-50 rounded bg-primary px-3 py-2 text-primary-fg">{t('nav.skipToContent', 'Skip to content')}</a>
      <header className="border-b border-border bg-surface">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3" aria-label={t('site.nav', 'Site')}>
          <Link to="/" className="flex items-center gap-2 text-lg font-bold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-fg">A</span> Acadex
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            <Link className="rounded px-2 py-1 hover:bg-surface-2" to="/pricing">{t('site.pricing', 'Pricing')}</Link>
            <Link className="rounded px-2 py-1 hover:bg-surface-2" to="/docs">{t('site.help', 'Help center')}</Link>
            <Link className="rounded px-2 py-1 hover:bg-surface-2" to="/demo">{t('site.demo', 'Book a demo')}</Link>
          </div>
          <ThemeToggle />
          {user ? <Link to="/home"><Button size="sm">{t('site.open', 'Open Acadex')}</Button></Link> : <Link to="/login"><Button size="sm" variant="outline">{t('site.signIn', 'Sign in')}</Button></Link>}
        </nav>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-border bg-surface text-sm text-fg-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-2 px-4 py-6">
          <span>© {new Date().getFullYear()} Acadex</span>
          {(['privacy', 'terms', 'dpa', 'subprocessors', 'compliance'] as const).map((d) => <Link key={d} to={`/legal/${d}`} className="hover:text-fg">{t(`legal.${d}`, LEGAL[d].title)}</Link>)}
        </div>
      </footer>
      <CookieNotice />
    </div>
  );
}

/** The cookie notice: Acadex uses only necessary cookies (sign-in), so there is nothing to opt in to. */
function CookieNotice() {
  const { t } = useTranslation();
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem('acadex.cookies') === 'ok';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  return (
    <div role="region" aria-label={t('site.cookies', 'Cookies')} className="fixed inset-x-2 bottom-2 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg">
      <p className="flex-1">{t('site.cookieText', 'We use only the cookies needed to keep you signed in — no tracking or advertising cookies.')} <Link to="/legal/privacy" className="text-primary underline">{t('legal.privacy', 'Privacy policy')}</Link></p>
      <Button size="sm" onClick={() => { try { localStorage.setItem('acadex.cookies', 'ok'); } catch { /* ignore */ } setSeen(true); }}>{t('site.ok', 'OK')}</Button>
    </div>
  );
}

const FEATURES = [
  { icon: Sparkles, title: 'AI that coaches, not cheats', text: 'A tutor that answers from your own course with sources and gives hints instead of answers; a copilot for teachers whose drafts are applied only on approval.' },
  { icon: Globe2, title: 'Any kind of institution', text: 'Schools, networks, colleges, universities and academies — each with its own words, grading and terms, in any country and currency.' },
  { icon: CreditCard, title: 'Fees that collect themselves', text: 'Vouchers, JazzCash, Easypaisa, cards and bank transfer on your own account, reminders in the app and by email, reconciliation.' },
  { icon: MessagesSquare, title: 'Families in the loop, safely', text: 'Safeguarded messaging, parent–teacher meetings, emergency broadcasts and digests on every channel.' },
  { icon: WifiOff, title: 'Works on any phone', text: 'Installable, works offline for attendance and saved lessons, and a low-bandwidth mode for slow connections.' },
  { icon: ShieldCheck, title: 'Private by design', text: 'Each institution is isolated twice over, sensitive data is visible only to those who need it, and you can export or delete everything.' },
  { icon: BarChart3, title: 'Reports that answer questions', text: 'Attendance, results, fees, workload and outcome attainment — or just ask Acadex in plain words.' },
  { icon: Bot, title: 'Connects with your tools', text: 'LTI 1.3, OneRoster, Google and Microsoft sign-in, Zoom, Teams and Meet, a REST API and webhooks.' },
];

export function LandingPage() {
  const { t } = useTranslation();
  const { user, status } = useAuth();
  if (status === 'loading') return <Spinner className="h-full" />;
  if (user) return <Navigate to="/home" replace />;
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-20">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">{t('site.hero', 'One platform for teaching, learning and running your institution')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-fg-muted">{t('site.heroSub', 'Courses, attendance, exams, fees, admissions and family communication — with AI that helps students learn instead of doing the work for them.')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/signup"><Button>{t('site.start', 'Start a free trial')}</Button></Link>
          <Link to="/demo"><Button variant="outline">{t('site.demo', 'Book a demo')}</Button></Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('site.features', 'Features')}>
        {FEATURES.map((f) => (
          <Card key={f.title} className="space-y-2 p-5">
            <f.icon className="size-6 text-primary" aria-hidden />
            <h2 className="font-semibold">{t(`site.f.${f.title}`, f.title)}</h2>
            <p className="text-sm text-fg-muted">{t(`site.ft.${f.title}`, f.text)}</p>
          </Card>
        ))}
      </section>
      <section className="bg-surface py-12">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 text-center">
          <HeartHandshake className="size-8 text-primary" aria-hidden />
          <h2 className="text-2xl font-bold">{t('site.ready', 'Set up in an afternoon')}</h2>
          <p className="text-fg-muted">{t('site.readySub', 'Import your students from a spreadsheet, invite your teachers, and your families get the app the same day.')}</p>
          <div className="flex flex-wrap justify-center gap-2"><Link to="/pricing"><Button variant="outline">{t('site.pricing', 'Pricing')}</Button></Link><Link to="/signup"><Button>{t('site.start', 'Start a free trial')}</Button></Link></div>
          <p className="flex items-center gap-1 text-sm text-fg-muted"><Smartphone className="size-4" aria-hidden /> {t('site.install', 'Install it from your browser on Android, iPhone or desktop.')}</p>
        </div>
      </section>
    </SiteLayout>
  );
}

const money = (n: number, c: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

export function PricingPage() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState('PKR');
  const q = useQuery({ queryKey: ['public-plans'], queryFn: () => api.get<Plan[]>('/public/plans') });
  const lim = (n: number | null | undefined, unit: string) => (n == null ? t('site.unlimited', 'Unlimited {{unit}}', { unit }) : `${n.toLocaleString()} ${unit}`);
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-center text-3xl font-bold">{t('site.pricing', 'Pricing')}</h1>
        <p className="mt-2 text-center text-fg-muted">{t('site.pricingSub', 'Every plan includes the LMS, attendance, exams, fees and the mobile app. Start with a free trial.')}</p>
        <div className="mt-4 flex justify-center">
          <Select aria-label={t('site.currency', 'Currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-32">{['PKR', 'USD', 'AED', 'SAR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</Select>
        </div>
        {q.isPending ? <Spinner /> : !q.data?.length ? <EmptyState title={t('site.noPlans', 'Plans are coming soon')} /> : (
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {q.data.map((p) => {
              const price = p.prices[currency] ?? (currency !== 'USD' ? p.prices.USD : undefined);
              const shown = p.prices[currency] != null ? currency : 'USD';
              return (
                <Card key={p.key} className="flex flex-col gap-3 p-6">
                  <h2 className="text-xl font-semibold">{p.name}</h2>
                  <p className="text-sm text-fg-muted">{p.description}</p>
                  <p className="text-3xl font-bold">{price == null ? t('site.contact', 'Contact us') : price === 0 ? t('site.free', 'Free') : <>{money(price, shown)} <span className="text-sm font-normal text-fg-muted">{t('site.perMonth', '/ month')}</span></>}</p>
                  <ul className="flex-1 space-y-1.5 text-sm">
                    {[lim(p.limits.students, t('site.students', 'students')), lim(p.limits.storage_mb != null ? Math.round(p.limits.storage_mb / 1024) : null, t('site.gbStorage', 'GB storage')), lim(p.limits.messages, t('site.messages', 'WhatsApp messages a month')),
                      ...(p.features.modules ?? []).map((m) => MODULE_LABELS[m]),
                      ...(p.features.api ? [t('site.api', 'REST API and webhooks')] : []), ...(p.features.sso ? [t('site.sso', 'Google / Microsoft sign-in')] : []), ...(p.features.lti ? ['LTI 1.3'] : []),
                      ...(p.features.white_label ? [t('site.whiteLabel', 'Your own brand')] : []), ...(p.features.custom_domain ? [t('site.domain', 'Your own domain')] : [])].map((x) => (
                      <li key={x} className="flex gap-2"><Check className="size-4 shrink-0 text-success" aria-hidden /> {x}</li>
                    ))}
                  </ul>
                  <Link to={price == null ? '/demo' : `/signup?plan=${p.key}`}><Button className="w-full">{price == null ? t('site.demo', 'Book a demo') : p.trial_days ? t('site.tryDays', 'Try free for {{n}} days', { n: p.trial_days }) : t('site.start', 'Start a free trial')}</Button></Link>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </SiteLayout>
  );
}

export function DemoPage() {
  const { t } = useTranslation();
  const [v, setV] = useState({ name: '', email: '', phone: '', institution: '', type: 'school', size: '', message: '' });
  const m = useMutation({ mutationFn: () => api.post('/public/demo', v) });
  return (
    <SiteLayout>
      <section className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold">{t('site.demo', 'Book a demo')}</h1>
        <p className="mb-4 text-fg-muted">{t('site.demoSub', 'Tell us about your institution and we will show you Acadex with your own setup.')}</p>
        {m.isSuccess ? <Alert tone="success">{t('site.demoThanks', 'Thank you — we will contact you within one working day.')}</Alert> : (
          <Card className="p-5">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
              <Field label={t('site.yourName', 'Your name')}>{(a) => <Input {...a} required autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('site.email', 'Email')}>{(a) => <Input {...a} type="email" required autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
                <Field label={t('site.phone', 'Phone')} optional>{(a) => <Input {...a} type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
              </div>
              <Field label={t('site.institution', 'Institution')}>{(a) => <Input {...a} required autoComplete="organization" value={v.institution} onChange={(e) => setV({ ...v, institution: e.target.value })} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('site.type', 'Kind')}>{(a) => <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{['school', 'chain', 'college', 'university', 'academy', 'training_center'].map((x) => <option key={x} value={x}>{t(`institutionType.${x}`, x)}</option>)}</Select>}</Field>
                <Field label={t('site.size', 'Students')} optional>{(a) => <Select {...a} value={v.size} onChange={(e) => setV({ ...v, size: e.target.value })}><option value="" />{['< 200', '200–1,000', '1,000–5,000', '> 5,000'].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
              </div>
              <Field label={t('site.message', 'Anything we should know?')} optional>{(a) => <Textarea {...a} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}</Field>
              <MutationError error={m.error} />
              <Button type="submit" loading={m.isPending}>{t('site.send', 'Send')}</Button>
            </form>
          </Card>
        )}
      </section>
    </SiteLayout>
  );
}

export function SignupPage() {
  const { t } = useTranslation();
  const plan = new URLSearchParams(window.location.search).get('plan') ?? 'pro';
  const [v, setV] = useState({ institution: '', type: 'school', country: 'PK', name: '', email: '', phone: '', plan, accept_terms: false });
  const m = useMutation({ mutationFn: () => api.post<{ trial_days: number; message: string }>('/public/signup', v) });
  return (
    <SiteLayout>
      <section className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold">{t('site.start', 'Start a free trial')}</h1>
        <p className="mb-4 text-fg-muted">{t('site.signupSub', 'No card needed. You will get an email to set your password.')}</p>
        {m.isSuccess ? <Alert tone="success">{t('site.signupDone', 'Your workspace is ready. Check your email ({{email}}) for the link to set your password.', { email: v.email })}</Alert> : (
          <Card className="p-5">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
              <Field label={t('site.institution', 'Institution')}>{(a) => <Input {...a} required autoComplete="organization" value={v.institution} onChange={(e) => setV({ ...v, institution: e.target.value })} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('site.type', 'Kind')}>{(a) => <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{['school', 'chain', 'college', 'university', 'academy', 'training_center'].map((x) => <option key={x} value={x}>{t(`institutionType.${x}`, x)}</option>)}</Select>}</Field>
                <Field label={t('site.country', 'Country')} hint={t('site.countryHint', 'Sets your currency, timezone and online payments ({{gateways}})', { gateways: gatewaysText(v.country) })}>{(a) => <CountrySelect {...a} value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} />}</Field>
              </div>
              <Field label={t('site.yourName', 'Your name')}>{(a) => <Input {...a} required autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('site.email', 'Email')}>{(a) => <Input {...a} type="email" required autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
                <Field label={t('site.phone', 'Phone')} optional>{(a) => <Input {...a} type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={v.accept_terms} onChange={(e) => setV({ ...v, accept_terms: e.target.checked })} />
                <span>{t('site.accept', 'I agree to the')} <Link to="/legal/terms" className="text-primary underline">{t('legal.terms', 'Terms of service')}</Link>, <Link to="/legal/privacy" className="text-primary underline">{t('legal.privacy', 'Privacy policy')}</Link> {t('site.and', 'and the')} <Link to="/legal/dpa" className="text-primary underline">{t('legal.dpa', 'Data processing agreement')}</Link></span>
              </label>
              <MutationError error={m.error} />
              <Button type="submit" loading={m.isPending} disabled={!v.accept_terms}>{t('site.create', 'Create my workspace')}</Button>
            </form>
          </Card>
        )}
      </section>
    </SiteLayout>
  );
}

// ---------------------------------------------------------------- legal

interface LegalDoc {
  title: string;
  sections: [string, string][];
}
const LEGAL: Record<'privacy' | 'terms' | 'dpa' | 'subprocessors' | 'compliance', LegalDoc> = {
  privacy: {
    title: 'Privacy policy',
    sections: [
      ['Who we are', 'Acadex provides a learning and institute-management platform to schools, colleges, universities and academies ("institutions"). For the personal data of students, families and staff, the institution is the controller and Acadex is its processor; for the accounts of institution administrators and for this website, Acadex is the controller.'],
      ['What we collect', 'What institutions enter or import (names, contact details, classes, attendance, grades, fees, documents), what people do in the app (submissions, messages, sign-ins) and the minimum technical data to run it securely (IP address and device for sessions). We do not sell data and we do not use advertising or tracking cookies.'],
      ['Children', 'Students may be under 18. Institutions collect the consents their law requires (Settings → Privacy shows guardian consents for data processing, photos, AI features and messaging), private messages between staff and minors follow the institution\'s safeguarding rules, and AI features for under-18s use stricter settings.'],
      ['AI features', 'AI features can be switched off by each institution, per feature and per course. Before anything is sent to an AI provider, names, emails, phone numbers and identity numbers are removed, and AI providers may not train on the data. Every AI call is logged with its cost.'],
      ['Your rights', 'You can see, download, correct and ask to delete your data (Account → Privacy). Requests are answered within 30 days. Institutions can export or delete all their data at any time.'],
      ['Retention and security', 'Data is kept while the institution uses Acadex and as long as its retention settings say; it is removed 30 days after an institution closes its account. Data is isolated per institution in code and in the database, encrypted in transit and in backups, and sensitive reads are recorded.'],
      ['Contact', 'Questions about privacy: privacy@acadex.app. You can also contact your institution, which decides how your data is used.'],
    ],
  },
  terms: {
    title: 'Terms of service',
    sections: [
      ['The service', 'Acadex is provided as an online service under the plan the institution chooses. Trials end automatically; nothing is charged without a plan being chosen.'],
      ['Accounts', 'Institutions are responsible for who they invite and for keeping administrator accounts secure (two-factor sign-in is required for administrators).'],
      ['Acceptable use', 'Do not use Acadex to break the law, harm children, send unsolicited messages, or attempt to access other institutions\' data.'],
      ['Fees and billing', 'Paid plans are invoiced monthly in advance; usage above plan limits (extra students, AI add-on) is invoiced the next month. Invoices are due in 10 days; workspaces with invoices more than 21 days overdue are paused until paid.'],
      ['Your data', 'Institutions own their data. You can export everything at any time; when you close your account, data is deleted after 30 days.'],
      ['Availability and liability', 'We aim for high availability and keep tested backups. Liability is limited to the fees paid in the 12 months before a claim, except where the law does not allow limits.'],
    ],
  },
  dpa: {
    title: 'Data processing agreement',
    sections: [
      ['Parties and scope', 'This agreement between the institution (controller) and Acadex (processor) covers the personal data processed in the service. It is accepted on sign-up and can be signed as a separate document on request (legal@acadex.app).'],
      ['Instructions', 'Acadex processes personal data only on the institution\'s documented instructions — the configuration of the service — and to meet legal obligations.'],
      ['Confidentiality and security', 'Staff with access are bound by confidentiality. Measures: tenant isolation (code and row-level security), encryption in transit and of backups, sealed secrets, role-based access, audit of sensitive reads, two-factor sign-in for administrators, and dependency and secret scanning.'],
      ['Sub-processors', 'Acadex uses the sub-processors listed on the sub-processors page and gives 30 days\' notice of changes, during which the institution may object.'],
      ['Assistance', 'Acadex helps the institution answer data-subject requests (export, correction, deletion tools in the product), and notifies personal-data breaches without undue delay (within 48 hours of discovery).'],
      ['Deletion and audits', 'On termination, data is deleted after 30 days unless exported; backups expire on their rotation. Acadex provides the information needed to demonstrate compliance on request.'],
    ],
  },
  subprocessors: {
    title: 'Sub-processors',
    sections: [
      ['Hosting and database', 'Cloud hosting and managed PostgreSQL (Cloudflare, Neon) — application and database hosting.'],
      ['File storage', 'S3-compatible object storage (Cloudflare R2 or AWS S3) — uploaded files and backups.'],
      ['Email', 'SMTP provider configured by the platform — transactional email.'],
      ['WhatsApp', 'Meta (WhatsApp Business) or Twilio — only if WhatsApp messages are switched on.'],
      ['Payments', 'Stripe, JazzCash and Easypaisa — only for payments; card data never reaches Acadex.'],
      ['AI providers', 'Anthropic, OpenAI, Google (Gemini) and Groq — only when AI features are on; personal identifiers are removed first and providers may not train on the data.'],
      ['Error monitoring', 'Sentry — error reports without personal content.'],
    ],
  },
  compliance: {
    title: 'Compliance',
    sections: [
      ['GDPR / UK GDPR', 'Processor terms (DPA), data-subject tools (access, export, correction, deletion), retention settings, consent records, records of processing, breach notification and EU / UK data-transfer safeguards. A data region can be chosen for new deployments.'],
      ['COPPA', 'For students under 13 in the US, schools give consent on behalf of parents for educational use; Acadex uses student data only to provide the service, never for advertising, and deletes it on request.'],
      ['FERPA', 'Acadex acts as a "school official" under the institution\'s direct control, uses education records only for the authorised purpose, and supports parents\' and eligible students\' rights to inspect records.'],
      ['Pakistan', 'Designed for the Prevention of Electronic Crimes Act and the draft Personal Data Protection Bill: consent and purpose limitation, data minimisation, security safeguards, and the right to correction and erasure.'],
      ['Security practices', 'OWASP Top-10 checklist in code review, automated dependency and secret scanning in CI, encrypted backups with restore drills, two-factor sign-in for administrators, and an audit log of sensitive reads (medical information, transcripts, exports).'],
    ],
  },
};

export function LegalPage() {
  const { t } = useTranslation();
  const { doc } = useParams();
  const d = LEGAL[(doc ?? 'privacy') as keyof typeof LEGAL];
  if (!d) return <Navigate to="/legal/privacy" replace />;
  return (
    <SiteLayout>
      <article className="mx-auto max-w-3xl space-y-5 px-4 py-12">
        <h1 className="text-3xl font-bold">{t(`legal.${doc}`, d.title)}</h1>
        <p className="text-sm text-fg-muted">{t('legal.updated', 'Last updated: October 2026')}</p>
        {d.sections.map(([h, p]) => (
          <section key={h}>
            <h2 className="mb-1 text-lg font-semibold">{h}</h2>
            <p className="leading-relaxed">{p}</p>
          </section>
        ))}
      </article>
    </SiteLayout>
  );
}

/** The public help center (the same guides as inside the app). */
export function DocsPage() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const a = HELP_ARTICLES.find((x) => x.slug === slug) ?? HELP_ARTICLES[0]!;
  const videos = useQuery({ queryKey: ['tutorial-videos'], queryFn: () => api.get<Record<string, string>>('/public/tutorials').catch((): Record<string, string> => ({})) });
  return (
    <SiteLayout>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 lg:grid-cols-[18rem_1fr]">
        <nav aria-label={t('site.help', 'Help center')}>
          <ul className="space-y-1 text-sm">{HELP_ARTICLES.map((x) => <li key={x.slug}><Link to={`/docs/${x.slug}`} className={`block rounded px-2 py-1.5 hover:bg-surface-2 ${x.slug === a.slug ? 'bg-primary-soft text-primary' : ''}`}>{x.title}</Link></li>)}</ul>
        </nav>
        <article className="space-y-3">
          <h1 className="text-2xl font-bold">{a.title}</h1>
          {a.body.split('\n\n').map((p, i) => <p key={i} className="leading-relaxed">{p}</p>)}
          {videos.data?.[a.slug] && <a href={videos.data[a.slug]} target="_blank" rel="noreferrer" className="inline-block text-primary underline">{t('site.watch', 'Watch the video tutorial')}</a>}
        </article>
      </div>
    </SiteLayout>
  );
}
