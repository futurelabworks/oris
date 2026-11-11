// Exam prep engine: reading papers, matching topics, stats, priority, search links, practice parsing, mocks.
import assert from 'node:assert/strict';
import { createChrome } from './chrome-mock.mjs';

const mock = createChrome();
globalThis.chrome = mock.chrome;
let aiReply = null;
const sent = [];
globalThis.fetch = async (url, opts = {}) => { const body = JSON.parse(opts.body); sent.push(body); return new Response(JSON.stringify({ content: JSON.stringify(aiReply(body)) }), { status: 200 }); };

const P = await import('../lib/pyq.js');

const paper = `GGSIP UNIVERSITY END TERM EXAMINATION, DECEMBER 2023
Paper Code: ETCS-206   Subject: Database Management Systems
Time: 3 Hours   Maximum Marks: 75
Note: Attempt any five questions including Q.no. 1 which is compulsory.
Q1. Answer the following briefly: (5x5=25)
(a) What is data independence? Explain its types. [CO1]
(b) Differentiate between primary key and candidate key.
(c) What is a weak entity set? Give an example. (5)
Q2. (a) Draw an ER diagram for a university database with entities student,
course and faculty. Show cardinality. (6.5)
(b) Explain the three-schema architecture of DBMS. [6]
Q3. What is normalization? Explain 1NF, 2NF, 3NF and BCNF with suitable examples. 12.5 marks
Q4. (a) Explain conflict serializability with an example.
(b) Describe the two-phase locking protocol. Does it ensure serializability?
P.T.O.
5. Write SQL queries for the following on the relation EMP(eno, name, salary, dno):
i) Find employees earning more than the average salary
ii) Count employees in each department
6. Explain B+ tree indexing. Insert 5, 10, 15, 20, 25 into a B+ tree of order 3.`;

const qs = P.splitQuestions(paper);
assert.deepEqual(qs.map((q) => q.label), ['1(a)', '1(b)', '1(c)', '2(a)', '2(b)', '3', '4(a)', '4(b)', '5(i)', '5(ii)', '6'], 'labels, generic stem dropped');
assert.equal(qs.find((q) => q.label === '2(a)').marks, 6.5);
assert.equal(qs.find((q) => q.label === '3').marks, 12.5);
assert.ok(!qs.some((q) => /\[CO1\]|Maximum Marks|P\.T\.O|Attempt any/i.test(q.text)), 'paper furniture removed');
assert.ok(qs.find((q) => q.label === '2(a)').text.includes('course and faculty'), 'wrapped lines joined');
assert.ok(qs.find((q) => q.label === '5(i)').text.startsWith('Write SQL queries'), 'useful stem kept as context');
assert.equal(P.detectYear(paper, 'dbms dec 2023'), '2023');
assert.equal(P.detectYear('no year here'), '');

const T = (id, title, extra = {}) => ({ id, title, done: false, videos: null, ...extra });
const syl = {
  id: 's1', name: 'DBMS', subject: 'DBMS',
  units: [
    { id: 'u1', title: 'Introduction and ER model', topics: [T('di', 'Data independence', { done: true }), T('ts', 'Three schema architecture'), T('er', 'ER diagrams', { done: true }), T('k', 'Keys'), T('we', 'Weak entity set')] },
    { id: 'u2', title: 'Relational model and SQL', topics: [T('sql', 'SQL queries'), T('nf', 'Normalization (1NF, 2NF, 3NF, BCNF)'), T('fd', 'Functional dependencies')] },
    { id: 'u3', title: 'Transactions', topics: [T('ser', 'Serializability'), T('2pl', 'Two-phase locking'), T('dl', 'Deadlock')] },
    { id: 'u4', title: 'Storage', topics: [T('bt', 'B+ tree indexing'), T('hash', 'Hashing')] },
  ],
};
const m = P.matchTopics(qs, syl);
assert.deepEqual(m, ['di', 'k', 'we', 'er', 'ts', 'nf', 'ser', '2pl', 'sql', 'sql', 'bt'], 'every question on its topic');
assert.equal(P.matchTopics([{ text: 'Discuss the history of the Mughal empire in detail.' }], syl)[0], null, 'off-topic stays unmatched');

// rules path
let r = await P.analysePaper(paper, syl, {}, { useAI: false });
assert.equal(r.questions.length, 11);
assert.ok(r.questions.every((q) => q.how === 'rules'));
assert.equal(sent.length, 0, 'no AI call when AI is off');

// AI path: batches of 20, 0 = no topic
aiReply = (b) => { assert.equal(b.task, 'pyq'); const n = (b.messages[1].content.match(/^\d+\. /gm) || []).length; return { map: Array.from({ length: 11 }, (_, i) => (i === 0 ? 0 : 1)) }; };
r = await P.analysePaper(paper, syl, {}, { useAI: true });
assert.equal(r.questions[0].topicId, null);
assert.equal(r.questions[1].topicId, 'di');
assert.ok(r.questions.every((q) => q.how === 'ai'));
// AI fails -> falls back to rules with a warning
aiReply = () => { throw new Error('boom'); };
globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Oris AI is busy. Try again in a minute.' }), { status: 429 });
r = await P.analysePaper(paper, syl, {}, { useAI: true });
assert.equal(r.questions[1].topicId, 'k');
assert.match(r.warning, /busy/);
globalThis.fetch = async (url, opts = {}) => { const body = JSON.parse(opts.body); sent.push(body); return new Response(JSON.stringify({ content: JSON.stringify(aiReply(body)) }), { status: 200 }); };
// Messy text with few numbered questions -> AI extraction
aiReply = (b) => (b.messages[0].content.includes('extract') ? { questions: [{ label: '1', text: 'Explain deadlock prevention techniques in detail.', marks: 10 }, { label: '2', text: 'x' }] } : { map: [11] });
r = await P.analysePaper('Deadlock prevention techniques explain in detail and also hashing', syl, {}, { useAI: true });
assert.equal(r.questions.length, 1, 'too-short AI questions dropped');
assert.equal(r.questions[0].topicId, 'dl');

// stats + priority with 2 papers
syl.papers = [{ id: 'p1', year: '2023' }, { id: 'p2', year: '2022' }];
syl.pyqs = [
  { id: 'a', paperId: 'p1', year: '2023', text: 'Normalization q', topicId: 'nf', marks: 12.5 },
  { id: 'b', paperId: 'p2', year: '2022', text: 'BCNF q', topicId: 'nf', marks: 10 },
  { id: 'c', paperId: 'p1', year: '2023', text: 'ER q', topicId: 'er', marks: 6 },
  { id: 'd', paperId: 'p2', year: '2022', text: 'ER q2', topicId: 'er', marks: 5 },
  { id: 'e', paperId: 'p2', year: '2022', text: 'SQL q', topicId: 'sql', marks: 5 },
  { id: 'f', paperId: 'p1', year: '2023', text: 'unknown', topicId: null },
];
const st = P.topicStats(syl);
assert.equal(st[0].topic.id, 'nf');
assert.equal(st[0].inPapers, 2);
assert.equal(st[0].marks, 22.5);
assert.deepEqual(st[0].years, ['2022', '2023']);
assert.deepEqual(P.studyPriority(syl).map((x) => x.topic.id), ['nf', 'sql'], 'done topics skipped');
syl.units[0].topics[2].revise = true; // ER done but flagged
assert.deepEqual(P.studyPriority(syl).map((x) => x.topic.id), ['er', 'nf', 'sql'], 'revise brings a done topic back, ahead on ties');
assert.deepEqual(P.pyqsForTopic(syl, 'nf').map((q) => q.year), ['2023', '2022'], 'newest first');

// search links
assert.match(P.pyqSearchUrl(syl), /^https:\/\/www\.google\.com\/search\?q=DBMS%20previous%20year%20question%20papers%20pdf$/);
assert.match(decodeURIComponent(P.pyqSearchUrl(syl, 'Deadlock')), /DBMS Deadlock previous year/);
assert.match(decodeURIComponent(P.pyqSearchUrl({ ...syl, examType: 'competitive' }, 'Deadlock')), /with solutions/);

// practice: university
aiReply = (b) => { assert.equal(b.task, 'practice'); assert.ok(b.messages[1].content.includes('Normalization q'), 'past questions given for style'); return { questions: [{ q: 'Explain 3NF.', answer: '- definition\n- example', level: 'medium', marks: 5 }, { q: '' }] }; };
let pr = await P.aiPractice(syl.units[1].topics[1], syl, {});
assert.equal(pr.length, 1);
assert.equal(pr[0].marks, 5);
assert.ok(pr[0].id);
// practice: competitive MCQ, answer given as a letter / exact text / invalid
aiReply = () => ({ questions: [
  { q: 'Which normal form removes transitive dependency?', options: ['1NF', '2NF', '3NF', '4NF'], answer: 'C', explain: '3NF removes transitive dependencies.', level: 'easy' },
  { q: 'BCNF is stricter than?', options: ['3NF', '5NF'], answer: '3NF', level: 'hard' },
  { q: 'Bad', options: ['x', 'y'], answer: 'z' },
] });
pr = await P.aiPractice(syl.units[1].topics[1], { ...syl, examType: 'competitive' }, {});
assert.equal(pr.length, 2, 'MCQ with an answer outside the options dropped');
assert.equal(pr[0].answer, '3NF');
assert.equal(pr[1].answer, '3NF');
aiReply = () => ({ questions: [] });
await assert.rejects(P.aiPractice(syl.units[1].topics[1], syl, {}), /didn’t return any questions/);

// mock
syl.units[1].topics[1].practice = [{ id: 'x1', q: 'Explain 3NF.', answer: 'outline', level: 'medium' }];
syl.units[0].topics[2].practice = [{ id: 'x2', q: 'MCQ', options: ['a', 'b'], answer: 'a', level: 'easy' }];
assert.equal(P.mockPool(syl, { scope: 'done', source: 'both' }).length, 3, 'done topics: ER pyqs + ER practice');
assert.equal(P.mockPool(syl, { scope: 'all', source: 'pyq' }).length, 5, 'unmatched pyqs never used');
assert.equal(P.mockPool(syl, { scope: 'u2', source: 'practice' }).length, 1);
let seed = 1; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const items = P.buildMock(syl, { scope: 'all', source: 'both', count: 4 }, rand);
assert.equal(items.length, 4);
assert.equal(new Set(items.map((i) => i.id)).size, 4, 'no repeats');
assert.equal(new Set(items.map((i) => i.topicId)).size >= 3, true, 'spread across topics');
assert.equal(P.buildMock(syl, { scope: 'all', source: 'both', count: 50 }, rand).length, 7, 'capped at the pool');
const mq = P.mockQuestion(syl, { kind: 'practice', id: 'x2', topicId: 'er' });
assert.deepEqual(mq.options, ['a', 'b']);
assert.equal(P.mockQuestion(syl, { kind: 'pyq', id: 'a', topicId: 'nf' }).meta, '2023');
assert.equal(P.mockQuestion(syl, { kind: 'pyq', id: 'gone', topicId: 'nf' }), null);
assert.deepEqual(P.scoreMock({ a: 'got', b: 'partly', c: 'missed', d: 'got' }), { got: 2, partly: 1, missed: 1, total: 4, percent: 63 });

console.log('pyq engine (papers, matching, stats, priority, search, practice, mocks): all assertions passed');
