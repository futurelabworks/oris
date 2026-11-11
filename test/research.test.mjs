import assert from 'node:assert/strict';
import { emptyResearch, applyOp, normalizeUrl, highlightsForUrl, mergeResearch } from '../lib/research.js';
import { formatCitation, citationText, citationHtml, bibliography, toBibtex, parseName, parseDate } from '../lib/cite.js';
import { basicSummary } from '../lib/summarize.js';

// ---- urls ----
assert.equal(normalizeUrl('https://Example.com/a/b/?utm_source=x&id=3#sec'), 'https://example.com/a/b?id=3');
assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
assert.equal(normalizeUrl('https://example.com/a?fbclid=1'), 'https://example.com/a');

// ---- store ops ----
const st = emptyResearch();
const pid = st.activeProjectId;
const s1 = applyOp(st, 'saveSource', { url: 'https://example.com/a#x', meta: { title: 'Page A', authors: ['Jane Doe'] } });
const again = applyOp(st, 'saveSource', { url: 'https://example.com/a?utm_medium=y', meta: { title: 'Other', published: '2024-02-03' } });
assert.equal(again.id, s1.id, 'same page is not saved twice');
assert.equal(again.title, 'Page A', 'user/first title kept');
assert.equal(again.published, '2024-02-03', 'gaps filled');
assert.throws(() => applyOp(st, 'saveSource', { url: 'chrome://extensions' }), /Only web pages/);

const r = applyOp(st, 'addHighlight', { url: 'https://example.com/b', meta: { title: 'Page B' }, highlight: { text: 'important line', prefix: 'an ', suffix: ' here', color: 'green' } });
assert.equal(st.sources.length, 2, 'highlight auto-saves the page');
assert.equal(r.source.highlights[0].color, 'green');
assert.equal(r.projectName, 'My research');
assert.throws(() => applyOp(st, 'addHighlight', { url: 'https://example.com/b', highlight: { text: '  ' } }), /Select some text/);
applyOp(st, 'updateHighlight', { sourceId: r.source.id, id: r.highlight.id, patch: { note: 'n1', color: 'pink' } });
assert.equal(highlightsForUrl(st, 'https://example.com/b#top')[0].color, 'pink');

const p2 = applyOp(st, 'addProject', { name: 'Thesis' });
assert.equal(st.activeProjectId, p2.id);
applyOp(st, 'updateSource', { id: s1.id, patch: { projectId: p2.id, notes: 'hello', bogus: 1 } });
assert.equal(st.sources.find((s) => s.id === s1.id).projectId, p2.id);
assert.equal(st.sources.find((s) => s.id === s1.id).bogus, undefined);
const sess = applyOp(st, 'saveSession', { name: '', tabs: [{ url: 'https://a.com', title: 'A' }, { url: 'chrome://newtab' }] });
assert.equal(sess.tabs.length, 1);
assert.equal(sess.name, 'Untitled session');
assert.throws(() => applyOp(st, 'saveSession', { tabs: [{ url: 'chrome://x' }] }), /No web pages/);
applyOp(st, 'deleteProject', { id: p2.id });
assert.equal(st.sources.length, 1, 'project delete removes its sources');
assert.equal(st.sessions.length, 0);
assert.equal(st.activeProjectId, pid);
assert.throws(() => applyOp(st, 'deleteProject', { id: pid }), /at least one/);
assert.equal(mergeResearch(null).projects.length, 1);

// ---- names / dates ----
assert.deepEqual(parseName('Jane Q. Doe'), { given: 'Jane Q.', family: 'Doe' });
assert.deepEqual(parseName('Doe, Jane'), { given: 'Jane', family: 'Doe' });
assert.deepEqual(parseName('World Health Organization'), { org: 'World Health Organization' });
assert.deepEqual(parseDate('2023-07-15T10:00:00+05:30'), { y: 2023, m: 7, d: 15 });
assert.deepEqual(parseDate('2021'), { y: 2021 });

// ---- citations ----
const src = { url: 'https://www.thehindu.com/sci-tech/article1.ece', title: 'Monsoon patterns are shifting', authors: ['Ravi Kumar Sharma', 'Anita Rao'], published: '2023-07-15', siteName: 'The Hindu', accessedAt: new Date(2026, 9, 22).getTime(), savedAt: 1 };
const apa = citationText(formatCitation(src, 'apa'));
assert.equal(apa, 'Sharma, R. K., & Rao, A. (2023, July 15). Monsoon patterns are shifting. The Hindu. https://www.thehindu.com/sci-tech/article1.ece');
assert.match(citationHtml(formatCitation(src, 'apa')), /<i>Monsoon patterns are shifting\.<\/i>/);
const mla = citationText(formatCitation(src, 'mla'));
assert.equal(mla, 'Sharma, Ravi Kumar, and Anita Rao. “Monsoon patterns are shifting.” The Hindu, 15 July 2023, www.thehindu.com/sci-tech/article1.ece.');
const ieee = citationText(formatCitation(src, 'ieee', 3));
assert.equal(ieee, '[3] R. K. Sharma and A. Rao, “Monsoon patterns are shifting,” The Hindu. Jul. 15, 2023. Accessed: Oct. 22, 2026. [Online]. Available: https://www.thehindu.com/sci-tech/article1.ece');
const noAuthor = { url: 'https://example.org/page', title: 'Climate basics', authors: [], published: '', siteName: '', accessedAt: new Date(2026, 9, 22).getTime() };
assert.equal(citationText(formatCitation(noAuthor, 'apa')), 'Climate basics. (n.d.). example.org. https://example.org/page');
assert.equal(citationText(formatCitation(noAuthor, 'mla')), '“Climate basics.” example.org, example.org/page. Accessed 22 Oct. 2026.');
const org = { ...noAuthor, authors: ['World Health Organization'], siteName: 'World Health Organization', published: '2024' };
assert.equal(citationText(formatCitation(org, 'apa')), 'World Health Organization. (2024). Climate basics. https://example.org/page');
const bib = bibliography([src, noAuthor], 'apa').map(citationText);
assert.ok(bib[0].startsWith('Climate basics'), 'APA list is alphabetical');
const bt = toBibtex([src, { ...src, title: 'Second' }]);
assert.match(bt, /@misc\{sharma2023,/);
assert.match(bt, /@misc\{sharma2023b,/);
assert.match(bt, /author = \{Sharma, Ravi Kumar and Rao, Anita\}/);

// ---- basic summary ----
const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} talks about monsoon rainfall and climate change in India across many regions.`).join(' ');
const sum = basicSummary(text, 4);
assert.equal(sum.points.length, 4);
assert.equal(sum.method, 'basic');

console.log('research store + citations: all assertions passed');
assert.deepEqual(parseName('Intergovernmental Panel on Climate Change'), { org: 'Intergovernmental Panel on Climate Change' });
assert.deepEqual(parseName('Ministry of Earth Sciences'), { org: 'Ministry of Earth Sciences' });
assert.deepEqual(parseName('Ravi Kumar Sharma'), { given: 'Ravi Kumar', family: 'Sharma' });
console.log('org names: ok');
