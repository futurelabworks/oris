// 2.1: AI routing — own Groq key vs Oris AI server, install id, limits, off switch, fallbacks.
import assert from 'node:assert/strict';
import { createChrome } from './chrome-mock.mjs';

const mock = createChrome();
globalThis.chrome = mock.chrome;
const calls = [];
let serverReply = () => new Response(JSON.stringify({ content: JSON.stringify({ summary: 'Server summary.', points: ['A', 'B'] }) }), { status: 200, headers: { 'x-oris-left': '29' } });
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
  if (String(url).includes('api.groq.com')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Own key summary.', points: ['X'] }) } }] }), { status: 200 });
  return serverReply();
};

const { chatJSON, hasAI, aiRoute, installId, freeLeft, ORIS_AI_URL } = await import('../lib/ai.js');
const { summarize } = await import('../lib/summarize.js');
const { parseSyllabus } = await import('../lib/syllabus.js');
const { DEFAULT_SETTINGS } = await import('../lib/defaults.js');
const text = 'The monsoon reaches Kerala in early June each year. '.repeat(12);

assert.equal(DEFAULT_SETTINGS.cloudAI, true, 'Oris AI on by default');
assert.equal(aiRoute({}), 'oris');
assert.equal(aiRoute({ groqKey: 'gsk_x' }), 'own');
assert.equal(aiRoute({ cloudAI: false }), null);
assert.equal(hasAI({ cloudAI: false }), false);
assert.equal(hasAI({ cloudAI: false, groqKey: 'gsk' }), true, 'own key works even with Oris AI off');

// server route
let r = await summarize(text, { ...DEFAULT_SETTINGS }, 'Monsoon', 'short');
assert.equal(r.summary.method, 'ai');
assert.equal(r.summary.text, 'Server summary.');
let c = calls.at(-1);
assert.equal(c.url, ORIS_AI_URL);
assert.equal(c.body.task, 'summary');
assert.equal(c.body.model, undefined, 'client cannot pick the server model');
assert.match(c.headers['x-oris-install'], /^[0-9a-f-]{36}$/);
assert.equal(c.headers.Authorization, undefined, 'no key sent to the server');
const id = await installId();
assert.equal(c.headers['x-oris-install'], id, 'install id is stable');
assert.equal(mock.store.installId, id);
assert.equal(freeLeft(), 29);

// own key route goes straight to Groq and never to the server
const before = calls.length;
r = await summarize(text, { ...DEFAULT_SETTINGS, groqKey: 'gsk_own' }, 'Monsoon');
assert.equal(r.summary.text, 'Own key summary.');
assert.ok(calls.at(-1).url.includes('api.groq.com'));
assert.equal(calls.at(-1).headers.Authorization, 'Bearer gsk_own');
assert.equal(calls.length, before + 1);

// daily limit: friendly message, falls back to built-in summary
serverReply = () => new Response(JSON.stringify({ error: 'You’ve used today’s free Oris AI requests.', code: 'limit_install' }), { status: 429 });
r = await summarize(text, { ...DEFAULT_SETTINGS }, 'Monsoon');
assert.equal(r.summary.method !== 'ai', true, 'built-in summary used');
assert.match(r.warning, /today’s free Oris AI requests/);
assert.equal(freeLeft(), 0);
await assert.rejects(chatJSON({ task: 'notes', messages: [{ role: 'user', content: 'x' }] }, {}), /free Oris AI/);

// network down
serverReply = () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(chatJSON({ task: 'notes', messages: [{ role: 'user', content: 'x' }] }, {}), /Couldn’t reach Oris AI/);

// off: no network at all
const n = calls.length;
r = await summarize(text, { ...DEFAULT_SETTINGS, cloudAI: false }, 'Monsoon');
assert.notEqual(r.summary.method, 'ai');
const s = await parseSyllabus('Unit 1: Algebra\n- Linear equations\n- Quadratics\nUnit 2: Geometry\n- Triangles', { ...DEFAULT_SETTINGS, cloudAI: false });
assert.equal(s.method, 'rules');
assert.equal(calls.length, n, 'nothing sent when AI is off');

// syllabus through the server
serverReply = () => new Response(JSON.stringify({ content: JSON.stringify({ subject: 'Maths', units: [{ title: 'Algebra', topics: ['Linear equations'] }] }) }), { status: 200 });
const s2 = await parseSyllabus('Unit 1: Algebra\n- Linear equations', { ...DEFAULT_SETTINGS });
assert.equal(s2.method, 'ai');
assert.equal(calls.at(-1).body.task, 'syllabus');

console.log('ai routing (own key, Oris AI server, limits, off switch, fallbacks): all assertions passed');
