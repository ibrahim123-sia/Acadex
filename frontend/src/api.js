import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('acadex_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const clearAuth = () => ['acadex_token', 'acadex_user', 'acadex_school'].forEach((k) => localStorage.removeItem(k));

// Session revoked / expired / account deactivated → back to the login screen.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const onLogin = window.location.pathname === '/login';
    if (err.response?.status === 401 && !onLogin && localStorage.getItem('acadex_token')) {
      clearAuth();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function saveAuth({ token, user, school }) {
  localStorage.setItem('acadex_token', token);
  localStorage.setItem('acadex_user', JSON.stringify(user));
  localStorage.setItem('acadex_school', JSON.stringify(school || null));
}
export const getUser = () => { try { return JSON.parse(localStorage.getItem('acadex_user')); } catch { return null; } };
export const getSchool = () => { try { return JSON.parse(localStorage.getItem('acadex_school')); } catch { return null; } };
export const logout = async () => {
  try { await api.post('/auth/logout'); } catch { /* already signed out server-side */ }
  clearAuth();
  window.location.href = '/login';
};

export async function downloadPdf(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
