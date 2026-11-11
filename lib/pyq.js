// Exam prep for a syllabus: previous-year questions (PYQs), topic frequency, practice questions
// and mock tests. Pure functions except the AI helpers; the UI lives in sidepanel/exam.js.
//
// Data added to a syllabus (all optional, so old syllabi keep working):
//   syl.examType   'university' | 'competitive'
//   syl.papers     [{ id, name, year, addedAt, count }]
//   syl.pyqs       [{ id, paperId, year, label, text, marks, topicId|null, how: 'ai'|'rules'|'manual' }]
//   syl.mock       { startedAt, endsAt, items: [{ kind: 'pyq'|'practice', id, topicId }] } while a test runs
//   syl.mocks      [{ id, at, total, got, partly, missed, minutes, source }]
//   topic.practice [{ id, q, options?, answer, explain, level, marks }]
//   topic.revise   true when a mock test question on it was missed
import { tokenize } from './ask.js';
import { chatJSON } from './ai.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const EXAM_TYPES = [['university', 'University or school exam'], ['competitive', 'Competitive exam (GATE, NET, JEE…)']];

const allTopics = (syl) => syl.units.flatMap((u) => u.topics.map((t) => ({ ...t, unitId: u.id, unitTitle: u.title })));

// ---------- reading a paper ----------
// Lines that are paper furniture, not questions.
const JUNK_RE = /^(time\s*(allowed)?\s*[:\-]|max(imum)?\.?\s*marks|total\s*marks|roll\s*no|p\.?\s*t\.?\s*o\.?|page\s*\d|printed\s*pages|note\s*[:\-]|instructions?\b|attempt\s+(any|all)|answer\s+(any|all)|all\s+questions\s+(are|carry)|figures?\s+(to|in)\s+the\s+right|assume\s+suitable|(section|part)\s*[-–:]?\s*[a-e0-9ivx]{1,3}\s*$|question\s*paper\s*code|paper\s*code|sub(ject)?\s*code|course\s*code|[a-z .]*university\b|semester\s*(end)?\s*exam|\(?\s*\d+\s*(x|×)\s*\d+\s*=\s*\d+\s*\)?\s*$|or\s*$)/i;
// Start of a new top-level question: "Q1.", "Q.1", "Q 1)", "Question 1", "1.", "1)", "12."
const Q_RE = /^(?:q(?:uestion|ues)?\.?\s*(?:no\.?\s*)?(\d{1,2})\s*[.):\-]?|(\d{1,2})\s*[.)])\s*(.*)$/i;
// Start of a sub-part: "(a)", "a)", "a.", "(i)", "i)"
const SUB_RE = /^\(?\s*([a-h]|i{1,3}|iv|v|vi{0,3})\s*[).]\s*(.*)$/i;
// Marks at the end: "[5]", "(10)", "(5 marks)", "5M", "[CO2] [5]"
const MARKS_RE = /[\[(]\s*(\d{1,2}(?:\.\d)?)\s*(?:marks?|m)?\s*[\])]\s*$|(?:^|\s)(\d{1,2}(?:\.\d)?)\s*(?:marks?|m)\s*$/i;
// A question stem that only introduces sub-parts ("Answer the following briefly (5x5=25)").
const GENERIC_STEM_RE = /^(answer|attempt|explain|write|discuss|define|describe|solve)?[\w\s,]*\b(following|briefly|short notes?|any\s+(two|three|four|five))\b[^a-z]*$/i;
const CO_RE = /\s*[\[(]\s*(co|bl|l|k)\s*\d+\s*[\])]/gi;

export function detectYear(...texts) {
  const counts = new Map();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [y, c] of counts) if (c > n || (c === n && y > best)) { best = y; n = c; }
  return best;
}

function cleanQuestion(s) {
  return s.replace(CO_RE, '').replace(/\s+/g, ' ').trim();
}

function takeMarks(s) {
  const m = MARKS_RE.exec(s);
  if (!m) return { text: s, marks: null };
  return { text: s.slice(0, m.index).trim(), marks: Number(m[1] || m[2]) };
}

// Split question-paper text into questions. Sub-parts become their own questions ("3(b)").
export function splitQuestions(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let qNo = null;
  let cur = null;
  let stem = '';
  const push = () => {
    if (!cur) return;
    const { text: body, marks } = takeMarks(cleanQuestion(cur.text));
    if (body.replace(/[^\p{L}]/gu, '').length >= 12) out.push({ label: cur.label, text: body.slice(0, 1200), marks: cur.marks ?? marks });
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/^[•●▪\-–*]\s*/, '');
    if (JUNK_RE.test(line)) { push(); continue; }
    const q = Q_RE.exec(line);
    if (q && Number(q[1] || q[2]) <= 40) {
      push();
      qNo = Number(q[1] || q[2]);
      stem = '';
      const rest = q[3] || '';
      const sub = SUB_RE.exec(rest);
      if (sub && sub[2]) cur = { label: `${qNo}(${sub[1].toLowerCase()})`, text: sub[2] };
      else cur = { label: String(qNo), text: rest };
      continue;
    }
    const sub = qNo !== null ? SUB_RE.exec(line) : null;
    if (sub && sub[2] && sub[2].length > 3) {
      // The first sub-part turns the question's own text into a stem: dropped if it only says
      // "answer the following", otherwise kept as context in front of each sub-part.
      if (cur && cur.label === String(qNo)) {
        const t = takeMarks(cleanQuestion(cur.text)).text.replace(/\(?\s*\d+\s*(x|×)\s*\d+\s*=\s*\d+\s*\)?/gi, '').trim();
        stem = GENERIC_STEM_RE.test(t) || t.replace(/[^\p{L}]/gu, '').length < 12 ? '' : t;
        cur = null;
      } else push();
      cur = { label: `${qNo}(${sub[1].toLowerCase()})`, text: (stem ? stem + ' ' : '') + sub[2] };
      continue;
    }
    if (cur) {
      // A marks-only line belongs to the question above.
      const mOnly = /^[\[(]?\s*(\d{1,2})\s*(marks?|m)?\s*[\])]?$/i.exec(line);
      if (mOnly) { cur.marks = Number(mOnly[1]); continue; }
      cur.text += ' ' + line;
    }
  }
  push();
  // Drop exact duplicates (papers often repeat instructions).
  const seen = new Set();
  return out.filter((q) => { const k = q.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- matching questions to topics ----------
// Rule-based: weighted word overlap between the question and each topic (and its unit title),
// with rarer words counting more. Returns topicId or null.
const words = (s) => tokenize(String(s || '').replace(/[-–/]/g, ' '));

export function matchTopics(questions, syl) {
  const topics = allTopics(syl);
  // Words that say nothing about the topic: the subject's own name, and words found in most questions.
  const ignore = new Set(words(`${syl.subject || ''} ${syl.name || ''}`));
  const qdf = new Map();
  for (const q of questions) for (const w of new Set(words(q.text))) qdf.set(w, (qdf.get(w) || 0) + 1);
  if (questions.length >= 6) for (const [w, n] of qdf) if (n / questions.length > 0.4) ignore.add(w);
  const keep = (list) => new Set(list.filter((w) => !ignore.has(w)));
  const docs = topics.map((t) => ({ id: t.id, words: keep(words(t.title)), unit: keep(words(t.unitTitle)), phrase: t.title.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim() }));
  const df = new Map();
  for (const d of docs) for (const w of d.words) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(1 + docs.length / (df.get(w) || 1));
  return questions.map((q) => {
    const qWords = new Set(words(q.text));
    const lower = q.text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const d of docs) {
      if (!d.words.size) continue;
      let hit = 0;
      let all = 0;
      for (const w of d.words) { all += idf(w); if (qWords.has(w)) hit += idf(w); }
      let score = hit / all;
      const at = d.phrase.length > 3 ? lower.indexOf(d.phrase) : -1;
      if (at >= 0) score += 0.6 + 0.1 * (1 - at / Math.max(lower.length, 1)); // an earlier mention wins ties
      for (const w of d.unit) if (qWords.has(w)) score += 0.05;
      if (score > bestScore) { bestScore = score; best = d.id; }
    }
    return bestScore >= 0.34 ? best : null;
  });
}

// AI: classify questions in batches. Returns topicId|null per question; throws on failure.
export async function aiMatchTopics(questions, syl, settings) {
  const topics = allTopics(syl);
  const list = topics.map((t, i) => `${i + 1}. ${t.title} (${t.unitTitle})`).join('\n').slice(0, 9000);
  const out = new Array(questions.length).fill(null);
  for (let start = 0; start < questions.length; start += 20) {
    const batch = questions.slice(start, start + 20);
    const qs = batch.map((q, i) => `${i + 1}. ${q.text.slice(0, 500)}`).join('\n');
    const content = await chatJSON({
      task: 'pyq',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You map exam questions to syllabus topics. Reply with JSON only.' },
        { role: 'user', content: `Syllabus topics:\n${list}\n\nQuestions:\n${qs}\n\nFor each question give the number of the single best matching topic, or 0 if none fits.\nReturn exactly: {"map": [<topic number for question 1>, <for question 2>, ...]}` },
      ],
    }, settings);
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
    const map = Array.isArray(parsed.map) ? parsed.map : [];
    batch.forEach((_, i) => {
      const n = Number(map[i]);
      out[start + i] = n >= 1 && n <= topics.length ? topics[n - 1].id : null;
    });
  }
  return out;
}

// AI: pull questions out of messy paper text when the rules find too few.
export async function aiExtractQuestions(text, settings) {
  const content = await chatJSON({
    task: 'pyq',
    temperature: 0,
    messages: [
      { role: 'system', content: 'You extract the questions from an exam question paper. Copy each question\'s wording exactly. Skip instructions, headers and marks tables. Reply with JSON only.' },
      { role: 'user', content: `Return exactly: {"questions": [{"label": "<question number like 2(b)>", "text": "<question>", "marks": <number or null>}]}\n\nPaper:\n"""\n${String(text).slice(0, 20000)}\n"""` },
    ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  return (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((q) => ({ label: String(q.label || '').slice(0, 12), text: String(q.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200), marks: Number(q.marks) || null }))
    .filter((q) => q.text.length >= 12);
}

// Read a paper: questions + topic for each. Uses AI when available, rules otherwise.
export async function analysePaper(text, syl, settings, { useAI = false } = {}) {
  let questions = splitQuestions(text);
  let how = 'rules';
  let warning = '';
  if (useAI && questions.length < 3) {
    try { questions = await aiExtractQuestions(text, settings); } catch (e) { warning = e.message; }
  }
  let topicIds = matchTopics(questions, syl);
  if (useAI && questions.length) {
    try { topicIds = await aiMatchTopics(questions, syl, settings); how = 'ai'; } catch (e) { warning = e.message; }
  }
  return { questions: questions.map((q, i) => ({ ...q, topicId: topicIds[i] || null, how })), warning };
}

// Read a paper and return what to add to the syllabus (papers + pyqs). Throws when no questions are found.
export async function readPaperFor(syl, { text, name, year = '' }, settings, { useAI = false } = {}) {
  const { questions, warning } = await analysePaper(text, syl, settings, { useAI });
  if (!questions.length) throw new Error(`No questions found in ${name}. If it’s a scanned paper, paste its text instead.`);
  const paperId = uid();
  const y = year || detectYear(name, String(text).slice(0, 600)) || '';
  return {
    paper: { id: paperId, name: String(name).slice(0, 80), year: y, addedAt: Date.now(), count: questions.length },
    pyqs: questions.map((q) => ({ id: uid(), paperId, year: y, label: q.label, text: q.text, marks: q.marks, topicId: q.topicId, how: q.how })),
    n: questions.length, matched: questions.filter((q) => q.topicId).length, warning,
  };
}

// ---------- analysis ----------
// Per-topic numbers from the PYQs, sorted most-asked first.
export function topicStats(syl) {
  const papers = syl.papers || [];
  const pyqs = syl.pyqs || [];
  const total = papers.length;
  const rows = allTopics(syl).map((t) => {
    const qs = pyqs.filter((q) => q.topicId === t.id);
    const inPapers = new Set(qs.map((q) => q.paperId)).size;
    const marks = qs.reduce((a, q) => a + (q.marks || 0), 0);
    const years = [...new Set(qs.map((q) => q.year).filter(Boolean))].sort();
    return { topic: t, count: qs.length, inPapers, totalPapers: total, marks, years, share: total ? inPapers / total : 0 };
  });
  return rows.sort((a, b) => b.inPapers - a.inPapers || b.count - a.count || b.marks - a.marks);
}

// What to study first: unfinished topics, most-asked first, topics flagged for revision ahead of ties.
export function studyPriority(syl, limit = 10) {
  return topicStats(syl)
    .filter((r) => r.count > 0 && (!r.topic.done || r.topic.revise))
    .sort((a, b) => (b.inPapers - a.inPapers) || (Number(!!b.topic.revise) - Number(!!a.topic.revise)) || (b.count - a.count))
    .slice(0, limit);
}

export const pyqsForTopic = (syl, topicId) => (syl.pyqs || []).filter((q) => q.topicId === topicId)
  .slice().sort((a, b) => String(b.year).localeCompare(String(a.year)));

// ---------- finding papers online ----------
export function pyqSearchUrl(syl, topicTitle = '') {
  const subject = syl.subject || syl.name || '';
  const competitive = syl.examType === 'competitive';
  const q = topicTitle
    ? `${subject} ${topicTitle} ${competitive ? 'previous year questions with solutions' : 'previous year question paper questions'}`
    : `${subject} ${competitive ? 'previous year question papers with solutions pdf' : 'previous year question papers pdf'}`;
  return 'https://www.google.com/search?q=' + encodeURIComponent(q.replace(/\s+/g, ' ').trim());
}

// ---------- practice questions ----------
export async function aiPractice(topic, syl, settings, { count = 6 } = {}) {
  const competitive = syl.examType === 'competitive';
  const past = pyqsForTopic(syl, topic.id).slice(0, 5).map((q) => `- ${q.text.slice(0, 300)}`).join('\n');
  const shape = competitive
    ? '{"questions": [{"q": "<question>", "options": ["<A>", "<B>", "<C>", "<D>"], "answer": "<the correct option, copied exactly>", "explain": "<one or two sentence explanation>", "level": "easy|medium|hard"}]}'
    : '{"questions": [{"q": "<exam-style question>", "answer": "<answer outline: 2 to 5 key points a good answer must cover>", "level": "easy|medium|hard", "marks": <2, 5 or 10>}]}';
  const content = await chatJSON({
    task: 'practice',
    temperature: 0.5,
    messages: [
      { role: 'system', content: `You write ${competitive ? 'multiple-choice questions for a competitive exam' : 'university exam questions'} to help a student practise. Be accurate. Mix easy, medium and hard. Reply with JSON only.` },
      { role: 'user', content: `Subject: ${syl.subject || syl.name}\nTopic: ${topic.title}\n${past ? `Past exam questions on this topic, for style only (don't copy them):\n${past}\n` : ''}\nWrite ${count} new practice questions on this topic.\nReturn exactly: ${shape}` },
    ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const items = (Array.isArray(parsed.questions) ? parsed.questions : []).map((x) => {
    const options = Array.isArray(x.options) ? x.options.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6) : null;
    const item = {
      id: uid(),
      q: String(x.q || '').trim().slice(0, 800),
      answer: String(x.answer || '').trim().slice(0, 1200),
      explain: String(x.explain || '').trim().slice(0, 600),
      level: ['easy', 'medium', 'hard'].includes(x.level) ? x.level : 'medium',
      marks: Number(x.marks) || null,
    };
    if (options && options.length >= 2) {
      item.options = options;
      // The answer must be one of the options; match loosely ("B", "(B) text", the text itself).
      const letter = /^\(?([A-F])\)?(?:[.)\s]|$)/i.exec(item.answer);
      const byText = options.find((o) => o.toLowerCase() === item.answer.toLowerCase());
      item.answer = byText || (letter ? options[letter[1].toUpperCase().charCodeAt(0) - 65] : '') || '';
      if (!item.answer) return null;
    }
    return item.q ? item : null;
  }).filter(Boolean);
  if (!items.length) throw new Error('The AI didn’t return any questions. Try again.');
  return items;
}

// ---------- mock tests ----------
// Topics in scope: 'done' (finished topics), 'all', or a unit id.
export function mockPool(syl, { scope = 'done', source = 'both' } = {}) {
  const topics = allTopics(syl).filter((t) => (scope === 'all' ? true : scope === 'done' ? t.done : t.unitId === scope));
  const ids = new Set(topics.map((t) => t.id));
  const pool = [];
  if (source !== 'practice') for (const q of syl.pyqs || []) if (q.topicId && ids.has(q.topicId)) pool.push({ kind: 'pyq', id: q.id, topicId: q.topicId });
  if (source !== 'pyq') for (const t of topics) for (const p of t.practice || []) pool.push({ kind: 'practice', id: p.id, topicId: t.id });
  return pool;
}

// Pick `count` questions, spreading across topics and favouring most-asked topics.
export function buildMock(syl, opts = {}, rand = Math.random) {
  const count = Math.max(1, opts.count || 10);
  const pool = mockPool(syl, opts);
  const stats = new Map(topicStats(syl).map((r) => [r.topic.id, r.inPapers]));
  const byTopic = new Map();
  for (const item of pool) { if (!byTopic.has(item.topicId)) byTopic.set(item.topicId, []); byTopic.get(item.topicId).push(item); }
  for (const list of byTopic.values()) list.sort(() => rand() - 0.5);
  const order = [...byTopic.keys()].sort((a, b) => (stats.get(b) || 0) - (stats.get(a) || 0) || rand() - 0.5);
  const out = [];
  while (out.length < count && order.some((k) => byTopic.get(k).length)) {
    for (const k of order) {
      const list = byTopic.get(k);
      if (list.length && out.length < count) out.push(list.shift());
    }
  }
  return out.sort(() => rand() - 0.5);
}

// Resolve a mock item to what's shown.
export function mockQuestion(syl, item) {
  const topic = allTopics(syl).find((t) => t.id === item.topicId);
  if (item.kind === 'pyq') {
    const q = (syl.pyqs || []).find((x) => x.id === item.id);
    return q ? { text: q.text, marks: q.marks, meta: [q.year, q.label && `Q${q.label}`].filter(Boolean).join(', '), topic } : null;
  }
  const p = topic && (topic.practice || []).find((x) => x.id === item.id);
  return p ? { text: p.q, marks: p.marks, options: p.options, answer: p.answer, explain: p.explain, meta: 'Practice', topic } : null;
}

export function scoreMock(marks) {
  const v = Object.values(marks);
  const got = v.filter((x) => x === 'got').length;
  const partly = v.filter((x) => x === 'partly').length;
  const missed = v.filter((x) => x === 'missed').length;
  const total = v.length;
  return { got, partly, missed, total, percent: total ? Math.round(((got + partly / 2) / total) * 100) : 0 };
}
