// Study profile and the study plan.
//
// The plan is never stored: it is worked out from the inputs below every time it's shown,
// so missed work rolls forward by itself and every change the student makes takes effect at once.
//
// storage key 'study':
//   profile   { name, level: 'school'|'college'|'competitive', classYear, institution, course }
//   subjects  [{ id, name, syllabusId|null, examDate 'YYYY-MM-DD'|'', maxMarks, importance 1|2|3 }]
//   prefs     { minutesPerDay, restDays [0-6], revisionDays }
//   deps      { [topicId]: [prereqTopicId, ...] }   topic order (AI or the student)
//   hours     { [topicId]: n }                        AI estimate of study hours per topic
//   overrides { [topicId]: { minutes?, skip?, notBefore? } }
//   progress  { [itemKey]: 'YYYY-MM-DD' }          done practice/PYQ/revision items (learning = topic.done)
//   dayDone   { 'YYYY-MM-DD': minutes }            minutes of planned work finished that day
//   log       [{ at, kind, data }]                  every change, kept on this device (for the coach in 3.2)
//   setupDone true once the setup has been finished
import { topicStats } from './pyq.js';
import { chatJSON } from './ai.js';

export const STUDY_KEY = 'study';
export const LEVELS = [['school', 'School student'], ['college', 'College / university student'], ['competitive', 'Preparing for a competitive exam']];
export const IMPORTANCE = [[1, 'Low'], [2, 'Normal'], [3, 'High']];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = ['#3d4fd6', '#0f9d76', '#d9822b', '#c2417a', '#2b8fd9', '#7a52cc', '#8a7a12', '#d14d3b'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyStudy() {
  return {
    profile: { name: '', level: '', classYear: '', institution: '', course: '' },
    subjects: [],
    prefs: { minutesPerDay: 180, restDays: [], revisionDays: 2 },
    deps: {}, hours: {}, overrides: {}, progress: {}, log: [], setupDone: false,
  };
}

export function mergeStudy(raw) {
  const e = emptyStudy();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    ...e, ...s,
    profile: { ...e.profile, ...(s.profile || {}) },
    prefs: { ...e.prefs, ...(s.prefs || {}) },
    subjects: Array.isArray(s.subjects) ? s.subjects : [],
    deps: s.deps || {}, hours: s.hours || {}, overrides: s.overrides || {}, progress: s.progress || {},
    log: Array.isArray(s.log) ? s.log : [],
  };
}

export const subjectColor = (study, id) => COLORS[Math.max(0, study.subjects.findIndex((s) => s.id === id)) % COLORS.length];

// Record a change in the on-device log (newest last, capped).
export function logEvent(study, kind, data = {}) {
  study.log = [...(study.log || []), { at: Date.now(), kind, data }].slice(-1000);
  return study;
}

// A syllabus record in the same shape the Syllabus screen makes.
export function makeSyllabus(plan, { name, method }) {
  return {
    id: uid(),
    name: String(name || plan.subject || 'My syllabus').slice(0, 80),
    subject: String(name || plan.subject || '').slice(0, 80),
    createdAt: Date.now(),
    method,
    units: plan.units.map((u) => ({ id: uid(), title: u.title, topics: u.topics.map((t) => ({ id: uid(), title: t, done: false, videos: null })) })),
  };
}

// ---------- dates ----------
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
export const niceDay = (k) => parseDay(k).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- topic order with AI ----------
// Asks which topics must be learned before others, and roughly how long each takes.
// Returns { deps: {topicId: [prereqIds]}, hours: {topicId: n} }.
export async function aiTopicOrder(subjectName, syl, settings) {
  const topics = syl.units.flatMap((u) => u.topics.map((t) => ({ id: t.id, title: t.title, unit: u.title })));
  if (topics.length < 2) return { deps: {}, hours: {} };
  const list = topics.slice(0, 120).map((t, i) => `${i + 1}. ${t.title} (${t.unit})`).join('\n');
  const content = await chatJSON({
    task: 'plan',
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are an expert teacher planning the order to study syllabus topics. Reply with JSON only.' },
      { role: 'user', content: `Subject: ${subjectName}\nTopics:\n${list}\n\nFor each topic, list only the topics that MUST be understood first (strong prerequisites, usually 0 to 2), and estimate study hours for a student (0.5 to 4).\nReturn exactly: {"topics": [{"n": <topic number>, "after": [<topic numbers>], "hours": <number>}]}` },
    ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const deps = {};
  const hours = {};
  for (const row of Array.isArray(parsed.topics) ? parsed.topics : []) {
    const t = topics[Number(row.n) - 1];
    if (!t) continue;
    const after = (Array.isArray(row.after) ? row.after : []).map((n) => topics[Number(n) - 1]).filter((p) => p && p.id !== t.id).map((p) => p.id);
    if (after.length) deps[t.id] = [...new Set(after)].slice(0, 4);
    const h = Number(row.hours);
    if (h > 0) hours[t.id] = Math.min(6, Math.max(0.25, h));
  }
  return { deps: removeCycles(deps), hours };
}

// Drop dependency edges that would make a loop (the AI sometimes produces one).
export function removeCycles(deps) {
  const out = {};
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (out[from] || []).some((p) => reaches(p, target, seen));
  };
  for (const [t, ps] of Object.entries(deps)) {
    for (const p of ps) {
      if (reaches(p, t)) continue; // p already depends on t
      (out[t] = out[t] || []).push(p);
    }
  }
  return out;
}

// ---------- the plan ----------
const IMP = { 1: 0.7, 2: 1, 3: 1.4 };

// Everything the plan needs per topic, across all subjects with a syllabus.
export function topicBlocks(study, syllabi) {
  const blocks = [];
  for (const subj of study.subjects) {
    const syl = syllabi.find((s) => s.id === subj.syllabusId);
    if (!syl) continue;
    const stats = new Map(topicStats(syl).map((r) => [r.topic.id, r]));
    const all = syl.units.flatMap((u, ui) => u.topics.map((t, ti) => ({ t, ui, ti, unit: u.title })));
    const subjWeight = (Number(subj.maxMarks) || 100) * (IMP[subj.importance] || 1);
    all.forEach(({ t, ui, unit }, order) => {
      const st = stats.get(t.id) || { count: 0, inPapers: 0, totalPapers: 0 };
      const share = st.totalPapers ? st.inPapers / st.totalPapers : 0;
      const ov = study.overrides[t.id] || {};
      const learnMin = Math.round(ov.minutes || (study.hours && study.hours[t.id] ? study.hours[t.id] * 60 : 60));
      blocks.push({
        subjectId: subj.id, subjectName: subj.name, syllabusId: syl.id, topicId: t.id, title: t.title, unit, unitIndex: ui, order,
        learned: !!t.done, revise: !!t.revise, skip: !!ov.skip, notBefore: ov.notBefore || '',
        pyqCount: st.count, inPapers: st.inPapers, totalPapers: st.totalPapers,
        // How much this topic is worth: the subject's marks and importance spread over its topics,
        // boosted by how often it comes up in past papers and by a missed mock-test question.
        score: (subjWeight / all.length) * (1 + 2 * share + (t.revise ? 0.5 : 0)),
        learnMin: Math.max(15, learnMin),
        practiceMin: st.count >= 2 ? 30 : 20,
        pyqMin: st.count ? Math.min(60, 15 * st.count) : 0,
        after: (study.deps[t.id] || []).filter((id) => id !== t.id),
      });
    });
  }
  return blocks;
}

export const itemKey = (kind, id) => `${kind}:${id}`;

// Work out the plan from `today` onwards.
export function buildPlan(study, syllabi, today) {
  const prefs = { minutesPerDay: 180, restDays: [], revisionDays: 2, ...study.prefs };
  const cap = Math.max(30, Number(prefs.minutesPerDay) || 180);
  const blocks = topicBlocks(study, syllabi);
  const byTopic = new Map(blocks.map((b) => [b.topicId, b]));
  const warnings = [];
  for (const s of study.subjects) {
    if (!s.syllabusId || !syllabi.some((x) => x.id === s.syllabusId)) warnings.push({ subjectId: s.id, text: `Add a syllabus for ${s.name} to plan it.` });
  }

  // Each subject's last study day for new topics: its exam date minus revision days (or 60 days out).
  const subjDeadline = {};
  const examOf = {};
  for (const s of study.subjects) {
    const exam = s.examDate && s.examDate > today ? s.examDate : '';
    examOf[s.id] = exam;
    subjDeadline[s.id] = exam ? addDays(exam, -(1 + (Number(prefs.revisionDays) || 0))) : addDays(today, 60);
    if (s.examDate && s.examDate <= today) warnings.push({ subjectId: s.id, text: `${s.name}’s exam date has passed. Change it in Plan settings.` });
  }

  // Units of work, in the order they must happen for each topic.
  const work = [];
  for (const b of blocks) {
    if (b.skip) continue;
    const items = [];
    if (!b.learned) items.push({ kind: 'learn', minutes: b.learnMin, title: `Learn: ${b.title}` });
    if (!study.progress[itemKey('practice', b.topicId)]) items.push({ kind: 'practice', minutes: b.practiceMin, title: `Practice: ${b.title}` });
    if (b.pyqMin && !study.progress[itemKey('pyq', b.topicId)]) items.push({ kind: 'pyq', minutes: b.pyqMin, title: `Past questions: ${b.title}` });
    if (items.length) work.push({ b, items });
  }

  // Revision and a mock test in the days before each exam, reserved before anything else.
  const reserved = new Map(); // date -> items
  for (const s of study.subjects) {
    const exam = examOf[s.id];
    if (!exam || !s.syllabusId || !syllabi.some((x) => x.id === s.syllabusId)) continue;
    const rd = Number(prefs.revisionDays) || 0;
    for (let i = rd; i >= 1; i--) {
      const date = addDays(exam, -i);
      if (date < today) continue;
      const key = itemKey(i === 1 ? 'mock' : 'revise', `${s.id}:${date}`);
      if (study.progress[key]) continue;
      const item = i === 1
        ? { key, kind: 'mock', title: `Mock test: ${s.name}`, minutes: 90, subjectId: s.id, syllabusId: s.syllabusId }
        : { key, kind: 'revise', title: `Revise ${s.name}: most-asked topics`, minutes: 90, subjectId: s.id, syllabusId: s.syllabusId };
      reserved.set(date, [...(reserved.get(date) || []), item]);
    }
  }

  const examDays = new Set(Object.values(examOf).filter(Boolean));
  const days = [];
  const scheduledLearn = new Map(); // topicId -> date its learning is scheduled (or '' if learned already)
  for (const b of blocks) if (b.learned || b.skip) scheduledLearn.set(b.topicId, '');
  const pending = new Set(work);
  const lastDate = study.subjects.reduce((m, s) => (subjDeadline[s.id] > m ? subjDeadline[s.id] : m), today);
  let lastSubject = null;

  const ready = (w, date) => {
    if (w.b.notBefore && w.b.notBefore > date) return false;
    if (date > subjDeadline[w.b.subjectId]) return false;
    // Prerequisites must be learned or scheduled on an earlier day (or earlier the same day).
    return w.b.after.every((p) => !byTopic.has(p) || scheduledLearn.has(p));
  };
  const priority = (w, date) => {
    const left = Math.max(0, daysBetween(date, subjDeadline[w.b.subjectId]));
    const urgency = 1 + 6 / (left + 2);
    const flow = w.b.subjectId === lastSubject ? 1.15 : 1; // stay in one subject for a while
    const sequence = 1 / (1 + w.b.order * 0.01);           // nudge towards syllabus order
    return w.b.score * urgency * flow * sequence;
  };

  for (let date = today, guard = 0; date <= lastDate && pending.size && guard < 400; date = addDays(date, 1), guard++) {
    const day = { date, items: [...(reserved.get(date) || [])] };
    reserved.delete(date);
    const rest = (prefs.restDays || []).includes(parseDay(date).getDay());
    // Today: what was already done today counts against the day, so ticking things off doesn't pull tomorrow in.
    const doneToday = date === today ? Number((study.dayDone || {})[today]) || 0 : 0;
    let room = rest ? 0 : cap - doneToday - day.items.reduce((a, i) => a + i.minutes, 0);
    if (examDays.has(date)) room = 0; // keep exam days free
    while (room > 0 && pending.size) {
      // Highest priority first; if it doesn't fit in what's left of the day, take the best one that does.
      const tolerance = day.items.length ? cap * 0.2 : Infinity;
      const cands = [...pending].filter((w) => ready(w, date)).map((w) => [w, priority(w, date)]).sort((a, b) => b[1] - a[1]);
      const pick = cands.find(([w]) => w.items[0].minutes - room <= tolerance);
      if (!pick) break;
      const best = pick[0];
      const first = best.items[0];
      best.items.shift();
      room -= first.minutes;
      day.items.push({ key: itemKey(first.kind, best.b.topicId), kind: first.kind, title: first.title, minutes: first.minutes, subjectId: best.b.subjectId, topicId: best.b.topicId, syllabusId: best.b.syllabusId, after: best.b.after.filter((p) => byTopic.has(p)) });
      if (first.kind === 'learn') scheduledLearn.set(best.b.topicId, date);
      lastSubject = best.b.subjectId;
      if (!best.items.length) pending.delete(best);
    }
    days.push(day);
  }

  for (const [date, items] of reserved) days.push({ date, items });
  days.sort((a, b) => a.date.localeCompare(b.date));

  // Topics that didn't fit, and topics the student chose to skip.
  const dropped = [];
  for (const w of pending) dropped.push({ subjectId: w.b.subjectId, topicId: w.b.topicId, title: w.b.title, reason: 'Not enough time before the exam. These have the lowest priority.' });
  for (const b of blocks) if (b.skip) dropped.push({ subjectId: b.subjectId, topicId: b.topicId, title: b.title, reason: 'Skipped by you', skipped: true });

  return { today, days: days.filter((d) => d.items.length || d.date === today), dropped, warnings, goals: buildGoals(study, blocks, days, examOf, today) };
}

// One goal per subject, split into weekly sub-goals (and a revision sub-goal before the exam).
export function buildGoals(study, blocks, days, examOf, today) {
  const goals = [];
  for (const s of study.subjects) {
    const mine = blocks.filter((b) => b.subjectId === s.id && !b.skip);
    if (!mine.length) continue;
    const learned = mine.filter((b) => b.learned).length;
    const items = days.flatMap((d) => d.items.filter((i) => i.subjectId === s.id).map((i) => ({ ...i, date: d.date })));
    const weeks = [];
    const seen = new Set();
    for (const it of items.filter((i) => i.kind !== 'revise' && i.kind !== 'mock')) {
      const wk = Math.floor(daysBetween(today, it.date) / 7);
      if (!weeks[wk]) weeks[wk] = { start: addDays(today, wk * 7), topics: new Map(), minutes: 0 };
      weeks[wk].minutes += it.minutes;
      if (!seen.has(it.topicId)) { seen.add(it.topicId); weeks[wk].topics.set(it.topicId, it.title.replace(/^[^:]+:\s*/, '')); }
    }
    const subgoals = weeks.filter(Boolean).map((w, i) => ({
      id: `${s.id}:w${i}`,
      title: i === 0 ? 'This week' : `Week of ${niceDay(w.start).replace(/^\w+,?\s*/, '')}`,
      due: addDays(w.start, 6),
      topics: [...w.topics.values()],
      minutes: w.minutes,
    }));
    if (examOf[s.id] && (study.prefs.revisionDays || 0) > 0) subgoals.push({ id: `${s.id}:rev`, title: 'Revision and mock test', due: examOf[s.id], topics: [], minutes: 0, revision: true });
    goals.push({
      subjectId: s.id,
      title: examOf[s.id] ? `${s.name}: finish all topics before ${niceDay(examOf[s.id])}` : `${s.name}: finish all topics`,
      exam: examOf[s.id], daysLeft: examOf[s.id] ? daysBetween(today, examOf[s.id]) : null,
      learned, total: mine.length, subgoals,
    });
  }
  return goals;
}

// Rough "how likely am I to finish" per subject: learning minutes left vs study minutes available.
export function feasibility(study, syllabi, today) {
  const blocks = topicBlocks(study, syllabi);
  const prefs = study.prefs;
  return study.subjects.map((s) => {
    const left = blocks.filter((b) => b.subjectId === s.id && !b.skip && !b.learned).reduce((a, b) => a + b.learnMin + b.practiceMin + b.pyqMin, 0);
    const exam = s.examDate && s.examDate > today ? s.examDate : '';
    if (!exam) return { subjectId: s.id, left, ok: true };
    let avail = 0;
    for (let d = today; d < addDays(exam, -(prefs.revisionDays || 0)); d = addDays(d, 1)) if (!(prefs.restDays || []).includes(parseDay(d).getDay())) avail += prefs.minutesPerDay;
    return { subjectId: s.id, left, avail, ok: left <= avail };
  });
}
