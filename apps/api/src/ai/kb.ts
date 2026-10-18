// The course knowledge base: published course material (pages, files — PDF, Word, text —,
// assessment briefs, video transcripts) split into chunks with embeddings and a full-text
// index; and Acadex's own help articles. Indexing is incremental: a source is re-read only
// when its fingerprint (last change, file) changes. Quiz questions and answers are never
// indexed, so the tutor cannot see them.
import crypto from 'node:crypto';
import { HELP_ARTICLES } from '@acadex/shared';
import { db, runAsSystem } from '../db/context';
import { logger } from '../lib/logger';
import { storage } from '../storage';
import { defineJob } from '../jobs/queue';
import { aiEmbed, aiStatus, embeddingModel } from './client';
import { contentWords, fakeEmbedding } from './providers';

export interface Chunk {
  id: number;
  title: string;
  locator: string;
  content: string;
  score: number;
  source_type: string;
  source_id: number;
}

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

/** Text of an uploaded file we can read (PDF, Word, plain text). */
export async function extractFileText(storageKey: string, contentType: string): Promise<string> {
  try {
    const body = await storage().get(storageKey);
    if (contentType === 'application/pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(body));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(Array.isArray(text) ? text.join('\n') : text);
    }
    if (contentType.includes('wordprocessingml')) {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ buffer: body })).value;
    }
    if (contentType.startsWith('text/')) return body.toString('utf8');
  } catch (err) {
    logger.warn({ err, storageKey }, 'kb: could not read file');
  }
  return '';
}

/** ~900-character chunks on paragraph boundaries, with a little overlap. */
export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) {
      out.push(cur);
      cur = cur.slice(-overlap) + '\n\n' + p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > size * 1.6) {
      out.push(cur.slice(0, size));
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

interface Source {
  type: 'content_item' | 'assessment' | 'file' | 'transcript';
  id: number;
  title: string;
  locator: string;
  fingerprint: string;
  read: () => Promise<string>;
}

async function sourcesOf(offeringId: number): Promise<Source[]> {
  const base = `/learn/courses/${offeringId}`;
  const { rows: items } = await db.query<{ id: number; kind: string; title: string; body_html: string; url: string; updated_at: Date; file_id: number | null; storage_key: string | null; content_type: string | null; assessment_id: number | null }>(
    `SELECT i.id, i.kind, i.title, i.body_html, i.url, i.updated_at, i.file_id, f.storage_key, f.content_type, i.assessment_id
       FROM content_items i JOIN modules m ON m.id = i.module_id LEFT JOIN files f ON f.id = i.file_id
      WHERE m.offering_id = $1 AND m.published AND i.published AND i.deleted_at IS NULL`,
    [offeringId]
  );
  const { rows: work } = await db.query<{ id: number; title: string; instructions_html: string; updated_at: Date }>(
    `SELECT id, title, instructions_html, updated_at FROM assessments WHERE offering_id = $1 AND status <> 'draft' AND deleted_at IS NULL AND instructions_html <> ''`,
    [offeringId]
  );
  const { rows: transcripts } = await db.query<{ id: number; file_id: number; text: string; updated_at: Date; item_id: number; title: string }>(
    `SELECT t.id, t.file_id, t.text, t.updated_at, i.id AS item_id, i.title FROM media_transcripts t JOIN content_items i ON i.file_id = t.file_id
       JOIN modules m ON m.id = i.module_id WHERE m.offering_id = $1 AND t.status = 'done' AND i.published AND i.deleted_at IS NULL`,
    [offeringId]
  );
  const out: Source[] = [];
  for (const i of items) {
    if (i.kind === 'page') out.push({ type: 'content_item', id: i.id, title: i.title, locator: `${base}/items/${i.id}`, fingerprint: `${i.updated_at.toISOString()}`, read: async () => htmlToText(i.body_html) });
    else if (i.kind === 'file' && i.storage_key && i.content_type && /pdf|wordprocessingml|^text\//.test(i.content_type))
      out.push({ type: 'file', id: i.id, title: i.title, locator: `${base}/items/${i.id}`, fingerprint: `${i.file_id}:${i.updated_at.toISOString()}`, read: () => extractFileText(i.storage_key!, i.content_type!) });
  }
  for (const a of work) out.push({ type: 'assessment', id: a.id, title: a.title, locator: `${base}/work/${a.id}`, fingerprint: a.updated_at.toISOString(), read: async () => htmlToText(a.instructions_html) });
  for (const t of transcripts) out.push({ type: 'transcript', id: t.id, title: `${t.title} (transcript)`, locator: `${base}/items/${t.item_id}`, fingerprint: t.updated_at.toISOString(), read: async () => t.text });
  return out;
}

/** Bring an offering's chunks up to date; returns how many sources were (re)indexed. */
export async function indexOffering(offeringId: number, institutionId: number): Promise<{ indexed: number; removed: number; chunks: number }> {
  const st = await aiStatus({ institutionId, userId: null, feature: 'embeddings', offeringId });
  if (!st.enabled) return { indexed: 0, removed: 0, chunks: 0 };
  const sources = await sourcesOf(offeringId);
  const { rows: existing } = await db.query<{ source_type: string; source_id: number; hash: string; embedding_model: string | null }>(`SELECT DISTINCT ON (source_type, source_id) source_type, source_id, hash, embedding_model FROM kb_chunks WHERE offering_id = $1 ORDER BY source_type, source_id, chunk_no`, [offeringId]);
  // a change of embedding model (API management) re-embeds everything
  const model = await embeddingModel();
  const fp = (s: Source) => `fp:${crypto.createHash('sha1').update(`${s.fingerprint}|${s.title}`).digest('hex')}`;
  const stale = sources.filter((s) => {
    const e = existing.find((x) => x.source_type === s.type && x.source_id === s.id);
    return e?.hash !== fp(s) || e.embedding_model !== model;
  });
  const gone = existing.filter((e) => !sources.some((s) => s.type === e.source_type && s.id === e.source_id));
  for (const g of gone) await db.query(`DELETE FROM kb_chunks WHERE offering_id = $1 AND source_type = $2 AND source_id = $3`, [offeringId, g.source_type, g.source_id]);
  let chunks = 0;
  for (const s of stale) {
    const text = await s.read();
    const parts = chunkText(text);
    const { vectors, model } = await aiEmbed({ institutionId, userId: null, offeringId }, parts.map((p) => `${s.title}\n${p}`));
    await db.query(`DELETE FROM kb_chunks WHERE source_type = $1 AND source_id = $2`, [s.type, s.id]);
    for (const [i, p] of parts.entries()) {
      await db.query(
        `INSERT INTO kb_chunks (institution_id, offering_id, source_type, source_id, chunk_no, title, locator, content, tokens, embedding, embedding_model, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [institutionId, offeringId, s.type, s.id, i, s.title, s.locator, p, Math.ceil(p.length / 4), vectors[i], model, fp(s)]
      );
    }
    chunks += parts.length;
  }
  return { indexed: stale.length, removed: gone.length, chunks };
}

/** Hybrid search: meaning (embeddings) and words (full text), best first. */
export async function searchOffering(offeringId: number, institutionId: number, query: string, k = 5): Promise<Chunk[]> {
  const { vectors, model } = await aiEmbed({ institutionId, userId: null, offeringId }, [query]);
  return rank(`offering_id = $3`, [vectors[0], wordQuery(query), offeringId], k, model);
}

/** The topic words of a question as an OR query (stopwords dropped); '' matches nothing. */
const wordQuery = (q: string) => [...new Set(contentWords(q))].map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');

/** Meaning counts only for chunks embedded with the same model as the question. */
async function rank(where: string, params: unknown[], k: number, model: string): Promise<Chunk[]> {
  const m = params.length + 1;
  const { rows } = await db.query<Chunk>(
    `SELECT id, title, locator, content, source_type, source_id,
            (0.75 * COALESCE(CASE WHEN embedding_model = $${m} THEN acadex_cosine(embedding, $1::real[]) END, 0)
             + 0.25 * CASE WHEN $2 = '' THEN 0 ELSE LEAST(1, ts_rank(tsv, to_tsquery('simple', $2)) * 4) END)::float8 AS score
       FROM kb_chunks WHERE ${where} ORDER BY score DESC LIMIT ${Number(k)}`,
    [...params, model]
  );
  return rows;
}

// ---------------------------------------------------------------- help articles

/** Index the built-in help articles (no institution); cheap, so it runs at start-up. */
export async function indexHelp(): Promise<number> {
  return runAsSystem(async () => {
    let n = 0;
    for (const [idx, a] of HELP_ARTICLES.entries()) {
      const hash = `fp:${crypto.createHash('sha1').update(a.title + a.body).digest('hex')}`;
      const { rows } = await db.query<{ hash: string }>(`SELECT hash FROM kb_chunks WHERE source_type = 'help' AND source_id = $1 LIMIT 1`, [idx + 1]);
      if (rows[0]?.hash === hash) continue;
      await db.query(`DELETE FROM kb_chunks WHERE source_type = 'help' AND source_id = $1`, [idx + 1]);
      for (const [i, p] of chunkText(a.body).entries()) {
        // help articles are embedded locally (no tenant, no spend)
        await db.query(
          `INSERT INTO kb_chunks (institution_id, offering_id, source_type, source_id, chunk_no, title, locator, content, tokens, embedding, embedding_model, hash) VALUES (NULL, NULL, 'help', $1, $2, $3, $4, $5, $6, $7, 'local', $8)`,
          [idx + 1, i, a.title, `/help/${a.slug}`, p, Math.ceil(p.length / 4), fakeEmbedding(`${a.title}\n${p}`), hash]
        );
      }
      n++;
    }
    return n;
  });
}

export async function searchHelp(query: string, k = 4): Promise<Chunk[]> {
  return rank(`source_type = 'help'`, [fakeEmbedding(query), wordQuery(query)], k, 'local');
}

// ---------------------------------------------------------------- after a change of embedding model

/** Re-embed every course whose chunks were made with another model (queued by API management). */
export const reindexAllJob = defineJob<Record<string, never>>({
  name: 'kb.reindex_all',
  async run() {
    const model = await runAsSystem(() => embeddingModel());
    const { rows } = await runAsSystem(() =>
      db.query<{ offering_id: number; institution_id: number }>(
        `SELECT DISTINCT offering_id, institution_id FROM kb_chunks WHERE offering_id IS NOT NULL AND embedding_model IS DISTINCT FROM $1`,
        [model]
      )
    );
    for (const r of rows) {
      try {
        await runAsSystem(() => indexOffering(r.offering_id, r.institution_id));
      } catch (err) {
        logger.warn({ err, offering: r.offering_id }, 'course re-index failed');
      }
    }
    logger.info({ courses: rows.length, model }, 'courses re-indexed for the new embedding model');
  },
});
