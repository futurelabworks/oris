// Ask: questions answered from the active project's saved sources, with citations.
import { rankPassages, askAI, answerParts } from '../lib/ask.js';
import { hasAI } from '../lib/ai.js';
import { getTexts, saveText } from '../lib/source-text.js';
import { projectBar, activeProject, projectSources, hostOf, readPage } from './research-common.js';

const EXAMPLES = ['What are the main causes discussed?', 'Which sources disagree, and on what?', 'What numbers or statistics are mentioned?'];

export function mount(root, ctx) {
  const { el, state, research, toast } = ctx;
  const bar = projectBar(ctx, { onChange: () => { result = null; render(); } });
  const body = el('div');
  root.append(bar.node, body);

  let question = '';
  let busy = false;
  let result = null; // { question, passages, answer?, cited?, found?, error? }
  let indexing = null; // { done, total }

  async function ask(q) {
    const text = String(q || '').trim();
    if (!text || busy) return;
    question = text;
    busy = true;
    render();
    try {
      const sources = projectSources(state);
      const texts = await getTexts(sources.map((s) => s.id));
      const docs = sources.map((s) => ({ source: s, text: texts[s.id] || '' }));
      const passages = rankPassages(text, docs, 6);
      result = { question: text, passages };
      if (passages.length && hasAI(state.settings)) {
        try {
          Object.assign(result, await askAI(text, passages, state.settings));
        } catch (err) {
          result.error = err.message;
        }
      }
    } finally {
      busy = false;
      render();
    }
  }

  // Sources saved before 1.3 have no stored text: read each page once so Ask can search it.
  async function indexMissing() {
    const missing = projectSources(state).filter((s) => !s.hasText);
    if (!missing.length) return;
    indexing = { done: 0, total: missing.length, failed: 0 };
    render();
    for (const s of missing) {
      try {
        const page = await readPage({ url: s.url, tabId: null, title: s.title });
        if (await saveText(s.id, page.text)) await research('updateSource', { id: s.id, patch: { hasText: true } });
        else indexing.failed++;
      } catch { indexing.failed++; }
      indexing.done++;
      render();
    }
    const { failed, total } = indexing;
    indexing = null;
    render();
    toast(failed ? `Read ${total - failed} of ${total} pages. ${failed} couldn’t be loaded; open them and use Summarise to add them.` : `Read ${total} page${total === 1 ? '' : 's'}. Ask can search them now.`, failed ? 'error' : '');
  }

  function sourceCard(p, n) {
    return el('li', { class: 'passage', id: `passage-${n}` },
      el('span', { class: 'cite-num' }, String(n)),
      el('div', {},
        el('p', { class: 'passage-text' }, p.text.length > 420 ? p.text.slice(0, 420) + '…' : p.text),
        el('p', { class: 'source-meta' },
          el('a', { href: p.source.url, target: '_blank', rel: 'noopener' }, p.source.title),
          `, ${p.kind === 'page' ? hostOf(p.source.url) : p.kind}`)));
  }

  function answerNode(r) {
    return el('div', { class: 'answer' },
      ...answerParts(r.answer).map((part) => (part.ref
        ? el('a', {
          class: 'cite-chip', href: `#passage-${part.ref}`, title: r.passages[part.ref - 1] ? r.passages[part.ref - 1].source.title : '',
          onclick: (e) => { e.preventDefault(); const t = body.querySelector(`#passage-${part.ref}`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
        }, String(part.ref))
        : part.text)));
  }

  function render() {
    const sources = projectSources(state);
    const missing = sources.filter((s) => !s.hasText).length;
    const input = el('textarea', {
      class: 'text-input', rows: '2', maxlength: '500', placeholder: 'Ask a question about your sources', 'aria-label': 'Your question',
      oninput: (e) => { question = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } },
    }, question);

    const parts = [];
    parts.push(el('form', { class: 'panel ask-form', onsubmit: (e) => { e.preventDefault(); ask(question); } },
      el('h2', {}, `Ask ${activeProject(state).name}`),
      el('p', { class: 'hint' }, hasAI(state.settings)
        ? `Answers come only from the ${sources.length} source${sources.length === 1 ? '' : 's'} in this project, with numbered links to the passages used.`
        : 'AI is off, so Oris shows the passages that best match your question. Turn on Oris AI in Settings for written answers.'),
      input,
      el('div', { class: 'row' },
        el('button', { class: 'btn primary small', type: 'submit', disabled: busy || !sources.length }, busy ? 'Searching…' : 'Ask'),
        ...(!result ? EXAMPLES.map((q) => el('button', { type: 'button', class: 'chip', disabled: busy || !sources.length, onclick: () => ask(q) }, q)) : [])),
      missing && sources.length ? el('div', { class: 'index-note' },
        indexing
          ? el('p', {}, `Reading pages: ${indexing.done} of ${indexing.total}`)
          : el('p', {}, `${missing} source${missing === 1 ? ' was' : 's were'} saved before Ask existed, so only highlights and notes are searched for ${missing === 1 ? 'it' : 'them'}.`),
        indexing ? null : el('button', { type: 'button', class: 'btn small', onclick: indexMissing }, `Read ${missing === 1 ? 'that page' : `those ${missing} pages`}`)) : null,
    ));

    if (!sources.length) {
      parts.push(el('section', { class: 'panel empty-state' },
        el('h2', {}, 'No sources to ask yet'),
        el('p', {}, 'Save pages in Sources first. Ask searches their text, your highlights and your notes.')));
    } else if (result) {
      const r = result;
      const section = el('section', { class: 'panel' }, el('p', { class: 'summary-label' }, r.question));
      if (!r.passages.length) {
        section.append(el('p', { class: 'empty' }, 'Nothing in this project’s sources matches that question. Try other words, or save more sources.'));
      } else {
        if (r.answer) {
          section.append(answerNode(r));
          if (r.found === false) section.append(el('p', { class: 'hint' }, 'Your sources don’t fully answer this. The closest passages are below.'));
        } else if (r.error) {
          section.append(el('p', { class: 'hint warn-text' }, `The AI answer failed (${r.error}). Here are the best matching passages.`));
        }
        section.append(el('h3', { class: 'passages-head' }, r.answer ? 'Passages used' : 'Best matching passages'),
          el('ol', { class: 'passages' }, ...r.passages.map((p, i) => sourceCard(p, i + 1))));
      }
      parts.push(section);
    }

    const focused = document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    body.replaceChildren(...parts);
    if (focused) { const t = body.querySelector('textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }

  render();
  return { update(changed) { if (changed.research || changed.settings) { bar.render(); if (!busy) render(); } } };
}
