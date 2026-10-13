import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Page } from './api';

/** One page of a paginated list endpoint; resets to page 1 when the filters change. */
export function usePagedList<T>(path: string, filters: Record<string, string | number | undefined> = {}, pageSize = 50) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const query = useQuery<Page<T>>({
    queryKey: [path, filters, page, pageSize],
    queryFn: ({ signal }) => api.page<T>(path, { ...filters, page, pageSize }, signal),
    placeholderData: keepPreviousData,
  });
  return { ...query, page, setPage, pageSize };
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
