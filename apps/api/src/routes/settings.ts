// Institution settings: profile, type and terminology, grading schemes, custom fields, and the
// onboarding wizard that applies an institution type's smart defaults. Mounted under
// /api/institution.
import { Router, type Request } from 'express';
import {
  GRADING_PRESETS,
  INSTITUTION_DEFAULTS,
  TERMINOLOGY_PACKS,
  academicYearFor,
  customFieldBody,
  gradingSchemeBody,
  id,
  institutionProfileBody,
  institutionSettings,
  onboardingApplyBody,
  resolveTerminology,
  updateCustomFieldBody,
  type InstitutionType,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { isUniqueViolation } from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission } from '../middleware/auth';

const router = Router();
router.use(auth);
const manage = requirePermission('settings.manage');

async function loadInstitution(req: Request) {
  const { rows } = await db.query(
    `SELECT id, name, slug, type, logo_url, primary_color, contact_email, phone, address, plan, status, currency, timezone, locale,
            country, settings, onboarded_at, group_id
       FROM institutions WHERE id = $1`,
    [institutionId(req)]
  );
  const inst = rows[0];
  if (!inst) throw notFound();
  const settings = institutionSettings.parse(inst.settings ?? {});
  return { ...inst, settings, terminology: resolveTerminology(inst.type as InstitutionType, settings.terminology) };
}

/** Everyone in the institution needs the labels; the full profile is for settings.manage. */
router.get('/terminology', async (req, res) => {
  const inst = await loadInstitution(req);
  res.json({ type: inst.type, terminology: inst.terminology });
});

router.get('/settings', manage, async (req, res) => {
  res.json({ ...(await loadInstitution(req)), packs: TERMINOLOGY_PACKS });
});

router.patch('/settings', manage, async (req, res) => {
  const b = institutionProfileBody.parse(req.body);
  const params: unknown[] = [institutionId(req)];
  const sets = Object.entries(b).map(([k, v]) => {
    params.push(k === 'settings' ? JSON.stringify(v) : v);
    return `${k} = $${params.length}${k === 'settings' ? '::jsonb' : ''}`;
  });
  await db.query(`UPDATE institutions SET ${sets.join(', ')} WHERE id = $1`, params);
  res.json(await loadInstitution(req));
});

// ---------------------------------------------------------------- grading schemes

router.get('/grading-schemes', requirePermission('structure.read'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.*, (SELECT count(*)::int FROM programs p WHERE p.grading_scheme_id = g.id) programs
       FROM grading_schemes g WHERE g.institution_id = $1 ORDER BY g.is_default DESC, g.name`,
    [institutionId(req)]
  );
  res.json({ schemes: rows, presets: GRADING_PRESETS });
});

async function saveScheme(req: Request, schemeId: number | null) {
  const b = gradingSchemeBody.parse(req.body);
  const s = institutionId(req);
  const bands = [...b.bands].sort((x, y) => y.min - x.min);
  return withTransaction(async () => {
    if (b.is_default) await db.query(`UPDATE grading_schemes SET is_default = false WHERE institution_id = $1 AND id IS DISTINCT FROM $2`, [s, schemeId]);
    try {
      const { rows } = schemeId
        ? await db.query(
            `UPDATE grading_schemes SET name = $3, kind = $4, bands = $5, gpa_scale = $6, pass_percent = $7, is_default = $8
              WHERE id = $1 AND institution_id = $2 RETURNING *`,
            [schemeId, s, b.name, b.kind, JSON.stringify(bands), b.gpa_scale ?? null, b.pass_percent, b.is_default]
          )
        : await db.query(
            `INSERT INTO grading_schemes (institution_id, name, kind, bands, gpa_scale, pass_percent, is_default)
             VALUES ($1,$2,$3,$4,$5,$6, $7 OR NOT EXISTS (SELECT 1 FROM grading_schemes WHERE institution_id = $1)) RETURNING *`,
            [s, b.name, b.kind, JSON.stringify(bands), b.gpa_scale ?? null, b.pass_percent, b.is_default]
          );
      if (!rows[0]) throw notFound();
      return rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A grading scheme with this name already exists');
      throw e;
    }
  });
}

router.post('/grading-schemes', manage, async (req, res) => {
  res.status(201).json(await saveScheme(req, null));
});

router.put('/grading-schemes/:id', manage, async (req, res) => {
  res.json(await saveScheme(req, id.parse(req.params.id)));
});

router.delete('/grading-schemes/:id', manage, async (req, res) => {
  const schemeId = id.parse(req.params.id);
  const { rows } = await db.query<{ is_default: boolean; programs: number }>(
    `SELECT is_default, (SELECT count(*)::int FROM programs WHERE grading_scheme_id = g.id) programs FROM grading_schemes g WHERE id = $1 AND institution_id = $2`,
    [schemeId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  if (rows[0].is_default) throw conflict('The default grading scheme cannot be deleted — make another one the default first');
  if (rows[0].programs) throw conflict(`${rows[0].programs} programs use this scheme`, 'IN_USE');
  await db.query(`DELETE FROM grading_schemes WHERE id = $1`, [schemeId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- custom fields

router.get('/custom-fields', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM custom_fields WHERE institution_id = $1 ORDER BY entity, sort, label`, [institutionId(req)]);
  res.json(rows);
});

router.post('/custom-fields', manage, async (req, res) => {
  const b = customFieldBody.parse(req.body);
  try {
    const { rows } = await db.query(
      `INSERT INTO custom_fields (institution_id, entity, key, label, field_type, options, required, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [institutionId(req), b.entity, b.key, b.label, b.field_type, JSON.stringify(b.options), b.required, b.sort]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A field with this key already exists');
    throw e;
  }
});

router.patch('/custom-fields/:id', manage, async (req, res) => {
  const b = updateCustomFieldBody.parse(req.body);
  const params: unknown[] = [id.parse(req.params.id), institutionId(req)];
  const sets = Object.entries(b).map(([k, v]) => (params.push(k === 'options' ? JSON.stringify(v) : v), `${k} = $${params.length}`));
  const { rows } = await db.query(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
  if (!rows[0]) throw notFound();
  if (rows[0].field_type === 'select' && !rows[0].options.length) throw badRequest('A choice field needs options');
  res.json(rows[0]);
});

/** Removing a field definition keeps the stored values (they reappear if the field is re-added). */
router.delete('/custom-fields/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM custom_fields WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- onboarding

router.get('/onboarding', manage, async (req, res) => {
  const inst = await loadInstitution(req);
  const s = institutionId(req);
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM campuses WHERE institution_id = $1) campuses,
            (SELECT count(*)::int FROM academic_years WHERE institution_id = $1) academic_years,
            (SELECT count(*)::int FROM grading_schemes WHERE institution_id = $1) grading_schemes,
            (SELECT count(*)::int FROM programs WHERE institution_id = $1) programs,
            (SELECT count(*)::int FROM sections WHERE institution_id = $1) sections,
            (SELECT count(*)::int FROM courses WHERE institution_id = $1) courses,
            (SELECT count(*)::int FROM students WHERE institution_id = $1) students,
            (SELECT count(*)::int FROM teachers WHERE institution_id = $1) staff`,
    [s]
  );
  const today = todayIn(await institutionTimeZone(s));
  const preview = Object.fromEntries(
    Object.entries(INSTITUTION_DEFAULTS).map(([type, d]) => [
      type,
      { ...d, year: academicYearFor(d, today), grading_scheme: GRADING_PRESETS[d.grading], terminology: TERMINOLOGY_PACKS[type as InstitutionType] },
    ])
  );
  res.json({ institution: inst, counts: rows[0], done: !!inst.onboarded_at, defaults: preview });
});

/** Apply the type's defaults. Safe to run again: only creates what is missing. */
router.post('/onboarding/apply', manage, async (req, res) => {
  const b = onboardingApplyBody.parse(req.body);
  const s = institutionId(req);
  const d = INSTITUTION_DEFAULTS[b.type];
  const today = todayIn(await institutionTimeZone(s));
  const created: Record<string, number> = { campuses: 0, academic_years: 0, terms: 0, grading_schemes: 0, programs: 0, levels: 0 };
  await withTransaction(async (client) => {
    await client.query(`UPDATE institutions SET type = $2 WHERE id = $1`, [s, b.type]);
    const { rows: hasCampus } = await client.query(`SELECT 1 FROM campuses WHERE institution_id = $1 LIMIT 1`, [s]);
    if (!hasCampus.length) {
      await client.query(
        `INSERT INTO campuses (institution_id, name, code, address, phone, is_main)
         SELECT id, 'Main campus', 'MAIN', COALESCE(address, ''), COALESCE(phone, ''), true FROM institutions WHERE id = $1`,
        [s]
      );
      created.campuses!++;
    }
    for (const c of b.campuses) {
      const r = await client.query(
        `INSERT INTO campuses (institution_id, name, code) VALUES ($1,$2,$3) ON CONFLICT ON CONSTRAINT campuses_institution_id_code_key DO NOTHING`,
        [s, c.name, c.code]
      );
      created.campuses! += r.rowCount ?? 0;
    }
    if (b.grading) {
      const { rows } = await client.query(`SELECT 1 FROM grading_schemes WHERE institution_id = $1 LIMIT 1`, [s]);
      if (!rows.length) {
        const p = GRADING_PRESETS[d.grading];
        await client.query(
          `INSERT INTO grading_schemes (institution_id, name, kind, bands, gpa_scale, pass_percent, is_default) VALUES ($1,$2,$3,$4,$5,$6,true)`,
          [s, p.name, p.kind, JSON.stringify(p.bands), 'gpa_scale' in p ? p.gpa_scale : null, p.pass_percent]
        );
        created.grading_schemes!++;
      }
    }
    if (b.academic_year) {
      const layout = academicYearFor(d, today);
      const { rows: existing } = await client.query(`SELECT 1 FROM academic_years WHERE institution_id = $1 AND name = $2`, [s, layout.name]);
      if (!existing.length) {
        const { rows: cur } = await client.query(`SELECT 1 FROM academic_years WHERE institution_id = $1 AND is_current`, [s]);
        const { rows: y } = await client.query<{ id: number }>(
          `INSERT INTO academic_years (institution_id, name, starts_on, ends_on, status, is_current) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
          [s, layout.name, layout.startsOn, layout.endsOn, cur.length === 0]
        );
        created.academic_years!++;
        for (const t of layout.terms) {
          await client.query(
            `INSERT INTO terms (institution_id, academic_year_id, name, kind, sequence, starts_on, ends_on, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [s, y[0]!.id, t.name, d.termKind, t.sequence, t.startsOn, t.endsOn, t.startsOn <= today ? 'active' : 'planned']
          );
          created.terms!++;
        }
      }
    }
    const wanted = b.programs ? d.programs.filter((p) => b.programs!.includes(p.code)) : d.programs;
    for (const p of wanted) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO programs (institution_id, name, code) VALUES ($1,$2,$3) ON CONFLICT ON CONSTRAINT programs_institution_id_code_key DO NOTHING RETURNING id`,
        [s, p.name, p.code]
      );
      if (!rows[0]) continue;
      created.programs!++;
      const r = await client.query(
        `INSERT INTO program_levels (institution_id, program_id, name, sequence) SELECT $1, $2, name, ord FROM unnest($3::text[]) WITH ORDINALITY AS l(name, ord)`,
        [s, rows[0].id, p.levels]
      );
      created.levels! += r.rowCount ?? 0;
    }
  });
  res.json({ created, institution: await loadInstitution(req) });
});

router.post('/onboarding/complete', manage, async (req, res) => {
  await db.query(`UPDATE institutions SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1`, [institutionId(req)]);
  res.json({ ok: true, by: currentUser(req).id });
});

export default router;
