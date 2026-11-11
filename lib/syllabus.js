import { chatJSON, hasAI } from './ai.js';
// Turn raw syllabus text into { subject, units: [{ title, topics: [string] }] }.
// Uses AI (Oris AI or the user's own Groq key) when on; otherwise a rule-based parser.

const UNIT_RE = /^(unit|module|chapter|section|part|week|block|lesson)\s*[-–—:.#]?\s*([0-9]{1,2}|[ivxlc]{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*[-–—:.)]?\s*(.*)$/i;
const STOP_RE = /^(text\s*books?|reference(s|\s*books?)?|suggested\s*readings?|recommended\s*books?|books?\s*recommended|bibliography|course\s*outcomes?|learning\s*outcomes?|web\s*resources?|e-?resources?)\b/i;
const NOISE_RE = /^(page\s*\d+|course\s*(code|title|objectives?)|subject\s*code|credits?|l\s*-?\s*t\s*-?\s*p\b|total\s*(hours|lectures|marks)|max(imum)?\s*marks|marks|hours|duration|semester|prerequisites?|objectives?|co\d+|po\d+)\b/i;
const BULLET_RE = /^\s*(?:[•\-*–·●○▪■◦►✓]+|\(?\d{1,2}(?:\.\d{1,2})*[.)]|\(?[a-h][.)]|\(?(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)[.)])\s+/i;
const HOURS_RE = /\s*[([]?\s*\d{1,3}\s*(hours?|hrs?|lectures?|periods?|l)\s*[)\]]?\s*\.?$/i;

function clean(s) {
  return s.replace(/\s+/g, ' ').replace(HOURS_RE, '').replace(/^[\s:;,.–—-]+|[\s:;,.–—-]+$/g, '').trim();
}

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function splitTopics(line) {
  // Syllabus lines are usually comma/semicolon separated topic lists.
  const parts = line.split(/\s*[;,]\s*|\s+[–—]\s+|\.\s+(?=[A-Z])/);
  return parts.map(clean).filter((t) => t.length >= 3 && t.length <= 120 && /[a-z]/i.test(t));
}

export function heuristicParse(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\t/g, ' ').trim()).filter(Boolean);
  const units = [];
  let current = null;
  let stopped = false;

  const ensureUnit = () => {
    if (!current) {
      current = { title: 'Topics', topics: [] };
      units.push(current);
    }
    return current;
  };

  for (const raw of lines) {
    const line = raw.replace(BULLET_RE, '');
    const m = line.match(UNIT_RE);
    if (m) {
      stopped = false;
      const kind = titleCase(m[1]);
      const num = /^[ivxlc]+$/i.test(m[2]) ? m[2].toUpperCase() : titleCase(m[2]);
      let rest = (m[3] || '').trim();
      let name = '';
      let topicText = '';
      const colon = rest.search(/:|\s[–—-]\s/);
      if (colon > 0 && colon <= 70) {
        name = clean(rest.slice(0, colon));
        topicText = rest.slice(colon + 1).replace(/^\s*[–—-]?\s*/, '');
      } else if (rest && rest.length <= 60 && !/[;,]/.test(rest)) {
        name = clean(rest);
      } else {
        topicText = rest;
      }
      current = { title: `${kind} ${num}${name ? ': ' + name : ''}`, topics: [] };
      units.push(current);
      if (topicText) current.topics.push(...splitTopics(topicText));
      continue;
    }
    if (STOP_RE.test(line)) { stopped = true; continue; }
    if (stopped || NOISE_RE.test(line)) continue;
    if (/^\d+$/.test(line) || line.length < 3) continue;
    ensureUnit().topics.push(...splitTopics(line));
  }

  // A few loose lines before "Unit 1" are usually the course title/code, not topics.
  let subject = '';
  if (units.length > 1 && units[0].title === 'Topics' && units[0].topics.length <= 3) {
    subject = units[0].topics[0].replace(/\s*\([A-Z0-9 -]{2,12}\)\s*$/, '');
    units.shift();
  }

  return finalize({ subject, units });
}

// Dedupe, cap sizes, drop empty units.
export function finalize(plan) {
  const seen = new Set();
  let total = 0;
  const units = [];
  for (const u of plan.units || []) {
    const topics = [];
    for (const t of u.topics || []) {
      const title = clean(String(t));
      const key = title.toLowerCase();
      if (!title || seen.has(key) || total >= 250) continue;
      seen.add(key);
      topics.push(title);
      total++;
      if (topics.length >= 40) break;
    }
    if (topics.length) units.push({ title: clean(String(u.title || 'Topics')) || 'Topics', topics });
  }
  return { subject: clean(String(plan.subject || '')), units };
}

export async function aiParse(text, settings = {}) {
  const body = {
    task: 'syllabus',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: 'You turn course syllabi into structured study plans. Reply with JSON only.',
      },
      {
        role: 'user',
        content:
          'Extract the units (or modules/chapters) and the individual study topics from this syllabus.\n' +
          'Rules:\n' +
          '- Keep the syllabus order.\n' +
          '- Each topic is short (2 to 10 words) and specific enough to search for a lecture on YouTube.\n' +
          '- Skip textbooks, references, marks, hours, credits, course outcomes and objectives.\n' +
          '- If there are no units, use one unit titled "Topics".\n' +
          'Return exactly: {"subject": "<course name, or empty>", "units": [{"title": "<unit title>", "topics": ["<topic>", ...]}]}\n\n' +
          'Syllabus:\n"""\n' + String(text).slice(0, 24000) + '\n"""',
      },
    ],
  };
  const content = await chatJSON(body, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const plan = finalize(parsed);
  if (!plan.units.length) throw new Error('The AI didn’t find any topics.');
  return plan;
}

// Try AI first when configured; fall back to the rule-based parser.
export async function parseSyllabus(text, settings) {
  if (hasAI(settings)) {
    try {
      return { plan: await aiParse(text, settings), method: 'ai' };
    } catch (err) {
      return { plan: heuristicParse(text), method: 'rules', warning: err.message };
    }
  }
  return { plan: heuristicParse(text), method: 'rules' };
}
