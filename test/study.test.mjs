// 3.0 plan engine + paper finder library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createChrome } from './chrome-mock.mjs';
import { JSDOM } from 'jsdom';
globalThis.DOMParser = new JSDOM('').window.DOMParser;

const mock = createChrome();
globalThis.chrome = mock.chrome;
let respond = null;
const calls = [];
globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return respond(String(url), opts); };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const S = await import('../lib/study.js');
const F = await import('../lib/pyq-search.js');

const T = (id, title, extra = {}) => ({ id, title, done: false, ...extra });
const dbms = {
  id: 'd', name: 'DBMS', subject: 'DBMS',
  units: [{ id: 'u1', title: 'U1', topics: [T('er', 'ER model'), T('rel', 'Relational model'), T('sql', 'SQL'), T('nf', 'Normalization')] }, { id: 'u2', title: 'U2', topics: [T('tx', 'Transactions'), T('cc', 'Concurrency control')] }],
  papers: [{ id: 'p1' }, { id: 'p2' }], pyqs: [{ id: 1, paperId: 'p1', topicId: 'nf' }, { id: 2, paperId: 'p2', topicId: 'nf' }, { id: 3, paperId: 'p1', topicId: 'tx' }],
};
const os = { id: 'o', name: 'OS', units: [{ id: 'v1', title: 'V', topics: [T('proc', 'Processes'), T('sch', 'Scheduling'), T('dl', 'Deadlock'), T('mem', 'Memory')] }] };
const today = '2026-11-11'; // a Wednesday
const base = () => S.mergeStudy({
  subjects: [
    { id: 'S1', name: 'DBMS', syllabusId: 'd', examDate: '2026-11-20', maxMarks: 75, importance: 3 },
    { id: 'S2', name: 'OS', syllabusId: 'o', examDate: '2026-11-25', maxMarks: 75, importance: 2 },
    { id: 'S3', name: 'Maths', syllabusId: null },
  ],
  prefs: { minutesPerDay: 120, restDays: [0], revisionDays: 2 },
  deps: { nf: ['sql', 'rel'], sql: ['rel'], cc: ['tx'], sch: ['proc'], dl: ['sch'] },
  setupDone: true,
});

// ---- the plan ----
let st = base();
let plan = S.buildPlan(st, [dbms, os], today);
const flat = plan.days.flatMap((d) => d.items.map((i) => ({ ...i, date: d.date })));
const learnDay = Object.fromEntries(flat.filter((i) => i.kind === 'learn').map((i, n) => [i.topicId, [i.date, n]]));
assert.equal(Object.keys(learnDay).length, 10, 'every topic learned once');
for (const [t, ps] of Object.entries(st.deps)) for (const p of ps) assert.ok(learnDay[p][1] < learnDay[t][1], `${p} before ${t}`);
for (const d of plan.days) {
  const dow = S.parseDay(d.date).getDay();
  if (dow === 0) assert.equal(d.items.length, 0, 'rest day empty');
  assert.ok(!['2026-11-20', '2026-11-25'].includes(d.date) || !d.items.length, 'exam days free');
  assert.ok(d.items.reduce((a, i) => a + i.minutes, 0) <= 120 * 1.2 + 1, `day ${d.date} within limit`);
}
assert.deepEqual(flat.filter((i) => i.kind === 'mock').map((i) => i.date), ['2026-11-19', '2026-11-24'], 'mock the day before each exam');
assert.deepEqual(flat.filter((i) => i.kind === 'revise').map((i) => i.date), ['2026-11-18', '2026-11-23']);
assert.ok(flat.filter((i) => i.subjectId === 'S1' && i.kind === 'learn').every((i) => i.date <= '2026-11-17'), 'DBMS learning before its revision days');
assert.equal(flat.find((i) => i.kind === 'pyq' && i.topicId === 'nf').minutes, 30, 'PYQ time from question count');
assert.equal(flat.find((i) => i.kind === 'practice' && i.topicId === 'nf').minutes, 30, 'more practice for most-asked');
assert.deepEqual(plan.warnings.map((w) => w.text), ['Add a syllabus for Maths to plan it.']);
assert.deepEqual(plan.dropped, []);
// goals
const g1 = plan.goals.find((g) => g.subjectId === 'S1');
assert.match(g1.title, /^DBMS: finish all topics before /);
assert.equal(g1.total, 6);
const allSub = g1.subgoals.flatMap((s) => s.topics);
assert.equal(new Set(allSub).size, allSub.length, 'each topic in one sub-goal only');
assert.equal(g1.subgoals.at(-1).revision, true);
// most-asked first among unblocked DBMS topics: Transactions (asked) before ER model
assert.ok(learnDay.tx[1] < learnDay.er[1]);

// ---- not enough time -> lowest priority dropped ----
st = base(); st.prefs.minutesPerDay = 30;
plan = S.buildPlan(st, [dbms, os], today);
assert.ok(plan.dropped.length > 0);
assert.ok(plan.dropped.every((d) => d.reason.startsWith('Not enough time')));
assert.equal(S.feasibility(st, [dbms, os], today).find((f) => f.subjectId === 'S1').ok, false);

// ---- student changes ----
st = base(); st.overrides.er = { skip: true }; st.overrides.tx = { notBefore: '2026-11-13' }; st.overrides.rel = { minutes: 120 };
plan = S.buildPlan(st, [dbms, os], today);
let items = plan.days.flatMap((d) => d.items.map((i) => ({ ...i, date: d.date })));
assert.ok(!items.some((i) => i.topicId === 'er'), 'skipped topic gone');
assert.deepEqual(plan.dropped.filter((d) => d.skipped).map((d) => d.topicId), ['er']);
assert.ok(items.find((i) => i.kind === 'learn' && i.topicId === 'tx').date >= '2026-11-13', 'do it later respected');
assert.equal(items.find((i) => i.kind === 'learn' && i.topicId === 'rel').minutes, 120);
// done work leaves the plan; practice done stays out
const dbms2 = JSON.parse(JSON.stringify(dbms)); dbms2.units[1].topics[0].done = true;
st = base(); st.progress['practice:tx'] = today; st.progress['pyq:tx'] = today;
plan = S.buildPlan(st, [dbms2, os], today);
assert.ok(!plan.days.some((d) => d.items.some((i) => i.topicId === 'tx')));
assert.equal(plan.goals.find((g) => g.subjectId === 'S1').learned, 1);
// minutes already done today count against today
st = base(); st.dayDone = { [today]: 120 };
plan = S.buildPlan(st, [dbms, os], today);
assert.equal((plan.days.find((d) => d.date === today) || { items: [] }).items.length, 0, 'today full after 2h done');
// no exam date -> 60-day horizon, no revision
st = base(); st.subjects[0].examDate = ''; st.subjects[1].examDate = '2026-11-01';
plan = S.buildPlan(st, [dbms, os], today);
assert.ok(plan.warnings.some((w) => /exam date has passed/.test(w.text)));
assert.ok(!plan.days.some((d) => d.items.some((i) => i.kind === 'mock')));

// ---- topic order helpers ----
assert.deepEqual(S.removeCycles({ a: ['b'], b: ['a'], c: ['a'] }), { a: ['b'], c: ['a'] });
respond = (url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(body.task, 'plan');
  return json({ content: JSON.stringify({ topics: [{ n: 4, after: [3, 2, 4], hours: 2 }, { n: 3, after: [2], hours: 9 }, { n: 2, after: [3] }, { n: 99, after: [1] }] }) });
};
const order = await S.aiTopicOrder('DBMS', dbms, {});
assert.deepEqual(order.deps, { nf: ['sql', 'rel'], sql: ['rel'] }, 'self-link and loop removed');
assert.equal(order.hours.nf, 2);
assert.equal(order.hours.sql, 6, 'hours capped');
// syllabus record shape
const made = S.makeSyllabus({ subject: 'X', units: [{ title: 'U', topics: ['a', 'b'] }] }, { name: 'DBMS', method: 'rules' });
assert.equal(made.units[0].topics[1].title, 'b');
assert.equal(made.units[0].topics[0].done, false);
// log
const lg = S.logEvent(S.emptyStudy(), 'item.done', { a: 1 });
assert.equal(lg.log[0].kind, 'item.done');

// ---- paper finder ----
assert.deepEqual(F.paperQueries({ subject: 'DBMS', institution: 'GGSIPU', course: 'B.Tech CSE' }), ['GGSIPU DBMS previous year question paper pdf', 'DBMS B.Tech CSE previous year question paper pdf']);
assert.equal(F.paperQueries({ subject: 'GATE CS', level: 'competitive' }).length, 2);
const ranked = F.rankResults([
  { title: 'DBMS notes', url: 'https://blog.example.com/dbms', snippet: '' },
  { title: 'DBMS question paper', url: 'https://papers.example.com/dbms.pdf', snippet: '' },
  { title: 'Previous year papers', url: 'https://www.ipu.ac.in/exam/papers', snippet: '' },
  { title: 'dup', url: 'https://www.ipu.ac.in/exam/papers', snippet: '' },
  { title: 'bad', url: 'javascript:alert(1)' },
  { title: 'GGSIPU papers', url: 'https://ggsipu-papers.in/x', snippet: 'question paper' },
], { institution: 'GGSIPU University' });
assert.deepEqual(ranked.map((r) => r.host), ['ipu.ac.in', 'papers.example.com', 'ggsipu-papers.in', 'blog.example.com']);
assert.equal(ranked.find((r) => r.host === 'ggsipu-papers.in').official, false, 'a site with the college name is not official');
assert.equal(ranked[0].official, true);
assert.equal(ranked[1].pdf, true);
// search via server
respond = () => json({ error: 'Paper search isn’t set up yet.', code: 'search_not_configured' }, 503);
await assert.rejects(F.searchPapers({ subject: 'DBMS' }), (e) => e.code === 'search_not_configured');
respond = (url, opts) => { const b = JSON.parse(opts.body); assert.equal(b.task, 'search'); assert.ok(opts.headers['x-oris-install']); return json({ results: [{ title: 'Paper', url: 'https://x.ac.in/a.pdf', snippet: '' }] }); };
const res = await F.searchPapers({ subject: 'DBMS', institution: 'X' });
assert.equal(res.length, 1, 'deduped across both searches');
// fetching
const pdf = fs.readFileSync(new URL('./fixtures/dbms-paper-2023.pdf', import.meta.url));
respond = (url) => {
  if (url.endsWith('/list')) return new Response('<html><body><a href="/files/dbms-2023.pdf">DBMS Question Paper 2023</a><a href="notes.pdf">Notes</a><a href="/x">page</a></body></html>', { headers: { 'content-type': 'text/html' } });
  if (url.endsWith('.pdf')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
  return new Response('no', { status: 403 });
};
const page = await F.fetchPaper('https://uni.ac.in/exams/list');
assert.equal(page.kind, 'page');
assert.equal(page.links[0].url, 'https://uni.ac.in/files/dbms-2023.pdf', 'relative link resolved, paper first');
assert.equal(page.links.length, 2);
const got = await F.fetchPaper('https://uni.ac.in/files/dbms-2023.pdf');
assert.equal(got.kind, 'pdf');
assert.equal(got.name, 'dbms-2023');
await assert.rejects(F.fetchPaper('https://uni.ac.in/private'), /refused the download \(403\)/);

console.log('study plan engine + paper finder: all assertions passed');
