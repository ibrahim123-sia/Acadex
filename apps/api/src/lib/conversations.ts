// Who may message whom, with the safeguarding rules for students under 18:
//   staff ↔ staff                 always
//   teacher → student / guardian  students they teach, and those students' guardians
//   student → teacher             their own teachers (and the office)
//   student ↔ student             classmates, only when the institution allows it
//   guardian → teacher            their children's teachers (when allowed), the office, their own children
//   office (messages.review or an institution administrator) → anyone in the institution
// A private conversation between an adult and a student under 18 follows the institution's
// minor_dm policy: blocked, allowed with the student's guardians added (the default), or allowed.
import { messagingSettingsBody, type MessagingSettings } from '@acadex/shared';
import { db } from '../db/context';
import { badRequest, forbidden } from './errors';
import type { AuthUser } from '../middleware/auth';
import { can } from '../rbac';

export interface Person {
  id: number;
  role: string;
  full_name: string;
  ref_id: number | null;
  /** students: under 18 (no birth date: schools count as minors) */
  minor: boolean;
  section_id: number | null;
}

export async function messagingSettings(institutionId: number): Promise<MessagingSettings> {
  const { rows } = await db.query<{ m: unknown }>(`SELECT settings->'messaging' AS m FROM institutions WHERE id = $1`, [institutionId]);
  return messagingSettingsBody.parse(rows[0]?.m ?? {});
}

export async function loadPeople(institutionId: number, ids: number[]): Promise<Person[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<Person>(
    `SELECT u.id, u.role, u.full_name, u.ref_id, st.section_id,
            (u.role = 'student' AND CASE WHEN st.dob IS NOT NULL THEN st.dob > (CURRENT_DATE - INTERVAL '18 years')::date
                                         ELSE i.type IN ('school', 'chain') END) AS minor
       FROM users u JOIN institutions i ON i.id = u.institution_id
       LEFT JOIN students st ON u.role = 'student' AND st.id = u.ref_id
      WHERE u.institution_id = $1 AND u.id = ANY($2::int[]) AND u.is_active`,
    [institutionId, ids]
  );
  return rows.map((r) => ({ ...r, minor: !!r.minor }));
}

/** Students a teacher teaches (their sections, or enrolled in their courses). */
async function taughtStudents(institutionId: number, teacherRefId: number | null): Promise<Set<number>> {
  if (!teacherRefId) return new Set();
  const { rows } = await db.query<{ id: number }>(
    `SELECT st.id FROM students st
      WHERE st.institution_id = $1 AND COALESCE(st.status, 'active') = 'active'
        AND (st.section_id IN (SELECT ss.section_id FROM section_staff ss WHERE ss.teacher_id = $2 AND ss.institution_id = $1 AND ss.section_id IS NOT NULL)
             OR EXISTS (SELECT 1 FROM enrollments e JOIN section_staff ss ON ss.offering_id = e.offering_id
                         WHERE ss.teacher_id = $2 AND e.student_id = st.id AND e.status IN ('active', 'completed')))`,
    [institutionId, teacherRefId]
  );
  return new Set(rows.map((r) => r.id));
}

/** Children linked to a guardian account. */
async function childrenOf(userId: number): Promise<Set<number>> {
  const { rows } = await db.query<{ student_id: number }>(
    `SELECT gs.student_id FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.user_id = $1 AND g.deleted_at IS NULL`,
    [userId]
  );
  return new Set(rows.map((r) => r.student_id));
}

/** Guardian accounts of a student (for safeguarding copies). */
export async function guardianAccounts(studentId: number): Promise<number[]> {
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT DISTINCT g.user_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN users u ON u.id = g.user_id
      WHERE gs.student_id = $1 AND g.deleted_at IS NULL AND u.is_active`,
    [studentId]
  );
  return rows.map((r) => r.user_id);
}

const isOffice = (u: AuthUser) => u.role === 'institution_admin' || can(u, 'messages.review');
const isStaffRole = (role: string) => role === 'teacher' || role === 'institution_admin';

export interface Plan {
  people: Person[];
  /** guardians added as copies */
  cc: number[];
  safeguarded: boolean;
}

/** Checks a new conversation from `sender` with `targetIds`; throws when it is not allowed. */
export async function planConversation(sender: AuthUser, targetIds: number[], settings: MessagingSettings): Promise<Plan> {
  if (!settings.enabled) throw forbidden('Messaging is turned off in this institution');
  const inst = sender.institution_id!;
  const ids = [...new Set(targetIds)].filter((x) => x !== sender.id);
  if (!ids.length) throw badRequest('Choose who to message');
  const people = await loadPeople(inst, ids);
  if (people.length !== ids.length) throw badRequest('Some of these people cannot be found');
  const [me] = await loadPeople(inst, [sender.id]);
  if (!me) throw forbidden();

  if (!isOffice(sender)) {
    const taught = me.role === 'teacher' ? await taughtStudents(inst, me.ref_id) : new Set<number>();
    const kids = me.role === 'parent' ? await childrenOf(me.id) : new Set<number>();
    const parentKids = new Map<number, Set<number>>();
    for (const p of people.filter((x) => x.role === 'parent')) parentKids.set(p.id, await childrenOf(p.id));
    for (const p of people) {
      let ok = false;
      if (p.role === 'institution_admin') ok = true;
      else if (me.role === 'teacher') {
        if (p.role === 'teacher') ok = true;
        else if (p.role === 'student') ok = taught.has(p.ref_id!);
        else if (p.role === 'parent') ok = [...parentKids.get(p.id)!].some((s) => taught.has(s));
      } else if (me.role === 'student') {
        if (p.role === 'teacher') ok = (await taughtStudents(inst, p.ref_id)).has(me.ref_id!);
        else if (p.role === 'student') ok = settings.student_to_student && !!me.section_id && p.section_id === me.section_id;
      } else if (me.role === 'parent') {
        if (p.role === 'student') ok = kids.has(p.ref_id!);
        else if (p.role === 'teacher') {
          if (!settings.guardian_to_teacher) throw forbidden('Guardians cannot start conversations with teachers here — please contact the office');
          const t = await taughtStudents(inst, p.ref_id);
          ok = [...kids].some((s) => t.has(s));
        }
      }
      if (!ok) throw forbidden(`You can't message ${p.full_name}`);
    }
  }

  // safeguarding: a private conversation between staff and one student under 18
  const all = [me, ...people];
  const studentsIn = all.filter((p) => p.role === 'student');
  const adultsIn = all.filter((p) => isStaffRole(p.role));
  let cc: number[] = [];
  let safeguarded = false;
  if (studentsIn.length === 1 && studentsIn[0]!.minor && adultsIn.length) {
    if (settings.minor_dm === 'blocked') throw forbidden('Private messages between staff and students under 18 are turned off here — use a class group instead');
    if (settings.minor_dm === 'cc_guardians') {
      cc = (await guardianAccounts(studentsIn[0]!.ref_id!)).filter((g) => !all.some((p) => p.id === g));
      if (!cc.length && !all.some((p) => p.role === 'parent')) {
        throw forbidden("This student's guardians have no Acadex account yet, so a private conversation is not allowed — use a class group or contact the guardian");
      }
      safeguarded = true;
    }
  }
  return { people, cc, safeguarded };
}
