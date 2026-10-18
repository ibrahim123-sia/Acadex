// Interface text. Acadex's interface is in English: the strings live in the code as defaults
// (t('key', 'English')) and locales/en.json holds labels for enum values. The t() keys are kept so
// another language can be added later as one more locales/*.json file (see docs/future-gaps.md).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  react: { useSuspense: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
}

export default i18n;
