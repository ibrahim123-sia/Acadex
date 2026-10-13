// Page-based pagination for list endpoints. Bodies stay plain arrays (so existing clients
// keep working); totals travel in headers, which CORS exposes to the browser.
import type { Response } from 'express';
import { pageQuery } from '@acadex/shared';

export { MAX_PAGE_SIZE } from '@acadex/shared';

export interface Page {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export function parsePage(query: Record<string, unknown>, { defaultSize = 50 } = {}): Page {
  const { page, pageSize } = pageQuery(defaultSize).parse({ page: query.page, pageSize: query.pageSize });
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** Rows come from a query that selects count(*) OVER() AS _total. */
export function sendPage(res: Response, rows: Array<Record<string, unknown>>, { page, pageSize }: Page) {
  const total = rows.length ? Number(rows[0]!._total) : 0;
  res.set({ 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Page-Size': String(pageSize) });
  res.json(rows.map(({ _total, ...r }) => r));
}

export const PAGINATION_HEADERS = ['X-Total-Count', 'X-Page', 'X-Page-Size'];
