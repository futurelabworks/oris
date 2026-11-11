// Runs the real background.js against the chrome mock and walks through a focus cycle.
import assert from 'node:assert/strict';
import { createChrome } from './chrome-mock.mjs';

const mock = createChrome();
globalThis.chrome = mock.chrome;

let now = new Date('2026-10-21T10:00:00+05:30').getTime();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};

await import('../background.js');
const settle = () => new Promise((r) => setTimeout(r, 30));
const send = (msg) => chrome.runtime.sendMessage(msg);

await mock.fire.installed();
await settle();
assert.ok(mock.store.settings, 'defaults written on install');
assert.equal(mock.store.timer.status, 'idle');
assert.equal(mock.rules.length, 0, 'no blocking while idle in "during focus" mode');

// Open tab on a blocked site should be redirected when focus starts.
mock.tabs.push({ id: 1, url: 'https://www.instagram.com/reels/' }, { id: 2, url: 'https://www.youtube.com/watch?v=x' });

let res = await send({ type: 'timer:start', phase: 'focus', task: 'DBMS unit 2' });
assert.ok(res.ok, res.error);
await settle();
assert.equal(mock.store.timer.status, 'running');
assert.equal(mock.store.timer.task, 'DBMS unit 2');
assert.equal(mock.rules.length, 1, 'block rule added');
assert.deepEqual(mock.rules[0].condition.requestDomains.slice(0, 2), ['instagram.com', 'facebook.com']);
assert.equal(mock.rules[0].action.redirect.regexSubstitution, 'chrome-extension://testextid/blocked/blocked.html#\\0');
assert.ok(mock.alarms.has('oris-phase-end'));
assert.equal(mock.badge.text, '25m');
assert.ok(mock.tabs[0].url.startsWith('chrome-extension://testextid/blocked/blocked.html#https://www.instagram.com'), 'blocked tab redirected');
assert.equal(mock.tabs[1].url, 'https://www.youtube.com/watch?v=x', 'allowed tab untouched');

// Pause / resume keeps blocking and the remaining time.
now += 5 * 60000;
res = await send({ type: 'timer:pause' });
assert.equal(res.timer.status, 'paused');
assert.equal(res.timer.remainingMs, 20 * 60000);
assert.equal(mock.rules.length, 1, 'still blocking while paused');
assert.equal(mock.badge.text, '||');
now += 60 * 60000; // long pause
res = await send({ type: 'timer:resume' });
assert.equal(res.timer.endsAt, now + 20 * 60000);

// Phase end -> stats + auto-start short break, blocking lifted.
now += 20 * 60000;
await mock.fire.alarm('oris-phase-end');
await settle();
let t = mock.store.timer;
assert.equal(t.phase, 'short');
assert.equal(t.status, 'running', 'break auto-started');
assert.equal(t.completedFocus, 1);
const day = mock.store.stats.days['2026-10-21'];
assert.equal(day.sessions, 1);
assert.equal(day.focusMs, 25 * 60000);
assert.equal(mock.rules.length, 0, 'not blocking during break');
assert.equal(mock.notifications.at(-1).title, 'Focus session complete');

// Break end -> focus is waiting (autoStartFocus off by default).
now += 5 * 60000;
await mock.fire.alarm('oris-phase-end');
await settle();
t = mock.store.timer;
assert.equal(t.phase, 'focus');
assert.equal(t.status, 'idle');
assert.ok(mock.notifications.at(-1).buttons, 'notification offers a start button');

// Hard mode: can't pause or stop a focus session.
await chrome.storage.local.set({ settings: { ...mock.store.settings, hardMode: true } });
await settle();
res = await send({ type: 'timer:start', phase: 'focus' });
assert.ok(res.ok);
res = await send({ type: 'timer:pause' });
assert.equal(res.ok, false);
assert.match(res.error, /Hard mode/);
res = await send({ type: 'timer:stop' });
assert.equal(res.ok, false);
assert.equal(mock.store.timer.status, 'running');

// Run 3 more focus sessions -> 4th completion triggers a long break.
await chrome.storage.local.set({ settings: { ...mock.store.settings, hardMode: false, autoStartBreaks: false } });
await settle();
for (let i = 0; i < 3; i++) {
  if (mock.store.timer.status !== 'running') await send({ type: 'timer:start', phase: 'focus' });
  now += 25 * 60000;
  await mock.fire.alarm('oris-phase-end');
  await settle();
  if (i < 2) {
    assert.equal(mock.store.timer.phase, 'short');
    assert.equal(mock.store.timer.status, 'idle');
    await send({ type: 'timer:skip' }); // skip the pending break
    assert.equal(mock.store.timer.phase, 'focus');
  }
}
assert.equal(mock.store.timer.completedFocus, 4);
assert.equal(mock.store.timer.phase, 'long', 'long break after 4 sessions');
assert.equal(mock.store.stats.days['2026-10-21'].sessions, 4);

// Stop early counts the minutes but not a session.
await send({ type: 'timer:skip' });
await send({ type: 'timer:start', phase: 'focus' });
now += 10 * 60000;
res = await send({ type: 'timer:stop' });
assert.ok(res.ok);
assert.equal(mock.store.stats.days['2026-10-21'].sessions, 4);
assert.equal(mock.store.stats.days['2026-10-21'].focusMs, 4 * 25 * 60000 + 10 * 60000);
assert.equal(mock.store.timer.status, 'idle');
assert.equal(mock.badge.text, '');

// Allow-list + always mode.
await chrome.storage.local.set({ settings: { ...mock.store.settings, blockMode: 'always', listType: 'allow' } });
await settle();
assert.equal(mock.rules.length, 1);
assert.ok(mock.rules[0].condition.excludedRequestDomains.includes('youtube.com'));
assert.equal(mock.rules[0].condition.requestDomains, undefined);
mock.tabs.push({ id: 3, url: 'https://news.example.com/' });
await chrome.storage.local.set({ settings: { ...mock.store.settings, allowlist: [...mock.store.settings.allowlist, 'example.org'] } });
await settle();
assert.ok(mock.tabs.find((x) => x.id === 3).url.includes('blocked.html'), 'non-allowed tab swept after list change');

// Keyboard command toggles.
await chrome.storage.local.set({ settings: { ...mock.store.settings, blockMode: 'off' } });
await settle();
await mock.fire.command('toggle-timer');
await settle();
assert.equal(mock.store.timer.status, 'running');
await mock.fire.command('toggle-timer');
await settle();
assert.equal(mock.store.timer.status, 'paused');

console.log('background: all assertions passed');
