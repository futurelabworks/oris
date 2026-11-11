import { chatJSON, hasAI } from './ai.js';
// Page summaries: AI (Oris AI or the user's own Groq key) when on, otherwise a simple "key sentences" extract.

const STOP = new Set(('a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those ' +
  'he she they we you i his her their our your not no do does did done has have had can could will would should may might must also than ' +
  'which who whom what when where why how all any each more most other some such only own same very just into over after before about up out').split(' '));

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 400 && /[a-z]/i.test(s));
}

export function basicSummary(text, n = 5) {
  const list = sentences(text).slice(0, 300);
  if (!list.length) return null;
  const freq = new Map();
  const words = (s) => s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  for (const s of list) for (const w of words(s)) if (!STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const scored = list.map((s, i) => {
    const ws = words(s).filter((w) => !STOP.has(w));
    const score = ws.reduce((a, w) => a + (freq.get(w) || 0), 0) / Math.max(4, ws.length) + (i < 3 ? 0.5 : 0);
    return { s, i, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
  return { text: '', points: top, method: 'basic' };
}

export const SUMMARY_LENGTHS = [['short', 'TL;DR'], ['standard', 'Standard'], ['detailed', 'Detailed']];
const SHAPE = {
  short: '{"summary": "<one sentence TL;DR, at most 30 words>", "points": ["<key point>", ... at most 3 items]}',
  standard: '{"summary": "<2 to 4 sentences>", "points": ["<key point>", ... 3 to 6 items]}',
  detailed: '{"summary": "<a full paragraph of 5 to 8 sentences>", "points": ["<key point>", ... 6 to 10 items]}',
};
const BASIC_POINTS = { short: 2, standard: 5, detailed: 8 };

export async function aiSummary(text, { settings = {}, title, length = 'standard' } = {}) {
  const content = await chatJSON({
    task: 'summary',
    temperature: 0.2,
      messages: [
        { role: 'system', content: 'You summarise web pages for a student doing research. Reply with JSON only. Use only facts stated in the page.' },
        {
          role: 'user',
          content:
            'Summarise this page in the language it is written in.\n' +
            `Return exactly: ${SHAPE[length] || SHAPE.standard}\n\n` +
            `Title: ${title || ''}\n\nPage text:\n"""\n${String(text).slice(0, 16000)}\n"""`,
        },
      ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const points = (Array.isArray(parsed.points) ? parsed.points : []).map(String).filter(Boolean).slice(0, 10);
  if (!parsed.summary && !points.length) throw new Error('The AI returned an empty summary.');
  return { text: String(parsed.summary || ''), points, method: 'ai', length };
}

export async function summarize(text, settings, title, length = settings.summaryLength || 'standard') {
  if (String(text || '').trim().length < 200) throw new Error('There isn’t enough text on this page to summarise.');
  if (hasAI(settings)) {
    try {
      return { summary: await aiSummary(text, { settings, title, length }) };
    } catch (err) {
      const s = basicSummary(text, BASIC_POINTS[length] || 5);
      if (s) s.length = length;
      if (!s) throw err;
      return { summary: s, warning: err.message };
    }
  }
  const s = basicSummary(text, BASIC_POINTS[length] || 5);
  if (!s) throw new Error('Couldn’t find sentences to summarise on this page.');
  s.length = length;
  return { summary: s };
}
