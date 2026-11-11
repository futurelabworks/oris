import { chatJSON, hasAI } from './ai.js';
// Ask across a project's saved sources. Retrieval runs locally: page text, highlights and notes
// are cut into passages and ranked with BM25 against the question. With a Groq key, the best
// passages go to the AI, which must answer only from them and cite them as [1], [2]…
// Without a key, the best passages themselves are the answer.

const STOP = new Set(('a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those ' +
  'he she they we you i his her their our your not no do does did has have had can could will would should may might must also than which who whom ' +
  'what when where why how all any each more most other some such only own same very just into over after about up out there here me my').split(' '));

export function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])
    .map((w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// Paragraph-aware passages of about `size` characters.
export function chunkText(text, size = 700) {
  const paras = String(text || '').split(/\n{1,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 30);
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const p of paras) {
    if (p.length > size * 1.5) {
      flush();
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((buf + ' ' + s).length > size && buf) flush();
        buf += (buf ? ' ' : '') + s;
      }
      flush();
    } else {
      if ((buf + '\n' + p).length > size && buf) flush();
      buf += (buf ? '\n' : '') + p;
    }
  }
  flush();
  return out;
}

// docs: [{ source, text }] where source has highlights and notes. Returns passages with scores.
export function rankPassages(question, docs, k = 6) {
  const passages = [];
  for (const { source, text } of docs) {
    for (const t of chunkText(text)) passages.push({ source, text: t, kind: 'page' });
    for (const h of source.highlights || []) passages.push({ source, text: h.note ? `${h.text} (note: ${h.note})` : h.text, kind: 'highlight' });
    if (source.notes && source.notes.trim()) passages.push({ source, text: source.notes.trim().slice(0, 1500), kind: 'note' });
    if (source.summary) passages.push({ source, text: [source.summary.text, ...(source.summary.points || [])].filter(Boolean).join(' '), kind: 'summary' });
  }
  const q = [...new Set(tokenize(question))];
  if (!q.length || !passages.length) return [];

  const toks = passages.map((p) => tokenize(p.text + ' ' + (p.kind === 'page' ? '' : p.source.title)));
  const avg = toks.reduce((a, t) => a + t.length, 0) / toks.length || 1;
  const df = new Map(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  const N = passages.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = passages.map((p, i) => {
    const tf = new Map();
    for (const w of toks[i]) if (df.has(w)) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg)));
    }
    // What the student chose to keep counts a little more than raw page text.
    if (p.kind === 'highlight' || p.kind === 'note') score *= 1.25;
    return { ...p, score };
  }).filter((p) => p.score > 0);

  scored.sort((a, b2) => b2.score - a.score);
  // At most 3 passages from one source, so one long page can't crowd out the rest.
  const perSource = new Map();
  const out = [];
  for (const p of scored) {
    const n = perSource.get(p.source.id) || 0;
    if (n >= 3) continue;
    perSource.set(p.source.id, n + 1);
    out.push(p);
    if (out.length >= k) break;
  }
  return out;
}

export async function askAI(question, passages, settings = {}) {
  const context = passages.map((p, i) => `[${i + 1}] From "${p.source.title}" (${p.kind}):\n${p.text}`).join('\n\n');
  const content = await chatJSON({
    task: 'ask',
    temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You answer a student\'s question using ONLY the numbered passages from their saved research. ' +
            'Cite every claim with the passage number in square brackets, like [2]. ' +
            'If the passages do not answer the question, say so plainly and do not use outside knowledge. Reply with JSON only.',
        },
        { role: 'user', content: `Passages:\n${context}\n\nQuestion: ${question}\n\nReturn exactly: {"answer": "<answer with [n] citations>", "found": true or false}` },
      ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const answer = String(parsed.answer || '').trim();
  if (!answer) throw new Error('The AI returned an empty answer.');
  // Keep only citation numbers that point at a real passage.
  const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]).filter((n) => n >= 1 && n <= passages.length))];
  return { answer, found: parsed.found !== false, cited };
}

// Splits "text [1] more [2]" into parts for rendering citation chips.
export function answerParts(answer) {
  const parts = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ ref: +m[1] });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
}
