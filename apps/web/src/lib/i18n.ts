// Internationalisation. English strings live in the code as defaults (t('key', 'English'));
// other languages override them from locales/*.json. Urdu and Arabic are right-to-left.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ur from '../locales/ur.json';
import ar from '../locales/ar.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];

const KEY = 'acadex.lang';
const saved = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
const initial = LANGUAGES.some((l) => l.code === saved) ? saved! : LANGUAGES.some((l) => l.code === browser) ? browser : 'en';

export function applyDocumentLanguage(code: string) {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: {} }, ur: { translation: ur }, ar: { translation: ar } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  react: { useSuspense: false },
});
applyDocumentLanguage(initial);

export function setLanguage(code: Language) {
  void i18n.changeLanguage(code);
  applyDocumentLanguage(code);
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode */
  }
}

export default i18n;
