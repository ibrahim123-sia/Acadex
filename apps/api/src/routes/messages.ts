// Messaging: conversations between people of one institution, under the safeguarding rules in
// lib/conversations.ts (who may message whom; guardians copied into private conversations
// with students under 18). Every message is kept: withdrawn or hidden messages disappear for
// members but stay available to safeguarding review (messages.review), which also handles
// reports, flagged messages and locking. Mounted under /api.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { classConversationBody, conversationBody, id, messageBody, messagingSettingsBody, reportBody, reviewReportBody } from '@acadex/shared';
import { moderate } from '../ai/guard';
import { db, withTransaction } from '../db/context';
import { audit } from '../lib/audit';
import { messagingSettings, planConversation } from '../lib/conversations';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { publish } from '../lib/events';
import { assertCourseEditor, guardianUserIds, rosterSql, rosterUserIds, staffUserIds } from '../lib/lms/access';
import { channelEnabled } from '../lib/messaging';
import { notify } from '../lib/notify';
import { parsePage, sendPage } from '../lib/pagination';
import { filterProfanity } from '../lib/profanity';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();

/** People holding a permission in an institution (safeguarding leads, the help desk…). */
export async function holders(institution: number, permission: string): Promise<number[]> {
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN users u ON u.id = ur.user_id
      WHERE u.institution_id = $1 AND u.is_active AND rp.permission = $2`,
    [institution, permission]
  );
  return rows.map((r) => r.user_id);
}

interface Member {
  user_id: number;
  role: 'member' | 'cc';
  muted: boolean;
}
interface ConversationRow {
  id: number;
  kind: string;
  title: string;
  locked: boolean;
  safeguarded: boolean;
  offering_id: number | null;
}

/** The conversation, if the caller is a member — or a safeguarding reviewer (audited). */
async function openConversation(req: Request, conversationId: number, { forWriting = false } = {}) {
  const u = currentUser(req);
  const { rows } = await db.query<ConversationRow>(`SELECT id, kind, title, locked, safeguarded, offering_id FROM conversations WHERE id = $1 AND institution_id = $2`, [
    conversationId,
    institutionId(req),
  ]);
  const c = rows[0];
  if (!c) throw notFound();
  const { rows: members } = await db.query<Member>(`SELECT user_id, role, muted FROM conversation_members WHERE conversation_id = $1`, [c.id]);
  const me = members.find((m) => m.user_id === u.id);
  if (!me) {
    if (forWriting || !userCan(req, 'messages.review')) throw notFound();
    await audit({ institutionId: institutionId(req), userId: u.id, actor: u.email, action: 'safeguarding_view', entity: `conversation:${c.id}` });
  }
  return { c, members, me, reviewer: !me };
}

/** Masks profanity and flags unsafe content; tells the safeguarding leads about a student in distress. */
async function screen(req: Request, body: string): Promise<{ body: string; flagged: boolean; reason: string | null }> {
  const settings = await messagingSettings(institutionId(req));
  const p = settings.profanity_filter ? filterProfanity(body) : { text: body, flagged: false };
  const m = moderate(body);
  return { body: p.text, flagged: p.flagged || m.flagged, reason: m.flagged ? m.flag! : p.flagged ? 'profanity' : null };
}

async function postMessage(req: Request, conversationId: number, memberIds: number[], b: { body: string }, title: string) {
  const u = currentUser(req);
  const inst = institutionId(req);
  const s = await screen(req, b.body);
  const { rows } = await db.query(
    `INSERT INTO messages (institution_id, conversation_id, sender_id, body, flagged, flag_reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, body, created_at, flagged`,
    [inst, conversationId, u.id, s.body, s.flagged, s.reason]
  );
  await db.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
  await db.query(`UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [conversationId, u.id]);
  const { rows: muted } = await db.query<{ user_id: number }>(`SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND muted`, [conversationId]);
  const others = memberIds.filter((x) => x !== u.id);
  await publish(others, { kind: 'message', data: { conversation_id: conversationId } });
  const hour = Math.floor(Date.now() / 3_600_000);
  await notify({
    institutionId: inst,
    userIds: others.filter((x) => !muted.some((m) => m.user_id === x)),
    type: 'message',
    title: `${u.name}: ${title || 'new message'}`.slice(0, 160),
    message: s.body.slice(0, 200),
    link: `/messages/${conversationId}`,
    // at most one notification per conversation per hour
    dedupeKey: `msg:${conversationId}:${hour}`,
  });
  if (s.reason && s.reason !== 'profanity' && u.role === 'student') {
    await notify({
      institutionId: inst,
      userIds: await holders(inst, 'messages.review'),
      type: 'system',
      title: 'Safeguarding: a student message may need attention',
      message: `Flagged as ${s.reason.replace('_', ' ')}. Open the safeguarding queue.`,
      link: '/safeguarding',
      dedupeKey: `sg:${rows[0].id}`,
    });
  }
  return rows[0];
}

// ---------------------------------------------------------------- contacts and conversations

/** People the caller may start a conversation with (search by name). */
router.get('/messages/contacts', async (req, res) => {
  const u = currentUser(req);
  const inst = institutionId(req);
  const s = await messagingSettings(inst);
  const q = `%${z.string().max(100).catch('').parse(req.query.q ?? '').trim()}%`;
  const base = `SELECT u.id, u.full_name, u.role, sec.name AS detail FROM users u
       LEFT JOIN students st ON u.role = 'student' AND st.id = u.ref_id LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE u.institution_id = $1 AND u.is_active AND u.id <> $2 AND u.full_name ILIKE $3`;
  const tail = ` ORDER BY u.role, u.full_name LIMIT 50`;
  let rows;
  if (u.role === 'institution_admin' || userCan(req, 'messages.review')) {
    rows = (await db.query(base + tail, [inst, u.id, q])).rows;
  } else if (u.role === 'teacher') {
    rows = (
      await db.query(
        `WITH taught AS (SELECT st.id FROM students st WHERE st.institution_id = $1 AND COALESCE(st.status, 'active') = 'active'
             AND (st.section_id IN (SELECT section_id FROM section_staff WHERE teacher_id = $4 AND institution_id = $1)
                  OR EXISTS (SELECT 1 FROM enrollments e JOIN section_staff ss ON ss.offering_id = e.offering_id WHERE ss.teacher_id = $4 AND e.student_id = st.id AND e.status IN ('active', 'completed'))))
         ${base} AND (u.role IN ('teacher', 'institution_admin') OR (u.role = 'student' AND u.ref_id IN (SELECT id FROM taught))
              OR (u.role = 'parent' AND EXISTS (SELECT 1 FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.user_id = u.id AND gs.student_id IN (SELECT id FROM taught))))${tail}`,
        [inst, u.id, q, u.ref_id ?? 0]
      )
    ).rows;
  } else if (u.role === 'student') {
    const { rows: me } = await db.query<{ section_id: number | null }>(`SELECT section_id FROM students WHERE id = $1`, [u.ref_id ?? 0]);
    rows = (
      await db.query(
        `${base} AND (u.role = 'institution_admin'
              OR (u.role = 'teacher' AND u.ref_id IN (SELECT ss.teacher_id FROM section_staff ss WHERE ss.institution_id = $1
                    AND (ss.section_id = $5 OR ss.offering_id IN (SELECT offering_id FROM enrollments WHERE student_id = $4 AND status IN ('active', 'completed')))))
              OR ($6 AND u.role = 'student' AND st.section_id = $5))${tail}`,
        [inst, u.id, q, u.ref_id ?? 0, me[0]?.section_id ?? 0, s.student_to_student]
      )
    ).rows;
  } else {
    rows = (
      await db.query(
        `WITH kids AS (SELECT gs.student_id AS id FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.user_id = $2 AND g.deleted_at IS NULL)
         ${base} AND (u.role = 'institution_admin' OR (u.role = 'student' AND u.ref_id IN (SELECT id FROM kids))
              OR ($4 AND u.role = 'teacher' AND u.ref_id IN (SELECT ss.teacher_id FROM section_staff ss WHERE ss.institution_id = $1
                    AND (ss.section_id IN (SELECT section_id FROM students WHERE id IN (SELECT id FROM kids))
                         OR ss.offering_id IN (SELECT offering_id FROM enrollments WHERE student_id IN (SELECT id FROM kids) AND status IN ('active', 'completed'))))))${tail}`,
        [inst, u.id, q, s.guardian_to_teacher]
      )
    ).rows;
  }
  res.json(rows);
});

const LIST_SQL = `
  SELECT c.id, c.kind, c.title, c.safeguarded, c.locked, c.last_message_at, m.muted, m.role AS my_role,
         (SELECT count(*)::int FROM messages x WHERE x.conversation_id = c.id AND x.hidden_at IS NULL AND x.sender_id IS DISTINCT FROM $1
             AND x.created_at > COALESCE(m.last_read_at, '-infinity'::timestamptz)) AS unread,
         (SELECT json_build_object('body', left(x.body, 140), 'sender', su.full_name, 'created_at', x.created_at)
            FROM messages x LEFT JOIN users su ON su.id = x.sender_id WHERE x.conversation_id = c.id AND x.hidden_at IS NULL ORDER BY x.id DESC LIMIT 1) AS last,
         (SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name, 'role', u.role, 'cc', cm.role = 'cc') ORDER BY u.full_name)
            FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id) AS members,
         count(*) OVER () AS _total
    FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1`;

/** My conversations, the most recent first, with unread counts. */
router.get('/conversations', async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 30 });
  const { rows } = await db.query(`${LIST_SQL} ORDER BY c.last_message_at DESC LIMIT $2 OFFSET $3`, [currentUser(req).id, pg.limit, pg.offset]);
  sendPage(res, rows, pg);
});

/** Unread messages across my conversations (for the menu badge). */
router.get('/conversations/unread', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages x JOIN conversation_members m ON m.conversation_id = x.conversation_id AND m.user_id = $1
      WHERE x.hidden_at IS NULL AND x.sender_id IS DISTINCT FROM $1 AND x.created_at > COALESCE(m.last_read_at, '-infinity'::timestamptz)`,
    [u.id]
  );
  res.json({ unread: rows[0]?.n ?? 0 });
});

/** Start a conversation (or continue the existing direct one with the same person). */
router.post('/conversations', async (req, res) => {
  const b = conversationBody.parse(req.body);
  const u = currentUser(req);
  const inst = institutionId(req);
  const plan = await planConversation(u, b.user_ids, await messagingSettings(inst));
  const out = await withTransaction(async () => {
    const memberIds = [u.id, ...plan.people.map((p) => p.id)];
    let convId: number | null = null;
    if (plan.people.length === 1) {
      const { rows } = await db.query<{ id: number }>(
        `SELECT c.id FROM conversations c WHERE c.institution_id = $1 AND c.kind = 'direct'
            AND (SELECT array_agg(user_id ORDER BY user_id) FROM conversation_members WHERE conversation_id = c.id AND role = 'member') = $2::int[]
          ORDER BY c.id LIMIT 1`,
        [inst, [...memberIds].sort((a, z2) => a - z2)]
      );
      convId = rows[0]?.id ?? null;
    }
    if (!convId) {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO conversations (institution_id, kind, title, created_by, safeguarded) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [inst, plan.people.length === 1 ? 'direct' : 'group', b.title, u.id, plan.safeguarded]
      );
      convId = rows[0]!.id;
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, institution_id, role)
         SELECT $1::int, x, $2::int, 'member' FROM unnest($3::int[]) x UNION ALL SELECT $1::int, x, $2::int, 'cc' FROM unnest($4::int[]) x`,
        [convId, inst, memberIds, plan.cc]
      );
    }
    const { rows: all } = await db.query<{ user_id: number }>(`SELECT user_id FROM conversation_members WHERE conversation_id = $1`, [convId]);
    const msg = await postMessage(req, convId, all.map((r) => r.user_id), b, b.title);
    return { id: convId, message: msg, safeguarded: plan.safeguarded, cc: plan.cc.length };
  });
  res.status(201).json(out);
});

/** A class group: the teacher and everyone on one of their courses (optionally their guardians). */
router.post('/conversations/class', async (req, res) => {
  const b = classConversationBody.parse(req.body);
  const a = await assertCourseEditor(req, b.offering_id);
  const u = currentUser(req);
  const inst = institutionId(req);
  if (!(await messagingSettings(inst)).enabled) throw forbidden('Messaging is turned off in this institution');
  const students = await rosterUserIds(b.offering_id);
  if (!students.length) throw badRequest('Nobody is on this course yet');
  const { rows: ids } = await db.query<{ id: number }>(rosterSql('$1'), [b.offering_id]);
  const guardians = b.include_guardians ? await guardianUserIds(ids.map((r) => r.id)) : [];
  const staff = await staffUserIds(b.offering_id);
  const members = [...new Set([u.id, ...staff, ...students, ...guardians])];
  const title = b.title || `${a.course.name}${a.course.section_name ? ` · ${a.course.section_name}` : ''}`;
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(`INSERT INTO conversations (institution_id, kind, title, offering_id, created_by) VALUES ($1,'class',$2,$3,$4) RETURNING id`, [
      inst,
      title,
      b.offering_id,
      u.id,
    ]);
    await db.query(`INSERT INTO conversation_members (conversation_id, user_id, institution_id) SELECT $1::int, x, $2::int FROM unnest($3::int[]) x`, [rows[0]!.id, inst, members]);
    await postMessage(req, rows[0]!.id, members, b, title);
    return { id: rows[0]!.id, members: members.length };
  });
  res.status(201).json(out);
});

/** A conversation and its messages (50 at a time, older with ?before=<message id>). */
router.get('/conversations/:id', async (req, res) => {
  const { c, members, me, reviewer } = await openConversation(req, id.parse(req.params.id));
  const before = req.query.before ? id.parse(req.query.before) : null;
  const { rows: msgs } = await db.query(
    `SELECT x.id, x.sender_id, su.full_name AS sender, su.role AS sender_role, x.body, x.created_at,
            x.hidden_at IS NOT NULL AS hidden, ${reviewer ? 'x.flagged, x.flag_reason' : 'false AS flagged, NULL AS flag_reason'}
       FROM messages x LEFT JOIN users su ON su.id = x.sender_id
      WHERE x.conversation_id = $1 AND ($2::int IS NULL OR x.id < $2) AND ($3::boolean OR x.hidden_at IS NULL)
      ORDER BY x.id DESC LIMIT 50`,
    [c.id, before, reviewer]
  );
  const { rows: people } = await db.query(
    `SELECT u.id, u.full_name AS name, u.role, cm.role = 'cc' AS cc FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = $1 ORDER BY u.full_name`,
    [c.id]
  );
  if (me) await db.query(`UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [c.id, me.user_id]);
  res.json({ ...c, muted: me?.muted ?? false, my_role: me?.role ?? null, reviewer, members: people, member_count: members.length, messages: msgs.reverse() });
});

router.post('/conversations/:id/messages', async (req, res) => {
  const b = messageBody.parse(req.body);
  const inst = institutionId(req);
  if (!(await messagingSettings(inst)).enabled) throw forbidden('Messaging is turned off in this institution');
  const { c, members } = await openConversation(req, id.parse(req.params.id), { forWriting: true });
  if (c.locked) throw forbidden('This conversation was locked by the safeguarding team');
  const msg = await postMessage(req, c.id, members.map((m) => m.user_id), b, c.title);
  res.status(201).json(msg);
});

/** Mute a conversation (me), or lock / unlock it (safeguarding review). */
router.patch('/conversations/:id', async (req, res) => {
  const b = z.object({ muted: z.boolean().optional(), locked: z.boolean().optional() }).parse(req.body);
  const { c, me } = await openConversation(req, id.parse(req.params.id));
  if (b.muted !== undefined) {
    if (!me) throw forbidden();
    await db.query(`UPDATE conversation_members SET muted = $3 WHERE conversation_id = $1 AND user_id = $2`, [c.id, me.user_id, b.muted]);
  }
  if (b.locked !== undefined) {
    if (!userCan(req, 'messages.review')) throw forbidden();
    await db.query(`UPDATE conversations SET locked = $2 WHERE id = $1`, [c.id, b.locked]);
  }
  res.json({ ok: true });
});

/** Withdraw my message (it stays available to safeguarding review), or hide one (review). */
router.delete('/messages/:id', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query<{ id: number; sender_id: number | null; conversation_id: number }>(`SELECT id, sender_id, conversation_id FROM messages WHERE id = $1 AND institution_id = $2`, [
    id.parse(req.params.id),
    institutionId(req),
  ]);
  const m = rows[0];
  if (!m) throw notFound();
  if (m.sender_id !== u.id && !userCan(req, 'messages.review')) throw notFound();
  await db.query(`UPDATE messages SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL`, [m.id, u.id]);
  res.status(204).end();
});

/** Report a message to the safeguarding team. */
router.post('/messages/:id/report', async (req, res) => {
  const b = reportBody.parse(req.body);
  const u = currentUser(req);
  const inst = institutionId(req);
  const { rows } = await db.query<{ id: number; conversation_id: number }>(`SELECT id, conversation_id FROM messages WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), inst]);
  const m = rows[0];
  if (!m) throw notFound();
  const { rows: mem } = await db.query(`SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [m.conversation_id, u.id]);
  if (!mem[0]) throw notFound();
  const { rows: out } = await db.query(`INSERT INTO message_reports (institution_id, message_id, reporter_id, reason) VALUES ($1,$2,$3,$4) RETURNING id, status, created_at`, [
    inst,
    m.id,
    u.id,
    b.reason,
  ]);
  await notify({ institutionId: inst, userIds: await holders(inst, 'messages.review'), type: 'system', title: 'A message was reported', message: b.reason.slice(0, 200), link: '/safeguarding' });
  res.status(201).json(out[0]);
});

// ---------------------------------------------------------------- safeguarding review

/** Open reports and flagged messages. */
router.get('/safeguarding/queue', requirePermission('messages.review'), async (req, res) => {
  const inst = institutionId(req);
  const [reports, flagged] = await Promise.all([
    db.query(
      `SELECT r.id, r.reason, r.status, r.created_at, ru.full_name AS reporter, x.id AS message_id, x.body, x.conversation_id, su.full_name AS sender, x.hidden_at IS NOT NULL AS hidden
         FROM message_reports r JOIN messages x ON x.id = r.message_id LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users su ON su.id = x.sender_id
        WHERE r.institution_id = $1 AND r.status = 'open' ORDER BY r.created_at`,
      [inst]
    ),
    db.query(
      `SELECT x.id AS message_id, x.body, x.flag_reason, x.created_at, x.conversation_id, su.full_name AS sender, x.hidden_at IS NOT NULL AS hidden
         FROM messages x LEFT JOIN users su ON su.id = x.sender_id
        WHERE x.institution_id = $1 AND x.flagged AND x.created_at > now() - interval '30 days' ORDER BY x.created_at DESC LIMIT 100`,
      [inst]
    ),
  ]);
  res.json({ reports: reports.rows, flagged: flagged.rows });
});

router.patch('/safeguarding/reports/:id', requirePermission('messages.review'), async (req, res) => {
  const b = reviewReportBody.parse(req.body);
  const u = currentUser(req);
  const { rows } = await db.query<{ id: number; message_id: number }>(
    `UPDATE message_reports SET status = $3, review_note = $4, reviewed_by = $5, reviewed_at = now() WHERE id = $1 AND institution_id = $2 RETURNING id, message_id`,
    [id.parse(req.params.id), institutionId(req), b.status, b.note, u.id]
  );
  const r = rows[0];
  if (!r) throw notFound();
  if (b.hide_message) await db.query(`UPDATE messages SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL`, [r.message_id, u.id]);
  if (b.lock_conversation) await db.query(`UPDATE conversations SET locked = true WHERE id = (SELECT conversation_id FROM messages WHERE id = $1)`, [r.message_id]);
  res.json({ ok: true });
});

/** Every conversation in the institution (search by a member's name). */
router.get('/safeguarding/conversations', requirePermission('messages.review'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 30 });
  const q = `%${z.string().max(100).catch('').parse(req.query.q ?? '').trim()}%`;
  const { rows } = await db.query(
    `SELECT c.id, c.kind, c.title, c.safeguarded, c.locked, c.last_message_at,
            (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id) AS members,
            (SELECT count(*)::int FROM messages x WHERE x.conversation_id = c.id AND x.flagged) AS flagged,
            count(*) OVER () AS _total
       FROM conversations c
      WHERE c.institution_id = $1 AND ($2 = '%%' OR EXISTS (SELECT 1 FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id AND u.full_name ILIKE $2))
      ORDER BY c.last_message_at DESC LIMIT $3 OFFSET $4`,
    [institutionId(req), q, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------------------------------------------------------------- settings

/** Messaging and safeguarding rules, and whether notifications may go out by WhatsApp. */
router.get('/messaging/settings', requirePermission('settings.manage'), async (req, res) => {
  const inst = institutionId(req);
  const { rows } = await db.query<{ by_phone: boolean | null }>(`SELECT (settings->>'notify_by_phone')::boolean AS by_phone FROM institutions WHERE id = $1`, [inst]);
  res.json({ messaging: await messagingSettings(inst), notify_by_phone: !!rows[0]?.by_phone, drivers: { whatsapp: channelEnabled('whatsapp') } });
});

router.put('/messaging/settings', requirePermission('settings.manage'), async (req, res) => {
  const b = z.object({ messaging: messagingSettingsBody, notify_by_phone: z.boolean() }).parse(req.body);
  await db.query(
    `UPDATE institutions SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('messaging', $2::jsonb, 'notify_by_phone', $3::boolean) WHERE id = $1`,
    [institutionId(req), JSON.stringify(b.messaging), b.notify_by_phone]
  );
  res.json(b);
});

export default router;
