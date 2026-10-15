// Bringing content in: IMS Common Cartridge, Moodle backups (.mbz), QTI question files,
// Google Classroom (behind a provider), SCORM packages with playback, a minimal xAPI record
// store, starter templates and links to open educational resources. Mounted under /api.
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { classroomImportBody, id, importContentQuery } from '@acadex/shared';
import { asSystem, db, withTransaction } from '../db/context';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { cleanHtml, escapeHtml } from '../lib/html';
import { assertCourseEditor, assertCourseMember } from '../lib/lms/access';
import { joinPath, list, parseQti, readArchive, readZip, txt, xml, type Archive } from '../lib/lms/packages';
import { onProgress } from '../lib/lms/rewards';
import { launchToken, loadManifest, runtimeScript, scormOutcome, storeScormPackage, verifyLaunch } from '../lib/lms/scorm';
import { OER_LIBRARIES, STARTER_TEMPLATES, classroomProvider } from '../lib/lms/templates';
import { markDone } from '../lib/lms/space';
import { oneFile, requireFile } from '../lib/upload';
import { storage } from '../storage';
import { currentUser, institutionId, requirePermission } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------- building blocks

interface Ctx {
  s: number;
  offeringId: number;
  userId: number;
  summary: { modules: number; pages: number; links: number; files: number; assessments: number; questions: number; discussions: number; skipped: string[] };
}

async function addModule(c: Ctx, title: string, description = '') {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO modules (institution_id, offering_id, title, description, published, position) VALUES ($1,$2,$3,$4,false, (SELECT COALESCE(max(position) + 1, 0) FROM modules WHERE offering_id = $2)) RETURNING id`,
    [c.s, c.offeringId, title.slice(0, 200) || 'Imported', description.slice(0, 2000)]
  );
  c.summary.modules++;
  return rows[0]!.id;
}

async function addItem(c: Ctx, moduleId: number, item: { kind: string; title: string; body_html?: string; url?: string; file_id?: number; assessment_id?: number; completion?: string }) {
  await db.query(
    `INSERT INTO content_items (institution_id, module_id, kind, title, body_html, url, file_id, assessment_id, completion, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, (SELECT COALESCE(max(position) + 1, 0) FROM content_items WHERE module_id = $2))`,
    [c.s, moduleId, item.kind, item.title.slice(0, 200) || 'Untitled', cleanHtml(item.body_html ?? ''), item.url ?? '', item.file_id ?? null, item.assessment_id ?? null, item.completion ?? 'view']
  );
  if (item.kind === 'page') c.summary.pages++;
  else if (item.kind === 'link') c.summary.links++;
  else if (item.kind === 'file') c.summary.files++;
}

async function addFile(c: Ctx, name: string, data: Uint8Array) {
  const { storeUpload } = await import('../storage/files');
  try {
    const f = await storeUpload({ institutionId: c.s, userId: c.userId, purpose: 'course', body: Buffer.from(data), originalName: name.split('/').pop() ?? name });
    return f.id;
  } catch (e) {
    c.summary.skipped.push(`${name}: ${(e as Error).message}`);
    return null;
  }
}

async function addAssessment(c: Ctx, a: { kind: string; title: string; instructions_html: string; points: number }) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO assessments (institution_id, offering_id, kind, title, instructions_html, points, status, submission_types, quiz, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING id`,
    [c.s, c.offeringId, a.kind, a.title.slice(0, 200), cleanHtml(a.instructions_html), a.points, a.kind === 'quiz' ? ['none'] : ['text', 'file'], a.kind === 'quiz' ? JSON.stringify({ time_limit_minutes: null, shuffle_questions: false, shuffle_options: true, one_at_a_time: false, show_results: 'after_release', scoring: 'highest' }) : null, c.userId]
  );
  c.summary.assessments++;
  return rows[0]!.id;
}

/** Questions into a bank of the course, and (optionally) onto a quiz. */
async function addQuestions(c: Ctx, title: string, qs: ReturnType<typeof parseQti>['questions'], quizId?: number) {
  if (!qs.length) return;
  const { rows: course } = await db.query<{ course_id: number }>(`SELECT course_id FROM course_offerings WHERE id = $1`, [c.offeringId]);
  const { rows } = await db.query<{ id: number }>(`INSERT INTO question_banks (institution_id, course_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [c.s, course[0]!.course_id, title.slice(0, 200), c.userId]);
  for (const [i, q] of qs.entries()) {
    const { rows: qr } = await db.query<{ id: number }>(
      `INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [c.s, rows[0]!.id, q.type, cleanHtml(q.prompt_html), JSON.stringify(q.data), q.points, c.userId]
    );
    if (quizId) await db.query(`INSERT INTO assessment_questions (institution_id, assessment_id, question_id, position) VALUES ($1,$2,$3,$4)`, [c.s, quizId, qr[0]!.id, i]);
    c.summary.questions++;
  }
}

const decode = (d: Uint8Array | undefined) => (d ? new TextDecoder().decode(d) : '');
const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

// ---------------------------------------------------------------- Common Cartridge

async function importCartridge(c: Ctx, zip: Archive) {
  const doc = xml(zip.get('imsmanifest.xml')) as { manifest?: Record<string, unknown> };
  const m = doc.manifest;
  if (!m) throw badRequest('Not a Common Cartridge (imsmanifest.xml is missing)');
  const resources = new Map(list<Record<string, unknown>>((m.resources as Record<string, unknown>)?.resource).map((r) => [String(r['@identifier']), r]));
  const org = list<Record<string, unknown>>((m.organizations as Record<string, unknown>)?.organization)[0];
  const root = list<Record<string, unknown>>(org?.item)[0];
  const top = list<Record<string, unknown>>(root?.item ?? org?.item);
  const handle = async (moduleId: number, it: Record<string, unknown>) => {
    const title = txt(it.title);
    const res = resources.get(String(it['@identifierref'] ?? ''));
    if (!res) {
      for (const child of list<Record<string, unknown>>(it.item)) await handle(moduleId, child);
      return;
    }
    const type = String(res['@type'] ?? '');
    const href = String(res['@href'] ?? list<Record<string, unknown>>(res.file)[0]?.['@href'] ?? '');
    if (type === 'webcontent') {
      if (/\.html?$/i.test(href)) {
        let html = bodyOf(decode(zip.get(href)));
        // images inside the cartridge become course files
        const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((x) => x[1]!).filter((src) => !/^https?:|^data:/i.test(src));
        for (const src of imgs) {
          const p = joinPath(href, src.replace(/^\$IMS-CC-FILEBASE\$\/?/, ''));
          const data = zip.get(p);
          if (!data) continue;
          const fid = await addFile(c, p, data);
          if (fid) html = html.split(src).join(`/api/files/${fid}`);
        }
        await addItem(c, moduleId, { kind: 'page', title, body_html: html });
      } else if (zip.get(href)) {
        const fid = await addFile(c, href, zip.get(href)!);
        if (fid) await addItem(c, moduleId, { kind: 'file', title, file_id: fid });
      } else c.summary.skipped.push(`${title}: file ${href} missing`);
    } else if (/imswl/.test(type)) {
      const wl = xml(zip.get(href)) as { webLink?: Record<string, unknown> };
      const url = String((wl.webLink?.url as Record<string, unknown>)?.['@href'] ?? '');
      if (/^https?:\/\//.test(url)) await addItem(c, moduleId, { kind: 'link', title: title || txt(wl.webLink?.title), url });
      else c.summary.skipped.push(`${title}: link without a web address`);
    } else if (/imsqti|assessment/.test(type)) {
      const qti = parseQti(xml(zip.get(href)));
      const quizId = await addAssessment(c, { kind: 'quiz', title: title || qti.title, instructions_html: '', points: Math.max(1, qti.questions.length) });
      await addQuestions(c, title || qti.title, qti.questions, quizId);
      if (qti.skipped) c.summary.skipped.push(`${title}: ${qti.skipped} question(s) of a type that could not be read`);
      await addItem(c, moduleId, { kind: 'assessment', title, assessment_id: quizId, completion: 'submit' });
    } else if (/imsdt/.test(type)) {
      const dt = xml(zip.get(href)) as { topic?: Record<string, unknown> };
      await db.query(`INSERT INTO discussions (institution_id, offering_id, title, body_html, created_by) VALUES ($1,$2,$3,$4,$5)`, [c.s, c.offeringId, (title || txt(dt.topic?.title) || 'Discussion').slice(0, 200), cleanHtml(txt(dt.topic?.text)), c.userId]);
      c.summary.discussions++;
    } else if (/assignment/.test(type)) {
      const a = xml(zip.get(href)) as { assignment?: Record<string, unknown> };
      const aid = await addAssessment(c, { kind: 'assignment', title: title || txt(a.assignment?.title), instructions_html: txt(a.assignment?.text), points: Number(txt((a.assignment?.gradable as Record<string, unknown>)?.['@points_possible'])) || 100 });
      await addItem(c, moduleId, { kind: 'assessment', title, assessment_id: aid, completion: 'submit' });
    } else c.summary.skipped.push(`${title}: ${type} is not supported`);
  };
  for (const it of top) {
    const mid = await addModule(c, txt(it.title));
    if (it['@identifierref']) await handle(mid, it);
    for (const child of list<Record<string, unknown>>(it.item)) await handle(mid, child);
  }
}

// ---------------------------------------------------------------- Moodle backup

async function importMoodle(c: Ctx, arc: Archive) {
  const mb = xml(arc.get('moodle_backup.xml')) as { moodle_backup?: { information?: Record<string, unknown> } };
  const info = mb.moodle_backup?.information;
  if (!info) throw badRequest('Not a Moodle backup (moodle_backup.xml is missing)');
  const contents = (info.contents ?? {}) as Record<string, unknown>;
  const sections = list<Record<string, unknown>>((contents.sections as Record<string, unknown>)?.section);
  const activities = list<Record<string, unknown>>((contents.activities as Record<string, unknown>)?.activity);
  // files: contenthash → stored under files/xx/hash
  const filesXml = xml(arc.get('files.xml')) as { files?: { file?: unknown } };
  const fileRows = list<Record<string, unknown>>(filesXml.files?.file).filter((f) => txt(f.filename) !== '.');
  const moduleFor = new Map<string, number>();
  for (const s of sections) {
    const dir = txt(s.directory);
    const sx = xml(arc.get(`${dir}/section.xml`)) as { section?: Record<string, unknown> };
    const name = txt(sx.section?.name) || txt(s.title) || `Section ${txt(sx.section?.number)}`;
    moduleFor.set(txt(s.sectionid), await addModule(c, name === '$@NULL@$' ? 'General' : name, txt(sx.section?.summary).replace(/<[^>]+>/g, ' ').trim()));
  }
  for (const a of activities) {
    const mod = txt(a.modulename);
    const dir = txt(a.directory);
    const moduleId = moduleFor.get(txt(a.sectionid)) ?? (await addModule(c, 'Imported'));
    const ax = xml(arc.get(`${dir}/${mod}.xml`)) as { activity?: Record<string, unknown> };
    const act = (ax.activity?.[mod] ?? {}) as Record<string, unknown>;
    const name = txt(act.name) || txt(a.title);
    if (mod === 'page') await addItem(c, moduleId, { kind: 'page', title: name, body_html: txt(act.content) });
    else if (mod === 'label') await addItem(c, moduleId, { kind: 'page', title: name.slice(0, 80) || 'Note', body_html: txt(act.intro) });
    else if (mod === 'url') {
      const url = txt(act.externalurl);
      if (/^https?:\/\//.test(url)) await addItem(c, moduleId, { kind: 'link', title: name, url });
      else c.summary.skipped.push(`${name}: link without a web address`);
    } else if (mod === 'resource') {
      const ctxId = String(ax.activity?.['@contextid'] ?? '');
      const f = fileRows.find((r) => txt(r.contextid) === ctxId && txt(r.component) === 'mod_resource' && txt(r.filearea) === 'content');
      const hash = f ? txt(f.contenthash) : '';
      const data = hash ? arc.get(`files/${hash.slice(0, 2)}/${hash}`) : undefined;
      if (f && data) {
        const fid = await addFile(c, txt(f.filename), data);
        if (fid) await addItem(c, moduleId, { kind: 'file', title: name, file_id: fid });
      } else c.summary.skipped.push(`${name}: file missing from the backup`);
    } else if (mod === 'assign') {
      const aid = await addAssessment(c, { kind: 'assignment', title: name, instructions_html: txt(act.intro), points: Math.abs(Number(txt(act.grade))) || 100 });
      await addItem(c, moduleId, { kind: 'assessment', title: name, assessment_id: aid, completion: 'submit' });
    } else if (mod === 'quiz') {
      const aid = await addAssessment(c, { kind: 'quiz', title: name, instructions_html: txt(act.intro), points: Number(txt(act.grade)) || 10 });
      await addItem(c, moduleId, { kind: 'assessment', title: name, assessment_id: aid, completion: 'submit' });
      c.summary.skipped.push(`${name}: quiz created without its questions (export them from Moodle as Moodle XML or QTI and import into the question bank)`);
    } else if (mod === 'forum') {
      await db.query(`INSERT INTO discussions (institution_id, offering_id, title, body_html, created_by) VALUES ($1,$2,$3,$4,$5)`, [c.s, c.offeringId, name.slice(0, 200) || 'Forum', cleanHtml(txt(act.intro)), c.userId]);
      c.summary.discussions++;
    } else c.summary.skipped.push(`${name}: Moodle ${mod} activities are not imported`);
  }
}

// ---------------------------------------------------------------- import endpoints

async function recordImport(c: Ctx, format: string, fileName: string, status: 'completed' | 'failed', extra: Record<string, unknown> = {}) {
  await db.query(`INSERT INTO content_imports (institution_id, offering_id, format, file_name, status, summary, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    c.s, c.offeringId, format, fileName.slice(0, 200), status, JSON.stringify({ ...c.summary, ...extra }), c.userId,
  ]);
}

const newCtx = (req: Request, offeringId: number): Ctx => ({
  s: institutionId(req),
  offeringId,
  userId: currentUser(req).id,
  summary: { modules: 0, pages: 0, links: 0, files: 0, assessments: 0, questions: 0, discussions: 0, skipped: [] },
});

router.post('/courses/:id/import', requirePermission('content.import'), oneFile(300), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { format } = importContentQuery.parse(req.query);
  if (format === 'scorm') throw badRequest('Add SCORM packages with the SCORM upload');
  const file = requireFile(req);
  const c = newCtx(req, offeringId);
  // everything lands unpublished, so the teacher can check it before students see it
  await withTransaction(async () => {
    if (format === 'imscc') await importCartridge(c, readZip(file.buffer));
    else if (format === 'mbz') await importMoodle(c, readArchive(file.buffer));
    else {
      const isZip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
      const docs = isZip ? [...readZip(file.buffer)].filter(([k]) => k.endsWith('.xml') && !/imsmanifest/i.test(k)).map(([, v]) => v) : [new Uint8Array(file.buffer)];
      for (const d of docs) {
        const q = parseQti(xml(d));
        await addQuestions(c, q.title, q.questions);
        if (q.skipped) c.summary.skipped.push(`${q.skipped} question(s) of a type that could not be read`);
      }
      if (!c.summary.questions) throw badRequest('No questions could be read from this file (QTI 1.2 or 2.x expected)');
    }
    await recordImport(c, format, file.originalname, 'completed');
  });
  res.status(201).json(c.summary);
});

router.post('/courses/:id/import/classroom', requirePermission('content.import'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { course_ref } = classroomImportBody.parse(req.body);
  const provider = classroomProvider();
  if (!provider) throw badRequest('Google Classroom import needs the institution’s Google Workspace connection (CLASSROOM_DRIVER). Until then, export from Classroom to Google Drive and upload the files.', { code: 'NOT_CONFIGURED' });
  const work = await provider.courseWork(course_ref);
  const c = newCtx(req, offeringId);
  await withTransaction(async () => {
    const topics = new Map<string, number>();
    for (const w of work.items) {
      const topic = w.topic ?? work.courseName;
      if (!topics.has(topic)) topics.set(topic, await addModule(c, topic));
      const mid = topics.get(topic)!;
      if (w.kind === 'material') {
        await addItem(c, mid, { kind: 'page', title: w.title, body_html: `<p>${escapeHtml(w.description)}</p>` });
        for (const l of w.links) await addItem(c, mid, { kind: 'link', title: l.title, url: l.url });
      } else {
        const aid = await addAssessment(c, { kind: 'assignment', title: w.title, instructions_html: `<p>${escapeHtml(w.description)}</p>`, points: w.points ?? 100 });
        await addItem(c, mid, { kind: 'assessment', title: w.title, assessment_id: aid, completion: 'submit' });
      }
    }
    await recordImport(c, 'classroom', course_ref, 'completed');
  });
  res.status(201).json(c.summary);
});

router.get('/courses/:id/imports', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { rows } = await db.query(`SELECT i.*, u.full_name AS by FROM content_imports i LEFT JOIN users u ON u.id = i.created_by WHERE i.offering_id = $1 ORDER BY i.created_at DESC`, [offeringId]);
  res.json(rows);
});

// ---------------------------------------------------------------- templates & OER

router.get('/course-templates', (_req, res) => {
  res.json(STARTER_TEMPLATES.map((t) => ({ key: t.key, title: t.title, description: t.description, modules: t.modules.length })));
});

router.post('/courses/:id/apply-template', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { key } = z.object({ key: z.string() }).parse(req.body);
  const t = STARTER_TEMPLATES.find((x) => x.key === key);
  if (!t) throw notFound('Unknown template');
  const c = newCtx(req, offeringId);
  await withTransaction(async () => {
    for (const m of t.modules) {
      const mid = await addModule(c, m.title);
      for (const it of m.items) await addItem(c, mid, it);
    }
  });
  res.status(201).json(c.summary);
});

router.get('/oer', (req, res) => {
  const q = String(req.query.subject ?? '').toLowerCase();
  res.json(OER_LIBRARIES.filter((l) => !q || l.subjects.some((s) => s.includes(q) || s === 'all')));
});

// ---------------------------------------------------------------- SCORM

router.post('/courses/:id/scorm', requirePermission('content.import'), oneFile(300), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const moduleId = id.parse(req.query.module_id ?? req.body?.module_id);
  const { rows: m } = await db.query(`SELECT 1 FROM modules WHERE id = $1 AND offering_id = $2`, [moduleId, offeringId]);
  if (!m[0]) throw badRequest('Choose a module of this course', { module_id: 'invalid' });
  const file = requireFile(req);
  const s = institutionId(req);
  const prefix = `scorm/${s}/${crypto.randomUUID()}`;
  const manifest = await storeScormPackage(s, prefix, file.buffer);
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO scorm_packages (institution_id, title, version, launch_path, storage_prefix, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [s, manifest.title.slice(0, 200), manifest.version, manifest.launch, prefix, currentUser(req).id]
    );
    const { rows: item } = await db.query<{ id: number }>(
      `INSERT INTO content_items (institution_id, module_id, kind, title, scorm_package_id, completion, position)
       VALUES ($1,$2,'scorm',$3,$4,'pass', (SELECT COALESCE(max(position) + 1, 0) FROM content_items WHERE module_id = $2)) RETURNING id`,
      [s, moduleId, manifest.title.slice(0, 200), rows[0]!.id]
    );
    await db.query(`INSERT INTO content_imports (institution_id, offering_id, format, file_name, status, summary, created_by) VALUES ($1,$2,'scorm',$3,'completed',$4,$5)`, [
      s, offeringId, file.originalname.slice(0, 200), JSON.stringify({ version: manifest.version, files: Object.keys(manifest.files).length }), currentUser(req).id,
    ]);
    return { package_id: rows[0]!.id, item_id: item[0]!.id, version: manifest.version, title: manifest.title };
  });
  res.status(201).json(out);
});

async function scormItem(req: Request, itemId: number) {
  const { rows } = await db.query<{ id: number; offering_id: number; package_id: number; version: '1.2' | '2004'; launch_path: string; storage_prefix: string }>(
    `SELECT i.id, m.offering_id, p.id AS package_id, p.version, p.launch_path, p.storage_prefix
       FROM content_items i JOIN modules m ON m.id = i.module_id JOIN scorm_packages p ON p.id = i.scorm_package_id
      WHERE i.id = $1 AND i.institution_id = $2 AND i.kind = 'scorm'`,
    [itemId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('SCORM item not found');
  return { item: rows[0], access: await assertCourseMember(req, rows[0].offering_id) };
}

/** Where the player frame should load the package from. */
router.get('/scorm/items/:id/launch', async (req, res) => {
  const { item, access } = await scormItem(req, id.parse(req.params.id));
  if (access.role === 'guardian') throw forbidden();
  const studentId = access.role === 'student' ? access.studentIds[0]! : null;
  const token = launchToken({ p: item.package_id, i: item.id, s: studentId, u: currentUser(req).id });
  const { rows } = studentId ? await db.query(`SELECT status, score_percent, updated_at FROM scorm_attempts WHERE package_id = $1 AND student_id = $2 AND item_id = $3`, [item.package_id, studentId, item.id]) : { rows: [] };
  res.json({ url: `/api/scorm/content/${token}/${item.launch_path}`, version: item.version, preview: !studentId, attempt: rows[0] ?? null });
});

/** The player reports the package's data model (the person's own session saves it). */
router.put('/scorm/items/:id/attempt', requirePermission('learner.access'), async (req, res) => {
  const { item, access } = await scormItem(req, id.parse(req.params.id));
  if (access.role !== 'student') return void res.json({ saved: false, preview: true });
  const cmi = z.record(z.string().max(255), z.string().max(64_000)).refine((o) => Object.keys(o).length <= 2000 && JSON.stringify(o).length <= 256_000, 'Too much data').parse(req.body?.cmi);
  const sid = access.studentIds[0]!;
  const o = scormOutcome(item.version, cmi);
  await db.query(
    `INSERT INTO scorm_attempts (institution_id, package_id, item_id, student_id, cmi, status, score_percent, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT ON CONSTRAINT scorm_attempts_package_id_student_id_item_id_key DO UPDATE SET cmi = EXCLUDED.cmi, status = EXCLUDED.status,
       score_percent = COALESCE(EXCLUDED.score_percent, scorm_attempts.score_percent), updated_at = now()`,
    [institutionId(req), item.package_id, item.id, sid, JSON.stringify(cmi), o.status.slice(0, 40), o.score]
  );
  if (o.completed) {
    await markDone(institutionId(req), sid, item.id);
    await onProgress(institutionId(req), item.offering_id, [sid], `scorm:${item.id}`);
  }
  res.json({ saved: true, status: o.status, score: o.score, completed: o.completed });
});

export default router;

// ---------------------------------------------------------------- package files (token, no session)

/** Serves package files under a launch token; mounted before authentication. */
export const scormContentRouter = Router();
scormContentRouter.get('/scorm/content/:token/*path', async (req: Request, res: Response) => {
  const claims = verifyLaunch(String(req.params.token));
  if (!claims) return void res.status(403).type('text').send('This link has expired. Open the activity again from the course.');
  const rel = ([] as string[]).concat((req.params as unknown as { path: string[] | string }).path).join('/');
  const pkg = await asSystem(async () => (await db.query<{ storage_prefix: string; version: '1.2' | '2004' }>(`SELECT storage_prefix, version FROM scorm_packages WHERE id = $1`, [claims.p])).rows[0]);
  if (!pkg) return void res.status(404).end();
  const manifest = await loadManifest(pkg.storage_prefix);
  const entry = manifest.files[decodeURIComponent(rel)];
  if (!entry) return void res.status(404).type('text').send('Not in this package');
  let body = await storage().get(entry.key);
  // sandboxed: the package runs in an opaque origin, away from Acadex and the person's session
  const nonce = crypto.randomBytes(12).toString('base64');
  res.set({
    'Content-Type': entry.type,
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': `sandbox allow-scripts allow-forms allow-popups allow-modals; default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; script-src 'self' https: 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'; frame-ancestors 'self'`,
  });
  res.removeHeader('X-Frame-Options');
  if (entry.type === 'text/html') {
    const { rows } = claims.s
      ? await asSystem(() => db.query<{ cmi: Record<string, string> }>(`SELECT cmi FROM scorm_attempts WHERE package_id = $1 AND student_id = $2 AND item_id IS NOT DISTINCT FROM $3`, [claims.p, claims.s, claims.i]))
      : { rows: [] };
    const html = body.toString('utf8');
    const script = runtimeScript(pkg.version, rows[0]?.cmi ?? {}, nonce);
    const injected = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${script}`) : `${script}${html}`;
    body = Buffer.from(injected, 'utf8');
  }
  res.send(body);
});

// ---------------------------------------------------------------- xAPI (a minimal record store)

const statement = z.object({
  id: z.uuid().optional(),
  actor: z.record(z.string(), z.unknown()),
  verb: z.object({ id: z.string().url().max(500), display: z.record(z.string(), z.string()).optional() }),
  object: z.object({ id: z.string().max(1000) }).passthrough(),
  result: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
});

router.post('/xapi/statements', async (req, res) => {
  const input = Array.isArray(req.body) ? req.body : [req.body];
  if (input.length > 50) throw badRequest('At most 50 statements at a time');
  const parsed = input.map((s) => statement.parse(s));
  const u = currentUser(req);
  const ids: string[] = [];
  for (const s of parsed) {
    const sid = s.id ?? crypto.randomUUID();
    // the actor is always the signed-in person, whatever the statement claims
    const stored = { ...s, id: sid, actor: { objectType: 'Agent', name: u.name, account: { homePage: 'acadex', name: String(u.id) } }, stored: new Date().toISOString() };
    await db.query(`INSERT INTO xapi_statements (id, institution_id, user_id, verb, object_id, statement) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [
      sid, institutionId(req), u.id, s.verb.id, s.object.id, JSON.stringify(stored),
    ]);
    ids.push(sid);
  }
  res.json(ids);
});

router.get('/xapi/statements', async (req, res) => {
  const q = z.object({ verb: z.string().max(500).optional(), activity: z.string().max(1000).optional(), user_id: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
  const u = currentUser(req);
  // people see their own statements; staff with course management see everyone's
  const userFilter = q.user_id && (u.role === 'teacher' || u.role === 'institution_admin') ? q.user_id : u.role === 'teacher' || u.role === 'institution_admin' ? null : u.id;
  const { rows } = await db.query(
    `SELECT statement FROM xapi_statements WHERE institution_id = $1 AND ($2::text IS NULL OR verb = $2) AND ($3::text IS NULL OR object_id = $3) AND ($4::int IS NULL OR user_id = $4)
      ORDER BY stored_at DESC LIMIT $5`,
    [institutionId(req), q.verb ?? null, q.activity ?? null, userFilter, q.limit]
  );
  res.json({ statements: rows.map((r) => r.statement), more: '' });
});
