// 3.1 lectures library, YouTube lookups and the player bridge (relay + direct fallback).
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';

const mock = createChrome();
globalThis.chrome = mock.chrome;
let respond = null;
const calls = [];
globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return respond(String(url), opts); };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const L = await import('../lib/lectures.js');
const Y = await import('../lib/yt.js');

// ---- links ----
assert.deepEqual(Y.parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90'), { videoId: 'dQw4w9WgXcQ', playlistId: '', start: 90 });
assert.deepEqual(Y.parseYouTubeUrl('youtu.be/dQw4w9WgXcQ?t=1m5s'), { videoId: 'dQw4w9WgXcQ', playlistId: '', start: 65 });
assert.equal(Y.parseYouTubeUrl('https://m.youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
assert.deepEqual(Y.parseYouTubeUrl('https://www.youtube.com/playlist?list=PLabcdefghij123'), { videoId: '', playlistId: 'PLabcdefghij123', start: 0 });
assert.equal(Y.parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx1234567890').playlistId, 'PLx1234567890');
assert.equal(Y.parseYouTubeUrl('dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
assert.equal(Y.parseYouTubeUrl('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
assert.equal(Y.parseYouTubeUrl('not a link'), null);

// ---- playlist order ----
const T = (id, title, extra = {}) => ({ id, title, done: false, ...extra });
const syl = {
  id: 'S', name: 'DBMS', subject: 'DBMS',
  units: [
    { id: 'u1', title: 'Design', topics: [T('nf', 'Normalization'), T('sql', 'SQL queries'), T('er', 'ER model', { videos: [{ id: 'erVideo0001', title: 'ER model lecture', channel: 'Prof', durationSec: 1800, thumb: 't' }] })] },
    { id: 'u2', title: 'Transactions', topics: [T('acid', 'ACID properties')] },
  ],
};
const deps = { nf: ['sql'], sql: ['er'] };
assert.deepEqual(L.orderedTopics(syl, deps).map((x) => x.topic.id), ['er', 'sql', 'nf', 'acid'], 'prerequisites first');
assert.deepEqual(L.orderedTopics(syl, { a: ['b'], er: ['nf'], nf: ['er'] }).map((x) => x.topic.id).sort(), ['acid', 'er', 'nf', 'sql'], 'cycles don’t hang');
let lect = L.mergeLectures({ videos: { sql: { videoId: 'sqlVideo001', title: 'SQL', seconds: 600 } }, extras: { S: [{ videoId: 'extraVid001', title: 'Bonus' }] }, progress: { sqlVideo001: { done: true, dur: 600, max: 600 } } });
let rows = L.playlistFor(syl, lect, deps);
assert.equal(rows[0].video.videoId, 'erVideo0001', 'best video from Syllabus used');
assert.equal(rows[0].video.source, 'syllabus');
assert.equal(rows[1].video.videoId, 'sqlVideo001');
assert.equal(rows.at(-1).topic, null, 'extras at the end');
assert.deepEqual(L.playlistStats(rows), { topics: 4, withVideo: 2, done: 1, seconds: 2400 });

// ---- watching ----
let p = null;
let r = L.trackTick(p, { t: 0, d: 600, playing: false, dt: 0.5 });
r = L.trackTick(r.p, { t: 590, d: 600, playing: true, dt: 0.5 });
assert.equal(r.p.watched, 0, 'jumping ahead isn’t watching');
assert.equal(r.justDone, false, 'skipping to the end doesn’t complete');
p = null; let doneCount = 0;
for (let t = 0; t <= 560; t += 2) { r = L.trackTick(p, { t, d: 600, playing: true, dt: 2 }); p = r.p; if (r.justDone) doneCount++; }
assert.equal(p.done, true);
assert.equal(doneCount, 1, 'completes once');
assert.ok(p.watched >= 550);
r = L.trackTick(p, { t: 100, d: 600, playing: false, dt: 0.5 });
assert.equal(r.p.max, 560, 'furthest point kept after seeking back');

// ---- points, imports, notes ----
lect = L.mergeLectures({});
L.addPoints(lect, 'watch', 20, 'v'); L.addPoints(lect, 'quiz', 15, 'v');
assert.equal(lect.points.total, 35);
assert.equal(lect.points.log.length, 2);
lect.videos.sql = { videoId: 'myOwnPick01', source: 'link' };
const imp = L.assignImported([
  { id: 'v0000000001', title: 'Lecture 1: ER model and diagrams', channel: 'C', durationSec: 900 },
  { id: 'v0000000002', title: 'Lecture 2: SQL queries part 1', channel: 'C', durationSec: 900 },
  { id: 'v0000000003', title: 'Lecture 3: ACID properties of transactions', channel: 'C', durationSec: 900 },
  { id: 'v0000000004', title: 'Lecture 4: ER model examples', channel: 'C', durationSec: 900 },
  { id: 'v0000000005', title: 'Course intro', channel: 'C', durationSec: 300 },
], syl, lect);
assert.deepEqual(Object.keys(imp.assigned).sort(), ['acid', 'er']);
assert.equal(imp.assigned.er.videoId, 'v0000000001', 'first match wins');
assert.equal(imp.extras.length, 3, 'student’s own pick kept, duplicates and intro go to the end');
const md = L.notesMarkdown({ videoId: 'abcdefghijk', title: 'ACID', channel: 'Prof' }, [{ t: 125, text: 'Atomicity = all or nothing', sticky: true }, { t: 5, text: 'Intro' }], 'ACID properties');
assert.match(md, /^# ACID properties/);
assert.ok(md.indexOf('Intro') < md.indexOf('Atomicity'), 'sorted by time');
assert.match(md, /\[2:05\]\(https:\/\/youtu\.be\/abcdefghijk\?t=125\) 📌 Atomicity/);
assert.equal(L.fmtTime(3725), '1:02:05');
assert.equal(L.playerUrl('chrome-extension://x/player/player.html', { videoId: 'abcdefghijk', topicId: 'acid', syllabusId: 'S', start: 12.7 }), 'chrome-extension://x/player/player.html#v=abcdefghijk&topic=acid&syl=S&t=12');

// ---- quiz ----
respond = (url, opts) => {
  const b = JSON.parse(opts.body);
  assert.equal(b.task, 'quiz');
  assert.match(b.messages[1].content, /\(2:05\) Atomicity/, 'notes sent with times');
  return json({ content: JSON.stringify({ questions: [
    { q: 'Atomicity means?', options: ['All or nothing', 'Fast', 'Slow', 'Sorted'], answer: 'A', explain: 'Yes.' },
    { q: 'Bad one', options: ['x', 'y'], answer: 'z' },
    { q: 'Durability?', options: ['Survives crashes', 'Locks'], answer: 'Survives crashes' },
  ] }) });
};
const qz = await L.aiQuiz({ topic: 'ACID', subject: 'DBMS', videoTitle: 'ACID', notes: [{ t: 125, text: 'Atomicity' }] }, {});
assert.equal(qz.length, 2);
assert.equal(qz[0].answer, 'All or nothing');

// ---- YouTube through the server / own key ----
respond = () => json({ error: 'Lecture search isn’t set up yet.', code: 'yt_not_configured' }, 503);
await assert.rejects(Y.topicVideos('ACID', 'DBMS', {}), (e) => e.code === 'yt_not_configured');
respond = (url, opts) => {
  const b = JSON.parse(opts.body);
  assert.equal(b.task, 'yt');
  if (b.action === 'search') { assert.match(b.query, /ACID DBMS/); return json({ videos: [
    { id: 'short000001', title: 'Short', durationSec: 50, views: 9e6, likes: 1e5 },
    { id: 'good0000001', title: 'ACID full lecture', durationSec: 1500, views: 2e5, likes: 8e3 },
    { id: 'live0000001', title: 'Live', durationSec: 3000, views: 5, likes: 0, live: true },
  ] }); }
  if (b.action === 'playlists') return json({ playlists: [{ id: 'PL1', title: 'DBMS course', count: 40 }] });
  if (b.action === 'playlist') { assert.equal(b.id, 'PLabc1234567'); return json({ videos: [{ id: 'v1', title: 'L1' }] }); }
};
const vids = await Y.topicVideos('ACID', 'DBMS', {});
assert.deepEqual(vids.map((v) => v.id), ['good0000001'], 'shorts and live streams filtered');
assert.equal((await Y.findPlaylists('DBMS', {}))[0].count, 40);
assert.equal((await Y.playlistVideos('PLabc1234567', {})).length, 1);
calls.length = 0;
respond = (url) => {
  if (url.includes('/search?')) return json({ items: [{ id: { videoId: 'own00000001' } }] });
  return json({ items: [{ id: 'own00000001', snippet: { title: 'Own key', channelTitle: 'C', thumbnails: {} }, contentDetails: { duration: 'PT20M' }, statistics: { viewCount: '100', likeCount: '5' } }] });
};
const own = await Y.topicVideos('ACID', 'DBMS', { youtubeKey: 'AIzaOWN' });
assert.equal(own[0].id, 'own00000001');
assert.ok(calls.every((c) => c.url.startsWith('https://www.googleapis.com/youtube/v3/')), 'own key goes straight to YouTube');

// ---- player bridge ----
const dom = new JSDOM('<!doctype html><div id="c"></div>', { url: 'chrome-extension://abcdefghijklmnop/player/player.html' });
const win = dom.window;
const { createBridge, RELAY_URL } = await import('../lib/player-bridge.js');
const events = [];
const posted = [];
const frame = () => win.document.querySelector('#c iframe');
const spy = () => { const f = frame(); f.contentWindow.postMessage = (m, o) => posted.push([m, o]); return f; };
let b = createBridge(win.document.getElementById('c'), { videoId: 'abcdefghijk', start: 30, onEvent: (e) => events.push(e), timeoutMs: 60, win });
let f = spy();
assert.ok(f.src.startsWith(RELAY_URL + '#'), 'relay first');
const q = new URLSearchParams(f.src.split('#')[1]);
assert.equal(q.get('v'), 'abcdefghijk');
assert.equal(q.get('t'), '30');
assert.equal(q.get('o'), 'chrome-extension://abcdefghijklmnop');
const relayMsg = (data, origin = 'https://futurelabworks.github.io', source = f.contentWindow) => win.dispatchEvent(new win.MessageEvent('message', { data, origin, source }));
relayMsg({ oris: 1, type: 'ready', d: 600 }, 'https://evil.example.com');
relayMsg({ oris: 1, type: 'ready', d: 600 }, 'https://futurelabworks.github.io', win);
assert.equal(events.length, 0, 'ignores other origins and sources');
relayMsg({ oris: 1, type: 'ready', d: 600 });
assert.deepEqual(events.slice(0, 2), [{ type: 'mode', mode: 'relay' }, { type: 'ready', d: 600 }]);
relayMsg({ oris: 1, type: 'time', t: 31, d: 600, state: 1, rate: 1 });
assert.deepEqual(events.at(-1), { type: 'time', t: 31, d: 600, state: 1, rate: 1 });
b.seek(90); b.rate(1.5); b.pause();
assert.deepEqual(posted.map(([m]) => m.cmd), ['seekTo', 'setPlaybackRate', 'pauseVideo']);
assert.equal(posted[0][1], 'https://futurelabworks.github.io', 'commands only to the relay origin');
assert.deepEqual(posted[0][0].args, [90, true]);
await new Promise((res) => setTimeout(res, 120));
assert.ok(frame().src.startsWith(RELAY_URL), 'no fallback once ready');
b.destroy();
// relay silent -> direct embed
events.length = 0;
b = createBridge(win.document.getElementById('c'), { videoId: 'abcdefghijk', onEvent: (e) => events.push(e), timeoutMs: 50, win });
await new Promise((res) => setTimeout(res, 90));
f = spy();
assert.ok(f.src.startsWith('https://www.youtube-nocookie.com/embed/abcdefghijk?'), 'falls back to direct');
assert.match(f.src, /enablejsapi=1/);
assert.match(f.src, /origin=chrome-extension%3A%2F%2Fabcdefghijklmnop/);
win.dispatchEvent(new win.MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12, duration: 700, playerState: 1, playbackRate: 1 } }), origin: 'https://www.youtube-nocookie.com', source: f.contentWindow }));
assert.deepEqual(events.slice(0, 2), [{ type: 'mode', mode: 'direct' }, { type: 'ready', d: 700 }]);
assert.deepEqual(events.at(-1), { type: 'time', t: 12, d: 700, state: 1, rate: 1 });
b.play();
assert.deepEqual(JSON.parse(posted.at(-1)[0]), { event: 'command', func: 'playVideo', args: [], id: 'oris', channel: 'widget' });
assert.equal(posted.at(-1)[1], 'https://www.youtube-nocookie.com');
b.destroy();
// embed refused (150) on relay -> direct; then nothing -> fail
events.length = 0;
b = createBridge(win.document.getElementById('c'), { videoId: 'abcdefghijk', onEvent: (e) => events.push(e), timeoutMs: 40, win });
f = frame();
relayMsg({ oris: 1, type: 'error', code: 150 }, 'https://futurelabworks.github.io', f.contentWindow);
assert.ok(frame().src.includes('youtube-nocookie'), 'error 150 before ready tries direct');
await new Promise((res) => setTimeout(res, 80));
assert.deepEqual(events.at(-1), { type: 'fail' });
b.destroy();
// a removed video is final: no fallback
events.length = 0;
b = createBridge(win.document.getElementById('c'), { videoId: 'abcdefghijk', onEvent: (e) => events.push(e), timeoutMs: 400, win });
f = frame();
relayMsg({ oris: 1, type: 'error', code: 100 }, 'https://futurelabworks.github.io', f.contentWindow);
assert.deepEqual(events.at(-1), { type: 'error', code: 100 });
assert.ok(frame().src.startsWith(RELAY_URL));
b.destroy();
// direct only
b = createBridge(win.document.getElementById('c'), { videoId: 'abcdefghijk', mode: 'direct', onEvent: () => {}, timeoutMs: 400, win });
assert.ok(frame().src.includes('youtube-nocookie'));
b.destroy();

console.log('lectures library, YouTube lookups, player bridge: all assertions passed');
process.exit(0);
