// Oris lecture player page. Opened as player.html#v=VIDEO&topic=TOPIC&syl=SYLLABUS[&t=SECONDS].
import { createBridge, RELAY_URL } from '../lib/player-bridge.js';
import {
  LECTURES_KEY, mergeLectures, playlistFor, trackTick, addPoints, POINTS, STICKY_COLORS, fmtTime, uid,
  notesMarkdown, aiQuiz, videoForTopic,
} from '../lib/lectures.js';
import { STUDY_KEY, mergeStudy, logEvent, addDays } from '../lib/study.js';
import { KEYS, mergeSettings, todayKey } from '../lib/defaults.js';
import { hasAI } from '../lib/ai.js';

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, val]) => n.style.setProperty(p, val));
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

// ---------- state ----------
const params = new URLSearchParams(location.hash.slice(1));
const S = { settings: mergeSettings(null), lect: mergeLectures(null), syllabi: [], study: mergeStudy(null) };
let videoId = params.get('v') || '';
let topicId = params.get('topic') || '';
const sylId = params.get('syl') || '';
let bridge = null;
let tab = 'notes';
const live = { t: 0, d: 0, state: -1, rate: 1, lastTick: 0, dirty: false };
let loop = { a: null, b: null };
let noteDraft = { text: '', t: null, sticky: false, color: STICKY_COLORS[0] };
let quiz = null; // { questions, i, picked, correct, done, gained }
let quizBusy = false;

const syl = () => S.syllabi.find((y) => y.id === sylId) || null;
const topic = () => { const y = syl(); if (!y) return null; for (const u of y.units) for (const t of u.topics) if (t.id === topicId) return t; return null; };
const rows = () => (syl() ? playlistFor(syl(), S.lect, S.study.deps) : []);
const current = () => rows().find((r) => r.video && r.video.videoId === videoId) || null;
const meta = () => {
  const r = current();
  if (r) return r.video;
  const t = topic();
  return (t && videoForTopic(S.lect, t)) || { videoId, title: 'Lecture', channel: '', seconds: 0 };
};
const notes = () => (S.lect.notes[videoId] || []).slice().sort((a, b) => a.t - b.t);
const prog = () => S.lect.progress[videoId] || { pos: 0, dur: 0, max: 0, watched: 0, done: false };

async function saveLect(fn) {
  const r = await chrome.storage.local.get(LECTURES_KEY);
  const next = mergeLectures(r[LECTURES_KEY]);
  // Keep the in-memory progress for the open video (it's newer than what's stored).
  if (S.lect.progress[videoId]) next.progress[videoId] = S.lect.progress[videoId];
  fn(next);
  S.lect = next;
  await chrome.storage.local.set({ [LECTURES_KEY]: next });
}

// ---------- rendering ----------
function renderTop() {
  const y = syl();
  const t = topic();
  const m = meta();
  $('crumbs').replaceChildren(...[y ? el('span', {}, `${y.name} · `) : null, el('strong', {}, t ? t.title : m.title), m.channel ? el('span', {}, ` · ${m.channel}`) : null].filter(Boolean));
  document.title = `${t ? t.title : m.title} · Oris`;
  $('points').textContent = `★ ${S.lect.points.total || 0} points`;
  const list = rows().filter((r) => r.video);
  const i = list.findIndex((r) => r.video.videoId === videoId);
  $('btn-prev').disabled = i <= 0;
  $('btn-next').disabled = i < 0 || i >= list.length - 1;
}

function renderTimeline() {
  const d = live.d || prog().dur || meta().seconds || 0;
  const pct = d ? Math.min(100, (live.t / d) * 100) : 0;
  $('fill').style.width = `${pct}%`;
  $('time').textContent = `${fmtTime(live.t)} / ${fmtTime(d)}`;
  const tl = $('timeline');
  tl.setAttribute('aria-valuemax', String(Math.round(d)));
  tl.setAttribute('aria-valuenow', String(Math.round(live.t)));
  tl.setAttribute('aria-valuetext', `${fmtTime(live.t)} of ${fmtTime(d)}`);
  const band = $('loopband');
  if (loop.a != null && d) {
    band.hidden = false;
    const b = loop.b != null ? loop.b : live.t;
    band.style.left = `${(Math.min(loop.a, b) / d) * 100}%`;
    band.style.width = `${(Math.abs(b - loop.a) / d) * 100}%`;
  } else band.hidden = true;
  $('btn-play').textContent = live.state === 1 ? '❚❚' : '▶';
  $('btn-play').setAttribute('aria-label', live.state === 1 ? 'Pause' : 'Play');
}

function renderMarks() {
  const d = live.d || prog().dur || meta().seconds || 0;
  const box = $('marks');
  if (!d) { box.replaceChildren(); return; }
  box.replaceChildren(...notes().map((n) => {
    const b = el('button', {
      class: `pl-mark${n.sticky ? ' sticky' : ''}`, style: { left: `${(n.t / d) * 100}%`, '--c': n.color || STICKY_COLORS[0] },
      'aria-label': `${fmtTime(n.t)}: ${n.text}`, title: `${fmtTime(n.t)} ${n.text}`,
      onclick: (e) => { e.stopPropagation(); seek(n.t); },
    });
    b.addEventListener('mouseenter', () => { const tip = el('div', { class: 'pl-tip', style: { left: `${(n.t / d) * 100}%` } }, `${fmtTime(n.t)} · ${n.text}`); box.append(tip); b._tip = tip; });
    b.addEventListener('mouseleave', () => { if (b._tip) b._tip.remove(); });
    return b;
  }));
}

function renderPanel() {
  for (const [id, name] of [['tab-notes', 'notes'], ['tab-next', 'next'], ['tab-quiz', 'quiz']]) $(id).setAttribute('aria-selected', String(tab === name));
  const a = document.activeElement;
  if (tab === 'notes' && a && $('panel').contains(a) && a.tagName === 'TEXTAREA') return; // don't wipe while typing
  $('panel').replaceChildren(...(tab === 'notes' ? notesPanel() : tab === 'next' ? playlistPanel() : quizPanel()).filter(Boolean));
}

// ---------- notes ----------
function notesPanel() {
  const list = notes();
  const t = noteDraft.t != null ? noteDraft.t : live.t;
  const near = list.reduce((best, n) => (n.t <= live.t + 1 && (!best || n.t > best.t) ? n : best), null);
  return [
    el('div', { class: 'note-box' },
      el('div', { class: 'note-row' },
        el('span', {}, 'Note at ', el('button', { class: 't-chip', type: 'button', title: 'Jump here', onclick: () => seek(t) }, fmtTime(t))),
        el('label', {}, el('input', { type: 'checkbox', checked: noteDraft.sticky, onchange: (e) => { noteDraft.sticky = e.target.checked; renderPanel(); } }), ' Pin on timeline'),
        noteDraft.sticky ? el('span', { class: 'colors' }, ...STICKY_COLORS.map((c) => el('button', { type: 'button', style: { '--c': c }, 'aria-label': 'Sticky colour', 'aria-pressed': String(noteDraft.color === c), onclick: () => { noteDraft.color = c; renderPanel(); } }))) : null),
      el('textarea', {
        id: 'note-input', placeholder: 'Write what you just learned. Enter saves, Shift+Enter adds a line.', 'aria-label': 'Note',
        oninput: (e) => {
          if (noteDraft.t == null) { noteDraft.t = live.t; if (S.lect.prefs.pauseOnNote && live.state === 1) bridge && bridge.pause(); }
          noteDraft.text = e.target.value;
        },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); } if (e.key === 'Escape') { e.target.blur(); } },
      }, noteDraft.text),
      el('div', { class: 'note-row' },
        el('label', {}, el('input', { type: 'checkbox', checked: S.lect.prefs.pauseOnNote, onchange: (e) => saveLect((l) => { l.prefs.pauseOnNote = e.target.checked; }) }), ' Pause while I type'),
        el('button', { class: 'pl-btn primary', type: 'button', onclick: saveNote }, 'Save note'))),
    list.length ? el('ul', { class: 'note-list' }, ...list.map((n) => el('li', { class: `note${n.sticky ? ' sticky' : ''}${near && near.id === n.id ? ' now' : ''}`, 'data-t': String(n.t), style: { '--c': n.color || STICKY_COLORS[0] } },
      el('button', { class: 't-chip', type: 'button', onclick: () => seek(n.t) }, fmtTime(n.t)),
      el('p', {}, n.sticky ? '📌 ' : '', n.text),
      el('button', { class: 'x', type: 'button', 'aria-label': 'Delete note', title: 'Delete', onclick: () => deleteNote(n.id) }, '×'))))
      : el('p', { class: 'empty' }, 'Notes you write are stamped with the time in the video. Click a time to jump back. Pinned notes show on the timeline.'),
    list.length ? el('div', { class: 'panel-foot' },
      el('button', { class: 'pl-btn', type: 'button', onclick: downloadNotes }, 'Download notes (.md)'),
      el('button', { class: 'pl-btn ghost', type: 'button', onclick: copyToOris }, 'Add to my Oris notes')) : null,
  ];
}

async function saveNote() {
  const text = noteDraft.text.trim();
  if (!text) { toast('Write something first.'); return; }
  const n = { id: uid(), t: noteDraft.t != null ? noteDraft.t : live.t, text: text.slice(0, 2000), sticky: noteDraft.sticky, color: noteDraft.color, at: Date.now() };
  noteDraft = { text: '', t: null, sticky: false, color: noteDraft.color };
  await saveLect((l) => { l.notes[videoId] = [...(l.notes[videoId] || []), n]; });
  logStudy(n.sticky ? 'lecture.pin' : 'lecture.note', { videoId, t: Math.round(n.t) });
  const ta = $('note-input');
  if (ta) ta.blur();
  renderPanel();
  renderMarks();
  toast(n.sticky ? `Pinned at ${fmtTime(n.t)}` : `Note saved at ${fmtTime(n.t)}`);
}
async function deleteNote(id) {
  await saveLect((l) => { l.notes[videoId] = (l.notes[videoId] || []).filter((n) => n.id !== id); });
  renderPanel();
  renderMarks();
}
function downloadNotes() {
  const t = topic();
  const blob = new Blob([notesMarkdown(meta(), notes(), t ? t.title : '')], { type: 'text/markdown' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `oris-notes-${(t ? t.title : 'lecture').replace(/[^\w]+/g, '-').toLowerCase()}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyToOris() {
  const t = topic();
  const text = `${t ? t.title : meta().title} (lecture notes)\n` + notes().map((n) => `${fmtTime(n.t)} ${n.text}`).join('\n');
  const res = await chrome.runtime.sendMessage({ type: 'planner:op', op: 'addNote', args: { text: text.slice(0, 4000), task: t ? t.title : '' } });
  toast(res && res.ok ? 'Added to Study → Focus notes' : 'Couldn’t add the notes. Try again.', res && res.ok ? '' : 'error');
}

// ---------- playlist ----------
function playlistPanel() {
  const list = rows();
  if (!list.length) return [el('p', { class: 'empty' }, 'Open lectures from Study → Lectures to get the whole subject as a playlist here.')];
  let lastUnit = '';
  const out = [el('label', { class: 'toggle-line' }, el('input', { type: 'checkbox', checked: S.lect.prefs.autoNext, onchange: (e) => saveLect((l) => { l.prefs.autoNext = e.target.checked; }) }), 'Play the next lecture automatically')];
  const ul = el('ul', { class: 'pl-list' });
  for (const r of list) {
    if (r.unit !== lastUnit) { lastUnit = r.unit; ul.append(el('li', { class: 'unit-head' }, r.unit)); }
    const p = r.progress;
    const pct = p && p.dur ? Math.round((p.done ? 1 : Math.min(1, p.max / p.dur)) * 100) : 0;
    ul.append(el('li', {}, el('button', {
      class: `pl-item${r.video && r.video.videoId === videoId ? ' now' : ''}`, type: 'button', disabled: !r.video,
      onclick: () => r.video && switchTo(r.video.videoId, r.topic ? r.topic.id : ''),
    },
    r.video ? el('img', { src: r.video.thumb || `https://i.ytimg.com/vi/${r.video.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }) : el('span', { class: 'noimg' }),
    el('span', { class: 'meta' },
      el('strong', {}, r.topic ? r.topic.title : r.video.title),
      el('span', {}, r.video ? [r.video.seconds ? fmtTime(r.video.seconds) : '', p && p.done ? '✓ watched' : pct ? `${pct}%` : ''].filter(Boolean).join(' · ') : 'No video yet'),
      r.video ? el('span', { class: 'bar' }, el('span', { style: { width: `${pct}%` } })) : null))));
  }
  out.push(ul);
  return out;
}

// ---------- practice ----------
function quizPanel() {
  const p = prog();
  const d = p.dur || live.d || meta().seconds;
  const pct = d ? Math.round(Math.min(1, p.watched / d) * 100) : 0;
  const best = S.lect.quiz[videoId];
  if (!hasAI(S.settings)) return [el('p', { class: 'empty' }, 'Practice questions need AI. Turn on Oris AI in Oris Settings.')];
  if (!quiz) {
    return [
      el('p', {}, el('strong', {}, 'Check what you learned')),
      el('p', { class: 'empty' }, '5 quick questions on this topic. Each right answer earns points; a perfect score earns a bonus. Questions are written by AI from the topic and your notes.'),
      el('div', { class: 'watch-meter', title: `${pct}% watched` }, el('span', { style: { width: `${pct}%` } })),
      el('p', { class: 'empty' }, `${pct}% watched${best ? ` · best score ${best.best}/5` : ''}`),
      el('button', { class: 'pl-btn primary', type: 'button', disabled: quizBusy, onclick: startQuiz }, quizBusy ? 'Writing questions…' : best ? 'Practice again' : 'Start practice'),
      pct < 50 ? el('p', { class: 'empty' }, 'Tip: watch most of the lecture first.') : null,
    ];
  }
  if (quiz.done) {
    const n = quiz.questions.length;
    return [
      el('p', { class: 'quiz-progress' }, 'Practice done'),
      el('p', { class: 'quiz-score' }, `${quiz.correct}/${n}`),
      el('p', { class: 'empty' }, quiz.gained ? `+${quiz.gained} points` : 'No new points: beat your best score to earn more.'),
      el('div', { class: 'panel-foot' },
        el('button', { class: 'pl-btn primary', type: 'button', onclick: () => { quiz = null; startQuiz(); } }, 'New questions'),
        el('button', { class: 'pl-btn ghost', type: 'button', onclick: () => { quiz = null; renderPanel(); } }, 'Close')),
    ];
  }
  const q = quiz.questions[quiz.i];
  const answered = quiz.picked != null;
  return [
    el('p', { class: 'quiz-progress' }, `Question ${quiz.i + 1} of ${quiz.questions.length} · ${quiz.correct} right`),
    el('p', { class: 'quiz-q' }, q.q),
    el('div', { class: 'quiz-opts', role: 'group', 'aria-label': 'Answers' }, ...q.options.map((o, k) => el('button', {
      type: 'button', disabled: answered,
      class: answered ? (o === q.answer ? 'right' : o === quiz.picked ? 'wrong' : '') : '',
      onclick: () => { quiz.picked = o; if (o === q.answer) quiz.correct++; renderPanel(); },
    }, `${String.fromCharCode(65 + k)}. ${o}`))),
    answered ? el('p', { class: 'quiz-explain' }, quiz.picked === q.answer ? '✓ Right. ' : `✗ The answer is “${q.answer}”. `, q.explain || '') : null,
    answered ? el('button', { class: 'pl-btn primary', type: 'button', onclick: nextQuestion }, quiz.i + 1 < quiz.questions.length ? 'Next question' : 'See score') : null,
  ];
}

async function startQuiz() {
  quizBusy = true;
  renderPanel();
  try {
    const y = syl();
    const t = topic();
    const questions = await aiQuiz({ topic: t ? t.title : meta().title, subject: y ? (y.subject || y.name) : '', videoTitle: meta().title, notes: notes() }, S.settings);
    quiz = { questions: questions.slice(0, 5), i: 0, picked: null, correct: 0, done: false, gained: 0 };
  } catch (e) {
    toast(e.message || String(e), 'error');
  }
  quizBusy = false;
  renderPanel();
}

async function nextQuestion() {
  if (quiz.i + 1 < quiz.questions.length) { quiz.i++; quiz.picked = null; renderPanel(); return; }
  quiz.done = true;
  const prev = S.lect.quiz[videoId] || { best: 0, attempts: 0 };
  const n = quiz.questions.length;
  // Points only for beating your best, so retakes can't be farmed.
  const gain = Math.max(0, quiz.correct - prev.best) * POINTS.correct + (quiz.correct === n && prev.best < n ? POINTS.perfect : 0);
  quiz.gained = gain;
  await saveLect((l) => {
    l.quiz[videoId] = { best: Math.max(prev.best, quiz.correct), attempts: (prev.attempts || 0) + 1, last: quiz.correct, total: n };
    if (gain) addPoints(l, 'quiz', gain, videoId);
  });
  logStudy('lecture.quiz', { videoId, correct: quiz.correct, of: n });
  if (gain) bumpPoints();
  renderTop();
  renderPanel();
}

function bumpPoints() {
  const p = $('points');
  p.classList.remove('bump');
  void p.offsetWidth;
  p.classList.add('bump');
}

// ---------- playback ----------
function seek(t) {
  const d = live.d || prog().dur || 0;
  t = Math.max(0, d ? Math.min(d - 0.5, t) : t);
  live.t = t;
  if (bridge) bridge.seek(t);
  renderTimeline();
  renderPanel();
}
function toggle() { if (!bridge) return; if (live.state === 1) bridge.pause(); else bridge.play(); }
function setRate(r) { $('speed').value = String(r); if (bridge) bridge.rate(r); }
function stepRate(dir) {
  const opts = [...$('speed').options].map((o) => Number(o.value));
  const i = opts.indexOf(Number($('speed').value));
  setRate(opts[Math.max(0, Math.min(opts.length - 1, i + dir))]);
}

async function markLearned() {
  const t = topic();
  if (!t || t.done) return false;
  const r = await chrome.storage.local.get([KEYS.syllabi, STUDY_KEY]);
  const list = (r[KEYS.syllabi] || []).map((y) => (y.id !== sylId ? y : { ...y, units: y.units.map((u) => ({ ...u, topics: u.topics.map((x) => (x.id === t.id ? { ...x, done: true } : x)) })) }));
  const st = mergeStudy(r[STUDY_KEY]);
  const today = todayKey();
  st.progress[`learn:${t.id}`] = today;
  st.dayDone = { ...(st.dayDone || {}), [today]: ((st.dayDone || {})[today] || 0) + Math.round((meta().seconds || live.d || 3600) / 60) };
  for (const d of Object.keys(st.dayDone)) if (d < addDays(today, -30)) delete st.dayDone[d];
  logEvent(st, 'lecture.done', { topicId: t.id, videoId });
  await chrome.storage.local.set({ [KEYS.syllabi]: list, [STUDY_KEY]: st });
  S.syllabi = list;
  S.study = st;
  return true;
}

async function logStudy(kind, data) {
  const r = await chrome.storage.local.get(STUDY_KEY);
  const st = logEvent(mergeStudy(r[STUDY_KEY]), kind, data);
  await chrome.storage.local.set({ [STUDY_KEY]: st });
}

async function onDone() {
  await saveLect((l) => addPoints(l, 'watch', POINTS.watch, videoId));
  const learned = await markLearned();
  bumpPoints();
  renderTop();
  toast(`Lecture complete. +${POINTS.watch} points${learned ? `. “${topic().title}” is marked learned in your plan.` : ''}`);
}

let lastSave = 0;
function onTime(e) {
  const now = Date.now();
  const dt = live.lastTick ? (now - live.lastTick) / 1000 : 0.5;
  live.lastTick = now;
  live.t = e.t; live.d = e.d || live.d; live.state = e.state; live.rate = e.rate || 1;
  const { p, justDone } = trackTick(S.lect.progress[videoId], { t: e.t, d: live.d, playing: e.state === 1, dt });
  S.lect.progress[videoId] = p;
  live.dirty = true;
  if (justDone) onDone();
  if (loop.a != null && loop.b != null && e.state === 1 && e.t >= Math.max(loop.a, loop.b)) bridge.seek(Math.min(loop.a, loop.b));
  if (now - lastSave > 10000) { lastSave = now; persistProgress(); }
  renderTimeline();
  highlightNote();
}

// Keep the note you're "at" highlighted as the video plays, without redrawing the panel.
function highlightNote() {
  const items = [...document.querySelectorAll('.note[data-t]')];
  let best = null;
  for (const li of items) if (Number(li.dataset.t) <= live.t + 1 && (!best || Number(li.dataset.t) > Number(best.dataset.t))) best = li;
  for (const li of items) li.classList.toggle('now', li === best);
}
async function persistProgress() {
  if (!live.dirty) return;
  live.dirty = false;
  await saveLect(() => {});
}

function showEnd() {
  const list = rows().filter((r) => r.video);
  const i = list.findIndex((r) => r.video.videoId === videoId);
  const nx = list[i + 1];
  const card = $('endcard');
  card.hidden = false;
  card.replaceChildren(el('div', {},
    el('h2', {}, prog().done ? 'Lecture complete ✓' : 'End of the video'),
    el('p', {}, prog().done ? el('span', { class: 'gain' }, `+${POINTS.watch} points`) : 'Watch most of it to count it as done.', ' Now lock it in with a few practice questions.'),
    el('div', { class: 'row' },
      el('button', { class: 'pl-btn primary', type: 'button', onclick: () => { card.hidden = true; tab = 'quiz'; renderPanel(); } }, 'Practice now'),
      nx ? el('button', { class: 'pl-btn', type: 'button', onclick: () => switchTo(nx.video.videoId, nx.topic ? nx.topic.id : '') }, `Next: ${nx.topic ? nx.topic.title : nx.video.title}`) : null,
      el('button', { class: 'pl-btn ghost', type: 'button', onclick: () => { card.hidden = true; seek(0); bridge.play(); } }, 'Watch again'))));
  if (nx && S.lect.prefs.autoNext && !prog().done) return; // only auto-advance after a completed lecture
  if (nx && S.lect.prefs.autoNext) setTimeout(() => { if (!card.hidden && live.state === 0) switchTo(nx.video.videoId, nx.topic ? nx.topic.id : ''); }, 8000);
}

function showFail() {
  const card = $('failcard');
  card.hidden = false;
  card.replaceChildren(el('div', {},
    el('h2', {}, 'This video can’t play inside Oris'),
    el('p', {}, 'The channel may not allow embedding, or the Oris player page isn’t online yet. You can still watch it on YouTube and keep your notes here.'),
    el('div', { class: 'row' },
      el('a', { class: 'pl-btn primary', href: `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(prog().pos || 0)}s`, target: '_blank', rel: 'noopener' }, 'Open on YouTube'),
      el('a', { class: 'pl-btn', href: '../newtab/newtab.html' }, 'Back to Oris'))));
}

function startPlayer(start) {
  $('endcard').hidden = true;
  $('failcard').hidden = true;
  if (bridge) bridge.destroy();
  live.t = start; live.d = prog().dur || meta().seconds || 0; live.state = -1; live.lastTick = 0;
  bridge = createBridge($('stage'), {
    videoId, start, mode: S.lect.prefs.mode || 'auto', relayUrl: RELAY_URL,
    onEvent: (e) => {
      if (e.type === 'time') onTime(e);
      else if (e.type === 'ready') { if (e.d) live.d = e.d; renderTimeline(); renderMarks(); if ($('speed').value !== '1') bridge.rate(Number($('speed').value)); }
      else if (e.type === 'state') { live.state = e.state; renderTimeline(); if (e.state === 0) { persistProgress(); showEnd(); } }
      else if (e.type === 'error') { toast(`YouTube error ${e.code}: this video can’t be played here.`, 'error'); showFail(); }
      else if (e.type === 'fail') showFail();
    },
  });
}

async function switchTo(id, tId) {
  await persistProgress();
  videoId = id;
  topicId = tId || '';
  quiz = null;
  loop = { a: null, b: null };
  noteDraft = { text: '', t: null, sticky: false, color: noteDraft.color };
  const p = new URLSearchParams({ v: videoId });
  if (topicId) p.set('topic', topicId);
  if (sylId) p.set('syl', sylId);
  history.replaceState(null, '', `#${p}`);
  const pr = prog();
  startPlayer(pr.pos > 10 && pr.dur && pr.pos < pr.dur - 30 ? pr.pos : 0);
  renderAll();
}

function renderAll() { renderTop(); renderTimeline(); renderMarks(); renderPanel(); }

// ---------- wiring ----------
$('btn-play').addEventListener('click', toggle);
$('btn-back').addEventListener('click', () => seek(live.t - 10));
$('btn-fwd').addEventListener('click', () => seek(live.t + 10));
$('btn-prev').addEventListener('click', () => { const l = rows().filter((r) => r.video); const i = l.findIndex((r) => r.video.videoId === videoId); if (i > 0) switchTo(l[i - 1].video.videoId, l[i - 1].topic ? l[i - 1].topic.id : ''); });
$('btn-next').addEventListener('click', () => { const l = rows().filter((r) => r.video); const i = l.findIndex((r) => r.video.videoId === videoId); if (i >= 0 && i < l.length - 1) switchTo(l[i + 1].video.videoId, l[i + 1].topic ? l[i + 1].topic.id : ''); });
$('speed').addEventListener('change', (e) => setRate(Number(e.target.value)));
$('btn-loopA').addEventListener('click', () => { loop = { a: live.t, b: null }; $('btn-loopA').setAttribute('aria-pressed', 'true'); toast(`Loop starts at ${fmtTime(live.t)}. Press B at the end point.`); renderTimeline(); });
$('btn-loopB').addEventListener('click', () => {
  if (loop.a == null || loop.b != null) { loop = { a: null, b: null }; $('btn-loopA').setAttribute('aria-pressed', 'false'); $('btn-loopB').textContent = 'B'; toast('Loop off'); renderTimeline(); return; }
  if (Math.abs(live.t - loop.a) < 2) { toast('Move a little further first.'); return; }
  loop.b = live.t;
  $('btn-loopB').textContent = 'Stop loop';
  seek(Math.min(loop.a, loop.b));
  toast(`Looping ${fmtTime(Math.min(loop.a, loop.b))}–${fmtTime(Math.max(loop.a, loop.b))}`);
});
$('btn-pin').addEventListener('click', () => { tab = 'notes'; noteDraft.t = live.t; noteDraft.sticky = true; if (S.lect.prefs.pauseOnNote && bridge) bridge.pause(); renderPanel(); const ta = $('note-input'); if (ta) ta.focus(); });
$('btn-full').addEventListener('click', () => { const s = $('stage-wrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen(); });
$('btn-focus').addEventListener('click', async () => {
  const t = topic();
  const res = await chrome.runtime.sendMessage({ type: 'timer:start', phase: 'focus', task: `Lecture: ${t ? t.title : meta().title}`, taskId: null });
  if (res && res.ok) { $('btn-focus').setAttribute('aria-pressed', 'true'); $('btn-focus').textContent = 'Focusing'; toast('Focus started. Distracting sites are blocked while you watch.'); }
});
$('timeline').addEventListener('click', (e) => {
  const r = $('timeline').getBoundingClientRect();
  const d = live.d || prog().dur || 0;
  if (!d || !r.width) return;
  seek(((e.clientX - r.left) / r.width) * d);
});
$('timeline').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seek(live.t - 5); }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(live.t + 5); }
});
for (const [id, name] of [['tab-notes', 'notes'], ['tab-next', 'next'], ['tab-quiz', 'quiz']]) $(id).addEventListener('click', () => { tab = name; renderPanel(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = {
    ' ': toggle, k: toggle, j: () => seek(live.t - 10), l: () => seek(live.t + 10), arrowleft: () => seek(live.t - 5), arrowright: () => seek(live.t + 5),
    n: () => { tab = 'notes'; noteDraft.t = live.t; if (S.lect.prefs.pauseOnNote && bridge) bridge.pause(); renderPanel(); const ta = $('note-input'); if (ta) ta.focus(); },
    p: () => $('btn-pin').click(), '[': () => stepRate(-1), ']': () => stepRate(1), a: () => $('btn-loopA').click(), b: () => $('btn-loopB').click(), f: () => $('btn-full').click(),
  };
  if (map[k]) { e.preventDefault(); map[k](); }
});

window.addEventListener('pagehide', () => { persistProgress(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persistProgress(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.settings]) S.settings = mergeSettings(changes[KEYS.settings].newValue);
  if (changes[KEYS.syllabi]) { S.syllabi = changes[KEYS.syllabi].newValue || []; renderTop(); }
});

// ---------- boot ----------
(async () => {
  const r = await chrome.storage.local.get([KEYS.settings, LECTURES_KEY, KEYS.syllabi, STUDY_KEY]);
  S.settings = mergeSettings(r[KEYS.settings]);
  S.lect = mergeLectures(r[LECTURES_KEY]);
  S.syllabi = r[KEYS.syllabi] || [];
  S.study = mergeStudy(r[STUDY_KEY]);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    $('failcard').hidden = false;
    $('failcard').replaceChildren(el('div', {}, el('h2', {}, 'No lecture chosen'), el('p', {}, 'Open a lecture from Study → Lectures in Oris.')));
    renderTop();
    return;
  }
  const pr = prog();
  const start = Number(params.get('t')) || (pr.pos > 10 && pr.dur && pr.pos < pr.dur - 30 ? pr.pos : 0);
  startPlayer(start);
  renderAll();
})();

export const _test = { live, S, seek, onTime, switchTo, saveNote, get bridge() { return bridge; }, noteDraft: () => noteDraft, setDraft: (d) => { noteDraft = { ...noteDraft, ...d }; } };
