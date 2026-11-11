// First-time study setup: about you → subjects → syllabus → past papers → study time → build plan.
// Every step saves as you go, so closing the panel never loses answers.
import { hasAI } from '../lib/ai.js';
import { parseSyllabus } from '../lib/syllabus.js';
import { readPaperFor } from '../lib/pyq.js';
import { LEVELS, IMPORTANCE, DAY_NAMES, uid, makeSyllabus, aiTopicOrder } from '../lib/study.js';
import { todayKey } from '../lib/defaults.js';
import { createFinder } from './paper-finder.js';

const STEPS = ['About you', 'Subjects', 'Syllabus', 'Past papers', 'Study time', 'Your plan'];

export function mount(root, ctx, params = {}) {
  const { el, state, saveStudy, saveSyllabi, toast, open } = ctx;
  const body = el('div', { class: 'setup' });
  root.append(body);
  let step = Math.min(STEPS.length - 1, Math.max(0, Number(params.step) || 0));
  const S = () => state.study;
  // Drafts for the current step (copied from saved data when the step opens).
  let about = null;
  let subjects = null;
  const sylDraft = {};   // subjectId -> { text, busy }
  let busy = '';
  const finder = createFinder(ctx, { addPaper: (syl, p) => addPaper(syl, p), render: () => render() });

  const getSyl = (id) => state.syllabi.find((s) => s.id === id);
  async function updateSyl(id, fn) {
    const list = state.syllabi.map((s) => (s.id === id ? fn(JSON.parse(JSON.stringify(s))) : s));
    await saveSyllabi(list);
  }
  async function addPaper(syl, p) {
    const r = await readPaperFor(getSyl(syl.id) || syl, p, state.settings, { useAI: hasAI(state.settings) });
    await updateSyl(syl.id, (s) => { s.papers = [...(s.papers || []), r.paper]; s.pyqs = [...(s.pyqs || []), ...r.pyqs]; return s; });
    return r;
  }

  function go(n) { step = n; about = null; subjects = null; render(); window.scrollTo(0, 0); }

  // ---------- step 1: about you ----------
  function stepAbout() {
    if (!about) about = { ...S().profile };
    const lv = about.level;
    const field = (label, key, attrs = {}, hint = '') => el('label', { class: 'field' }, el('span', {}, label),
      el('input', { class: 'text-input', value: about[key] || '', oninput: (e) => { about[key] = e.target.value; }, ...attrs }), hint ? el('small', {}, hint) : null);
    return [
      field('Your name', 'name', { maxlength: '40', placeholder: 'What should Oris call you?', autocomplete: 'given-name' }),
      el('fieldset', { class: 'choice-list' }, el('legend', {}, 'You are'),
        ...LEVELS.map(([v, l]) => el('label', { class: `choice${lv === v ? ' on' : ''}` },
          el('input', { type: 'radio', name: 'level', value: v, checked: lv === v, onchange: () => { about.level = v; render(); } }), el('span', {}, l)))),
      lv === 'school' ? el('label', { class: 'field' }, el('span', {}, 'Class'),
        el('select', { class: 'text-input', onchange: (e) => { about.classYear = e.target.value; } },
          el('option', { value: '' }, 'Choose…'), ...['6', '7', '8', '9', '10', '11', '12'].map((c) => el('option', { value: c, selected: about.classYear === c }, `Class ${c}`)))) : null,
      lv === 'school' ? field('Board', 'institution', { maxlength: '80', placeholder: 'e.g. CBSE, ICSE, UP Board' }) : null,
      lv === 'college' ? field('College or university', 'institution', { maxlength: '100', placeholder: 'e.g. GGSIPU, Delhi University' }, 'Used to find your university’s past papers.') : null,
      lv === 'college' ? field('Course and year', 'course', { maxlength: '80', placeholder: 'e.g. B.Tech CSE, 2nd year' }) : null,
      lv === 'competitive' ? field('Exam', 'course', { maxlength: '80', placeholder: 'e.g. GATE CS 2027, JEE Main, UPSC Prelims' }) : null,
      nav(async () => {
        if (!about.name.trim()) { toast('Add your name first.', 'error'); return false; }
        if (!about.level) { toast('Choose what describes you.', 'error'); return false; }
        await saveStudy((s) => { s.profile = { ...s.profile, ...about, name: about.name.trim().slice(0, 40) }; return s; }, { kind: 'profile', data: { level: about.level } });
        return true;
      }),
    ];
  }

  // ---------- step 2: subjects ----------
  function stepSubjects() {
    if (!subjects) {
      subjects = S().subjects.map((s) => ({ ...s }));
      if (!subjects.length && S().profile.level === 'competitive' && S().profile.course) subjects.push({ id: uid(), name: S().profile.course, syllabusId: null, examDate: '', maxMarks: 100, importance: 2 });
      if (!subjects.length) subjects.push({ id: uid(), name: '', syllabusId: null, examDate: '', maxMarks: 100, importance: 2 });
    }
    const unlinked = state.syllabi.filter((y) => !subjects.some((s) => s.syllabusId === y.id));
    return [
      el('p', { class: 'hint' }, 'Add every subject you have an exam in. Marks and importance decide what Oris plans first.'),
      el('ul', { class: 'subject-rows' }, ...subjects.map((s, i) => el('li', { class: 'subject-row' },
        el('div', { class: 'grid-subject' },
          el('label', { class: 'field' }, el('span', {}, 'Subject'), el('input', { class: 'text-input', value: s.name, maxlength: '60', placeholder: 'e.g. DBMS', oninput: (e) => { s.name = e.target.value; } })),
          el('label', { class: 'field' }, el('span', {}, 'Exam date'), el('input', { class: 'text-input', type: 'date', min: todayKey(), value: s.examDate, oninput: (e) => { s.examDate = e.target.value; } })),
          el('label', { class: 'field' }, el('span', {}, 'Max marks'), el('input', { class: 'text-input', inputmode: 'numeric', value: String(s.maxMarks || ''), placeholder: '100', oninput: (e) => { s.maxMarks = Number(e.target.value.replace(/\D/g, '')) || 0; } })),
          el('label', { class: 'field' }, el('span', {}, 'Importance'), el('select', { class: 'text-input', onchange: (e) => { s.importance = Number(e.target.value); } },
            ...IMPORTANCE.map(([v, l]) => el('option', { value: String(v), selected: (s.importance || 2) === v }, l))))),
        subjects.length > 1 ? el('button', { class: 'btn ghost small', onclick: () => { subjects.splice(i, 1); render(); } }, 'Remove') : null))),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => { subjects.push({ id: uid(), name: '', syllabusId: null, examDate: '', maxMarks: 100, importance: 2 }); render(); } }, 'Add a subject')),
      unlinked.length ? el('div', { class: 'from-syllabi' }, el('p', { class: 'summary-label' }, 'Or add from your syllabi'),
        el('div', { class: 'chips' }, ...unlinked.map((y) => el('button', {
          class: 'chip-btn', onclick: () => {
            const empty = subjects.find((s) => !s.name.trim() && !s.syllabusId);
            const row = empty || { id: uid(), name: '', syllabusId: null, examDate: '', maxMarks: 100, importance: 2 };
            Object.assign(row, { name: y.subject || y.name, syllabusId: y.id });
            if (!empty) subjects.push(row);
            render();
          },
        }, `+ ${y.name}`)))) : null,
      nav(async () => {
        const list = subjects.filter((s) => s.name.trim());
        if (!list.length) { toast('Add at least one subject.', 'error'); return false; }
        await saveStudy((st) => { st.subjects = list.map((s) => ({ ...s, name: s.name.trim().slice(0, 60), maxMarks: s.maxMarks || 100, importance: s.importance || 2 })); return st; },
          { kind: 'subjects', data: { count: list.length } });
        return true;
      }),
    ];
  }

  // ---------- step 3: syllabus ----------
  async function readSyllabus(subj, file) {
    const d = sylDraft[subj.id] || (sylDraft[subj.id] = { text: '' });
    try {
      let text = d.text.trim();
      if (file) {
        d.busy = 'Reading the file…'; render();
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          const { pdfToText } = await import('../lib/pdf-text.js');
          text = (await pdfToText(file)).text;
          if (text.replace(/\s/g, '').length < 30) throw new Error('This PDF has no selectable text, so it’s probably a scan. Paste the syllabus text instead.');
        } else text = await file.text();
      }
      if (!text) throw new Error('Choose a file or paste the syllabus first.');
      d.busy = hasAI(state.settings) ? 'Finding topics with AI…' : 'Finding topics…'; render();
      const { plan, method, warning } = await parseSyllabus(text, state.settings);
      if (!plan.units.length) throw new Error('No topics found. Paste the syllabus with one topic per line.');
      if (warning) toast(`AI step failed (${warning}). Used basic detection.`, 'error');
      const syl = makeSyllabus(plan, { name: subj.name, method });
      await saveSyllabi([syl, ...state.syllabi]);
      await saveStudy((st) => { const x = st.subjects.find((s) => s.id === subj.id); if (x) x.syllabusId = syl.id; return st; }, { kind: 'syllabus', data: { subjectId: subj.id, topics: syl.units.reduce((a, u) => a + u.topics.length, 0) } });
      d.text = '';
      toast(`${subj.name}: ${syl.units.reduce((a, u) => a + u.topics.length, 0)} topics found`);
    } catch (e) {
      toast(e.message || String(e), 'error');
    }
    d.busy = '';
    render();
  }

  function stepSyllabus() {
    return [
      el('p', { class: 'hint' }, 'Upload or paste each subject’s syllabus. Oris splits it into topics. You can skip a subject and add it later.'),
      ...S().subjects.map((subj) => {
        const syl = getSyl(subj.syllabusId);
        const d = sylDraft[subj.id] || (sylDraft[subj.id] = { text: '' });
        const others = state.syllabi.filter((y) => !S().subjects.some((s) => s.syllabusId === y.id));
        if (syl) {
          const n = syl.units.reduce((a, u) => a + u.topics.length, 0);
          return el('section', { class: 'panel subj-syl done' },
            el('div', { class: 'section-head' }, el('h3', {}, subj.name), el('span', { class: 'ok-tag' }, `✓ ${syl.units.length} units, ${n} topics`)),
            el('button', { class: 'linkish', onclick: () => saveStudy((st) => { const x = st.subjects.find((s) => s.id === subj.id); if (x) x.syllabusId = null; return st; }) }, 'Use a different syllabus'));
        }
        const input = el('input', { type: 'file', accept: '.pdf,.txt,.md,application/pdf,text/plain', class: 'visually-hidden', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) readSyllabus(subj, f); } });
        return el('section', { class: 'panel subj-syl' },
          el('h3', {}, subj.name),
          d.busy ? el('p', { class: 'batch' }, d.busy) : el('div', { class: 'exam-draft' },
            el('label', { class: 'drop small-drop' }, input, el('span', { class: 'drop-text' }, 'Upload syllabus (PDF or text)')),
            el('textarea', { class: 'text-input', rows: '4', placeholder: 'Or paste the syllabus here', 'aria-label': `${subj.name} syllabus text`, oninput: (e) => { d.text = e.target.value; } }, d.text),
            el('div', { class: 'row' },
              el('button', { class: 'btn small', onclick: () => readSyllabus(subj, null) }, 'Read pasted syllabus'),
              others.length ? el('select', { class: 'text-input', 'aria-label': 'Use a syllabus you already added', onchange: (e) => e.target.value && saveStudy((st) => { const x = st.subjects.find((s) => s.id === subj.id); if (x) x.syllabusId = e.target.value; return st; }) },
                el('option', { value: '' }, 'Or use one I added…'), ...others.map((y) => el('option', { value: y.id }, y.name))) : null)));
      }),
      nav(async () => true, { skipLabel: S().subjects.some((s) => !getSyl(s.syllabusId)) ? 'Skip for now' : '' }),
    ];
  }

  // ---------- step 4: past papers ----------
  function stepPapers() {
    const withSyl = S().subjects.filter((s) => getSyl(s.syllabusId));
    return [
      el('p', { class: 'hint' }, 'Optional, but it makes the plan much smarter: Oris finds which topics come up most and plans those first.'),
      !withSyl.length ? el('p', { class: 'empty' }, 'Add a syllabus first to attach past papers.') : null,
      ...withSyl.map((subj) => {
        const syl = getSyl(subj.syllabusId);
        const n = (syl.papers || []).length;
        const input = el('input', {
          type: 'file', multiple: true, accept: '.pdf,.txt,application/pdf,text/plain', class: 'visually-hidden',
          onchange: async (e) => {
            const files = [...e.target.files]; e.target.value = '';
            for (const f of files) {
              busy = `Reading ${f.name}…`; render();
              try {
                let text;
                if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
                  const { pdfToText } = await import('../lib/pdf-text.js');
                  text = (await pdfToText(f)).text;
                  if (text.replace(/\s/g, '').length < 60) throw new Error(`${f.name} has no selectable text (probably a scan).`);
                } else text = await f.text();
                const r = await addPaper(syl, { text, name: f.name.replace(/\.[^.]+$/, ''), year: '' });
                toast(`${f.name}: ${r.n} questions, ${r.matched} matched`);
              } catch (err) { toast(err.message || String(err), 'error'); }
            }
            busy = ''; render();
          },
        });
        return el('section', { class: 'panel subj-syl' },
          el('div', { class: 'section-head' }, el('h3', {}, subj.name), n ? el('span', { class: 'ok-tag' }, `✓ ${n} paper${n === 1 ? '' : 's'}, ${(syl.pyqs || []).length} questions`) : null),
          busy ? el('p', { class: 'batch' }, busy) : el('label', { class: 'drop small-drop' }, input, el('span', { class: 'drop-text' }, 'Upload past papers'), el('small', {}, 'PDF or text, several at once')),
          finder.panel(syl));
      }),
      nav(async () => true, { skipLabel: 'Skip for now' }),
    ];
  }

  // ---------- step 5: study time ----------
  function stepTime() {
    const p = S().prefs;
    const set = (patch, kind) => saveStudy((st) => { st.prefs = { ...st.prefs, ...patch }; return st; }, { kind, data: patch });
    return [
      el('label', { class: 'field' }, el('span', {}, 'How long can you study on a normal day?'),
        el('select', { class: 'text-input', onchange: (e) => set({ minutesPerDay: Number(e.target.value) }, 'prefs.minutes') },
          ...[60, 90, 120, 180, 240, 300, 360, 480].map((m) => el('option', { value: String(m), selected: p.minutesPerDay === m }, m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? '' : 's'}`)))),
      el('fieldset', { class: 'choice-list' }, el('legend', {}, 'Rest days (no new work)'),
        el('div', { class: 'day-toggles' }, ...DAY_NAMES.map((d, i) => el('button', {
          type: 'button', class: 'day-btn', 'aria-pressed': String((p.restDays || []).includes(i)),
          onclick: () => set({ restDays: (p.restDays || []).includes(i) ? p.restDays.filter((x) => x !== i) : [...(p.restDays || []), i] }, 'prefs.rest'),
        }, d)))),
      el('label', { class: 'field' }, el('span', {}, 'Revision days before each exam'),
        el('select', { class: 'text-input', onchange: (e) => set({ revisionDays: Number(e.target.value) }, 'prefs.revision') },
          ...[0, 1, 2, 3, 4].map((n) => el('option', { value: String(n), selected: p.revisionDays === n }, n ? `${n} day${n === 1 ? '' : 's'} (the last one is a mock test)` : 'None')))),
      nav(async () => true),
    ];
  }

  // ---------- step 6: build ----------
  async function build() {
    const subs = S().subjects.filter((s) => getSyl(s.syllabusId));
    if (hasAI(state.settings)) {
      for (const s of subs) {
        busy = `Working out the topic order for ${s.name}…`; render();
        try {
          const { deps, hours } = await aiTopicOrder(s.name, getSyl(s.syllabusId), state.settings);
          await saveStudy((st) => { Object.assign(st.deps, deps); Object.assign(st.hours, hours); return st; }, { kind: 'ai.order', data: { subjectId: s.id, links: Object.keys(deps).length } });
        } catch (e) {
          toast(`${s.name}: couldn’t get the topic order (${e.message}). The plan follows the syllabus order.`, 'error');
        }
      }
    }
    busy = '';
    await saveStudy((st) => { st.setupDone = true; return st; }, { kind: 'setup.done', data: { subjects: S().subjects.length } });
    toast('Your study plan is ready');
    open('plan');
  }

  function stepFinish() {
    const subs = S().subjects;
    const ready = subs.filter((s) => getSyl(s.syllabusId));
    return [
      el('ul', { class: 'ob-summary' },
        el('li', {}, `${subs.length} subject${subs.length === 1 ? '' : 's'}, ${ready.length} with a syllabus`),
        el('li', {}, `${ready.reduce((a, s) => a + ((getSyl(s.syllabusId).papers || []).length), 0)} past papers`),
        el('li', {}, `${S().prefs.minutesPerDay / 60} hours a day${(S().prefs.restDays || []).length ? `, rest on ${S().prefs.restDays.map((d) => DAY_NAMES[d]).join(', ')}` : ''}`)),
      el('p', { class: 'hint' }, hasAI(state.settings)
        ? 'Oris will ask AI which topics must come before others, then plan every day up to your exams. You can change anything later.'
        : 'Oris plans every day up to your exams, following the syllabus order. Turn on Oris AI in Settings to also work out which topics depend on others.'),
      busy ? el('p', { class: 'batch' }, busy) : el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => go(step - 1) }, 'Back'),
        el('button', { class: 'btn primary', disabled: !ready.length, onclick: build }, 'Build my plan')),
      !ready.length ? el('p', { class: 'hint error-text' }, 'Add at least one syllabus to build a plan.') : null,
    ];
  }

  function nav(next, { skipLabel = '' } = {}) {
    return el('div', { class: 'setup-nav' },
      step > 0 ? el('button', { class: 'btn ghost', onclick: () => go(step - 1) }, 'Back') : el('span'),
      el('div', { class: 'row' },
        skipLabel ? el('button', { class: 'btn ghost', onclick: () => go(step + 1) }, skipLabel) : null,
        el('button', { class: 'btn primary', onclick: async () => { if (await next()) go(step + 1); } }, 'Next')));
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input:not([type="file"]):not([type="radio"]), textarea')) return;
    const content = [stepAbout, stepSubjects, stepSyllabus, stepPapers, stepTime, stepFinish][step]();
    body.replaceChildren(...[
      el('div', { class: 'setup-head' },
        el('p', { class: 'ob-step' }, `Step ${step + 1} of ${STEPS.length}`),
        el('h2', {}, step === 0 ? 'Let’s set up your study plan' : STEPS[step]),
        el('div', { class: 'setup-dots', 'aria-hidden': 'true' }, ...STEPS.map((_, i) => el('span', { class: i < step ? 'done' : i === step ? 'now' : '' })))),
      ...content.flat(),
      S().setupDone && step < STEPS.length - 1 ? el('button', { class: 'linkish setup-exit', onclick: () => open('plan') }, 'Back to my plan') : null,
    ].filter(Boolean));
  }
  render();
  return { update(changed) { if (changed.study || changed.syllabi || changed.settings) render(); } };
}
