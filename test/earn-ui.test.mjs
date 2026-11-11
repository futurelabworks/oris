// Earn 2.0 end to end in the side panel: income, privacy, CSV, work timer, jobs + follow-up
// reminder, skills with focus time, rewards and badge toasts.
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
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, href: this.href }); };
const blobs = new Map();
globalThis.URL.createObjectURL = (b) => { const id = 'blob:' + blobs.size; blobs.set(id, b); return id; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.fetch = async () => new Response('no', { status: 404 });

const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
await import('../sidepanel/app.js');
await tick(60);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const pick = (select, value) => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const field = (label) => $$('.field').find((f) => f.querySelector('span')?.textContent.startsWith(label))?.querySelector('input, select, textarea');
const toasts = () => $$('.toast').map((t) => t.textContent).join(' | ');

assert.ok(mock.store.earn, 'earn store created on install');
byText('.modes button', 'Earn').click();
await tick(80);
assert.equal($('#subnav').textContent, 'OverviewWorkJobsSkillsRewards');

// ---- Overview: add income ----
assert.match(document.body.textContent, /Log what you earn/);
byText('button', 'Add income').click();
await tick();
type(field('Amount'), '12500');
type(field('From'), 'Acme Studio');
submit($('.earn-form'));
await tick(80);
assert.equal(mock.store.earn.income.length, 1);
assert.equal(mock.store.earn.income[0].amount, 12500);
await tick(900); // badge check is debounced
assert.match($('.stat strong').textContent, /₹\s?12,500/, 'month total in rupees');
assert.match(toasts(), /badges? unlocked:.*First earning/i, 'first income badge celebrated');

// pending invoice
byText('button', 'Add income').click();
await tick();
type(field('Amount'), '3000');
type(field('From'), 'Blog client');
$$('.earn-form input[type="checkbox"]')[0].click();
submit($('.earn-form'));
await tick(80);
assert.equal(mock.store.earn.income[0].paid, false);
assert.match($$('.stat strong')[1].textContent, /3,000/, 'waiting to be paid');
byText('button', 'Mark received').click();
await tick(80);
assert.equal(mock.store.earn.income.find((i) => i.source === 'Blog client').paid, true);

// privacy
byText('button', 'Hide amounts').click();
await tick(80);
assert.equal(mock.store.earn.privacy, true);
assert.equal(/12,500|15,500/.test(document.body.textContent), false, 'amounts hidden');
assert.match($('.stat strong').textContent, /•••/);
byText('button', 'Show amounts').click();
await tick(80);

// CSV
byText('button', 'Download CSV').click();
await tick();
const csv = await blobs.get(downloads.at(-1).href).text();
assert.match(downloads.at(-1).name, /^oris-income-\d{4}-\d{2}-\d{2}\.csv$/);
assert.match(csv, /Acme Studio/);

// ---- Work: client, timer, manual entry ----
byText('#subnav button', 'Work').click();
await tick(60);
assert.match(document.body.textContent, /Track paid work/);
type($('.add-client input'), 'Acme Studio');
type($('.add-client .rate'), '800');
submit($('.add-client'));
await tick(80);
assert.equal(mock.store.earn.clients[0].rate, 800);
type(field('What are you doing'), 'Landing page');
submit($('.work-card'));
await tick(80);
assert.ok(mock.store.earn.work, 'timer running');
assert.ok($('.work-clock'));
// pretend 90 minutes passed
mock.store.earn.work.startedAt -= 90 * 60000;
byText('button', 'Stop and log time').click();
await tick(80);
assert.equal(mock.store.earn.work, null);
assert.equal(mock.store.earn.entries[0].minutes, 90);
assert.match(document.body.textContent, /1h 30m/);
assert.match(document.body.textContent, /₹\s?1,200/, 'value of the work at ₹800/h');
byText('button', 'Add time by hand').click();
await tick();
type(field('Hours'), '2');
submit($('.manual-entry'));
await tick(80);
assert.equal(mock.store.earn.entries.length, 2);
assert.equal(mock.store.earn.entries.reduce((a, e) => a + e.minutes, 0), 210);

// ---- Jobs ----
byText('#subnav button', 'Jobs').click();
await tick(60);
byText('button', 'Add an application').click();
await tick();
type(field('Company'), 'Razorpay');
type(field('Role'), 'ML intern');
submit($('.earn-form'));
await tick(80);
const job = mock.store.earn.jobs[0];
assert.equal(job.stage, 'saved');
byText('button', 'Focus on applying').click();
await tick(80);
assert.equal(mock.store.timer.status, 'running');
assert.equal(mock.store.timer.task, 'Apply: ML intern at Razorpay');
await chrome.runtime.sendMessage({ type: 'timer:stop' });
pick($('.stage-select'), 'applied');
await tick(80);
assert.equal(mock.store.earn.jobs[0].stage, 'applied');
assert.ok(mock.store.earn.jobs[0].appliedAt);
// follow-up due today → reminder notification
const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
await chrome.runtime.sendMessage({ type: 'earn:op', op: 'updateJob', args: { id: job.id, patch: { followUp: iso } } });
await tick(60);
assert.ok($('.job.due'), 'due follow-up highlighted');
await mock.fire.alarm('oris-followups');
await tick(60);
assert.ok(mock.notifications.some((n) => /Razorpay/.test(n.message || n.title || '')), 'follow-up notification sent');
const before = mock.notifications.length;
await mock.fire.alarm('oris-followups');
await tick(60);
assert.equal(mock.notifications.length, before, 'reminds only once a day');

// ---- Skills ----
byText('#subnav button', 'Skills').click();
await tick(60);
type(field('Skill'), 'Python for ML');
submit($('.earn-form'));
await tick(80);
const skill = mock.store.earn.skills[0];
type($('.add-step input'), 'NumPy basics');
submit($('.add-step'));
await tick(80);
assert.equal(mock.store.earn.skills[0].milestones.length, 1);
byText('.steps button', 'Focus').click();
await tick(80);
assert.equal(mock.store.timer.skillId, skill.id);
// finish the session: shift start back 25 min and complete
mock.store.timer.endsAt = Date.now() - 1000;
mock.store.timer.focusStartedAt = Date.now() - 25 * 60000;
await mock.fire.alarm('oris-phase-end');
await tick(100);
assert.ok(mock.store.earn.skills[0].focusMs >= 24 * 60000, 'focus time counted to the skill');
$('.steps input[type="checkbox"]').click();
await tick(80);
assert.equal(mock.store.earn.skills[0].milestones[0].done, true);

// ---- Rewards ----
byText('#subnav button', 'Rewards').click();
await tick(60);
assert.match($('.level-big').textContent, /^Level \d+$/);
assert.ok($$('.xp-table tbody tr').length >= 6);
assert.ok($$('.badge-grid li.got').length >= 3, 'several badges earned');
assert.deepEqual([...new Set(mock.store.earn.seenBadges)].length, mock.store.earn.seenBadges.length);

// ---- deletes are two-tap ----
byText('#subnav button', 'Overview').click();
await tick(60);
const n = mock.store.earn.income.length;
const del = $('.income-list .icon-btn');
del.click();
await tick();
assert.equal(mock.store.earn.income.length, n, 'first tap only arms');
del.click();
await tick(80);
assert.equal(mock.store.earn.income.length, n - 1);

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN text');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('earn 2.0 UI: income, privacy, CSV, work timer, jobs + reminders, skills, rewards: all assertions passed');
process.exit(0);
