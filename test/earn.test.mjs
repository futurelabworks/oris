import assert from 'node:assert/strict';
import { emptyEarn, applyEarnOp, EARN_OPS, earnSummary, clientTotals, incomeCsv, workCsv, formatMoney, mergeEarn } from '../lib/earn.js';
import { xpBreakdown, levelFor, badges, newBadges, bestStreak } from '../lib/rewards.js';

const e = emptyEarn();
// ---- clients + work timer ----
const c = applyEarnOp(e, 'addClient', { name: 'Kukje Overseas', rate: '1,200' });
assert.equal(c.rate, 1200, 'rate parsed with comma');
assert.throws(() => applyEarnOp(e, 'addClient', { name: '' }), /Give the client/);
assert.throws(() => applyEarnOp(e, 'addClient', { name: 'X', rate: 'abc' }), /hourly rate/);
const t0 = new Date('2026-11-04T10:00:00+05:30').getTime();
EARN_OPS.startWork(e, { clientId: c.id, note: 'Homepage' }, t0);
assert.throws(() => EARN_OPS.startWork(e, { clientId: c.id }, t0), /already running/);
const entry = EARN_OPS.stopWork(e, {}, t0 + 90 * 60000);
assert.equal(entry.minutes, 90);
assert.equal(entry.rate, 1200);
assert.equal(e.work, null);
EARN_OPS.startWork(e, { clientId: c.id }, t0);
assert.equal(EARN_OPS.stopWork(e, {}, t0 + 20000), null, 'under a minute is not logged');
applyEarnOp(e, 'addEntry', { clientId: c.id, date: '2026-11-03', minutes: 30, note: 'Call' });
assert.throws(() => applyEarnOp(e, 'addEntry', { clientId: c.id, date: '2026-11-03', minutes: 0 }), /minutes/);
assert.deepEqual(clientTotals(e, c.id), { minutes: 120, billed: 2400 });

// ---- income ----
applyEarnOp(e, 'addIncome', { amount: '3000', date: '2026-11-02', clientId: c.id, category: 'freelance' });
applyEarnOp(e, 'addIncome', { amount: 1500, date: '2026-10-15', source: 'Fiverr', category: 'gig' });
const pend = applyEarnOp(e, 'addIncome', { amount: 2000, date: '2026-11-04', source: 'Upwork', paid: false });
applyEarnOp(e, 'addIncome', { amount: 400, date: '2026-11-01', source: 'Amazon Associates', category: 'affiliate', passive: true });
assert.equal(e.income[0].source, 'Upwork', 'newest first');
assert.equal(e.income.find((i) => i.amount === 3000).source, 'Kukje Overseas', 'source defaults to the client');
assert.throws(() => applyEarnOp(e, 'addIncome', { amount: 0, date: '2026-11-01', source: 'x' }), /Enter the amount/);
assert.throws(() => applyEarnOp(e, 'addIncome', { amount: 5, date: 'yesterday', source: 'x' }), /Pick the date/);

const now = new Date('2026-11-04T18:00:00+05:30');
let sum = earnSummary(e, now);
assert.equal(sum.monthIncome, 3400, 'paid this month only');
assert.equal(sum.pending, 2000);
assert.equal(sum.monthMinutes, 120);
assert.equal(sum.billed, 2400);
assert.equal(sum.perHour, 1500, '3000 paid / 2 hours');
assert.equal(sum.months.length, 6);
assert.equal(sum.months.at(-1).total, 3400);
assert.equal(sum.months.at(-2).total, 1500);
assert.equal(sum.topSources[0].source, 'Kukje Overseas');
assert.ok(Math.abs(sum.passiveShare - 400 / 4900) < 1e-9);
applyEarnOp(e, 'markPaid', { id: pend.id });
assert.equal(earnSummary(e, now).monthIncome, 5400);

// ---- jobs ----
const j = applyEarnOp(e, 'addJob', { company: 'Razorpay', role: 'AI/ML intern', kind: 'internship', link: 'razorpay.com/jobs/1', followUp: '2026-11-03' });
assert.equal(j.link, 'https://razorpay.com/jobs/1');
assert.equal(j.stage, 'saved');
assert.throws(() => applyEarnOp(e, 'addJob', {}), /company or the role/);
applyEarnOp(e, 'updateJob', { id: j.id, patch: { stage: 'applied' } });
assert.ok(e.jobs[0].appliedAt);
assert.equal(earnSummary(e, now).followUps.length, 1, 'follow-up due');
applyEarnOp(e, 'updateJob', { id: j.id, patch: { stage: 'interview' } });

// ---- skills ----
const sk = applyEarnOp(e, 'addSkill', { name: 'Python for ML', goal: 'Land an ML internship' });
const m1 = applyEarnOp(e, 'addMilestone', { skillId: sk.id, title: 'Python basics course', link: 'nptel.ac.in/x' });
const m2 = applyEarnOp(e, 'addMilestone', { skillId: sk.id, title: 'Build a classifier project' });
applyEarnOp(e, 'toggleMilestone', { skillId: sk.id, id: m1.id });
applyEarnOp(e, 'logSkillFocus', { id: sk.id, ms: 50 * 60000 });
assert.equal(e.skills[0].focusMs, 50 * 60000);
assert.equal(e.skills[0].milestones[0].link, 'https://nptel.ac.in/x');

// ---- CSV ----
const csv = incomeCsv(e);
assert.match(csv, /^Date,Source,Category,Amount,Currency,Paid,Passive,Note\r\n/);
applyEarnOp(e, 'addIncome', { amount: 10, date: '2026-11-04', source: '=HYPERLINK("x")' });
assert.match(incomeCsv(e), /"'=HYPERLINK\(""x""\)"/, 'formula injection neutralised');
assert.match(workCsv(e), /2026-11-04,Kukje Overseas,90,1\.50,1200,1800\.00,Homepage/);

// ---- money ----
assert.equal(formatMoney(125000, 'INR'), '₹1,25,000');
assert.equal(formatMoney(99.5, 'INR'), '₹99.50');
assert.equal(formatMoney(5, 'INR', true), '₹ •••');
assert.equal(mergeEarn({ currency: 'bad', work: {} }).currency, 'INR');

// ---- rewards ----
const stats = { days: { '2026-11-01': { focusMs: 50 * 60000, sessions: 2 }, '2026-11-02': { focusMs: 25 * 60000, sessions: 1 }, '2026-11-03': { focusMs: 25 * 60000, sessions: 1 }, '2026-10-20': { focusMs: 0, sessions: 0 } } };
assert.equal(bestStreak(stats), 3);
const data = { stats, planner: { tasks: [{ done: true }, { done: false }] }, research: { sources: [{}, {}] }, earn: e };
const xp = xpBreakdown(data);
const get = (l) => xp.items.find((i) => i.label === l);
assert.equal(get('Focus minutes').xp, 100);
assert.equal(get('Completed sessions').xp, 40);
assert.equal(get('Tasks done').xp, 5);
assert.equal(get('Sources saved').xp, 6);
assert.equal(get('Applications sent').xp, 15);
assert.equal(get('Skill steps finished').xp, 25);
assert.equal(get('Hours of client work').xp, 20);
assert.equal(get('Payments received').count, 5);
assert.equal(xp.total, xp.items.reduce((a, i) => a + i.xp, 0));
assert.deepEqual(levelFor(0), { level: 1, into: 0, span: 100, toNext: 100 });
assert.deepEqual(levelFor(100), { level: 2, into: 0, span: 200, toNext: 200 });
assert.deepEqual(levelFor(650), { level: 4, into: 50, span: 400, toNext: 350 });
const b = badges(data);
const has = (id) => b.find((x) => x.id === id).got;
assert.ok(has('first-session') && has('streak-3') && has('first-apply') && has('interview') && has('first-step') && has('first-income'));
assert.ok(!has('offer') && !has('skill-done') && !has('earned-1') && !has('streak-7'));
applyEarnOp(e, 'toggleMilestone', { skillId: sk.id, id: m2.id });
assert.ok(badges(data).find((x) => x.id === 'skill-done').got, 'all steps done');
applyEarnOp(e, 'addIncome', { amount: 6000, date: '2026-11-04', source: 'Client' });
assert.ok(badges(data).find((x) => x.id === 'earned-1').got, '₹10,000 total');
const fresh = newBadges(data, []);
applyEarnOp(e, 'markBadgesSeen', { ids: fresh.map((x) => x.id) });
assert.equal(newBadges(data, e.seenBadges).length, 0);

console.log('earn + rewards: all assertions passed');
