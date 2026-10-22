import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { HELP_ARTICLES } from '../../packages/shared/src/help';
import { headTags, htmlFileFor, publicPages, sitemap } from './src/lib/seo-pages';

/**
 * After the build, write one HTML file per public page with its own title, description and
 * link-preview tags (crawlers that don't run JavaScript read them), plus sitemap.xml. SITE_URL
 * (e.g. https://acadex.app) makes the canonical links, preview images and sitemap absolute.
 */
function seoPages(): Plugin {
  const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
  if (siteUrl && !/^https?:\/\/[^/]+$/.test(siteUrl)) throw new Error(`SITE_URL must look like https://example.com (got ${siteUrl})`);
  let outDir = 'dist';
  return {
    name: 'acadex-seo-pages',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle() {
      const shell = readFileSync(join(outDir, 'index.html'), 'utf8');
      const marked = /<!-- seo:[^>]*-->[\s\S]*?<!-- \/seo -->/;
      if (!marked.test(shell)) throw new Error('index.html has lost its <!-- seo --> … <!-- /seo --> block');
      const pages = publicPages(HELP_ARTICLES);
      for (const page of pages) {
        const file = join(outDir, htmlFileFor(page.path));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, shell.replace(marked, headTags(page, siteUrl)));
      }
      if (siteUrl) {
        writeFileSync(join(outDir, 'sitemap.xml'), sitemap(pages, siteUrl, new Date().toISOString().slice(0, 10)));
        const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8').trimEnd();
        writeFileSync(join(outDir, 'robots.txt'), `${robots}\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
      }
    },
  };
}

// In development the API is proxied under /api, so the web app and the API share an origin
// (the refresh cookie is first-party and no CORS is involved).
export default defineConfig({
  plugins: [react(), tailwindcss(), seoPages()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:5000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    // recharts (~540 kB) lands in a chunk only the lazy dashboard pages load
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
