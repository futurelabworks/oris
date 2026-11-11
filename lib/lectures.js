// Lectures: one video per topic (the subject's playlist), watch progress, timestamped notes,
// timeline stickies, practice quizzes and points.
//
// storage key 'lectures':
//   videos   { [topicId]: { videoId, title, channel, seconds, thumb, source } }
//   extras   { [syllabusId]: [video] }          imported playlist videos that didn't match a topic
//   progress { [videoId]: { pos, dur, max, watched, done, at } }
//   notes    { [videoId]: [{ id, t, text, sticky, color, at }] }
//   quiz     { [videoId]: { best, attempts, last } }
//   points   { total, log: [{ at, kind, pts, videoId }] }
//   prefs    { autoNext, pauseOnNote, mode: 'auto'|'relay'|'direct' }
import { matchTopics } from './pyq.js';
import { chatJSON } from './ai.js';

export const LECTURES_KEY = 'lectures';
export const POINTS = { watch: 20, correct: 5, perfect: 10 };
export const STICKY_COLORS = ['#f5c542', '#5ac8a0', '#f08aa8', '#7aa7ff'];
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyLectures() {
  return { videos: {}, extras: {}, progress: {}, notes: {}, quiz: {}, points: { total: 0, log: [] }, prefs: { autoNext: true, pauseOnNote: true, mode: 'auto' } };
}
export function mergeLectures(raw) {
  const e = emptyLectures();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    videos: s.videos || {}, extras: s.extras || {}, progress: s.progress || {}, notes: s.notes || {}, quiz: s.quiz || {},
    points: { total: 0, log: [], ...(s.points || {}) }, prefs: { ...e.prefs, ...(s.prefs || {}) },
  };
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const fromSearch = (v, source = 'auto') => ({ videoId: v.id, title: v.title, channel: v.channel, seconds: v.durationSec || 0, thumb: v.thumb || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, source });

// The chosen video for a topic: the student's pick, else the best one found in Syllabus.
export function videoForTopic(lect, topic) {
  if (lect.videos[topic.id]) return lect.videos[topic.id];
  const v = Array.isArray(topic.videos) && topic.videos[0];
  return v ? fromSearch(v, 'syllabus') : null;
}

// Topics in study order: prerequisites first, otherwise syllabus order.
export function orderedTopics(syl, deps = {}) {
  const list = syl.units.flatMap((u) => u.topics.map((t) => ({ topic: t, unit: u.title })));
  const ids = new Set(list.map((x) => x.topic.id));
  const out = [];
  const placed = new Set();
  const visit = (x, stack = new Set()) => {
    if (placed.has(x.topic.id) || stack.has(x.topic.id)) return;
    stack.add(x.topic.id);
    for (const p of deps[x.topic.id] || []) if (ids.has(p)) visit(list.find((y) => y.topic.id === p), stack);
    placed.add(x.topic.id);
    out.push(x);
  };
  list.forEach((x) => visit(x));
  return out;
}

// A subject's playlist.
export function playlistFor(syl, lect, deps = {}) {
  const rows = orderedTopics(syl, deps).map(({ topic, unit }) => {
    const video = videoForTopic(lect, topic);
    return { topic, unit, video, progress: video ? lect.progress[video.videoId] || null : null };
  });
  const extras = (lect.extras[syl.id] || []).map((video) => ({ topic: null, unit: 'More from the playlist', video, progress: lect.progress[video.videoId] || null }));
  return [...rows, ...extras];
}

export function playlistStats(rows) {
  const withVideo = rows.filter((r) => r.video && r.topic);
  const done = withVideo.filter((r) => r.progress && r.progress.done).length;
  const seconds = withVideo.reduce((a, r) => a + (r.video.seconds || 0), 0);
  return { topics: rows.filter((r) => r.topic).length, withVideo: withVideo.length, done, seconds };
}

// One player tick. Counts real watching only (time moving forward while playing, at most a few
// seconds per tick), so skipping to the end doesn't count as watched.
export function trackTick(prev, { t, d, playing, dt }) {
  const p = { pos: 0, dur: 0, max: 0, watched: 0, done: false, ...(prev || {}) };
  const step = t - p.pos;
  if (playing && step > 0 && step <= Math.max(3, dt * 2.5)) p.watched = Math.min(d || Infinity, p.watched + step);
  p.pos = t;
  if (d > 0) p.dur = d;
  p.max = Math.max(p.max, t);
  p.at = Date.now();
  let justDone = false;
  if (!p.done && p.dur > 0 && p.max >= p.dur * 0.9 && p.watched >= p.dur * 0.5) { p.done = true; justDone = true; }
  return { p, justDone };
}

export function addPoints(lect, kind, pts, videoId) {
  lect.points = { total: (lect.points.total || 0) + pts, log: [...(lect.points.log || []), { at: Date.now(), kind, pts, videoId }].slice(-500) };
  return lect;
}

// Put an imported playlist's videos on the matching topics; the rest go to "More from the playlist".
// Topics that already have a video chosen by the student keep it.
export function assignImported(videos, syl, lect) {
  const matches = matchTopics(videos.map((v) => ({ text: v.title })), syl);
  const assigned = {};
  const extras = [];
  videos.forEach((v, i) => {
    const t = matches[i];
    const keep = t && lect.videos[t] && lect.videos[t].source === 'link';
    if (t && !assigned[t] && !keep) assigned[t] = fromSearch(v, 'playlist');
    else extras.push(fromSearch(v, 'playlist'));
  });
  return { assigned, extras };
}

export function notesMarkdown(video, notes, topicTitle = '') {
  const lines = [`# ${topicTitle || video.title}`, '', `Lecture: [${video.title}](https://www.youtube.com/watch?v=${video.videoId})${video.channel ? ` by ${video.channel}` : ''}`, ''];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    lines.push(`- [${fmtTime(n.t)}](https://youtu.be/${video.videoId}?t=${Math.floor(n.t)})${n.sticky ? ' 📌' : ''} ${n.text}`);
  }
  return lines.join('\n') + '\n';
}

// A short practice quiz for a lecture (AI). Based on the topic and the student's own notes.
export async function aiQuiz({ topic, subject, videoTitle, notes = [], count = 5 }, settings) {
  const noteText = notes.slice(0, 20).map((n) => `- (${fmtTime(n.t)}) ${n.text}`).join('\n');
  const content = await chatJSON({
    task: 'quiz',
    temperature: 0.4,
    messages: [
      { role: 'system', content: 'You write short multiple-choice quizzes that check a student understood a lecture topic. Be accurate. Reply with JSON only.' },
      { role: 'user', content: `Subject: ${subject}\nTopic: ${topic}\nLecture title: ${videoTitle}\n${noteText ? `The student's notes from the lecture:\n${noteText}\n` : ''}\nWrite ${count} multiple-choice questions (easy to medium) on this topic${noteText ? ', using the notes where they help' : ''}.\nReturn exactly: {"questions": [{"q": "<question>", "options": ["<A>", "<B>", "<C>", "<D>"], "answer": "<the correct option copied exactly>", "explain": "<one sentence>"}]}` },
    ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const qs = (Array.isArray(parsed.questions) ? parsed.questions : []).map((x) => {
    const options = (Array.isArray(x.options) ? x.options : []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    let answer = String(x.answer || '').trim();
    const letter = /^\(?([A-E])\)?(?:[.)\s]|$)/i.exec(answer);
    answer = options.find((o) => o.toLowerCase() === answer.toLowerCase()) || (letter ? options[letter[1].toUpperCase().charCodeAt(0) - 65] : '') || '';
    return options.length >= 2 && answer && x.q ? { q: String(x.q).slice(0, 400), options, answer, explain: String(x.explain || '').slice(0, 300) } : null;
  }).filter(Boolean);
  if (!qs.length) throw new Error('The AI didn’t return any questions. Try again.');
  return qs;
}

export function playerUrl(base, { videoId, topicId = '', syllabusId = '', start = 0 }) {
  const p = new URLSearchParams({ v: videoId });
  if (topicId) p.set('topic', topicId);
  if (syllabusId) p.set('syl', syllabusId);
  if (start) p.set('t', String(Math.floor(start)));
  return `${base}#${p}`;
}
