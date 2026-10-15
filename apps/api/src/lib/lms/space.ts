// The course space: modules and content items of a course (or of a blueprint), what a student
// can open (drip release by date, prerequisite or mastery) and their progress.
import { db } from '../../db/context';
import { badRequest } from '../errors';
import { cleanHtml, parseVideoUrl } from '../html';
import { onProgress } from './rewards';

export type Owner = { offeringId: number; blueprintId?: undefined } | { blueprintId: number; offeringId?: undefined };
export const ownerWhere = (o: Owner, alias = 'm') => (o.offeringId ? `${alias}.offering_id = ${Number(o.offeringId)}` : `${alias}.blueprint_id = ${Number(o.blueprintId)}`);

export interface ModuleRow {
  id: number;
  title: string;
  description: string;
  position: number;
  published: boolean;
  unlock_at: Date | null;
  prerequisite_module_id: number | null;
  mastery_percent: string | null;
}
export interface ItemRow {
  id: number;
  module_id: number;
  kind: string;
  title: string;
  url: string;
  file_id: number | null;
  video_provider: string | null;
  video_ref: string | null;
  assessment_id: number | null;
  live_session_id: number | null;
  scorm_package_id: number | null;
  position: number;
  published: boolean;
  unlock_at: Date | null;
  completion: string;
  duration_minutes: number | null;
  locally_modified: boolean;
}

const ITEM_COLS = `i.id, i.module_id, i.kind, i.title, i.url, i.file_id, i.video_provider, i.video_ref, i.assessment_id, i.live_session_id,
  i.scorm_package_id, i.position, i.published, i.unlock_at, i.completion, i.duration_minutes, i.locally_modified`;

export async function loadSpace(owner: Owner) {
  const { rows: modules } = await db.query<ModuleRow>(
    `SELECT m.id, m.title, m.description, m.position, m.published, m.unlock_at, m.prerequisite_module_id, m.mastery_percent
       FROM modules m WHERE ${ownerWhere(owner)} ORDER BY m.position, m.id`
  );
  const { rows: items } = await db.query<ItemRow & { assessment_title: string | null; due_at: Date | null; assessment_kind: string | null; assessment_status: string | null; points: string | null }>(
    `SELECT ${ITEM_COLS}, a.title AS assessment_title, a.due_at, a.kind AS assessment_kind, a.status AS assessment_status, a.points
       FROM content_items i JOIN modules m ON m.id = i.module_id LEFT JOIN assessments a ON a.id = i.assessment_id
      WHERE ${ownerWhere(owner)} ORDER BY i.position, i.id`
  );
  return { modules, items };
}

export interface StudentState {
  done: Set<number>;
  /** module id → mastery (percent) on its graded items, from released grades */
  mastery: Map<number, number>;
}

export async function studentState(offeringId: number, studentId: number): Promise<StudentState> {
  const { rows: progress } = await db.query<{ item_id: number }>(
    `SELECT p.item_id FROM content_progress p JOIN content_items i ON i.id = p.item_id JOIN modules m ON m.id = i.module_id
      WHERE p.student_id = $1 AND m.offering_id = $2 AND p.status = 'done'`,
    [studentId, offeringId]
  );
  const { rows: mastery } = await db.query<{ module_id: number; pct: number }>(
    `SELECT i.module_id, (sum(g.points) * 100.0 / NULLIF(sum(a.points), 0))::float AS pct
       FROM content_items i JOIN modules m ON m.id = i.module_id JOIN assessments a ON a.id = i.assessment_id
       JOIN grades g ON g.assessment_id = a.id AND g.student_id = $1 AND g.status = 'released' AND NOT g.excused AND g.points IS NOT NULL
      WHERE m.offering_id = $2 GROUP BY i.module_id`,
    [studentId, offeringId]
  );
  return { done: new Set(progress.map((p) => p.item_id)), mastery: new Map(mastery.map((m) => [m.module_id, m.pct])) };
}

export interface Lock {
  locked: boolean;
  reason: string | null;
}

/** Why a module is closed for a student (date, unfinished prerequisite, mastery not reached). */
export function moduleLock(m: ModuleRow, modules: ModuleRow[], items: ItemRow[], st: StudentState, now = new Date()): Lock {
  if (m.unlock_at && m.unlock_at > now) return { locked: true, reason: `Opens ${m.unlock_at.toISOString()}` };
  if (m.prerequisite_module_id) {
    const pre = modules.find((x) => x.id === m.prerequisite_module_id);
    if (pre) {
      const required = items.filter((i) => i.module_id === pre.id && i.published);
      if (required.some((i) => !st.done.has(i.id))) return { locked: true, reason: `Finish “${pre.title}” first` };
      if (m.mastery_percent != null) {
        const got = st.mastery.get(pre.id);
        if (got == null || got < Number(m.mastery_percent)) return { locked: true, reason: `Score at least ${Number(m.mastery_percent)}% in “${pre.title}” first` };
      }
    }
  }
  return { locked: false, reason: null };
}

/** The view of the space a student gets: published modules and items, with locks and progress. */
export function studentView(space: Awaited<ReturnType<typeof loadSpace>>, st: StudentState, now = new Date()) {
  const modules = space.modules.filter((m) => m.published);
  const items = space.items.filter((i) => i.published && (!i.assessment_id || i.assessment_status !== 'draft'));
  const out = modules.map((m) => {
    const lock = moduleLock(m, modules, items, st, now);
    const mine = items
      .filter((i) => i.module_id === m.id)
      .map((i) => {
        const itemLocked = lock.locked || (!!i.unlock_at && i.unlock_at > now);
        return { ...i, done: st.done.has(i.id), locked: itemLocked, lock_reason: lock.locked ? lock.reason : itemLocked ? `Opens ${i.unlock_at!.toISOString()}` : null };
      });
    return { ...m, locked: lock.locked, lock_reason: lock.reason, items: mine, done: mine.length > 0 && mine.every((i) => i.done) };
  });
  const all = out.flatMap((m) => m.items);
  const done = all.filter((i) => i.done).length;
  // where to carry on: the first open item not done yet
  const resume = all.find((i) => !i.done && !i.locked) ?? null;
  return { modules: out, progress: { done, total: all.length, percent: all.length ? Math.round((done / all.length) * 100) : 0 }, resume_item_id: resume?.id ?? null };
}

/** Normalise an item body: sanitise HTML, recognise video links. */
export function prepareItem(b: { kind?: string; body_html?: string; url?: string }) {
  const out: { body_html?: string; video_provider?: string | null; video_ref?: string | null; url?: string } = {};
  if (b.body_html !== undefined) out.body_html = cleanHtml(b.body_html);
  if (b.kind === 'video' && b.url) {
    const v = parseVideoUrl(b.url);
    if (!v) throw badRequest('Use a YouTube, Vimeo, Loom or Google Drive link (or upload the video as a file)', { url: 'unsupported' });
    out.video_provider = v.provider;
    out.video_ref = v.ref;
    out.url = b.url;
  }
  if (b.kind === 'embed' && b.url && !parseVideoUrl(b.url)) {
    // other embeds are shown as links: arbitrary pages can't be framed safely
    out.url = b.url;
  }
  return out;
}

/** Mark an item done for a student (idempotent). */
export async function markDone(institutionId: number, studentId: number, itemId: number) {
  await db.query(
    `INSERT INTO content_progress (student_id, item_id, institution_id, status, percent, completed_at, updated_at)
     VALUES ($1, $2, $3, 'done', 100, now(), now())
     ON CONFLICT (student_id, item_id) DO UPDATE SET status = 'done', percent = 100, completed_at = COALESCE(content_progress.completed_at, now()), updated_at = now()`,
    [studentId, itemId, institutionId]
  );
  const { rows } = await db.query<{ offering_id: number | null }>(`SELECT m.offering_id FROM content_items i JOIN modules m ON m.id = i.module_id WHERE i.id = $1`, [itemId]);
  if (rows[0]?.offering_id) await onProgress(institutionId, rows[0].offering_id, [studentId], `item:${itemId}`);
}

/** After a submission or grade: tick off course-space items linked to the assessment. */
export async function completeAssessmentItems(institutionId: number, assessmentId: number, studentIds: number[], event: 'submit' | 'pass') {
  if (!studentIds.length) return;
  const rule = event === 'submit' ? `('submit', 'view', 'mark_done')` : `('pass', 'submit', 'view', 'mark_done')`;
  await db.query(
    `INSERT INTO content_progress (student_id, item_id, institution_id, status, percent, completed_at, updated_at)
     SELECT s, i.id, $1, 'done', 100, now(), now() FROM content_items i CROSS JOIN unnest($3::int[]) s
      WHERE i.assessment_id = $2 AND i.completion IN ${rule}
     ON CONFLICT (student_id, item_id) DO UPDATE SET status = 'done', percent = 100, completed_at = COALESCE(content_progress.completed_at, now()), updated_at = now()`,
    [institutionId, assessmentId, studentIds]
  );
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM assessments WHERE id = $1`, [assessmentId]);
  if (rows[0]) await onProgress(institutionId, rows[0].offering_id, studentIds, `${event}:${assessmentId}`);
}

/**
 * Copy modules and items from one space to another (blueprint → course, course → blueprint,
 * or pushing blueprint updates). With `update`, items already copied are refreshed unless the
 * course changed them locally; new ones are added.
 */
export async function copySpace(institutionId: number, from: Owner, to: Owner, { update = false } = {}) {
  const src = await loadSpace(from);
  const target = await loadSpace(to);
  const { rows: srcBodies } = await db.query<{ id: number; body_html: string; body_json: unknown }>(
    `SELECT i.id, i.body_html, i.body_json FROM content_items i JOIN modules m ON m.id = i.module_id WHERE ${ownerWhere(from)}`
  );
  const body = new Map(srcBodies.map((b) => [b.id, b]));
  const moduleMap = new Map<number, number>();
  let added = 0;
  let updated = 0;
  for (const m of src.modules) {
    const existing = update ? await db.query<{ id: number }>(`SELECT id FROM modules m WHERE ${ownerWhere(to)} AND source_module_id = $1`, [m.id]) : { rows: [] };
    let mid = existing.rows[0]?.id;
    if (mid) {
      await db.query(`UPDATE modules SET title = $2, description = $3, unlock_at = $4, mastery_percent = $5, updated_at = now() WHERE id = $1`, [mid, m.title, m.description, m.unlock_at, m.mastery_percent]);
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO modules (institution_id, offering_id, blueprint_id, title, description, position, published, unlock_at, mastery_percent, source_module_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [institutionId, to.offeringId ?? null, to.blueprintId ?? null, m.title, m.description, target.modules.length + m.position, m.published, m.unlock_at, m.mastery_percent, m.id]
      );
      mid = rows[0]!.id;
    }
    moduleMap.set(m.id, mid);
  }
  // prerequisites point at the copies
  for (const m of src.modules) {
    if (m.prerequisite_module_id && moduleMap.has(m.prerequisite_module_id)) {
      await db.query(`UPDATE modules SET prerequisite_module_id = $2 WHERE id = $1`, [moduleMap.get(m.id), moduleMap.get(m.prerequisite_module_id)]);
    }
  }
  for (const i of src.items) {
    // assessments, live classes and packages belong to one course: only content is copied
    if (['assessment', 'live'].includes(i.kind)) continue;
    const b = body.get(i.id);
    const mid = moduleMap.get(i.module_id)!;
    const existing = update ? await db.query<{ id: number; locally_modified: boolean }>(`SELECT id, locally_modified FROM content_items WHERE module_id = $1 AND source_item_id = $2`, [mid, i.id]) : { rows: [] };
    const ex = existing.rows[0];
    if (ex) {
      if (ex.locally_modified) continue;
      await db.query(
        `UPDATE content_items SET title = $2, body_html = $3, body_json = $4, url = $5, file_id = $6, video_provider = $7, video_ref = $8, completion = $9, duration_minutes = $10, updated_at = now() WHERE id = $1`,
        [ex.id, i.title, b?.body_html ?? '', b?.body_json ?? null, i.url, i.file_id, i.video_provider, i.video_ref, i.completion, i.duration_minutes]
      );
      updated++;
    } else {
      await db.query(
        `INSERT INTO content_items (institution_id, module_id, kind, title, body_html, body_json, url, file_id, video_provider, video_ref, scorm_package_id, position, published, unlock_at, completion, duration_minutes, source_item_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [institutionId, mid, i.kind, i.title, b?.body_html ?? '', b?.body_json ?? null, i.url, i.file_id, i.video_provider, i.video_ref, i.scorm_package_id, i.position, i.published, i.unlock_at, i.completion, i.duration_minutes, i.id]
      );
      added++;
    }
  }
  return { modules: moduleMap.size, added, updated };
}
