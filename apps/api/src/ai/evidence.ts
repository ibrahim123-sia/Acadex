// Learning-process evidence instead of "AI detection": how a piece of work was written (draft
// versions, active time, typing and pasting), whether it is close to another submission in the
// same class, and the student's own explanation in a mini-viva. No "% AI-written" score.
import { db } from '../db/context';

const words = (html: string) => html.replace(/<[^>]+>/g, ' ').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Overlapping 5-word phrases. */
export function shingles(text: string, n = 5): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Pairs of submissions in an assessment that share much of their wording. */
export async function similarity(assessmentId: number, threshold = 0.25) {
  const { rows } = await db.query<{ submission_id: number; student_id: number | null; name: string | null; text_html: string }>(
    `SELECT DISTINCT ON (s.student_id, s.group_id) s.id AS submission_id, s.student_id, st.first_name || ' ' || st.last_name AS name,
            COALESCE((SELECT v.text_html FROM submission_versions v WHERE v.submission_id = s.id ORDER BY v.version DESC LIMIT 1), '') AS text_html
       FROM submissions s LEFT JOIN students st ON st.id = s.student_id
      WHERE s.assessment_id = $1 AND s.status <> 'draft' ORDER BY s.student_id, s.group_id, s.attempt DESC`,
    [assessmentId]
  );
  const sets = rows.map((r) => ({ ...r, sh: shingles(r.text_html) })).filter((r) => r.sh.size >= 10);
  const pairs: { a: { submission_id: number; name: string | null }; b: { submission_id: number; name: string | null }; similarity: number; shared: string[] }[] = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const s = jaccard(sets[i]!.sh, sets[j]!.sh);
      if (s >= threshold) {
        const shared = [...sets[i]!.sh].filter((x) => sets[j]!.sh.has(x)).slice(0, 5);
        pairs.push({ a: { submission_id: sets[i]!.submission_id, name: sets[i]!.name }, b: { submission_id: sets[j]!.submission_id, name: sets[j]!.name }, similarity: Math.round(s * 100) / 100, shared });
      }
    }
  return { compared: sets.length, pairs: pairs.sort((x, y) => y.similarity - x.similarity) };
}

/** Everything about how one submission came to be. */
export async function processReport(submissionId: number) {
  const { rows: sub } = await db.query<{ id: number; assessment_id: number; student_id: number | null; submitted_at: Date | null; status: string }>(
    `SELECT id, assessment_id, student_id, submitted_at, status FROM submissions WHERE id = $1`,
    [submissionId]
  );
  if (!sub[0]) return null;
  const { rows: versions } = await db.query<{ version: number; created_at: Date; text_html: string; file_ids: number[] }>(
    `SELECT version, created_at, text_html, file_ids FROM submission_versions WHERE submission_id = $1 ORDER BY version`,
    [submissionId]
  );
  const { rows: activity } = await db.query(`SELECT active_seconds, keystrokes, pastes, pasted_chars, sessions, updated_at FROM submission_activity WHERE assessment_id = $1 AND student_id = $2`, [
    sub[0].assessment_id, sub[0].student_id ?? 0,
  ]);
  const { rows: viva } = await db.query(`SELECT id, questions, answers, status, teacher_note, created_at, answered_at FROM viva_sessions WHERE submission_id = $1 ORDER BY id DESC`, [submissionId]);
  const sim = await similarity(sub[0].assessment_id);
  const finalWords = versions.length ? words(versions[versions.length - 1]!.text_html).length : 0;
  const a = activity[0] as { active_seconds: number; keystrokes: number; pastes: number; pasted_chars: number } | undefined;
  // plain observations for the teacher to weigh — never a verdict
  const notes: string[] = [];
  if (versions.length <= 1 && finalWords > 300) notes.push('Handed in as one version (no earlier drafts saved).');
  if (a && a.pasted_chars > 0 && finalWords > 0) {
    const share = Math.min(1, a.pasted_chars / Math.max(1, versions.length ? versions[versions.length - 1]!.text_html.replace(/<[^>]+>/g, '').length : 1));
    if (share > 0.5) notes.push(`About ${Math.round(share * 100)}% of the text was pasted in.`);
  }
  if (a && finalWords > 200 && a.active_seconds < finalWords * 0.6) notes.push(`About ${Math.round(a.active_seconds / 60)} minutes of active writing for ${finalWords} words.`);
  const mine = sim.pairs.filter((p) => p.a.submission_id === submissionId || p.b.submission_id === submissionId);
  if (mine.length) notes.push(`Wording overlaps with ${mine.length} other submission(s) in the class.`);
  return {
    submission: sub[0],
    versions: versions.map((v) => ({ version: v.version, at: v.created_at, words: words(v.text_html).length, files: v.file_ids?.length ?? 0 })),
    activity: activity[0] ?? null,
    similar: mine,
    viva,
    notes,
  };
}
