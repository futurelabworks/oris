// Markdown export of a Research project: each source with its details, tags, summary,
// highlights and notes, then the bibliography in the chosen style.
import { bibliography, CITE_STYLES } from './cite.js';

const HEADINGS = { apa: 'References', mla: 'Works Cited', chicago: 'Bibliography', ieee: 'References' };

// Escapes characters that would change Markdown formatting inside plain text.
export function mdEscape(s) {
  return String(s || '').replace(/([\\`*_[\]#<>|])/g, '\\$1');
}

const quote = (text) => String(text).split('\n').map((l) => `> ${l}`).join('\n');

function citationMd(parts) {
  return parts.map((p) => (p.italic ? `*${mdEscape(p.text).trim()}*${/\s$/.test(p.text) ? ' ' : ''}` : mdEscape(p.text))).join('');
}

export function projectMarkdown(project, sources, style = 'apa', now = new Date()) {
  const lines = [];
  const styleName = (CITE_STYLES.find(([v]) => v === style) || [, style])[1];
  lines.push(`# ${mdEscape(project.name)}`, '');
  lines.push(`Exported from Oris on ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. ${sources.length} source${sources.length === 1 ? '' : 's'}.`, '');

  lines.push('## Sources', '');
  sources.forEach((s) => {
    lines.push(`### ${mdEscape(s.title)}`, '');
    const meta = [];
    if (s.authors && s.authors.length) meta.push(`**Authors:** ${mdEscape(s.authors.join(', '))}`);
    if (s.published) meta.push(`**Published:** ${mdEscape(s.published.slice(0, 10))}`);
    if (s.siteName) meta.push(`**Site:** ${mdEscape(s.siteName)}`);
    if (s.doi) meta.push(`**DOI:** [${mdEscape(s.doi)}](https://doi.org/${s.doi})`);
    meta.push(`**Link:** <${s.url}>`);
    if (s.tags && s.tags.length) meta.push(`**Tags:** ${s.tags.map((t) => '#' + mdEscape(t).replace(/ /g, '-')).join(' ')}`);
    lines.push(meta.join('  \n'), '');
    if (s.summary) {
      lines.push('**Summary**', '');
      if (s.summary.text) lines.push(mdEscape(s.summary.text), '');
      for (const p of s.summary.points || []) lines.push(`- ${mdEscape(p)}`);
      if ((s.summary.points || []).length) lines.push('');
    }
    if (s.highlights && s.highlights.length) {
      lines.push('**Highlights**', '');
      for (const h of s.highlights) {
        lines.push(quote(mdEscape(h.text)));
        if (h.note) lines.push('', `Note: ${mdEscape(h.note)}`);
        lines.push('');
      }
    }
    if (s.notes && s.notes.trim()) lines.push('**Notes**', '', mdEscape(s.notes.trim()), '');
  });

  lines.push(`## ${HEADINGS[style] || 'References'} (${styleName})`, '');
  bibliography(sources, style).forEach((parts) => lines.push(citationMd(parts), ''));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
