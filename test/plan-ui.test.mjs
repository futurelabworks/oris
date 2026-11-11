// 3.0 end to end in the side panel: setup wizard → plan → student edits, plus the paper finder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/sidepanel/sidepanel.html', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser', 'File', 'Blob']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const pdf = fs.readFileSync(new URL('./fixtures/dbms-paper-2023.pdf', import.meta.url));
const fetched = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  fetched.push(url);
  if (url.includes('oris-ai')) {
    const body = JSON.parse(opts.body);
    if (body.task === 'search') return new Response(JSON.stringify({ results: [
      { title: 'Previous year question papers – Exams', url: 'https://www.ipu.ac.in/exams/papers', snippet: 'question papers' },
      { title: 'DBMS notes blog', url: 'https://blog.example.com/dbms', snippet: '' },
    ] }), { status: 200 });
    return new Response(JSON.stringify({ error: 'Oris AI is busy.' }), { status: 429 });
  }
  if (url === 'https://www.ipu.ac.in/exams/papers') return new Response('<html><body><a href="/pdf/dbms-dec-2023.pdf">DBMS question paper Dec 2023</a></body></html>', { headers: { 'content-type': 'text/html' } });
  if (url.endsWith('.pdf')) return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf' } });
  return new Response('nope', { status: 404 });
};

const mock = createChrome();
mock.chrome.runtime.getURL = (p) => new URL('../' + p, import.meta.url).href; // pdf.js worker for tests
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
await chrome.storage.local.set({ settings: { ...mock.store.settings, cloudAI: false } });
await import('../sidepanel/app.js');
await tick(60);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const pick = (select, value) => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
const field = (label, root = document) => [...root.querySelectorAll('.field')].find((f) => f.querySelector('span')?.textContent.startsWith(label))?.querySelector('input, select, textarea');
const next = async () => { byText('.setup-nav button', 'Next').click(); await tick(80); };
const study = () => mock.store.study;
const toasts = () => $('#toast').textContent;
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Fresh install: Study still opens on Focus; Plan is a new tab.
assert.equal($('#subnav').textContent, 'PlanFocusBlockerSyllabus');
assert.equal($('#subnav [aria-current="page"]').textContent, 'Focus', 'existing default kept');
byText('#subnav button', 'Plan').click();
await tick();
assert.match(document.body.textContent, /Your plan to top every subject/);
byText('button', 'Make my study plan').click();
await tick();

// Step 1: about you (validation first)
assert.match($('.setup-head').textContent, /Step 1 of 6/);
assert.equal(/\bnull\b|\bundefined\b/.test(document.body.textContent), false, 'no stray null in the wizard');
await next();
assert.match(toasts(), /Add your name/);
type(field('Your name'), 'Shalu');
await next();
assert.match(toasts(), /Choose what describes you/);
$$('.choice input').find((i) => i.value === 'college').click();
await tick();
type(field('College or university'), 'GGSIPU');
type(field('Course and year'), 'B.Tech CSE, 2nd year');
await next();
assert.equal(study().profile.name, 'Shalu');
assert.equal(study().profile.level, 'college');

// Step 2: subjects
assert.match($('.setup-head').textContent, /Subjects/);
type(field('Subject'), 'DBMS');
type(field('Exam date'), iso(20));
type(field('Max marks'), '75');
pick(field('Importance'), '3');
byText('button', 'Add a subject').click();
await tick();
const rows = $$('.subject-row');
type(field('Subject', rows[1]), 'Operating Systems');
type(field('Exam date', rows[1]), iso(26));
await next();
assert.equal(study().subjects.length, 2);
assert.equal(study().subjects[0].importance, 3);
assert.equal(study().subjects[0].maxMarks, 75);

// Step 3: syllabus (paste for DBMS, skip OS)
const dbmsBox = $$('.subj-syl').find((s) => s.textContent.startsWith('DBMS'));
type(dbmsBox.querySelector('textarea'), 'UNIT 1: Transactions\nACID properties\nSerializability\nUNIT 2: Design\nER model\nNormalization\nSQL queries');
byText('button', 'Read pasted syllabus').click();
await tick(120);
const dbmsId = study().subjects[0].syllabusId;
assert.ok(dbmsId, 'syllabus linked to the subject');
assert.equal(mock.store.syllabi[0].units.length, 2);
assert.match($$('.subj-syl')[0].textContent, /✓ 2 units, 5 topics/);
byText('.setup-nav button', 'Skip for now').click();
await tick(60);

// Step 4: past papers: upload a PDF, then find one online
assert.match($('.setup-head').textContent, /Past papers/);
const up = $('.subj-syl input[type="file"]');
Object.defineProperty(up, 'files', { value: [new File([pdf], 'dbms-dec-2023.pdf', { type: 'application/pdf' })], configurable: true });
up.dispatchEvent(new dom.window.Event('change'));
await tick(900);
let syl = mock.store.syllabi.find((y) => y.id === dbmsId);
assert.equal(syl.papers.length, 1);
assert.equal(syl.papers[0].year, '2023');
assert.ok(syl.pyqs.length >= 4, `questions read from the PDF (${syl.pyqs.length})`);
byText('button', 'Find papers for me').click();
await tick(120);
assert.ok(fetched.some((u) => u.includes('oris-ai')));
const hits = $$('.find-hit');
assert.equal(hits.length, 2);
assert.match(hits[0].textContent, /Official/, 'official site first');
byText('.find-hit button', 'Open PDFs').click();
await tick(120);
assert.ok($('.find-hit.nested'), 'PDFs on the page listed');
byText('.find-hit.nested button', 'Use this').click();
await tick(900);
syl = mock.store.syllabi.find((y) => y.id === dbmsId);
assert.equal(syl.papers.length, 2, 'paper from the web added');
assert.equal(syl.papers[1].name, 'DBMS question paper Dec 2023');
assert.ok(byText('.find-hit.nested button', 'Added ✓'));
await next();

// Step 5: study time
pick(field('How long can you study'), '120');
await tick(60);
const sunday = byText('.day-btn', 'Sun');
sunday.click();
await tick(60);
assert.deepEqual(study().prefs.restDays, [0]);
assert.equal(study().prefs.minutesPerDay, 120);
await next();

// Step 6: build
assert.match(document.body.textContent, /2 subjects, 1 with a syllabus/);
byText('button', 'Build my plan').click();
await tick(120);
assert.equal(study().setupDone, true);
assert.match($('.plan-hero h2').textContent, /Hi Shalu/);
assert.match($('.plan-hero').textContent, /B\.Tech CSE, 2nd year · GGSIPU/);
assert.match($('.exam-chips').textContent, /DBMS in 20 days/);
assert.ok($$('.notice').some((n) => /Add a syllabus for Operating Systems/.test(n.textContent)));
const todayItems = () => $$('.plan-list')[0] ? [...$$('.panel')].find((p) => p.querySelector('h2')?.textContent === 'Today').querySelectorAll('.plan-item') : [];
const isRest = new Date().getDay() === 0;
if (!isRest) {
  assert.ok(todayItems().length >= 1, 'work planned for today');
  // most-asked topics first: the past papers make normalization/ACID/SQL/ER/serializability all asked; the first item is one of them
  const first = todayItems()[0];
  assert.match(first.querySelector('.plan-kind').textContent, /^Learn/);
  // Focus
  byText('.plan-item button', 'Focus').click();
  await tick(60);
  assert.equal(mock.store.timer.status, 'running');
  await chrome.runtime.sendMessage({ type: 'timer:stop' });
  // Tick off the first learn item -> syllabus topic done, logged, counted for today
  const title = first.querySelector('.plan-title').textContent;
  first.querySelector('input[type="checkbox"]').click();
  await tick(80);
  syl = mock.store.syllabi.find((y) => y.id === dbmsId);
  assert.equal(syl.units.flatMap((u) => u.topics).find((t) => t.title === title).done, true);
  assert.ok(study().dayDone[iso(0)] >= 30);
  assert.match(document.body.textContent, /✓ 1 done today/);
  // More → Do it tomorrow
  const it = todayItems()[0];
  const itTitle = it.querySelector('.plan-title').textContent;
  byText('.plan-item button', 'More').click();
  await tick();
  byText('.plan-menu button', 'Do it tomorrow').click();
  await tick(80);
  assert.ok(Object.values(study().overrides).some((o) => o.notBefore === iso(1)));
  assert.ok(![...todayItems()].some((n) => n.querySelector('.plan-title').textContent === itTitle && n.querySelector('.plan-kind').textContent.startsWith('Learn')), 'moved off today');
  // Skip a topic, then put it back
  byText('.plan-item button', 'More').click();
  await tick();
  byText('.plan-menu button', 'Skip this topic').click();
  await tick(80);
  assert.match(document.body.textContent, /Not in the plan/);
  byText('button', 'Put back').click();
  await tick(80);
  assert.ok(!Object.values(study().overrides).some((o) => o.skip));
}
// Goals and sub-goals
assert.match($('.goal-title').textContent, /^DBMS: finish all topics before /);
assert.ok($('.subgoals ol li'));
// Topic order rule chip with ×
const topicIds = mock.store.syllabi.find((y) => y.id === dbmsId).units.flatMap((u) => u.topics.map((t) => t.id));
await chrome.storage.local.set({ study: { ...study(), deps: { [topicIds[4]]: [topicIds[3]] } } });
await tick(80);
const chip = $('.dep-x');
assert.ok(chip, 'order rule shown as After …');
assert.match(chip.closest('.plan-deps').textContent, /^After /);
chip.click(); await tick(80);
assert.equal(study().deps[topicIds[4]], undefined, 'order rule removed');
// Plan settings: change exam date and importance
$('.plan-settings').open = true;
const examInput = $$('.subj-settings input[type="date"]')[0];
examInput.value = iso(30);
examInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(80);
assert.equal(study().subjects[0].examDate, iso(30));
assert.match($('.exam-chips').textContent, /DBMS in 30 days/);
pick($$('.subj-settings select')[0], '1');
await tick(80);
assert.equal(study().subjects[0].importance, 1);
// Every change is logged on the device
const kinds = study().log.map((l) => l.kind);
for (const k of ['profile', 'subjects', 'syllabus', 'prefs.minutes', 'prefs.rest', 'setup.done', 'subject.exam', 'subject.importance']) assert.ok(kinds.includes(k), `logged ${k}`);
if (!isRest) for (const k of ['item.done', 'item.later', 'topic.skip', 'topic.unskip']) assert.ok(kinds.includes(k), `logged ${k}`);
// After setup, Study opens on Plan
byText('#subnav button', 'Focus').click();
await tick();
byText('#subnav button', 'Plan').click();
await tick();
assert.equal($('#subnav [aria-current="page"]').textContent, 'Plan');
// Edit details goes back into the wizard and out again
byText('button', 'Edit my details').click();
await tick();
assert.equal(field('Your name').value, 'Shalu');
byText('button', 'Back to my plan').click();
await tick();
assert.ok($('.plan-hero'));

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('study 3.0 UI: setup wizard, PDF + web paper finder, plan, focus, done, later, skip, order rules, settings, log: all assertions passed');
process.exit(0);
