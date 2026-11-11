// "Find papers for me": searches online, lists results (official sites first), and reads the one
// the student taps. A page that isn't a PDF shows the PDFs it links to.
import { searchPapers, fetchPaper, hostOf } from '../lib/pyq-search.js';
import { pyqSearchUrl } from '../lib/pyq.js';

export function createFinder(ctx, { addPaper, render }) {
  const { el, toast, state } = ctx;
  const runs = new Map(); // syllabusId -> { loading, results, error, code, pages: {url: links}, using: url, used: Set }

  const infoFor = (syl) => {
    const p = (state.study && state.study.profile) || {};
    return { subject: syl.subject || syl.name, institution: p.institution || '', course: p.course || '', level: syl.examType === 'competitive' ? 'competitive' : p.level || '' };
  };

  async function search(syl) {
    const run = { loading: true, results: [], error: '', code: '', pages: {}, using: '', used: new Set() };
    runs.set(syl.id, run);
    render();
    try {
      run.results = await searchPapers(infoFor(syl));
      if (!run.results.length) run.error = 'Nothing found. Try the Google search instead.';
    } catch (e) {
      run.error = e.message;
      run.code = e.code || '';
    }
    run.loading = false;
    render();
  }

  async function use(syl, url, title) {
    const run = runs.get(syl.id);
    run.using = url;
    render();
    try {
      const got = await fetchPaper(url);
      if (got.kind === 'page') {
        run.pages[url] = got.links;
        if (!got.links.length) toast('No PDFs on that page. Open it to look yourself.', 'error');
      } else {
        const { pdfToText } = await import('../lib/pdf-text.js');
        const text = (await pdfToText(got.blob)).text;
        if (text.replace(/\s/g, '').length < 60) throw new Error('That PDF is a scan with no text. Open it and paste the questions instead.');
        const r = await addPaper(syl, { text, name: (title || got.name || hostOf(url)).slice(0, 80), year: '' });
        run.used.add(url);
        toast(`${r.n} questions read, ${r.matched} matched to topics`);
        if (r.warning) toast(`AI step failed (${r.warning}). Used basic matching.`, 'error');
      }
    } catch (e) {
      toast(e.message || String(e), 'error');
    }
    run.using = '';
    render();
  }

  function resultItem(syl, run, r, nested = false) {
    const busy = run.using === r.url;
    const used = run.used.has(r.url);
    const links = run.pages[r.url];
    return el('li', { class: `find-hit${nested ? ' nested' : ''}` },
      el('div', { class: 'find-main' },
        el('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'find-title' }, r.title),
        el('span', { class: 'find-meta' },
          r.official ? el('span', { class: 'tag-official' }, 'Official') : null,
          (r.pdf || nested) ? el('span', { class: 'tag-pdf' }, 'PDF') : null,
          el('span', {}, r.host || hostOf(r.url)))),
      el('button', {
        class: `btn small${used ? ' ghost' : ''}`, disabled: !!run.using || used,
        onclick: () => use(syl, r.url, nested ? r.title : r.pdf ? r.title : ''),
      }, used ? 'Added ✓' : busy ? 'Reading…' : (r.pdf || nested) ? 'Use this' : 'Open PDFs'),
      links && links.length ? el('ul', { class: 'find-list' }, ...links.map((l) => resultItem(syl, run, { ...l, host: hostOf(l.url), pdf: true, official: r.official && hostOf(l.url) === (r.host || hostOf(r.url)) }, true))) : null);
  }

  function panel(syl) {
    const run = runs.get(syl.id);
    const google = el('a', { class: 'linkish', href: pyqSearchUrl(syl), target: '_blank', rel: 'noopener' }, 'Search Google yourself');
    if (!run) {
      return el('div', { class: 'finder' },
        el('button', { class: 'btn small', onclick: () => search(syl) }, 'Find papers for me'),
        google);
    }
    if (run.loading) return el('div', { class: 'finder' }, el('p', { class: 'batch' }, 'Searching for past papers…'));
    return el('div', { class: 'finder open' },
      run.error ? el('p', { class: run.code === 'search_not_configured' ? 'hint' : 'hint error-text' },
        run.code === 'search_not_configured' ? 'Automatic paper search isn’t switched on yet. Use the Google search for now.' : run.error) : null,
      run.results.length ? el('p', { class: 'hint' }, 'Tap “Use this” on a paper and Oris reads it. Official sites are listed first. Check that it’s the right subject.') : null,
      run.results.length ? el('ul', { class: 'find-list' }, ...run.results.map((r) => resultItem(syl, run, r))) : null,
      el('div', { class: 'row' }, el('button', { class: 'btn ghost small', onclick: () => search(syl) }, 'Search again'), google));
  }

  return { panel };
}
