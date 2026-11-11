import assert from 'node:assert/strict';
import { emptyPlanner, applyPlannerOp, dailyFocus, visibleTasks, sessionNotes, mergePlanner } from '../lib/planner.js';
import { evaluate, formatResult } from '../lib/calc.js';
import { parseBackup } from '../lib/backup.js';
import { isBlockingActive } from '../lib/rules.js';
import { mergeSettings, mergeTimer } from '../lib/defaults.js';

// ---- planner ----
const p = emptyPlanner();
applyPlannerOp(p, 'setDaily', { text: '  Finish DBMS unit 3  ' });
assert.equal(dailyFocus(p), 'Finish DBMS unit 3');
assert.equal(dailyFocus(p, new Date(Date.now() + 86400e3)), '', 'daily focus resets the next day');
const t1 = applyPlannerOp(p, 'addTask', { title: 'Revise normalization' });
const t2 = applyPlannerOp(p, 'addTask', { title: 'Solve PYQs' });
assert.throws(() => applyPlannerOp(p, 'addTask', { title: '  ' }), /Write the task/);
applyPlannerOp(p, 'toggleTask', { id: t1.id });
assert.equal(p.tasks[0].done, true);
assert.equal(visibleTasks(p).length, 2, 'done today still visible');
p.tasks[0].doneAt = Date.now() - 2 * 86400e3;
assert.equal(visibleTasks(p).length, 1, 'done on an earlier day drops off');
applyPlannerOp(p, 'logTaskFocus', { id: t2.id, ms: 25 * 60000, completed: true });
applyPlannerOp(p, 'logTaskFocus', { id: t2.id, ms: 10 * 60000, completed: false });
assert.equal(p.tasks[1].sessions, 1);
assert.equal(p.tasks[1].focusMs, 35 * 60000);
assert.equal(applyPlannerOp(p, 'logTaskFocus', { id: 'gone', ms: 1 }), false, 'deleted task is ignored, not an error');
applyPlannerOp(p, 'moveTask', { id: t2.id, to: 0 });
assert.equal(p.tasks[0].id, t2.id);
applyPlannerOp(p, 'addNote', { text: 'BCNF: every determinant is a key', session: '123', task: 'Solve PYQs' });
applyPlannerOp(p, 'addNote', { text: 'loose note', session: null });
assert.equal(sessionNotes(p, '123').length, 1);
assert.equal(sessionNotes(p, null).length, 2, 'no session: all of today');
const link = applyPlannerOp(p, 'addLink', { url: 'nptel.ac.in/courses' });
assert.equal(link.url, 'https://nptel.ac.in/courses');
assert.equal(link.title, 'nptel.ac.in');
assert.throws(() => applyPlannerOp(p, 'addLink', { url: 'javascript:alert(1)' }), /Enter a web address/);
applyPlannerOp(p, 'setDockApp', { app: 'calc', on: false });
assert.equal(p.dock.apps.calc, false);
assert.deepEqual(mergePlanner({ dock: { apps: { calc: false } } }).dock.apps, { calc: false, stopwatch: true, links: true });

// ---- calculator ----
const ev = (s) => evaluate(s);
assert.equal(ev('2+3*4'), 14);
assert.equal(ev('(2+3)*4'), 20);
assert.equal(ev('2^3^2'), 512, 'power is right-associative');
assert.equal(ev('-2^2'), -4);
assert.equal(ev('2400*18%'), 432);
assert.equal(ev('10%3'), 1, 'modulo when a number follows');
assert.equal(ev('sqrt(144)'), 12);
assert.ok(Math.abs(ev('sin(30)') - 0.5) < 1e-12, 'degrees');
assert.equal(ev('1,20,000 / 12'), 10000, 'Indian digit grouping accepted');
assert.equal(ev('3 × 4 ÷ 2'), 6);
assert.throws(() => ev('2/0'), /divide by zero/);
assert.throws(() => ev('alert(1)'), /Unknown word/);
assert.throws(() => ev('(2+3'), /Close the bracket/);
assert.throws(() => ev('2+'), /ends too early/);
assert.equal(formatResult(1234567.5), '12,34,567.5');
assert.equal(formatResult(0.1 + 0.2), '0.3');

// ---- backup ----
const backup = JSON.stringify({ app: 'oris', version: '1.1.0', exportedAt: '2026-10-20T10:00:00Z', data: {
  settings: { focusMin: 50, groqKey: '' }, stats: { days: { '2026-10-19': { focusMs: 1, sessions: 1 } } }, timer: { status: 'running' },
  research: { projects: [{ id: 'p', name: 'X' }], activeProjectId: 'p', sources: [{ id: 's' }] }, syllabi: [{ id: 'y' }], 'ui:stopwatch': {},
} });
const res = parseBackup(backup, { groqKey: 'gsk_live', youtubeKey: 'AIza_live' });
assert.equal(res.data.settings.focusMin, 50);
assert.equal(res.data.settings.groqKey, 'gsk_live', 'device keys kept');
assert.equal(res.data.timer, undefined, 'running timer never restored');
assert.equal(res.data['ui:stopwatch'], undefined, 'unknown keys dropped');
assert.deepEqual(res.counts, { sources: 1, syllabi: 1, tasks: 0, days: 1 });
assert.throws(() => parseBackup('{not json'), /valid JSON/);
assert.throws(() => parseBackup('{"app":"other","data":{}}'), /isn’t an Oris backup/);

// ---- Focus + breaks blocking level ----
const s = mergeSettings({ blockMode: 'session' });
assert.equal(isBlockingActive(s, mergeTimer({ phase: 'short', status: 'running' })), true, 'blocks during a break');
assert.equal(isBlockingActive(s, mergeTimer({ phase: 'short', status: 'idle' })), false, 'not when the timer is stopped');
assert.equal(isBlockingActive(mergeSettings({ blockMode: 'focus' }), mergeTimer({ phase: 'short', status: 'running' })), false);

console.log('planner, calculator, backup, blocking level: all assertions passed');
