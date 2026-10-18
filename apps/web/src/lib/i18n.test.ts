import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from './i18n';

describe('interface language', () => {
  it('is English only', () => {
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(['en']);
    expect(i18n.language).toBe('en');
    const locales = fs.readdirSync(path.resolve(__dirname, '../locales'));
    expect(locales).toEqual(['en.json']);
  });

  it('every t() call carries its English text', () => {
    const root = path.resolve(__dirname, '..');
    const missing: string[] = [];
    // t('key') with no English default would show the raw key
    const bare = /\bt\(\s*'([a-zA-Z][\w.]*)'\s*\)/g;
    const en = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8')));
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\./.test(f))
          for (const m of fs.readFileSync(p, 'utf8').matchAll(bare)) {
            const leaf = m[1]!.split('.').pop()!;
            if (!en.includes(`"${leaf}"`)) missing.push(`${path.relative(root, p)}: ${m[1]}`);
          }
      }
    };
    walk(root);
    expect(missing).toEqual([]);
  });
});
