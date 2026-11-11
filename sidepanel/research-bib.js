import { CITE_STYLES, bibliography, citationText, citationHtml, toBibtex } from '../lib/cite.js';
import { projectMarkdown } from '../lib/markdown.js';
import { projectBar, activeProject, projectSources, copyRich, download, fileSafe, citationNode } from './research-common.js';

const HEADINGS = { apa: 'References', mla: 'Works Cited', chicago: 'Bibliography', ieee: 'References' };

export function mount(root, ctx) {
  const { el, state, saveSettings, toast } = ctx;
  const bar = projectBar(ctx, { onChange: () => render() });
  const body = el('div');
  root.append(bar.node, body);

  function render() {
    const style = state.settings.citeStyle || 'apa';
    const sources = projectSources(state);
    const project = activeProject(state);
    const entries = bibliography(sources, style);
    const missing = sources.filter((s) => !s.authors.length || !s.published).length;

    const plain = () => `${HEADINGS[style]}\n\n${entries.map(citationText).join('\n\n')}\n`;
    const html = () => `<p><b>${HEADINGS[style]}</b></p>${entries.map((p) => `<p>${citationHtml(p)}</p>`).join('')}`;

    body.replaceChildren(
      el('section', { class: 'panel' },
        el('h2', {}, 'Bibliography'),
        el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Citation style' },
          ...CITE_STYLES.map(([v, label]) => el('button', { role: 'radio', 'aria-checked': String(v === style), onclick: () => saveSettings({ citeStyle: v }) }, label))),
        sources.length ? el('div', { class: 'row' },
          el('button', {
            class: 'btn primary small',
            onclick: async () => toast((await copyRich(html(), plain())) ? `Copied ${entries.length} reference${entries.length === 1 ? '' : 's'}` : 'Couldn’t copy. Try the download instead.'),
          }, 'Copy all'),
          el('button', { class: 'btn small', onclick: () => download(`${fileSafe(project.name)}-${style}.txt`, plain()) }, 'Download .txt'),
          el('button', { class: 'btn small', onclick: () => download(`${fileSafe(project.name)}.bib`, toBibtex(sources), 'application/x-bibtex') }, 'Download .bib'),
          el('button', { class: 'btn small', title: 'Every source with its summary, highlights, notes and tags, plus this bibliography', onclick: () => download(`${fileSafe(project.name)}.md`, projectMarkdown(project, sources, style), 'text/markdown') }, 'Export project (.md)'),
        ) : null,
        missing ? el('p', { class: 'hint' }, `${missing} source${missing === 1 ? ' is' : 's are'} missing an author or date. Open ${missing === 1 ? 'it' : 'them'} from Sources and use “Edit details” to fill ${missing === 1 ? 'it' : 'them'} in.`) : null,
      ),
      sources.length
        ? el('section', { class: 'panel bib' },
          el('h3', {}, HEADINGS[style]),
          ...entries.map((parts) => citationNode(el, parts)))
        : el('section', { class: 'panel empty-state' },
          el('h2', {}, 'No sources yet'),
          el('p', {}, 'Save pages in Sources and their citations will collect here, ready to paste into your essay or report.')),
    );
  }

  render();
  return { update(changed) { if (changed.research || changed.settings) { bar.render(); render(); } } };
}
