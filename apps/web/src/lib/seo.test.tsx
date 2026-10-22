import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { useDocumentTitle, useRouteSeo } from './seo';

const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ?? null;

let navigate: NavigateFunction;
function Harness({ header }: { header?: string }) {
  useRouteSeo();
  useDocumentTitle(header ?? null);
  navigate = useNavigate();
  return null;
}

describe('route SEO', () => {
  it('public pages get their title, description, canonical link and are indexable', () => {
    render(<MemoryRouter initialEntries={['/pricing']}><Harness /></MemoryRouter>);
    expect(document.title).toBe('Pricing — Acadex');
    expect(robots()).toBe('index, follow');
    expect(canonical()).toMatch(/\/pricing$/);
    expect(document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content).toBe('Pricing — Acadex');
  });

  it('pages behind sign-in are kept out of search and titled by their header', () => {
    const { rerender } = render(<MemoryRouter initialEntries={['/pricing']}><Harness /></MemoryRouter>);
    act(() => navigate('/admin/students'));
    rerender(<MemoryRouter initialEntries={['/admin/students']}><Harness header="Students" /></MemoryRouter>);
    expect(robots()).toBe('noindex, nofollow');
    expect(canonical()).toBeNull();
    expect(document.title).toBe('Students — Acadex');
  });

  it('keeps the header title when only the route changes', () => {
    render(<MemoryRouter initialEntries={['/messages']}><Harness header="Messages" /></MemoryRouter>);
    expect(document.title).toBe('Messages — Acadex');
    act(() => navigate('/messages/5'));
    expect(document.title).toBe('Messages — Acadex');
  });

  it('online admission forms may be found; status and test pages may not', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/apply/greenwood/class-one-2027']}><Harness /></MemoryRouter>);
    expect(robots()).toBe('index, follow');
    expect(document.title).toBe('Online application — Acadex');
    unmount();
    render(<MemoryRouter initialEntries={['/apply/status']}><Harness /></MemoryRouter>);
    expect(robots()).toBe('noindex, nofollow');
  });
});
