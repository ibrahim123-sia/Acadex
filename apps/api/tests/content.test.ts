// Bringing content in (Common Cartridge, Moodle backup, QTI, Google Classroom, templates),
// SCORM playback, xAPI, blueprints, and assessment rules: groups, peer review, extensions,
// accommodations and late penalties.
import { describe, it, expect, beforeAll } from 'vitest';
import { strToU8, zipSync, gzipSync } from 'fflate';
import { app, as, fixture, request } from './helpers/http';

let f;
let t1;
let s1;
let course: number;

beforeAll(async () => {
  f = await fixture.resetDb();
  t1 = as(f.tokens.t1);
  s1 = as(f.tokens.s1);
  course = f.subjects.A1math.id;
});

const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

/** A tiny tar archive (one 512-byte header per file). */
function tar(files: Record<string, string>) {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write('0000644\0', 100);
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('0', 156);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.from(gzipSync(Buffer.concat(blocks)));
}

const QTI = `<?xml version="1.0"?><questestinterop><assessment title="Quiz one"><section ident="s">
  <item ident="q1" title="Q1"><presentation><material><mattext>2 + 2?</mattext></material>
    <response_lid ident="r1" rcardinality="Single"><render_choice>
      <response_label ident="a"><material><mattext>4</mattext></material></response_label>
      <response_label ident="b"><material><mattext>5</mattext></material></response_label>
    </render_choice></response_lid></presentation>
    <resprocessing><respcondition continue="No"><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar action="Set">100</setvar></respcondition></resprocessing></item>
  <item ident="q2"><presentation><material><mattext>Explain</mattext></material><response_str ident="r2"><render_fib/></response_str></presentation></item>
</section></assessment></questestinterop>`;

describe('imports', () => {
  it('a Common Cartridge: modules, pages (with images), links and quizzes, unpublished', async () => {
    const pkg = zip({
      'imsmanifest.xml': `<manifest><organizations><organization><item identifier="root">
          <item identifier="w1"><title>Week 1</title>
            <item identifier="i1" identifierref="r1"><title>Intro</title></item>
            <item identifier="i2" identifierref="r2"><title>Khan</title></item>
            <item identifier="i3" identifierref="r3"><title>Check</title></item>
          </item></item></organization></organizations>
        <resources>
          <resource identifier="r1" type="webcontent" href="intro.html"><file href="intro.html"/></resource>
          <resource identifier="r2" type="imswl_xmlv1p1" href="link.xml"/>
          <resource identifier="r3" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="quiz.xml"/>
        </resources></manifest>`,
      'intro.html': '<html><body><h1>Hello</h1><img src="img/dot.png"><script>bad()</script></body></html>',
      'img/dot.png': '\u0089PNG\r\n\u001a\n',
      'link.xml': '<webLink><title>Khan</title><url href="https://www.khanacademy.org/"/></webLink>',
      'quiz.xml': QTI,
    });
    const res = await t1.upload('post', `/api/courses/${course}/import?format=imscc`, { buffer: pkg, name: 'course.imscc' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ modules: 1, pages: 1, links: 1, assessments: 1, questions: 2 });
    const space = await t1.get(`/api/courses/${course}`);
    const week = space.body.modules.find((m) => m.title === 'Week 1');
    expect(week.published).toBe(false);
    expect(week.items.map((i) => i.kind)).toEqual(['page', 'link', 'assessment']);
    const page = await t1.get(`/api/content-items/${week.items[0].id}`);
    expect(page.body.body_html).not.toContain('script');
    expect((await s1.get(`/api/courses/${course}`)).body.modules.some((m) => m.title === 'Week 1')).toBe(false);
    expect((await t1.get(`/api/courses/${course}/imports`)).body[0]).toMatchObject({ format: 'imscc', status: 'completed' });
  });

  it('a Moodle backup: sections, pages, links and assignments', async () => {
    const mbz = tar({
      'moodle_backup.xml': `<moodle_backup><information><contents>
          <sections><section><sectionid>1</sectionid><title>Topic 1</title><directory>sections/section_1</directory></section></sections>
          <activities>
            <activity><moduleid>1</moduleid><sectionid>1</sectionid><modulename>page</modulename><title>Notes</title><directory>activities/page_1</directory></activity>
            <activity><moduleid>2</moduleid><sectionid>1</sectionid><modulename>url</modulename><title>Site</title><directory>activities/url_2</directory></activity>
            <activity><moduleid>3</moduleid><sectionid>1</sectionid><modulename>assign</modulename><title>Essay</title><directory>activities/assign_3</directory></activity>
            <activity><moduleid>4</moduleid><sectionid>1</sectionid><modulename>wiki</modulename><title>Wiki</title><directory>activities/wiki_4</directory></activity>
          </activities></contents></information></moodle_backup>`,
      'sections/section_1/section.xml': '<section><number>1</number><name>Topic 1</name><summary>About it</summary></section>',
      'activities/page_1/page.xml': '<activity><page><name>Notes</name><content>&lt;p&gt;Read me&lt;/p&gt;</content></page></activity>',
      'activities/url_2/url.xml': '<activity><url><name>Site</name><externalurl>https://moodle.org</externalurl></url></activity>',
      'activities/assign_3/assign.xml': '<activity><assign><name>Essay</name><intro>Write it</intro><grade>50</grade></assign></activity>',
      'files.xml': '<files></files>',
    });
    const res = await t1.upload('post', `/api/courses/${course}/import?format=mbz`, { buffer: mbz, name: 'backup.mbz' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ modules: 1, pages: 1, links: 1, assessments: 1 });
    expect(res.body.skipped.join(' ')).toContain('wiki');
    const { rows } = await fixture.pool.query(`SELECT points FROM assessments WHERE title = 'Essay'`);
    expect(rows[0].points).toBe('50.00');
  });

  it('QTI into the question bank; rubbish is refused', async () => {
    const res = await t1.upload('post', `/api/courses/${course}/import?format=qti`, { buffer: Buffer.from(QTI), name: 'quiz.xml' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.questions).toBe(2);
    expect((await t1.upload('post', `/api/courses/${course}/import?format=imscc`, { buffer: Buffer.from('not a zip'), name: 'x.imscc' })).status).toBe(400);
    expect((await s1.upload('post', `/api/courses/${course}/import?format=qti`, { buffer: Buffer.from(QTI), name: 'quiz.xml' })).status).toBe(403);
  });

  it('Google Classroom (fake provider) and starter templates', async () => {
    const res = await t1.post(`/api/courses/${course}/import/classroom`, { course_ref: '123' });
    expect(res.status).toBe(201);
    expect(res.body.assessments).toBe(1);
    const templates = await t1.get('/api/course-templates');
    expect(templates.body.map((t) => t.key)).toContain('weekly-12');
    const applied = await t1.post(`/api/courses/${f.subjects.A1math.id}/apply-template`, { key: 'units-school' });
    expect(applied.body.modules).toBe(6);
    expect((await t1.get('/api/oer?subject=physics')).body.map((l) => l.name)).toContain('PhET Interactive Simulations');
  });
});

describe('SCORM', () => {
  let item: number;
  it('uploads a package and plays it sandboxed with the runtime injected', async () => {
    const m = await t1.post(`/api/courses/${course}/modules`, { title: 'eLearning', published: true });
    const pkg = zip({
      'imsmanifest.xml': `<manifest><metadata><schemaversion>1.2</schemaversion></metadata><organizations><organization><title>Safety</title>
        <item identifier="i" identifierref="r"><title>Safety</title></item></organization></organizations>
        <resources><resource identifier="r" adlcp:scormtype="sco" href="index.html"/></resources></manifest>`,
      'index.html': '<html><head><title>x</title></head><body><script src="app.js"></script></body></html>',
      'app.js': 'API.LMSInitialize("");',
    });
    const up = await t1.upload('post', `/api/courses/${course}/scorm?module_id=${m.body.id}`, { buffer: pkg, name: 'safety.zip' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.version).toBe('1.2');
    item = up.body.item_id;
    const launch = await s1.get(`/api/scorm/items/${item}/launch`);
    expect(launch.body.preview).toBe(false);
    const page = await request(app).get(launch.body.url);
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(page.headers['content-security-policy']).not.toContain('allow-same-origin');
    expect(page.text).toContain('window.API=api12');
    const js = await request(app).get(launch.body.url.replace('index.html', 'app.js'));
    expect(js.text).toBe('API.LMSInitialize("");');
    expect((await request(app).get(launch.body.url.replace(/content\/[^/]+/, 'content/forged.token'))).status).toBe(403);
    expect((await request(app).get(launch.body.url.replace('index.html', '../../etc/passwd'))).status).toBe(404);
  });

  it('saving the data model completes the item; a teacher preview saves nothing', async () => {
    const res = await s1.put(`/api/scorm/items/${item}/attempt`, { cmi: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '80', 'cmi.core.score.max': '100' } });
    expect(res.body).toMatchObject({ saved: true, completed: true, score: 80 });
    const { rows } = await fixture.pool.query(`SELECT status FROM content_progress WHERE item_id = $1 AND student_id = $2`, [item, f.students.S1.id]);
    expect(rows[0].status).toBe('done');
    expect((await t1.put(`/api/scorm/items/${item}/attempt`, { cmi: {} })).status).toBe(403);
    // the saved state comes back into the page
    const launch = await s1.get(`/api/scorm/items/${item}/launch`);
    expect((await request(app).get(launch.body.url)).text).toContain('passed');
  });

  it('xAPI statements are stored as the signed-in person', async () => {
    const res = await s1.post('/api/xapi/statements', { actor: { mbox: 'mailto:someone@else.test' }, verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { id: 'https://acadex.test/activity/1' } });
    expect(res.status).toBe(200);
    const mine = await s1.get('/api/xapi/statements');
    expect(mine.body.statements[0].actor.account.name).toBe(String(f.users.s1.id));
    expect((await as(f.tokens.s2).get('/api/xapi/statements')).body.statements).toEqual([]);
  });
});

describe('blueprints', () => {
  it('copies to courses and pushes updates, keeping local changes', async () => {
    const A = as(f.tokens.adminA);
    const bp = await A.post('/api/blueprints', { title: 'Maths master' });
    const m = await A.post(`/api/blueprints/${bp.body.id}/modules`, { title: 'Algebra', published: true });
    const p1 = await A.post('/api/content-items', { module_id: m.body.id, kind: 'page', title: 'Equations', body_html: '<p>v1</p>' });
    const p2 = await A.post('/api/content-items', { module_id: m.body.id, kind: 'page', title: 'Graphs', body_html: '<p>v1</p>' });
    expect((await t1.post('/api/blueprints', { title: 'x' })).status).toBe(403);
    const applied = await A.post(`/api/blueprints/${bp.body.id}/apply`, { offering_ids: [f.subjects.A1math.id, f.subjects.A2math.id] });
    expect(applied.body.map((r) => r.added)).toEqual([2, 2]);
    // the A1 teacher changes one page locally
    const copy = (await fixture.pool.query(`SELECT i.id FROM content_items i JOIN modules mo ON mo.id = i.module_id WHERE mo.offering_id = $1 AND i.source_item_id = $2`, [f.subjects.A1math.id, p1.body.id])).rows[0];
    await t1.patch(`/api/content-items/${copy.id}`, { body_html: '<p>my version</p>' });
    await A.patch(`/api/content-items/${p1.body.id}`, { body_html: '<p>v2</p>' });
    await A.patch(`/api/content-items/${p2.body.id}`, { body_html: '<p>v2</p>' });
    const pushed = await A.post(`/api/blueprints/${bp.body.id}/push`, {});
    expect(pushed.body.map((r) => r.updated).sort()).toEqual([1, 2]);
    const { rows } = await fixture.pool.query(
      `SELECT mo.offering_id, i.title, i.body_html FROM content_items i JOIN modules mo ON mo.id = i.module_id WHERE i.source_item_id IS NOT NULL ORDER BY mo.offering_id, i.title`
    );
    expect(rows.filter((r) => r.offering_id === f.subjects.A1math.id).map((r) => r.body_html)).toEqual(['<p>my version</p>', '<p>v2</p>']);
    expect(rows.filter((r) => r.offering_id === f.subjects.A2math.id).map((r) => r.body_html)).toEqual(['<p>v2</p>', '<p>v2</p>']);
  });
});

describe('assessment rules', () => {
  it('late work: blocked, or penalised per day', async () => {
    const past = new Date(Date.now() - 36 * 3600 * 1000);
    await fixture.pool.query(`UPDATE assessments SET due_at = $1, late_policy = '{"mode":"block"}' WHERE id = $2`, [past, f.assignments.ASG1.id]);
    const blocked = await s1.post(`/api/assessments/${f.assignments.ASG1.id}/submission`, { text_html: '<p>late</p>' });
    expect(blocked.body.code).toBe('LATE_BLOCKED');
    // an extension for this student opens it again
    await t1.post(`/api/assessments/${f.assignments.ASG1.id}/extensions`, { student_id: f.students.S1.id, due_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Ill' });
    expect((await s1.post(`/api/assessments/${f.assignments.ASG1.id}/submission`, { text_html: '<p>on time now</p>' })).status).toBe(201);
    // penalty: 2 days late at 10%/day → 20% off
    await fixture.pool.query(`UPDATE assessments SET late_policy = '{"mode":"penalty","penalty_percent_per_day":10,"max_penalty_percent":50}' WHERE id = $1`, [f.assignments.ASG1.id]);
    const late = await as(f.tokens.s2).post(`/api/assessments/${f.assignments.ASG1.id}/submission`, { text_html: '<p>late</p>' });
    expect(late.body.late).toBe(true);
    await t1.put(`/api/assessments/${f.assignments.ASG1.id}/grades`, { grades: [{ student_id: f.students.S2.id, points: 100 }] });
    const { rows } = await fixture.pool.query(`SELECT late_penalty_percent FROM grades WHERE student_id = $1`, [f.students.S2.id]);
    expect(rows[0].late_penalty_percent).toBe('20.00');
  });

  it('accommodations add time to timed quizzes', async () => {
    expect((await t1.put(`/api/students/${f.students.S1.id}/accommodations`, { extra_time_percent: 50 })).status).toBe(403);
    expect((await as(f.tokens.adminA).put(`/api/students/${f.students.S1.id}/accommodations`, { extra_time_percent: 50, notes: 'Dyslexia' })).status).toBe(200);
    const bank = await t1.post('/api/question-banks', { name: 'B' });
    const q = await t1.post('/api/questions', { bank_id: bank.body.id, type: 'true_false', prompt_html: '<p>?</p>', data: { correct: true } });
    const quiz = await t1.post(`/api/courses/${course}/assessments`, { kind: 'quiz', title: 'Timed', status: 'published', quiz: { time_limit_minutes: 10 } });
    await t1.put(`/api/assessments/${quiz.body.id}/questions`, { items: [{ question_id: q.body.id }] });
    const a = await s1.post(`/api/assessments/${quiz.body.id}/attempts`, {});
    const mins = (new Date(a.body.deadline_at).getTime() - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(14.5);
    expect(mins).toBeLessThan(15.1);
  });

  it('group work: one hand-in per group; peer review between groups’ members', async () => {
    const set = await t1.post(`/api/courses/${course}/group-sets`, { name: 'Pairs', auto_size: 1 });
    expect(set.status).toBe(201);
    const hw = await t1.post(`/api/courses/${course}/assessments`, { title: 'Group poster', status: 'published', group_set_id: set.body.id, peer_review: { reviews_per_student: 1 } });
    expect((await s1.post(`/api/assessments/${hw.body.id}/submission`, { text_html: '<p>ours</p>' })).status).toBe(201);
    expect((await as(f.tokens.s2).post(`/api/assessments/${hw.body.id}/submission`, { text_html: '<p>ours too</p>' })).status).toBe(201);
    const assigned = await t1.post(`/api/assessments/${hw.body.id}/peer-reviews/assign`, {});
    expect(assigned.body.assigned).toBe(2);
    const mine = await s1.get(`/api/assessments/${hw.body.id}/peer-reviews`);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].work.text_html).toBe('<p>ours too</p>');
    expect((await as(f.tokens.s2).put(`/api/peer-reviews/${mine.body[0].id}`, { comments: 'x' })).status).toBe(403);
    expect((await s1.put(`/api/peer-reviews/${mine.body[0].id}`, { comments: 'Nice colours' })).status).toBe(200);
    const s2sees = await as(f.tokens.s2).get(`/api/assessments/${hw.body.id}/submission`);
    expect(s2sees.body.peer_reviews).toEqual([expect.objectContaining({ comments: 'Nice colours', reviewer: null })]);
  });
});
