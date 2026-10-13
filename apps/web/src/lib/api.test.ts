import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, onSessionEnded, tokenStore } from './api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const session = (token: string) => ({ access_token: token, expires_in: 900, user: {}, school: null });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  tokenStore.set('old-token');
});
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the access token and the client header', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await api.get('/x');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBe('Bearer old-token');
    expect(init.headers['X-Acadex-Client']).toBe('web');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: 'expired' }))
      .mockResolvedValueOnce(json(200, session('new-token')))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    expect(await api.get('/x')).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer new-token');
  });

  it('concurrent 401s share a single refresh', async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session('fresh'));
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer fresh' ? json(200, { url }) : json(401, {});
    });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('reports the end of the session when refresh fails', async () => {
    const ended = vi.fn();
    const off = onSessionEnded(ended);
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, { error: 'gone' }));
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalled();
    expect(tokenStore.get()).toBeNull();
    off();
  });

  it('turns error bodies into ApiError with code and field details', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'Invalid request', code: 'X', details: [{ path: 'email', message: 'Invalid email' }] }));
    const err = (await api.post("/x", {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('X');
    expect(errorMessage(err)).toBe('Invalid email');
  });

  it('reads pagination headers', async () => {
    fetchMock.mockResolvedValueOnce(json(200, [{ id: 1 }], { 'X-Total-Count': '42', 'X-Page': '2', 'X-Page-Size': '20' }));
    const page = await api.page('/list', { page: 2, pageSize: 20 });
    expect(page).toEqual({ rows: [{ id: 1 }], total: 42, page: 2, pageSize: 20 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/list?page=2&pageSize=20');
  });

  it('gives a friendly message when offline', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/connection/i);
  });
});
