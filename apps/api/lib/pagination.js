// Page-based pagination for list endpoints. Bodies stay plain arrays (so existing clients
// keep working); totals travel in headers, which CORS exposes to the browser.
const { z } = require('zod');

const MAX_PAGE_SIZE = 100;

function parsePage(query, { defaultSize = 50 } = {}) {
  const { page, pageSize } = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(defaultSize),
    })
    .parse({ page: query.page, pageSize: query.pageSize });
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

// Rows come from a query that selects count(*) OVER() AS _total.
function sendPage(res, rows, { page, pageSize }) {
  const total = rows.length ? Number(rows[0]._total) : 0;
  res.set({ 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Page-Size': String(pageSize) });
  res.json(rows.map(({ _total, ...r }) => r));
}

const PAGINATION_HEADERS = ['X-Total-Count', 'X-Page', 'X-Page-Size'];

module.exports = { parsePage, sendPage, MAX_PAGE_SIZE, PAGINATION_HEADERS };
