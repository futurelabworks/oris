// Exam prep inside a syllabus: past papers (PYQs), most-asked topics, what to study first,
// per-topic past questions + practice questions, and timed mock tests.
// Created once per Syllabus view; syllabus.js calls into it while rendering.
import { hasAI } from '../lib/ai.js';
import { createFinder } from './paper-finder.js';
import {
  uid, EXAM_TYPES, readPaperFor, topicStats, studyPriority, pyqsForTopic, pyqSearchUrl,
  aiPractice, mockPool, buildMock, mockQuestion, scoreMock,
} from '../lib/pyq.js';

export function createExam(ctx, { getSyl, updateSyl, render }) {
  const { el, state, toast, send } = ctx;
  const openTopicExam = new Set();   // topics whose exam panel is open
  const openStat = new Set();        // topics expanded in "Most asked"
  const shownAnswers = new Set();    // practice ids with the answer revealed
  const busy = new Set();            // topic ids generating practice
  const paste = { text: '', year: '', name: '' };
  let reading = '';                  // "Reading paper 1 of 2…"
  let setup = { source: 'both', scope: 'done', count: 10, minutes: '' };
  let run = null;                    // { phase: 'test'|'mark', choices: {}, marks: {} } for the running mock
  let clock = null;
  let confirmPaper = null;

  const allTopics = (syl) => syl.units.flatMap((u) => u.topics);
  const finder = createFinder(ctx, { addPaper: (syl, p) => addPaper(syl, p), render: () => render() });
  const topicName = (syl, id) => (allTopics(syl).find((t) => t.id === id) || {}).title || 'Deleted topic';
  const fmtMarks = (m) => (m ? `${m} mark${m === 1 ? '' : 's'}` : '');

  // ---------- reading papers ----------
  async function addPaper(syl, { text, name, year }) {
    const r = await readPaperFor(getSyl(syl.id) || syl, { text, name, year }, state.settings, { useAI: hasAI(state.settings) });
    await updateSyl(syl.id, (s) => { s.papers = [...(s.papers || []), r.paper]; s.pyqs = [...(s.pyqs || []), ...r.pyqs]; return s; });
    return r;
  }

  async function readFiles(syl, files) {
    let done = 0;
    for (const f of files) {
      reading = `Reading paper ${done + 1} of ${files.length}…`;
      render();
      try {
        let text;
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          const { pdfToText } = await import('../lib/pdf-text.js');
          text = (await pdfToText(f)).text;
          if (text.replace(/\s/g, '').length < 60) throw new Error(`${f.name} has no selectable text, so it’s probably a scan. Paste its text instead.`);
        } else {
          text = await f.text();
        }
        const r = await addPaper(syl, { text, name: f.name.replace(/\.[^.]+$/, ''), year: '' });
        toast(`${f.name}: ${r.n} questions, ${r.matched} matched to topics`);
        if (r.warning) toast(`AI step failed (${r.warning}). Used basic matching.`, 'error');
        done++;
      } catch (err) {
        toast(err.message || String(err), 'error');
      }
    }
    reading = '';
    render();
  }

  async function readPaste(syl) {
    const text = paste.text.trim();
    if (text.length < 40) { toast('Paste the question paper text first.', 'error'); return; }
    reading = 'Reading the paper…';
    render();
    try {
      const name = paste.name.trim() || `Paper ${(syl.papers || []).length + 1}`;
      const r = await addPaper(syl, { text, name, year: paste.year.trim() });
      Object.assign(paste, { text: '', year: '', name: '' });
      toast(`${r.n} questions, ${r.matched} matched to topics`);
      if (r.warning) toast(`AI step failed (${r.warning}). Used basic matching.`, 'error');
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      reading = '';
      render();
    }
  }

  // ---------- practice ----------
  async function makePractice(syl, topic) {
    if (!hasAI(state.settings)) { toast('Practice questions need AI. Turn on Oris AI in Settings.', 'error'); return; }
    busy.add(topic.id);
    render();
    try {
      const items = await aiPractice(topic, getSyl(syl.id) || syl, state.settings);
      await updateSyl(syl.id, (s) => {
        for (const u of s.units) for (const t of u.topics) if (t.id === topic.id) t.practice = [...(t.practice || []), ...items].slice(-30);
        return s;
      });
      toast(`${items.length} practice questions added`);
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      busy.delete(topic.id);
      render();
    }
  }

  // ---------- small pieces ----------
  function pyqItem(syl, q, { reassign = false } = {}) {
    return el('li', { class: 'pyq' },
      el('p', { class: 'pyq-text' }, q.text),
      el('div', { class: 'pyq-meta' },
        el('span', {}, [q.year, q.label ? `Q${q.label}` : '', fmtMarks(q.marks)].filter(Boolean).join(' · ')),
        reassign || !q.topicId ? el('select', {
          class: 'text-input pyq-move', 'aria-label': 'Topic for this question',
          onchange: (e) => updateSyl(syl.id, (s) => { const x = s.pyqs.find((p) => p.id === q.id); if (x) { x.topicId = e.target.value || null; x.how = 'manual'; } return s; }),
        },
        el('option', { value: '' }, q.topicId ? 'Not matched' : 'Choose a topic…'),
        ...syl.units.map((u) => el('optgroup', { label: u.title }, ...u.topics.map((t) => el('option', { value: t.id, selected: t.id === q.topicId }, t.title))))) : null));
  }

  function practiceItem(p) {
    const open = shownAnswers.has(p.id);
    const toggle = () => { if (open) shownAnswers.delete(p.id); else shownAnswers.add(p.id); render(); };
    return el('li', { class: 'practice' },
      el('p', { class: 'pyq-text' }, p.q),
      p.options ? el('ol', { class: 'mcq', type: 'A' }, ...p.options.map((o) => el('li', { class: open && o === p.answer ? 'correct' : '' }, o))) : null,
      el('div', { class: 'pyq-meta' },
        el('span', { class: `level ${p.level}` }, [p.level, fmtMarks(p.marks)].filter(Boolean).join(' · ')),
        el('button', { class: 'linkish', 'aria-expanded': String(open), onclick: toggle }, open ? 'Hide answer' : 'Show answer')),
      open ? el('div', { class: 'answer' },
        p.options ? el('p', {}, el('strong', {}, 'Answer: '), p.answer) : el('p', { class: 'answer-outline' }, p.answer),
        p.explain ? el('p', { class: 'hint' }, p.explain) : null) : null);
  }

  // ---------- inside the Topics list ----------
  function topicChips(syl, topic) {
    const n = (syl.pyqs || []).filter((q) => q.topicId === topic.id).length;
    const papers = (syl.papers || []).length;
    const inPapers = new Set((syl.pyqs || []).filter((q) => q.topicId === topic.id).map((q) => q.paperId)).size;
    return [
      n ? el('span', { class: `chip-asked${papers && inPapers / papers >= 0.5 ? ' hot' : ''}`, title: `${n} past question${n === 1 ? '' : 's'}` }, `Asked ${inPapers}/${papers}`) : null,
      topic.revise ? el('span', { class: 'chip-revise', title: 'You missed this in a mock test' }, 'Revise') : null,
    ].filter(Boolean);
  }

  function topicChipsRow(syl, topic) {
    const chips = topicChips(syl, topic);
    return chips.length ? el('div', { class: 'topic-chips' }, ...chips) : null;
  }

  function topicButton(syl, topic) {
    const open = openTopicExam.has(topic.id);
    const n = (syl.pyqs || []).filter((q) => q.topicId === topic.id).length + (topic.practice || []).length;
    return el('button', {
      class: 'btn ghost small exam-btn', 'aria-expanded': String(open), title: 'Past questions and practice',
      onclick: () => { if (open) openTopicExam.delete(topic.id); else openTopicExam.add(topic.id); render(); },
    }, open ? 'Close' : n ? `Exam (${n})` : 'Exam');
  }

  function topicPanel(syl, topic) {
    if (!openTopicExam.has(topic.id)) return null;
    const past = pyqsForTopic(syl, topic.id);
    const practice = topic.practice || [];
    const ai = hasAI(state.settings);
    return el('div', { class: 'exam-panel' },
      el('div', { class: 'exam-sub' },
        el('h4', {}, `Past questions (${past.length})`),
        el('a', { href: pyqSearchUrl(syl, topic.title), target: '_blank', rel: 'noopener', class: 'linkish' }, 'Find PYQs online')),
      past.length ? el('ul', { class: 'pyq-list' }, ...past.map((q) => pyqItem(syl, q))) : el('p', { class: 'hint' }, (syl.papers || []).length ? 'Not asked in your uploaded papers.' : 'Upload past papers in Exam prep to see this topic’s questions here.'),
      el('div', { class: 'exam-sub' },
        el('h4', {}, `Practice (${practice.length})`),
        el('button', { class: 'btn small', disabled: busy.has(topic.id) || !ai, onclick: () => makePractice(syl, topic) },
          busy.has(topic.id) ? 'Writing questions…' : practice.length ? 'More questions' : 'Practice questions')),
      practice.length ? el('ul', { class: 'pyq-list' }, ...practice.slice().reverse().map(practiceItem)) : null,
      el('p', { class: 'hint small' }, ai
        ? 'Practice questions are written by AI to help you revise. They aren’t real past-paper questions.'
        : 'Turn on Oris AI in Settings to get practice questions.'));
  }

  // ---------- Exam prep tab ----------
  function papersPanel(syl) {
    const papers = syl.papers || [];
    const input = el('input', {
      type: 'file', multiple: true, accept: '.pdf,.txt,.md,application/pdf,text/plain', class: 'visually-hidden',
      onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) readFiles(syl, files); },
    });
    return el('section', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h2', {}, `Past papers (${papers.length})`),
        el('a', { class: 'linkish', href: pyqSearchUrl(syl), target: '_blank', rel: 'noopener' }, 'Find papers online')),
      finder.panel(syl),
      papers.length ? el('ul', { class: 'paper-list' }, ...papers.map((p) => el('li', {},
        el('span', { class: 'paper-name' }, p.name),
        el('span', { class: 'source-meta' }, [p.year, `${(syl.pyqs || []).filter((q) => q.paperId === p.id).length} questions`].filter(Boolean).join(' · ')),
        el('button', {
          class: `icon-btn small${confirmPaper === p.id ? ' armed' : ''}`, 'aria-label': `Remove paper ${p.name}`, title: 'Remove paper',
          onclick: async () => {
            if (confirmPaper !== p.id) { confirmPaper = p.id; render(); setTimeout(() => { if (confirmPaper === p.id) { confirmPaper = null; render(); } }, 4000); return; }
            confirmPaper = null;
            await updateSyl(syl.id, (s) => { s.papers = (s.papers || []).filter((x) => x.id !== p.id); s.pyqs = (s.pyqs || []).filter((q) => q.paperId !== p.id); return s; });
          },
        }, confirmPaper === p.id ? 'Remove?' : '×')))) : el('p', { class: 'hint' }, 'Upload previous-year question papers. Oris reads every question, matches it to your topics, and shows what comes up most.'),
      reading ? el('p', { class: 'batch' }, reading) : el('label', { class: 'drop small-drop' }, input, el('span', { class: 'drop-text' }, 'Upload papers (PDF or text)'), el('small', {}, 'You can pick several at once')),
      el('details', { class: 'paste-paper' },
        el('summary', {}, 'Or paste a paper'),
        el('div', { class: 'exam-draft' },
          el('div', { class: 'grid2' },
            el('label', { class: 'field' }, el('span', {}, 'Name'), el('input', { class: 'text-input', value: paste.name, placeholder: 'e.g. End term Dec', oninput: (e) => { paste.name = e.target.value; } })),
            el('label', { class: 'field' }, el('span', {}, 'Year'), el('input', { class: 'text-input', inputmode: 'numeric', maxlength: '4', value: paste.year, placeholder: '2024', oninput: (e) => { paste.year = e.target.value; } }))),
          el('textarea', { class: 'text-input', rows: '6', placeholder: 'Q1. (a) What is…', 'aria-label': 'Question paper text', oninput: (e) => { paste.text = e.target.value; } }, paste.text),
          el('button', { class: 'btn small', disabled: !!reading, onclick: () => readPaste(syl) }, 'Read paper'))));
  }

  function analysisPanels(syl) {
    const pyqs = syl.pyqs || [];
    if (!pyqs.length) return [];
    const stats = topicStats(syl);
    const asked = stats.filter((r) => r.count);
    const never = stats.length - asked.length;
    const unmatched = pyqs.filter((q) => !q.topicId);
    const prio = studyPriority(syl, 6);
    const max = Math.max(1, ...asked.map((r) => r.inPapers));
    return [
      prio.length ? el('section', { class: 'panel' },
        el('h2', {}, 'Study these first'),
        el('p', { class: 'hint' }, 'Unfinished topics that come up most in your papers.'),
        el('ol', { class: 'prio-list' }, ...prio.map((r) => el('li', {},
          el('div', {}, el('span', { class: 'prio-title' }, r.topic.title, r.topic.revise ? el('span', { class: 'chip-revise' }, 'Revise') : null),
            el('span', { class: 'source-meta' }, `In ${r.inPapers} of ${r.totalPapers} papers · ${r.count} question${r.count === 1 ? '' : 's'}`)),
          el('button', {
            class: 'btn ghost small',
            onclick: async () => { if (await send({ type: 'timer:start', phase: 'focus', task: `${syl.name}: ${r.topic.title}`, taskId: null })) toast(`Focus started on ${r.topic.title}`); },
          }, 'Focus'))))) : null,
      el('section', { class: 'panel' },
        el('h2', {}, 'Most asked topics'),
        el('p', { class: 'hint' }, `${pyqs.length} questions from ${(syl.papers || []).length} paper${(syl.papers || []).length === 1 ? '' : 's'}.${never ? ` ${never} topic${never === 1 ? '' : 's'} never came up.` : ''}`),
        el('ul', { class: 'asked-list' }, ...asked.slice(0, 15).map((r) => {
          const open = openStat.has(r.topic.id);
          return el('li', { class: r.topic.done ? 'done' : '' },
            el('button', { class: 'asked-row', 'aria-expanded': String(open), onclick: () => { if (open) openStat.delete(r.topic.id); else openStat.add(r.topic.id); render(); } },
              el('span', { class: 'asked-title' }, r.topic.done ? '✓ ' : '', r.topic.title),
              el('span', { class: 'asked-bar' }, el('span', { style: { width: `${(r.inPapers / max) * 100}%` } })),
              el('span', { class: 'asked-num' }, `${r.inPapers}/${r.totalPapers}`)),
            open ? el('ul', { class: 'pyq-list' }, ...pyqsForTopic(syl, r.topic.id).map((q) => pyqItem(syl, q, { reassign: true }))) : null);
        }))),
      unmatched.length ? el('section', { class: 'panel' },
        el('h2', {}, `Not matched (${unmatched.length})`),
        el('p', { class: 'hint' }, 'Oris couldn’t tell which topic these belong to. Pick one, or leave them.'),
        el('ul', { class: 'pyq-list' }, ...unmatched.slice(0, 30).map((q) => pyqItem(syl, q)))) : null,
    ].filter(Boolean);
  }

  // ---------- mock tests ----------
  function startClock() {
    clearInterval(clock);
    clock = setInterval(() => {
      const syl = getSyl(currentId);
      const node = document.querySelector('.mock-clock');
      if (!syl || !syl.mock) { clearInterval(clock); return; }
      const left = syl.mock.endsAt - Date.now();
      if (node) node.textContent = fmtLeft(left);
      if (left <= 0 && run && run.phase === 'test') { run.phase = 'mark'; toast('Time’s up. Now mark your answers.'); render(); }
    }, 1000);
  }
  let currentId = null;
  const fmtLeft = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function mockSetup(syl) {
    const ai = hasAI(state.settings);
    const pool = mockPool(syl, setup);
    const comp = syl.examType === 'competitive';
    const minutes = Number(setup.minutes) || Math.min(180, setup.count * (comp ? 2 : 6));
    const history = (syl.mocks || []).slice(-5).reverse();
    const doneTopics = allTopics(syl).filter((t) => t.done).length;
    return el('section', { class: 'panel' },
      el('h2', {}, 'Mock test'),
      el('div', { class: 'grid2 exam-draft' },
        el('label', { class: 'field' }, el('span', {}, 'Questions from'), el('select', { class: 'text-input', onchange: (e) => { setup.source = e.target.value; render(); } },
          ...[['both', 'Past papers + practice'], ['pyq', 'Past papers only'], ['practice', 'Practice only']].map(([v, l]) => el('option', { value: v, selected: setup.source === v }, l)))),
        el('label', { class: 'field' }, el('span', {}, 'Topics'), el('select', { class: 'text-input', onchange: (e) => { setup.scope = e.target.value; render(); } },
          el('option', { value: 'done', selected: setup.scope === 'done' }, `Topics I’ve finished (${doneTopics})`),
          el('option', { value: 'all', selected: setup.scope === 'all' }, 'Whole syllabus'),
          ...syl.units.map((u) => el('option', { value: u.id, selected: setup.scope === u.id }, u.title)))),
        el('label', { class: 'field' }, el('span', {}, 'Number of questions'), el('select', { class: 'text-input', onchange: (e) => { setup.count = Number(e.target.value); render(); } },
          ...[5, 10, 15, 20, 30].map((n) => el('option', { value: String(n), selected: setup.count === n }, String(n))))),
        el('label', { class: 'field' }, el('span', {}, 'Time (minutes)'), el('input', { class: 'text-input', inputmode: 'numeric', value: setup.minutes, placeholder: String(minutes), oninput: (e) => { setup.minutes = e.target.value.replace(/\D/g, '').slice(0, 3); } }))),
      el('p', { class: 'source-meta' }, pool.length
        ? `${pool.length} question${pool.length === 1 ? '' : 's'} available for this choice.`
        : setup.scope === 'done' && !doneTopics ? 'Tick topics as done first, or choose “Whole syllabus”.'
          : `No questions yet. Upload past papers${ai ? ' or make practice questions on topics' : ''} first.`),
      el('button', {
        class: 'btn primary', disabled: !pool.length,
        onclick: async () => {
          const items = buildMock(syl, setup);
          const mins = Number(setup.minutes) || minutes;
          await updateSyl(syl.id, (s) => { s.mock = { startedAt: Date.now(), endsAt: Date.now() + mins * 60000, minutes: mins, source: setup.source, items }; return s; });
          run = { phase: 'test', choices: {}, marks: {} };
          window.scrollTo(0, 0);
        },
      }, 'Start mock test'),
      history.length ? el('div', { class: 'mock-history' },
        el('p', { class: 'summary-label' }, 'Recent results'),
        el('ul', {}, ...history.map((m) => el('li', {},
          el('span', {}, new Date(m.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })),
          el('span', { class: 'source-meta' }, `${m.got} right, ${m.partly} partly, ${m.missed} missed`),
          el('strong', {}, `${m.percent}%`))))) : null);
  }

  function mockRunner(syl) {
    const m = syl.mock;
    if (!run) run = { phase: Date.now() > m.endsAt ? 'mark' : 'test', choices: {}, marks: {} };
    currentId = syl.id;
    if (run.phase === 'test') startClock(); else clearInterval(clock);
    const qs = m.items.map((it) => ({ it, q: mockQuestion(syl, it) })).filter((x) => x.q);
    const marking = run.phase === 'mark';
    // MCQs mark themselves.
    if (marking) for (const { it, q } of qs) if (q.options && !run.marks[it.id]) run.marks[it.id] = run.choices[it.id] === q.answer ? 'got' : 'missed';
    const allMarked = qs.every(({ it }) => run.marks[it.id]);
    return [
      el('section', { class: `panel mock-head${marking ? '' : ' live'}` },
        el('div', { class: 'section-head' },
          el('h2', {}, marking ? 'Mark your answers' : 'Mock test'),
          marking ? null : el('span', { class: 'mock-clock', role: 'timer', 'aria-label': 'Time left' }, fmtLeft(m.endsAt - Date.now()))),
        el('p', { class: 'hint' }, marking
          ? 'Compare with the answer outline or your notes, then mark each one honestly.'
          : `${qs.length} questions · ${m.minutes} minutes. Write your answers on paper, like the real exam.`),
        el('div', { class: 'row' },
          marking ? null : el('button', { class: 'btn primary small', onclick: () => { run.phase = 'mark'; clearInterval(clock); render(); window.scrollTo(0, 0); } }, 'Finish and mark'),
          el('button', {
            class: 'btn ghost small',
            onclick: async () => { run = null; clearInterval(clock); await updateSyl(syl.id, (s) => { delete s.mock; return s; }); },
          }, 'Quit test'))),
      el('ol', { class: 'mock-list' }, ...qs.map(({ it, q }, i) => el('li', { class: `mock-q ${run.marks[it.id] || ''}` },
        el('p', { class: 'pyq-text' }, el('strong', {}, `${i + 1}. `), q.text),
        q.options ? el('div', { class: 'mcq-choices', role: 'radiogroup', 'aria-label': `Question ${i + 1}` }, ...q.options.map((o, k) => el('label', { class: marking ? (o === q.answer ? 'correct' : run.choices[it.id] === o ? 'wrong' : '') : '' },
          el('input', { type: 'radio', name: `mq-${it.id}`, value: o, checked: run.choices[it.id] === o, disabled: marking, onchange: () => { run.choices[it.id] = o; } }),
          el('span', {}, `${String.fromCharCode(65 + k)}. ${o}`)))) : null,
        el('p', { class: 'pyq-meta' }, [q.topic && q.topic.title, q.meta, fmtMarks(q.marks)].filter(Boolean).join(' · ')),
        marking ? el('div', { class: 'mark-box' },
          q.options ? null : (q.answer ? el('p', { class: 'answer-outline' }, el('strong', {}, 'Answer outline: '), q.answer) : el('p', { class: 'hint' }, 'Past-paper question: check your notes or the lecture for this topic.')),
          q.explain ? el('p', { class: 'hint' }, q.explain) : null,
          q.options ? el('p', { class: 'source-meta' }, run.marks[it.id] === 'got' ? 'Correct' : 'Wrong or not answered') : el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': `Mark question ${i + 1}` },
            ...[['got', 'Got it'], ['partly', 'Partly'], ['missed', 'Missed']].map(([v, l]) => el('button', {
              type: 'button', role: 'radio', 'aria-checked': String(run.marks[it.id] === v), 'aria-pressed': String(run.marks[it.id] === v),
              onclick: () => { run.marks[it.id] = v; render(); },
            }, l)))) : null))),
      marking ? el('section', { class: 'panel' },
        el('button', {
          class: 'btn primary', disabled: !allMarked,
          onclick: async () => {
            const marks = Object.fromEntries(qs.map(({ it }) => [it.id, run.marks[it.id]]));
            const sc = scoreMock(marks);
            const byTopic = new Map();
            for (const { it } of qs) { const a = byTopic.get(it.topicId) || []; a.push(marks[it.id]); byTopic.set(it.topicId, a); }
            await updateSyl(syl.id, (s) => {
              s.mocks = [...(s.mocks || []), { id: uid(), at: Date.now(), total: sc.total, got: sc.got, partly: sc.partly, missed: sc.missed, percent: sc.percent, minutes: s.mock.minutes, source: s.mock.source }].slice(-50);
              for (const u of s.units) for (const t of u.topics) {
                const r = byTopic.get(t.id);
                if (!r) continue;
                if (r.some((x) => x !== 'got')) t.revise = true; else delete t.revise;
              }
              delete s.mock;
              return s;
            });
            run = null;
            toast(`Mock test saved: ${sc.percent}%. Topics to revise are marked.`);
          },
        }, allMarked ? 'Save result' : `Mark all ${qs.length} questions to save`)) : null,
    ].filter(Boolean);
  }

  function examTab(syl) {
    currentId = syl.id;
    if (syl.mock) return mockRunner(syl);
    clearInterval(clock);
    run = null;
    return [
      el('section', { class: 'panel exam-type' },
        el('label', { class: 'field' }, el('span', {}, 'Exam type'),
          el('select', { class: 'text-input', onchange: (e) => updateSyl(syl.id, (s) => { s.examType = e.target.value; return s; }) },
            ...EXAM_TYPES.map(([v, l]) => el('option', { value: v, selected: (syl.examType || 'university') === v }, l))),
          el('small', {}, 'Competitive exams get multiple-choice practice questions that mark themselves.'))),
      papersPanel(syl),
      ...analysisPanels(syl),
      mockSetup(syl),
    ];
  }

  return {
    topicChips, topicChipsRow, topicButton, topicPanel, examTab,
    isTyping: () => { const a = document.activeElement; return !!(a && a.closest && a.closest('.exam-draft') && a.matches('input, textarea')); },
    unmount: () => clearInterval(clock),
  };
}
