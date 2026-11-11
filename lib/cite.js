// Citations for saved web pages and PDFs: APA 7, MLA 9, IEEE, plus BibTeX export.
// A formatted citation is a list of parts: [{ text, italic? }] so the UI can render italics
// and the clipboard can carry both rich HTML and plain text.

export const CITE_STYLES = [
  ['apa', 'APA 7'],
  ['mla', 'MLA 9'],
  ['chicago', 'Chicago'],
  ['ieee', 'IEEE'],
];

// A source with a DOI is cited by its DOI link, which never breaks; otherwise by its URL.
const linkOf = (src) => (src.doi ? `https://doi.org/${src.doi}` : src.url);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const IEEE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const ORG_RE = /\b(inc|ltd|llc|limited|corporation|corp|company|co|university|college|school|institute|ministry|department|government|association|society|organisation|organization|foundation|council|commission|committee|panel|programme|program|united|nations|national|international|world|bank|fund|centre|center|office|group|network|trust|team|staff|editors?|editorial|news|bureau|agency|board|press|times|india|wikipedia|of|for|and)\b/i;

// "2026-03-05T10:00:00Z" | "2026-03" | "2026" -> { y, m?, d? }
export function parseDate(s) {
  const str = String(s || '').trim();
  let m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(str);
  if (m) {
    const out = { y: +m[1] };
    if (m[2] && +m[2] >= 1 && +m[2] <= 12) out.m = +m[2];
    if (out.m && m[3] && +m[3] >= 1 && +m[3] <= 31) out.d = +m[3];
    return out;
  }
  const t = Date.parse(str);
  if (!Number.isNaN(t) && /\d{4}/.test(str)) {
    const d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  return null;
}

// "Jane Q. Doe" -> { given: 'Jane Q.', family: 'Doe' }; "Doe, Jane" also works; orgs stay whole.
export function parseName(raw) {
  const s = String(raw || '').replace(/^by\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // Organisations: known words, 5+ words, or a single word. "Doe, Jane" never counts as one.
  if (!s.includes(',') && (ORG_RE.test(s) || s.split(' ').length >= 5 || !/\s/.test(s))) return { org: s };
  if (s.includes(',')) {
    const [family, given] = s.split(',').map((x) => x.trim());
    return given ? { given, family } : { org: family };
  }
  const parts = s.split(' ');
  const family = parts.pop();
  return { given: parts.join(' '), family };
}

const initials = (given, sep = ' ') => given.split(/[\s-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + '.').join(sep);

function siteFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function stripProtocol(url) {
  return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const end = (s) => (/[.?!]$/.test(s) ? s : s + '.');

// ---------- APA 7 ----------
function apaAuthor(n) {
  if (n.org) return n.org;
  return `${n.family}, ${initials(n.given)}`;
}

function apaAuthors(names) {
  const list = names.map(apaAuthor);
  if (list.length === 1) return list[0];
  if (list.length <= 20) return list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1];
  return list.slice(0, 19).join(', ') + ', . . . ' + list[list.length - 1];
}

function apaDate(d) {
  if (!d) return 'n.d.';
  if (d.m && d.d) return `${d.y}, ${MONTHS[d.m - 1]} ${d.d}`;
  if (d.m) return `${d.y}, ${MONTHS[d.m - 1]}`;
  return String(d.y);
}

function apa(src) {
  const names = (src.authors || []).map(parseName).filter(Boolean);
  const date = `(${apaDate(parseDate(src.published))}).`;
  const site = src.siteName || siteFromUrl(src.url);
  const title = src.title || src.url;
  const parts = [];
  if (names.length) {
    parts.push({ text: `${end(apaAuthors(names))} ${date} ` });
    parts.push({ text: end(title), italic: true });
  } else {
    parts.push({ text: end(title), italic: true });
    parts.push({ text: ` ${date}` });
  }
  const authorIsSite = names.length === 1 && names[0].org && names[0].org.toLowerCase() === site.toLowerCase();
  if (site && !authorIsSite) parts.push({ text: ` ${end(site)}` });
  parts.push({ text: ` ${linkOf(src)}` });
  return parts;
}

// ---------- MLA 9 ----------
function mlaAuthors(names) {
  const first = names[0];
  const firstStr = first.org ? first.org : `${first.family}, ${first.given}`;
  if (names.length === 1) return firstStr;
  if (names.length === 2) {
    const b = names[1];
    return `${firstStr}, and ${b.org ? b.org : `${b.given} ${b.family}`}`;
  }
  return `${firstStr}, et al`;
}

function mlaDate(d) {
  if (!d) return '';
  if (d.m && d.d) return `${d.d} ${MLA_MONTHS[d.m - 1]} ${d.y}`;
  if (d.m) return `${MLA_MONTHS[d.m - 1]} ${d.y}`;
  return String(d.y);
}

function mla(src) {
  const names = (src.authors || []).map(parseName).filter(Boolean);
  const site = src.siteName || siteFromUrl(src.url);
  const parts = [];
  if (names.length) parts.push({ text: `${end(mlaAuthors(names))} ` });
  const title = (src.title || src.url).replace(/[.]$/, '');
  if (src.type === 'pdf' && !site) parts.push({ text: `${title}.`, italic: true });
  else parts.push({ text: `“${title}.”` });
  const tail = [];
  if (site) tail.push({ text: ' ' }, { text: site, italic: true });
  const pubDate = mlaDate(parseDate(src.published));
  if (src.publisher && src.publisher.toLowerCase() !== site.toLowerCase()) tail.push({ text: `, ${src.publisher}` });
  if (pubDate) tail.push({ text: `, ${pubDate}` });
  tail.push({ text: `${tail.length ? ',' : ''} ${src.doi ? linkOf(src) : stripProtocol(src.url)}.` });
  const acc = new Date(src.accessedAt || src.savedAt || Date.now());
  if (!pubDate) tail.push({ text: ` Accessed ${acc.getDate()} ${MLA_MONTHS[acc.getMonth()]} ${acc.getFullYear()}.` });
  return [...parts, ...tail];
}

// ---------- IEEE ----------
function ieeeAuthors(names) {
  const list = names.map((n) => (n.org ? n.org : `${initials(n.given)} ${n.family}`));
  if (list.length > 6) return `${list[0]} et al.`;
  if (list.length <= 2) return list.join(' and ');
  return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
}

function ieee(src, index) {
  const names = (src.authors || []).map(parseName).filter(Boolean);
  const site = src.siteName || siteFromUrl(src.url);
  const acc = new Date(src.accessedAt || src.savedAt || Date.now());
  const parts = [{ text: `[${index || 1}] ` }];
  if (names.length) parts.push({ text: `${ieeeAuthors(names)}, ` });
  parts.push({ text: `“${(src.title || src.url).replace(/[.,]$/, '')},” ` });
  if (site) parts.push({ text: site, italic: true }, { text: '. ' });
  const d = parseDate(src.published);
  if (d) parts.push({ text: `${d.m ? IEEE_MONTHS[d.m - 1] + ' ' : ''}${d.d ? d.d + ', ' : ''}${d.y}. ` });
  parts.push({ text: `Accessed: ${IEEE_MONTHS[acc.getMonth()]} ${acc.getDate()}, ${acc.getFullYear()}. [Online]. Available: ${linkOf(src)}` });
  return parts;
}

// ---------- Chicago 17 (bibliography entry) ----------
function chicagoAuthors(names) {
  const full = (n) => (n.org ? n.org : `${n.given} ${n.family}`);
  const first = names[0].org ? names[0].org : `${names[0].family}, ${names[0].given}`;
  if (names.length === 1) return first;
  if (names.length > 10) return `${first}, ${names.slice(1, 7).map(full).join(', ')}, et al`;
  const rest = names.slice(1).map(full);
  return `${first}, ${rest.slice(0, -1).map((x) => x + ', ').join('')}and ${rest.at(-1)}`;
}

function chicagoDate(d) {
  if (!d) return '';
  if (d.m && d.d) return `${MONTHS[d.m - 1]} ${d.d}, ${d.y}`;
  if (d.m) return `${MONTHS[d.m - 1]} ${d.y}`;
  return String(d.y);
}

function chicago(src) {
  const names = (src.authors || []).map(parseName).filter(Boolean);
  const site = src.siteName || siteFromUrl(src.url);
  const title = (src.title || src.url).replace(/[.]$/, '');
  const parts = [];
  if (names.length) parts.push({ text: `${end(chicagoAuthors(names))} ` });
  if (src.type === 'pdf' && !src.siteName) parts.push({ text: `${title}.`, italic: true });
  else parts.push({ text: `“${title}.”` });
  if (site) parts.push({ text: ' ' }, { text: site, italic: true }, { text: '.' });
  if (src.publisher && src.publisher.toLowerCase() !== site.toLowerCase()) parts.push({ text: ` ${end(src.publisher)}` });
  const date = chicagoDate(parseDate(src.published));
  if (date) parts.push({ text: ` ${date}.` });
  else {
    const acc = new Date(src.accessedAt || src.savedAt || Date.now());
    parts.push({ text: ` Accessed ${MONTHS[acc.getMonth()]} ${acc.getDate()}, ${acc.getFullYear()}.` });
  }
  parts.push({ text: ` ${linkOf(src)}.` });
  return parts;
}

export function formatCitation(src, style = 'apa', index = 1) {
  if (style === 'chicago') return chicago(src);
  if (style === 'mla') return mla(src);
  if (style === 'ieee') return ieee(src, index);
  return apa(src);
}

export const citationText = (parts) => parts.map((p) => p.text).join('');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const citationHtml = (parts) => parts.map((p) => (p.italic ? `<i>${esc(p.text)}</i>` : esc(p.text))).join('');

// Reference-list order: APA and MLA alphabetical by first word, IEEE in the order sources were saved.
export function sortForBibliography(sources, style) {
  const list = [...sources];
  if (style === 'ieee') return list.sort((a, b) => a.savedAt - b.savedAt);
  const key = (s) => citationText(formatCitation(s, style)).replace(/^[“"]/, '').toLowerCase();
  return list.sort((a, b) => key(a).localeCompare(key(b)));
}

export function bibliography(sources, style) {
  return sortForBibliography(sources, style).map((s, i) => formatCitation(s, style, i + 1));
}

// ---------- BibTeX ----------
function bibEscape(s) {
  return String(s || '').replace(/[{}\\]/g, '').replace(/([&%$#_])/g, '\\$1');
}

export function toBibtex(sources) {
  const used = new Set();
  return sources.map((s) => {
    const names = (s.authors || []).map(parseName).filter(Boolean);
    const d = parseDate(s.published);
    const base = ((names[0] && (names[0].family || names[0].org)) || siteFromUrl(s.url) || 'source').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'source';
    let key = `${base}${d ? d.y : 'nd'}`;
    let n = 1;
    while (used.has(key)) key = `${base}${d ? d.y : 'nd'}${String.fromCharCode(96 + ++n)}`;
    used.add(key);
    const acc = new Date(s.accessedAt || s.savedAt || Date.now());
    const fields = [
      names.length ? `  author = {${names.map((x) => (x.org ? `{${bibEscape(x.org)}}` : `${bibEscape(x.family)}, ${bibEscape(x.given)}`)).join(' and ')}}` : null,
      `  title = {${bibEscape(s.title || s.url)}}`,
      s.siteName ? `  howpublished = {${bibEscape(s.siteName)}}` : null,
      s.publisher ? `  publisher = {${bibEscape(s.publisher)}}` : null,
      d ? `  year = {${d.y}}` : null,
      d && d.m ? `  month = {${d.m}}` : null,
      s.doi ? `  doi = {${s.doi}}` : null,
      `  url = {${s.url}}`,
      `  urldate = {${acc.toISOString().slice(0, 10)}}`,
    ].filter(Boolean);
    return `@misc{${key},\n${fields.join(',\n')}\n}`;
  }).join('\n\n');
}
