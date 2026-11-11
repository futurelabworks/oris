import { hasAI } from '../lib/ai.js';
import { parseSyllabus } from '../lib/syllabus.js';
import { findVideos, searchUrl, buildQuery, formatSeconds, formatViews } from '../lib/youtube.js';
import { createExam } from './exam.js';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const QUOTA_PER_TOPIC = 101;

function counts(syl) {
  let done = 0;
  let total = 0;
  for (const u of syl.units) for (const t of u.topics) { total++; if (t.done) done++; }
  return { done, total };
}

export function mount(root, ctx, params = {}) {
  const { el, state, saveSyllabi, toast } = ctx;
  const container = el('div');
  root.append(container);

  let mode = params.id ? 'detail' : 'list';
  let openId = params.id || null;
  const openUnits = new Set();
  const openTopics = new Set();
  const busyTopics = new Set();
  let batch = null; // { running, done, total, stop }
  let confirmBatch = false;
  let confirmDelete = false;
  let addState = { name: '', text: '', file: null, busy: '' };
  let detailTab = params.tab === 'exam' ? 'exam' : 'topics'; // 'topics' | 'exam'

  // ---------- data helpers ----------
  const getSyl = (id) => state.syllabi.find((s) => s.id === id);
  async function updateSyl(id, fn) {
    const list = state.syllabi.map((s) => (s.id === id ? fn(structuredClone(s)) : s));
    await saveSyllabi(list);
  }
  async function updateTopic(sylId, topicId, fn) {
    await updateSyl(sylId, (s) => {
      for (const u of s.units) for (const t of u.topics) if (t.id === topicId) fn(t);
      return s;
    });
  }

  const exam = createExam(ctx, { getSyl, updateSyl, render: () => render() });

  // ---------- list ----------
  function renderList() {
    const list = state.syllabi;
    const addBtn = el('button', { class: 'btn primary', onclick: () => { mode = 'add'; render(); } }, 'Add syllabus');
    if (!list.length) {
      return [el('section', { class: 'panel empty-state' },
        el('h2', {}, 'Turn your syllabus into a study plan'),
        el('p', {}, 'Upload a syllabus PDF or paste its text. Oris splits it into units and topics, then finds a good lecture on YouTube for each topic.'),
        addBtn)];
    }
    return [
      el('div', { class: 'section-head' }, el('h2', {}, 'Your syllabi'), addBtn),
      ...list.map((s) => {
        const { done, total } = counts(s);
        const pct = total ? Math.round((done / total) * 100) : 0;
        return el('button', { class: 'syl-card', onclick: () => { mode = 'detail'; openId = s.id; detailTab = 'topics'; confirmDelete = false; if (s.units[0]) openUnits.add(s.units[0].id); render(); } },
          el('span', { class: 'syl-name' }, s.name),
          el('span', { class: 'syl-meta' }, `${s.units.length} unit${s.units.length === 1 ? '' : 's'}, ${done} of ${total} topics done${(s.papers || []).length ? `, ${s.papers.length} past paper${s.papers.length === 1 ? '' : 's'}` : ''}`),
          el('span', { class: 'progress', 'aria-hidden': 'true' }, el('span', { style: { width: `${pct}%` } })),
        );
      }),
    ];
  }

  // ---------- add ----------
  async function submitAdd(e) {
    e.preventDefault();
    if (addState.busy) return;
    let text = addState.text.trim();
    try {
      if (addState.file) {
        const f = addState.file;
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          addState.busy = 'Reading the PDF…'; render();
          const { pdfToText } = await import('../lib/pdf-text.js');
          const res = await pdfToText(f);
          text = res.text;
          if (res.truncated) toast(`Only the first 40 of ${res.pages} pages were read.`);
          if (text.replace(/\s/g, '').length < 30) {
            throw new Error('This PDF has no selectable text, so it’s probably a scan. Paste the syllabus text instead.');
          }
        } else {
          text = await f.text();
        }
      }
      if (!text) throw new Error('Choose a file or paste the syllabus text first.');

      addState.busy = hasAI(state.settings) ? 'Finding topics with AI…' : 'Finding topics…'; render();
      const { plan, method, warning } = await parseSyllabus(text, state.settings);
      if (!plan.units.length) throw new Error('No topics found. Try pasting the syllabus text with one topic per line.');
      if (warning) toast(`AI step failed (${warning}). Used basic detection instead.`, 'error');

      const name = addState.name.trim() || plan.subject || (addState.file ? addState.file.name.replace(/\.[^.]+$/, '') : 'My syllabus');
      const syl = {
        id: uid(),
        name: name.slice(0, 80),
        subject: (addState.name.trim() || plan.subject || '').slice(0, 80),
        createdAt: Date.now(),
        method,
        units: plan.units.map((u) => ({ id: uid(), title: u.title, topics: u.topics.map((t) => ({ id: uid(), title: t, done: false, videos: null })) })),
      };
      await saveSyllabi([syl, ...state.syllabi]);
      addState = { name: '', text: '', file: null, busy: '' };
      mode = 'detail';
      openId = syl.id;
      openUnits.clear();
      openUnits.add(syl.units[0].id);
      render();
      const n = counts(syl).total;
      toast(`Found ${n} topic${n === 1 ? '' : 's'} in ${syl.units.length} unit${syl.units.length === 1 ? '' : 's'}`);
    } catch (err) {
      addState.busy = '';
      render();
      toast(err.message || String(err), 'error');
    }
  }

  function renderAdd() {
    const fileLabel = el('span', { class: 'drop-text' }, addState.file ? addState.file.name : 'Choose a PDF or text file');
    const fileInput = el('input', {
      type: 'file', accept: '.pdf,.txt,.md,application/pdf,text/plain', class: 'visually-hidden',
      onchange: (e) => { addState.file = e.target.files[0] || null; render(); },
    });
    const icon = ctx.svg('svg', { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true' },
      ctx.svg('path', { d: 'M12 16V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const drop = el('label', { class: `drop${addState.file ? ' has-file' : ''}` }, fileInput, icon, fileLabel,
      el('small', {}, addState.file ? 'Choose a different file' : 'Syllabus PDFs with selectable text work best'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) { addState.file = f; render(); }
    });

    const busy = !!addState.busy;
    return [
      el('div', { class: 'section-head' },
        el('button', { class: 'btn ghost small back', onclick: () => { mode = 'list'; render(); } }, '‹ Back'),
      ),
      el('form', { class: 'panel add-form', onsubmit: submitAdd },
        el('h2', {}, 'Add a syllabus'),
        el('label', { class: 'field' }, el('span', {}, 'Subject or exam'),
          el('input', {
            type: 'text', class: 'text-input', maxlength: '80', value: addState.name, disabled: busy,
            placeholder: 'e.g. DBMS, Class 12 Physics, UPSC GS-2',
            oninput: (e) => { addState.name = e.target.value; },
          }),
          el('small', {}, 'Added to every video search so results stay on subject.')),
        drop,
        addState.file ? el('button', { type: 'button', class: 'btn ghost small', onclick: () => { addState.file = null; render(); } }, 'Remove file') : null,
        el('label', { class: 'field' }, el('span', {}, addState.file ? 'Or paste text instead' : 'Or paste the syllabus text'),
          el('textarea', {
            rows: '6', class: 'text-input', disabled: busy || !!addState.file,
            placeholder: 'Unit 1: Introduction\nTopic one, topic two…',
            oninput: (e) => { addState.text = e.target.value; },
          }, addState.text)),
        el('div', { class: 'form-actions' },
          el('button', { class: 'btn primary lg', type: 'submit', disabled: busy }, busy ? addState.busy : 'Find topics'),
        ),
        hasAI(state.settings) ? null : el('p', { class: 'hint' }, 'Tip: turn on Oris AI in Settings for much better topic detection.'),
      ),
    ];
  }

  // ---------- detail ----------
  async function loadVideos(syl, topic, { silent } = {}) {
    busyTopics.add(topic.id);
    openTopics.add(topic.id);
    render();
    try {
      const videos = await findVideos(topic.title, { subject: syl.subject, key: state.settings.youtubeKey, lang: state.settings.videoLang });
      await updateTopic(syl.id, topic.id, (t) => { t.videos = videos; t.fetchedAt = Date.now(); });
      if (!videos.length && !silent) toast('No lecture-length videos found. Try “More on YouTube”.');
      return true;
    } catch (err) {
      toast(err.message || String(err), 'error');
      return false;
    } finally {
      busyTopics.delete(topic.id);
      render();
    }
  }

  async function runBatch(syl) {
    const todo = [];
    for (const u of syl.units) for (const t of u.topics) if (!t.videos) todo.push(t);
    batch = { running: true, done: 0, total: todo.length, stop: false };
    render();
    for (const t of todo) {
      if (batch.stop) break;
      const ok = await loadVideos(getSyl(syl.id) || syl, t, { silent: true });
      if (!ok) break;
      batch.done++;
      openTopics.delete(t.id);
      render();
    }
    const n = batch.done;
    batch = null;
    render();
    toast(`Found videos for ${n} topic${n === 1 ? '' : 's'}`);
  }

  function videoRow(syl, topic, v) {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`;
    return el('li', { class: `video${v.watched ? ' watched' : ''}` },
      el('a', { href: url, target: '_blank', rel: 'noopener', class: 'video-link' },
        el('span', { class: 'thumb' },
          v.thumb ? el('img', { src: v.thumb, alt: '', loading: 'lazy' }) : null,
          el('span', { class: 'dur' }, formatSeconds(v.durationSec))),
        el('span', { class: 'video-text' },
          el('span', { class: 'video-title' }, v.title),
          el('span', { class: 'video-meta' }, `${v.channel}, ${formatViews(v.views)}`)),
      ),
      el('label', { class: 'watched-box', title: 'Mark as watched' },
        el('input', {
          type: 'checkbox', checked: !!v.watched, 'aria-label': `Watched: ${v.title}`,
          onchange: (e) => updateTopic(syl.id, topic.id, (t) => {
            const x = t.videos.find((y) => y.id === v.id);
            if (x) x.watched = e.target.checked;
          }),
        })),
    );
  }

  function topicRow(syl, topic) {
    const hasKey = !!state.settings.youtubeKey;
    const query = buildQuery(topic.title, syl.subject, state.settings.videoLang);
    const busy = busyTopics.has(topic.id);
    const showing = openTopics.has(topic.id) && topic.videos;

    let action;
    if (!hasKey) {
      action = el('a', { class: 'btn small', href: searchUrl(query), target: '_blank', rel: 'noopener' }, 'Search');
    } else if (busy) {
      action = el('button', { class: 'btn small', disabled: true }, 'Finding…');
    } else if (topic.videos) {
      action = el('button', {
        class: 'btn small', 'aria-expanded': String(!!showing),
        onclick: () => { if (openTopics.has(topic.id)) openTopics.delete(topic.id); else openTopics.add(topic.id); render(); },
      }, showing ? 'Hide' : `Videos (${topic.videos.length})`);
    } else {
      action = el('button', { class: 'btn small', disabled: !!batch, onclick: () => loadVideos(syl, topic) }, 'Find videos');
    }

    return el('li', { class: `topic${topic.done ? ' done' : ''}` },
      el('div', { class: 'topic-row' },
        el('label', { class: 'topic-check' },
          el('input', {
            type: 'checkbox', checked: topic.done,
            onchange: (e) => updateTopic(syl.id, topic.id, (t) => { t.done = e.target.checked; }),
          }),
          el('span', {}, topic.title)),
        action,
        exam.topicButton(syl, topic),
        el('button', {
          class: 'icon-btn small', 'aria-label': `Remove topic ${topic.title}`, title: 'Remove topic',
          onclick: () => updateSyl(syl.id, (s) => { for (const u of s.units) u.topics = u.topics.filter((t) => t.id !== topic.id); return s; }),
        }, '×'),
      ),
      showing ? el('div', { class: 'videos' },
        topic.videos.length ? el('ul', {}, ...topic.videos.map((v) => videoRow(syl, topic, v))) : el('p', { class: 'hint' }, 'No lecture-length videos found for this topic.'),
        el('div', { class: 'videos-foot' },
          el('a', { href: searchUrl(query), target: '_blank', rel: 'noopener' }, 'More on YouTube'),
          el('button', { class: 'btn ghost small', disabled: busy || !!batch, onclick: () => loadVideos(syl, topic) }, 'Refresh'),
        )) : null,
      exam.topicChipsRow(syl, topic),
      exam.topicPanel(syl, topic),
    );
  }

  function unitBlock(syl, unit) {
    const done = unit.topics.filter((t) => t.done).length;
    let draft = '';
    const details = el('details', { class: 'unit', open: openUnits.has(unit.id) },
      el('summary', {}, el('span', { class: 'unit-title' }, unit.title), el('span', { class: 'unit-count' }, `${done}/${unit.topics.length}`)),
      el('ul', { class: 'topics' }, ...unit.topics.map((t) => topicRow(syl, t))),
      el('form', {
        class: 'add-row compact',
        onsubmit: (e) => {
          e.preventDefault();
          const title = draft.trim();
          if (!title) return;
          updateSyl(syl.id, (s) => { s.units.find((u) => u.id === unit.id).topics.push({ id: uid(), title: title.slice(0, 120), done: false, videos: null }); return s; });
        },
      },
      el('input', { type: 'text', class: 'text-input', placeholder: 'Add a topic', 'aria-label': `Add a topic to ${unit.title}`, oninput: (e) => { draft = e.target.value; } }),
      el('button', { class: 'btn small', type: 'submit' }, 'Add')),
    );
    details.addEventListener('toggle', () => { if (details.open) openUnits.add(unit.id); else openUnits.delete(unit.id); });
    return details;
  }

  function renderDetail() {
    const syl = getSyl(openId);
    if (!syl) { mode = 'list'; return renderList(); }
    const { done, total } = counts(syl);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const hasKey = !!state.settings.youtubeKey;
    const pending = syl.units.reduce((n, u) => n + u.topics.filter((t) => !t.videos).length, 0);

    let toolbar;
    if (batch) {
      toolbar = el('div', { class: 'batch' },
        el('span', {}, `Finding videos: ${batch.done} of ${batch.total}`),
        el('button', { class: 'btn small', onclick: () => { batch.stop = true; } }, 'Stop'));
    } else if (confirmBatch) {
      toolbar = el('div', { class: 'batch confirm' },
        el('span', {}, `Look up ${pending} topic${pending === 1 ? '' : 's'}? This uses about ${(pending * QUOTA_PER_TOPIC).toLocaleString('en-IN')} of your 10,000 daily YouTube quota units.`),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary small', onclick: () => { confirmBatch = false; runBatch(syl); } }, 'Find videos'),
          el('button', { class: 'btn ghost small', onclick: () => { confirmBatch = false; render(); } }, 'Cancel')));
    } else if (hasKey) {
      toolbar = pending ? el('button', { class: 'btn', onclick: () => { confirmBatch = true; render(); } }, `Find videos for all ${pending} topics`) : null;
    } else {
      toolbar = el('p', { class: 'hint' }, 'Add a YouTube API key in Settings to get the best lectures ranked here. Until then, “Search” opens YouTube results for each topic.');
    }

    return [
      el('div', { class: 'section-head' },
        el('button', { class: 'btn ghost small back', onclick: () => { mode = 'list'; confirmDelete = false; render(); } }, '‹ All syllabi'),
        el('button', {
          class: `btn small ${confirmDelete ? 'danger' : 'ghost'}`,
          onclick: async () => {
            if (!confirmDelete) { confirmDelete = true; render(); setTimeout(() => { confirmDelete = false; render(); }, 4000); return; }
            await saveSyllabi(state.syllabi.filter((s) => s.id !== syl.id));
            mode = 'list'; confirmDelete = false; render();
            toast(`Deleted ${syl.name}`);
          },
        }, confirmDelete ? 'Tap again to delete' : 'Delete'),
      ),
      el('section', { class: 'panel syl-head' },
        el('h2', {}, syl.name),
        el('p', { class: 'syl-meta' }, `${done} of ${total} topics done`),
        el('span', { class: 'progress', 'aria-hidden': 'true' }, el('span', { style: { width: `${pct}%` } })),
        syl.method === 'rules' ? el('p', { class: 'hint' }, 'Topics were split with basic rules. Remove or add topics if anything looks off.') : null,
        toolbar,
      ),
      el('div', { class: 'syl-tabs', role: 'tablist', 'aria-label': 'Syllabus sections' },
        ...[['topics', 'Topics'], ['exam', syl.mock ? 'Exam prep (test running)' : `Exam prep${(syl.pyqs || []).length ? ` (${syl.pyqs.length} PYQs)` : ''}`]].map(([v, l]) => el('button', {
          role: 'tab', 'aria-selected': String(detailTab === v), class: detailTab === v ? 'active' : '',
          onclick: () => { detailTab = v; render(); },
        }, l))),
      ...(detailTab === 'exam' ? exam.examTab(syl) : syl.units.map((u) => unitBlock(syl, u))),
    ];
  }

  function render() {
    const scroll = window.scrollY;
    const parts = mode === 'add' ? renderAdd() : mode === 'detail' ? renderDetail() : renderList();
    container.replaceChildren(...parts);
    if (mode === 'detail') window.scrollTo(0, scroll);
  }

  render();
  return {
    unmount() { exam.unmount(); },
    update(changed) {
      if (exam.isTyping()) return;
      if (changed.syllabi && mode !== 'add') render();
      if (changed.settings && mode !== 'add') render();
    },
  };
}
