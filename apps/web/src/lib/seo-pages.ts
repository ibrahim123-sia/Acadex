// Search and link-preview metadata for the public pages. Pure data and string helpers (no DOM, no
// React): the app uses them to set the page head at runtime, and the build (vite.config.ts) uses
// them to write one HTML file per public page, so crawlers that do not run JavaScript — LinkedIn,
// WhatsApp, Slack, Upwork — still see the right title, description and image.

export const SITE = {
  name: 'Acadex',
  tagline: 'The AI-native platform for running schools, colleges and universities',
  description:
    'Admissions, courses, attendance, exams, fees and family communication in one secure platform — with an AI tutor and teacher copilot that keep people in control.',
  image: '/og-image.png',
  imageAlt: 'Acadex — the AI-native platform for running schools, colleges and universities',
  themeColor: '#4f46e5',
} as const;

export interface SeoPage {
  /** the route, e.g. /pricing (no trailing slash; / for home) */
  path: string;
  title: string;
  description: string;
  /** false keeps the page out of search results (it can still be shared) */
  index: boolean;
  /** extra JSON-LD for this page */
  jsonLd?: Record<string, unknown>;
}

interface Article {
  slug: string;
  title: string;
  body: string;
}

/** The first sentences of a text, cut at a word boundary to fit a meta description. */
export function summary(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\s—-]+$/, '')}…`;
}

const LEGAL_PAGES: [string, string, string][] = [
  ['privacy', 'Privacy policy', 'How Acadex collects, uses and protects the personal data of institutions, students, families and staff — and the rights everyone has over it.'],
  ['terms', 'Terms of service', 'The terms for using Acadex: accounts, acceptable use, plans and billing, data ownership, availability and liability.'],
  ['dpa', 'Data processing agreement', 'The data processing agreement between an institution (controller) and Acadex (processor): instructions, security measures, sub-processors and deletion.'],
  ['subprocessors', 'Sub-processors', 'The service providers Acadex uses for hosting, storage, email, payments and AI, and what each one processes.'],
  ['compliance', 'Compliance', 'How Acadex supports GDPR, UK GDPR, COPPA, FERPA and Pakistan’s data protection rules, and the security practices behind it.'],
];

/** Every public page with its metadata; the help articles come from @acadex/shared. */
export function publicPages(articles: readonly Article[]): SeoPage[] {
  return [
    {
      path: '/',
      // under ~60 characters, so search results show it whole
      title: `${SITE.name} — AI-native platform for schools, colleges & universities`,
      description: SITE.description,
      index: true,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: SITE.name,
        description: SITE.description,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web browser; installable on Android, iOS, Windows and macOS',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free plan and free trial of the paid plans' },
      },
    },
    {
      path: '/pricing',
      title: `Pricing — ${SITE.name}`,
      description: 'Simple plans for schools, colleges, universities and academies: start free, try any paid plan, and pay in your own currency.',
      index: true,
    },
    {
      path: '/demo',
      title: `Book a demo — ${SITE.name}`,
      description: 'See Acadex with your own setup: tell us about your institution and we will walk you through admissions, teaching, exams and fees.',
      index: true,
    },
    {
      path: '/signup',
      title: `Start a free trial — ${SITE.name}`,
      description: 'Create your institution’s workspace in minutes — no card needed. Your country sets the currency, time zone and payment methods.',
      index: true,
    },
    {
      path: '/docs',
      title: `Help center — ${SITE.name}`,
      description: 'Step-by-step guides for administrators, teachers, students and parents: students, courses, attendance, exams, fees and more.',
      index: true,
    },
    ...articles.map((a) => ({ path: `/docs/${a.slug}`, title: `${a.title} — ${SITE.name} Help`, description: summary(a.body), index: true })),
    ...LEGAL_PAGES.map(([doc, title, description]) => ({ path: `/legal/${doc}`, title: `${title} — ${SITE.name}`, description, index: true })),
    {
      path: '/login',
      title: `Sign in — ${SITE.name}`,
      description: `Sign in to ${SITE.name} — your institution’s courses, attendance, exams, fees and messages in one place.`,
      index: true,
    },
  ];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The title of an app page: "Students — Acadex". */
export const pageTitle = (title: string) => `${title} — ${SITE.name}`;

/** Join the site's address and a path without double slashes. */
export const absolute = (siteUrl: string, path: string) => `${siteUrl.replace(/\/+$/, '')}${path === '/' ? '/' : path}`;

/**
 * The `<head>` tags of a page: title, description, robots, canonical, Open Graph, Twitter card
 * and JSON-LD. Without `siteUrl` the canonical and og:url are left out and the image stays
 * relative (set SITE_URL at build time for complete link previews).
 */
export function headTags(page: SeoPage, siteUrl?: string): string {
  const url = siteUrl ? absolute(siteUrl, page.path) : undefined;
  const image = siteUrl ? absolute(siteUrl, SITE.image) : SITE.image;
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta name="robots" content="${page.index ? 'index, follow' : 'noindex, nofollow'}" />`,
    url && `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    url && `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(SITE.imageAlt)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    page.jsonLd && `<script type="application/ld+json">${JSON.stringify(url ? { ...page.jsonLd, url } : page.jsonLd).replace(/</g, '\\u003c')}</script>`,
  ];
  return tags.filter(Boolean).join('\n    ');
}

/** Where the build writes a page: / → index.html, /pricing → pricing.html, /docs/x → docs/x.html. */
export const htmlFileFor = (path: string) => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);

/** sitemap.xml for the pages that may be indexed. */
export function sitemap(pages: SeoPage[], siteUrl: string, lastmod: string): string {
  const urls = pages
    .filter((p) => p.index && p.path !== '/login')
    .map((p) => `  <url><loc>${esc(absolute(siteUrl, p.path))}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
