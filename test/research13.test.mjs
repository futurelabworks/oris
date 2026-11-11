import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyResearch, applyOp, normalizeDoi, cleanTags, projectTags } from '../lib/research.js';
import { formatCitation, citationText, toBibtex, bibliography } from '../lib/cite.js';
import { tokenize, chunkText, rankPassages, answerParts } from '../lib/ask.js';
import { projectMarkdown, mdEscape } from '../lib/markdown.js';
import { basicSummary } from '../lib/summarize.js';
import { pageExtractor } from '../lib/extract.js';

// ---- DOI ----
assert.equal(normalizeDoi('https://doi.org/10.1038/s41586-020-2649-2'), '10.1038/s41586-020-2649-2');
assert.equal(normalizeDoi('doi: 10.1000/xyz123.'), '10.1000/xyz123');
assert.equal(normalizeDoi('https://dx.doi.org/10.1145/3290605.3300233'), '10.1145/3290605.3300233');
assert.equal(normalizeDoi('not a doi'), '');
const doc = new JSDOM(`<html><head><title>T</title><meta name="citation_title" content="Deep learning for monsoon forecasting">
<meta name="citation_author" content="Priya Nair"><meta name="citation_doi" content="10.1016/j.jhydrol.2021.126421">
<meta name="citation_journal_title" content="Journal of Hydrology"><meta name="citation_publication_date" content="2021/05/03"></head>
<body><article><p>${'Monsoon rainfall text. '.repeat(40)}</p></article></body></html>`).window.document;
const page = pageExtractor(16000, doc);
assert.equal(page.meta.doi, '10.1016/j.jhydrol.2021.126421');
const doc2 = new JSDOM(`<html><body><article><p>See <a href="https://doi.org/10.5555/abc.def">the paper</a>.</p></article></body></html>`).window.document;
assert.equal(pageExtractor(1000, doc2).meta.doi, 'https://doi.org/10.5555/abc.def', 'link fallback (normalised on save)');

// ---- tags + store ----
assert.deepEqual(cleanTags(['#Climate', 'climate', ' India  Monsoon ', '']), ['climate', 'india monsoon']);
const st = emptyResearch();
const s1 = applyOp(st, 'saveSource', { url: 'https://example.org/paper', meta: { ...page.meta } });
assert.equal(s1.doi, '10.1016/j.jhydrol.2021.126421');
assert.deepEqual(s1.tags, []);
applyOp(st, 'updateSource', { id: s1.id, patch: { tags: ['Methods', 'climate'] } });
const s2 = applyOp(st, 'saveSource', { url: 'https://example.org/b', meta: { title: 'B' } });
applyOp(st, 'updateSource', { id: s2.id, patch: { tags: ['climate'], doi: 'https://doi.org/10.1/x' } });
assert.equal(st.sources.find((x) => x.id === s2.id).doi, '', '10.1/x is too short to be a DOI');
assert.deepEqual(projectTags(st, st.activeProjectId), ['climate', 'methods']);

// ---- citations with DOI + Chicago ----
const src = { url: 'https://example.org/paper', doi: '10.1016/j.jhydrol.2021.126421', title: 'Deep learning for monsoon forecasting', authors: ['Priya Nair', 'Arjun Mehta'], published: '2021-05-03', siteName: 'Journal of Hydrology', accessedAt: new Date(2026, 10, 4).getTime(), savedAt: 2 };
assert.equal(citationText(formatCitation(src, 'apa')), 'Nair, P., & Mehta, A. (2021, May 3). Deep learning for monsoon forecasting. Journal of Hydrology. https://doi.org/10.1016/j.jhydrol.2021.126421');
assert.match(citationText(formatCitation(src, 'mla')), /, https:\/\/doi\.org\/10\.1016\/j\.jhydrol\.2021\.126421\.$/);
assert.match(citationText(formatCitation(src, 'ieee', 2)), /Available: https:\/\/doi\.org\//);
assert.equal(citationText(formatCitation(src, 'chicago')), 'Nair, Priya, and Arjun Mehta. “Deep learning for monsoon forecasting.” Journal of Hydrology. May 3, 2021. https://doi.org/10.1016/j.jhydrol.2021.126421.');
const three = { ...src, doi: '', authors: ['Priya Nair', 'Arjun Mehta', 'Ravi Rao'], published: '' };
assert.equal(citationText(formatCitation(three, 'chicago')), 'Nair, Priya, Arjun Mehta, and Ravi Rao. “Deep learning for monsoon forecasting.” Journal of Hydrology. Accessed November 4, 2026. https://example.org/paper.');
const noAuth = { url: 'https://imd.gov.in/x', title: 'Monsoon report 2025', authors: [], published: '2025-06', siteName: 'IMD', accessedAt: 1 };
assert.equal(citationText(formatCitation(noAuth, 'chicago')), '“Monsoon report 2025.” IMD. June 2025. https://imd.gov.in/x.');
assert.match(toBibtex([src]), /doi = \{10\.1016\/j\.jhydrol\.2021\.126421\}/);
assert.equal(bibliography([src, noAuth], 'chicago').map(citationText)[0].startsWith('“Monsoon'), true, 'alphabetical, quotes ignored');

// ---- summaries ----
const text = Array.from({ length: 20 }, (_, i) => `Point ${i}: monsoon rainfall in India changes with ocean temperature and wind patterns over the sea.`).join(' ');
assert.equal(basicSummary(text, 2).points.length, 2);
assert.equal(basicSummary(text, 8).points.length, 8);

// ---- Ask retrieval ----
assert.deepEqual(tokenize("The monsoon's winds and Rivers"), ['monsoon', 'wind', 'river']);
const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} talks about something else entirely, like cricket scores and film releases in the city.`).join('\n');
assert.ok(chunkText(long, 300).every((c) => c.length <= 450));
const A = { id: 'a', title: 'Monsoon onset over Kerala', highlights: [{ text: 'The onset date has moved later by about a week since 1980.', note: 'key stat' }], notes: '' };
const B = { id: 'b', title: 'Cricket season', highlights: [], notes: '' };
const C = { id: 'c', title: 'El Nino and rainfall', highlights: [], notes: 'El Nino years usually mean weaker monsoon rainfall in India.' };
const docs = [
  { source: A, text: 'The southwest monsoon reaches Kerala in early June.\nScientists track onset using rainfall and wind criteria.' },
  { source: B, text: long },
  { source: C, text: 'Sea surface temperatures in the Pacific shape global weather.' },
];
const top = rankPassages('When does the monsoon onset happen in Kerala?', docs, 4);
assert.equal(top[0].source.id, 'a', 'most relevant source first');
assert.ok(!top.some((p) => p.source.id === 'b'), 'irrelevant source excluded');
const elnino = rankPassages('How does El Nino affect rainfall?', docs, 3);
assert.equal(elnino[0].source.id, 'c');
assert.equal(elnino[0].kind, 'note', 'notes are searchable');
assert.deepEqual(rankPassages('', docs), []);
assert.deepEqual(answerParts('Onset is in June [1], later now [2].'), [{ text: 'Onset is in June ' }, { ref: 1 }, { text: ', later now ' }, { ref: 2 }, { text: '.' }]);

// ---- Markdown export ----
assert.equal(mdEscape('a*b_c [d]'), 'a\\*b\\_c \\[d\\]');
const md = projectMarkdown({ name: 'Monsoon essay' }, [{ ...src, tags: ['climate', 'india monsoon'], notes: 'Use in intro', summary: { text: 'Models beat baselines.', points: ['LSTM wins'] }, highlights: [{ text: 'Accuracy rose 12%', note: 'cite' }] }], 'apa', new Date(2026, 10, 4));
assert.match(md, /^# Monsoon essay\n/);
assert.match(md, /Exported from Oris on 4 November 2026\. 1 source\./);
assert.match(md, /\*\*DOI:\*\* \[10\.1016\/j\.jhydrol\.2021\.126421\]\(https:\/\/doi\.org\/10\.1016\/j\.jhydrol\.2021\.126421\)/);
assert.match(md, /\*\*Tags:\*\* #climate #india-monsoon/);
assert.match(md, /> Accuracy rose 12%\n\nNote: cite/);
assert.match(md, /## References \(APA 7\)\n\nNair, P\., & Mehta, A\. \(2021, May 3\)\. \*Deep learning for monsoon forecasting\.\* Journal of Hydrology\./);

console.log('research 1.3 (DOI, tags, Chicago, summaries, Ask, Markdown): all assertions passed');
