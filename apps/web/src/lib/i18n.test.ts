// Every string the app shows has an Urdu and an Arabic translation, with the same
// {{placeholders}} as the English. Adding a t('key', 'English') without translating it fails here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ur from '../locales/ur.json';
import ar from '../locales/ar.json';
import en from '../locales/en.json';

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = '', out: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flat(v, key, out);
  }
  return out;
};

function codeStrings(): Record<string, string> {
  const root = path.resolve(__dirname, '..');
  const out: Record<string, string> = {};
  const re = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) {
          const key = m[1] ?? m[2]!;
          if (/^[a-zA-Z][\w.]*$/.test(key)) out[key] = (m[3] ?? m[4]!).replace(/\\'/g, "'");
        }
      }
    }
  };
  walk(root);
  return out;
}

const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((x) => x.replace(/\s/g, '')).sort();

describe('translations', () => {
  const english = { ...flat(en as Tree), ...codeStrings() };
  for (const [lang, file] of [['ur', ur], ['ar', ar]] as const) {
    it(`${lang} covers every string with the same placeholders`, () => {
      const tr = flat(file as Tree);
      const missing = Object.keys(english).filter((k) => !tr[k]);
      expect(missing, `untranslated in ${lang}`).toEqual([]);
      const wrong = Object.keys(english).filter((k) => placeholders(tr[k]!).join() !== placeholders(english[k]!).join());
      expect(wrong, `placeholders differ in ${lang}`).toEqual([]);
    });
  }
});
