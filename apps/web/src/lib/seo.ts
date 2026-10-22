// Keeps the page head in step with the route: public pages get their title, description and
// link-preview tags (the same ones the build writes into their HTML files); every other page is
// kept out of search results, and its title comes from its PageHeader.
import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import { HELP_ARTICLES } from '@acadex/shared';
import { SITE, pageTitle, publicPages, type SeoPage } from './seo-pages';

const PAGES = new Map(publicPages(HELP_ARTICLES).map((p) => [p.path, p]));
/** the title the current page's PageHeader asked for (kept when only the route changes) */
let headerTitle: string | null = null;

function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function canonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) return el?.remove();
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

function apply(page: SeoPage, isPublic: boolean) {
  meta('name', 'robots', page.index ? 'index, follow' : 'noindex, nofollow');
  if (!isPublic) return canonical(null);
  const url = `${window.location.origin}${page.path}`;
  document.title = page.title;
  meta('name', 'description', page.description);
  meta('property', 'og:title', page.title);
  meta('property', 'og:description', page.description);
  meta('property', 'og:url', url);
  meta('name', 'twitter:title', page.title);
  meta('name', 'twitter:description', page.description);
  canonical(url);
}

/** Set the head for the current route. Runs as a layout effect, before pages set their titles. */
export function useRouteSeo() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const path = pathname.replace(/\/+$/, '') || '/';
    const page = PAGES.get(path);
    if (page) return apply(page, true);
    // online admission forms are public and meant to be found and shared
    const isApplication = /^\/apply\/[^/]+\/[^/]+$/.test(path);
    document.title = isApplication ? `Online application — ${SITE.name}` : headerTitle ? pageTitle(headerTitle) : SITE.name;
    apply({ path, title: document.title, description: SITE.description, index: isApplication }, false);
  }, [pathname]);
}

/** The browser tab shows the page ("Students — Acadex"); used by PageHeader. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    headerTitle = title;
    document.title = pageTitle(title);
    return () => {
      if (headerTitle !== title) return;
      headerTitle = null;
      // only undo our own title (the next route may already have set its own)
      if (document.title === pageTitle(title)) document.title = SITE.name;
    };
  }, [title]);
}
