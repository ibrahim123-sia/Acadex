// Reading content packages: zip (Common Cartridge, SCORM, QTI) and gzip-tar (Moodle .mbz)
// archives, with limits so a hostile archive can't exhaust memory, and the XML inside them.
import { gunzipSync, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { badRequest } from '../errors';

const MAX_FILES = 5000;
const MAX_TOTAL = 500 * 1024 * 1024;

export type Archive = Map<string, Uint8Array>;

const cleanPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '');

export function readZip(buf: Buffer): Archive {
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > MAX_FILES || total > MAX_TOTAL) throw new Error('too large');
        return !f.name.endsWith('/') && !f.name.split('/').includes('..');
      },
    });
  } catch (e) {
    throw badRequest((e as Error).message === 'too large' ? 'The package is too large to import' : 'The file is not a readable zip package');
  }
  return new Map(Object.entries(files).map(([k, v]) => [cleanPath(k), v]));
}

/** A .tar (optionally gzipped): enough of the format for Moodle backups. */
export function readTar(buf: Buffer): Archive {
  let data: Uint8Array = new Uint8Array(buf);
  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = gunzipSync(data);
    } catch {
      throw badRequest('The backup could not be unpacked');
    }
  }
  if (data.length > MAX_TOTAL) throw badRequest('The package is too large to import');
  const out: Archive = new Map();
  const text = (a: Uint8Array) => new TextDecoder().decode(a).replace(/\0.*$/s, '');
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= data.length && out.size < MAX_FILES) {
    const header = data.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    let name = text(header.subarray(0, 100));
    const prefix = text(header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(text(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156]!);
    const body = data.subarray(off + 512, off + 512 + size);
    if (type === 'L') longName = text(body);
    else if (type === '0' || type === '\0') {
      const n = cleanPath(longName ?? name);
      if (!n.split('/').includes('..')) out.set(n, body);
      longName = null;
    } else longName = null;
    off += 512 + Math.ceil(size / 512) * 512;
  }
  if (!out.size) throw badRequest('The backup is empty or not a Moodle backup');
  return out;
}

/** zip or tar, by signature. */
export function readArchive(buf: Buffer): Archive {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readZip(buf);
  return readTar(buf);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, textNodeName: '#text', parseTagValue: false, trimValues: true, processEntities: true });

export function xml(data: Uint8Array | string | undefined): Record<string, unknown> {
  if (!data) return {};
  const s = typeof data === 'string' ? data : new TextDecoder().decode(data);
  // no DTDs: external entities are never resolved
  return parser.parse(s.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/gi, '')) as Record<string, unknown>;
}

/** Always an array (XML gives one child as an object, many as an array). */
export const list = <T = Record<string, unknown>>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
export const txt = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text'] ?? '');
  return '';
};

/** Resolve a path relative to a file inside the archive. */
export function joinPath(base: string, rel: string) {
  const parts = base.split('/').slice(0, -1);
  for (const p of decodeURIComponent(rel.split(/[?#]/)[0]!).split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

export const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain', swf: 'application/x-shockwave-flash', vtt: 'text/vtt',
};
export const mimeOf = (p: string) => MIME[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

// ---------------------------------------------------------------- QTI

export interface ImportedQuestion {
  type: 'mcq' | 'multi' | 'true_false' | 'short' | 'essay' | 'numeric';
  prompt_html: string;
  data: Record<string, unknown>;
  points: number;
}

/** QTI 1.2 items (Common Cartridge, Canvas, Blackboard exports) and QTI 2.x assessment items. */
export function parseQti(doc: Record<string, unknown>): { title: string; questions: ImportedQuestion[]; skipped: number } {
  const out: ImportedQuestion[] = [];
  let skipped = 0;
  const root = (doc.questestinterop ?? {}) as Record<string, unknown>;
  const asmt = (root.assessment ?? root.objectbank) as Record<string, unknown> | undefined;
  const title = String((asmt?.['@title'] as string) ?? 'Imported questions');
  const items: Record<string, unknown>[] = [];
  const collect = (node: unknown) => {
    for (const n of list<Record<string, unknown>>(node)) {
      items.push(...list<Record<string, unknown>>(n.item));
      collect(n.section);
    }
  };
  if (asmt) {
    items.push(...list<Record<string, unknown>>(asmt.item));
    collect(asmt.section);
  }
  items.push(...list<Record<string, unknown>>(root.item));
  const mat = (node: unknown): string => {
    const m = (node as Record<string, unknown>)?.material ?? node;
    return list<Record<string, unknown>>(m).map((x) => list(x.mattext).map(txt).join(' ')).join(' ').trim();
  };
  for (const item of items) {
    const meta = list<Record<string, unknown>>((item.itemmetadata as Record<string, unknown>)?.qtimetadata).flatMap((q) => list<Record<string, unknown>>(q.qtimetadatafield));
    const qtype = txt(meta.find((f) => txt(f.fieldlabel) === 'question_type' || txt(f.fieldlabel) === 'cc_profile')?.fieldentry);
    const pres = (item.presentation ?? {}) as Record<string, unknown>;
    const prompt = mat(pres) || txt(item['@title']);
    const lid = list<Record<string, unknown>>(pres.response_lid)[0] ?? list<Record<string, unknown>>((pres.flow as Record<string, unknown>)?.response_lid)[0];
    const correct = new Set<string>();
    for (const rc of list<Record<string, unknown>>((item.resprocessing as Record<string, unknown>)?.respcondition)) {
      const set = list(rc.setvar).map(txt);
      const positive = set.some((v) => Number(v) > 0) || txt(rc['@continue']) === 'No';
      const cv = rc.conditionvar as Record<string, unknown> | undefined;
      const eq = [...list(cv?.varequal), ...list((cv?.and as Record<string, unknown>)?.varequal)];
      if (positive) for (const e of eq) correct.add(txt(e));
    }
    if (lid) {
      const labels = list<Record<string, unknown>>((lid.render_choice as Record<string, unknown>)?.response_label);
      const options = labels.map((l) => ({ id: txt(l['@ident']).slice(0, 20), text: mat(l) || txt(l['@ident']) }));
      const multiple = txt(lid['@rcardinality']) === 'Multiple' || /multiple_answers|multiple_response/.test(qtype);
      const right = options.filter((o) => correct.has(o.id)).map((o) => o.id);
      if (options.length === 2 && /true_false/.test(qtype)) {
        const t = options.find((o) => /^true$/i.test(o.text));
        out.push({ type: 'true_false', prompt_html: `<p>${prompt}</p>`, data: { correct: !!t && right.includes(t.id) }, points: 1 });
      } else if (options.length >= 2 && right.length) {
        out.push(multiple ? { type: 'multi', prompt_html: `<p>${prompt}</p>`, data: { options, correct: right, partial_credit: true }, points: 1 } : { type: 'mcq', prompt_html: `<p>${prompt}</p>`, data: { options, correct: right[0] }, points: 1 });
      } else skipped++;
      continue;
    }
    if (pres.response_str || (pres.flow as Record<string, unknown>)?.response_str) {
      if (/essay/.test(qtype) || !correct.size) out.push({ type: 'essay', prompt_html: `<p>${prompt}</p>`, data: { min_words: 0, max_words: null }, points: 1 });
      else out.push({ type: 'short', prompt_html: `<p>${prompt}</p>`, data: { accepted: [...correct], case_sensitive: false }, points: 1 });
      continue;
    }
    if (pres.response_num) {
      const v = Number([...correct][0]);
      if (Number.isFinite(v)) out.push({ type: 'numeric', prompt_html: `<p>${prompt}</p>`, data: { answer: v, tolerance: 0 }, points: 1 });
      else skipped++;
      continue;
    }
    skipped++;
  }
  // QTI 2.x: a single assessmentItem per file
  const ai = doc.assessmentItem as Record<string, unknown> | undefined;
  if (ai) {
    const body = (ai.itemBody ?? {}) as Record<string, unknown>;
    const choice = list<Record<string, unknown>>(body.choiceInteraction)[0];
    const decl = list<Record<string, unknown>>(ai.responseDeclaration)[0];
    const right = list((decl?.correctResponse as Record<string, unknown>)?.value).map(txt);
    const prompt = txt(choice?.prompt) || list(body.p).map(txt).join(' ') || txt(ai['@title']);
    if (choice) {
      const options = list<Record<string, unknown>>(choice.simpleChoice).map((c) => ({ id: txt(c['@identifier']).slice(0, 20), text: txt(c) || txt(c['@identifier']) }));
      const multiple = Number(txt(choice['@maxChoices']) || '1') !== 1;
      if (right.length) out.push(multiple ? { type: 'multi', prompt_html: `<p>${prompt}</p>`, data: { options, correct: right, partial_credit: true }, points: 1 } : { type: 'mcq', prompt_html: `<p>${prompt}</p>`, data: { options, correct: right[0] }, points: 1 });
      else skipped++;
    } else if (body.extendedTextInteraction) out.push({ type: 'essay', prompt_html: `<p>${prompt}</p>`, data: { min_words: 0, max_words: null }, points: 1 });
    else if (body.textEntryInteraction && right.length) out.push({ type: 'short', prompt_html: `<p>${prompt}</p>`, data: { accepted: right, case_sensitive: false }, points: 1 });
    else skipped++;
  }
  return { title, questions: out, skipped };
}
