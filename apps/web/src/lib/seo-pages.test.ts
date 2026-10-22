import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES } from '@acadex/shared';
import { absolute, headTags, htmlFileFor, publicPages, sitemap, summary } from './seo-pages';

const pages = publicPages(HELP_ARTICLES);

describe('public page metadata', () => {
  it('covers every public page once, with a help page per article', () => {
    const paths = pages.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ['/', '/pricing', '/demo', '/signup', '/docs', '/login', '/legal/privacy', '/legal/terms']) expect(paths).toContain(p);
    for (const a of HELP_ARTICLES) expect(paths).toContain(`/docs/${a.slug}`);
  });

  it('titles and descriptions fit search results and are unique', () => {
    for (const p of pages) {
      expect(p.title.length, p.title).toBeLessThanOrEqual(70);
      expect(p.description.length, p.path).toBeGreaterThanOrEqual(50);
      expect(p.description.length, p.path).toBeLessThanOrEqual(160);
    }
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
  });

  it('summary cuts at a word and marks the cut', () => {
    expect(summary('Short text.')).toBe('Short text.');
    const s = summary('word '.repeat(80));
    expect(s.length).toBeLessThanOrEqual(155);
    expect(s.endsWith('word…')).toBe(true);
  });
});

describe('head tags', () => {
  const home = pages.find((p) => p.path === '/')!;

  it('are complete and absolute when the site address is known', () => {
    const html = headTags(home, 'https://acadex.example/');
    expect(html).toContain('<link rel="canonical" href="https://acadex.example/" />');
    expect(html).toContain('<meta property="og:image" content="https://acadex.example/og-image.png" />');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"url":"https://acadex.example/"');
  });

  it('leave out what needs the address when it is not known', () => {
    const html = headTags(home);
    expect(html).not.toContain('canonical');
    expect(html).not.toContain('og:url');
    expect(html).toContain('content="/og-image.png"');
  });

  it('escape text and keep private pages out of search', () => {
    const html = headTags({ path: '/x', title: 'A "quoted" <b>title</b> & more', description: 'd'.repeat(60), index: false });
    expect(html).toContain('<title>A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more</title>');
    expect(html).toContain('content="noindex, nofollow"');
  });
});

describe('build output', () => {
  it('maps routes to files that /pricing and /docs/x are served from', () => {
    expect(htmlFileFor('/')).toBe('index.html');
    expect(htmlFileFor('/pricing')).toBe('pricing.html');
    expect(htmlFileFor('/docs/add-students')).toBe('docs/add-students.html');
    expect(absolute('https://a.example/', '/pricing')).toBe('https://a.example/pricing');
  });

  it('lists indexable pages in the sitemap, not the sign-in page', () => {
    const xml = sitemap(pages, 'https://acadex.example', '2026-10-21');
    expect(xml).toContain('<loc>https://acadex.example/pricing</loc>');
    expect(xml).toContain('<lastmod>2026-10-21</lastmod>');
    expect(xml).not.toContain('/login');
    expect(xml.match(/<url>/g)).toHaveLength(pages.length - 1);
  });
});
