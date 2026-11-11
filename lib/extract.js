// Reads a web page's citation metadata and main text.
// `pageExtractor` is injected with chrome.scripting.executeScript, so it must be fully
// self-contained (no imports, no outer variables). Pass `doc` to run it on a parsed document.

export function pageExtractor(maxChars, doc) {
  const d = doc || document;
  const pick = (...sels) => {
    for (const sel of sels) {
      const el = d.querySelector(sel);
      const v = el && (el.getAttribute('content') || el.getAttribute('datetime') || el.textContent);
      if (v && v.trim()) return v.trim();
    }
    return '';
  };

  // JSON-LD (most news sites, blogs and journals)
  let ld = {};
  for (const node of d.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(node.textContent);
      const items = [].concat(data['@graph'] || data).flat();
      const art = items.find((x) => x && /Article|BlogPosting|Report|ScholarlyArticle|WebPage/i.test([].concat(x['@type'] || '').join(' ')) && (x.author || x.datePublished));
      if (art) { ld = art; break; }
    } catch { /* bad JSON-LD */ }
  }
  const ldNames = (v) => [].concat(v || []).map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean);

  let authors = ldNames(ld.author);
  if (!authors.length) {
    authors = [...d.querySelectorAll('meta[name="citation_author"], meta[name="dc.creator" i], meta[name="author"], meta[property="article:author"]')]
      .map((m) => m.getAttribute('content') || '')
      .filter((a) => a && !/^https?:/i.test(a));
  }
  if (!authors.length) {
    const byline = d.querySelector('[rel="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"], .byline__name, .author-name, .byline');
    if (byline && byline.textContent.trim().length < 80) authors = [byline.textContent.trim().replace(/^by\s+/i, '')];
  }
  authors = [...new Set(authors.flatMap((a) => a.split(/\s+(?:and|&)\s+|;\s*/)).map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a.length > 1 && a.length < 100))].slice(0, 12);

  const published = (typeof ld.datePublished === 'string' && ld.datePublished) || pick(
    'meta[name="citation_publication_date"]', 'meta[name="citation_date"]', 'meta[property="article:published_time"]',
    'meta[name="dc.date" i]', 'meta[name="date"]', 'meta[itemprop="datePublished"]', 'time[itemprop="datePublished"]', 'time[datetime]');

  const publisherLd = ld.publisher && (typeof ld.publisher === 'string' ? ld.publisher : ld.publisher.name);
  const meta = {
    title: pick('meta[name="citation_title"]', 'meta[property="og:title"]', 'meta[name="twitter:title"]') || d.title || '',
    authors,
    published,
    siteName: pick('meta[name="citation_journal_title"]', 'meta[property="og:site_name"]', 'meta[name="application-name"]'),
    publisher: publisherLd || pick('meta[name="citation_publisher"]', 'meta[name="dc.publisher" i]'),
    description: pick('meta[name="description"]', 'meta[property="og:description"]'),
    // DOI: journal meta tags first, then JSON-LD, then the first doi.org link in the article.
    doi: (() => {
      const m = pick('meta[name="citation_doi"]', 'meta[name="dc.identifier" i][scheme="doi" i]', 'meta[name="prism.doi"]', 'meta[name="bepress_citation_doi"]', 'meta[property="citation_doi"]');
      if (m) return m;
      const ldId = [].concat(ld.identifier || [], ld.sameAs || []).map((x) => (typeof x === 'string' ? x : x && (x.value || x['@id']))).find((x) => /10\.\d{4,9}\//.test(x || ''));
      if (ldId) return ldId;
      const dcId = [...d.querySelectorAll('meta[name="dc.identifier" i], meta[name="DC.Identifier"]')].map((x) => x.getAttribute('content') || '').find((x) => /10\.\d{4,9}\//.test(x));
      if (dcId) return dcId;
      const a = d.querySelector('article a[href*="doi.org/10."], main a[href*="doi.org/10."]');
      return a ? a.getAttribute('href') : '';
    })(),
    type: 'webpage',
  };

  // Main text: prefer the article, strip page chrome.
  // Walks the DOM itself (instead of innerText) so it works the same on live and parsed pages
  // and keeps a line break between paragraphs.
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|NAV|HEADER|FOOTER|ASIDE|FORM|BUTTON|SVG|IFRAME|TEMPLATE|SELECT|ORIS-HL-TOAST)$/i;
  const BLOCK = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|H[1-6]|TR|TABLE|BLOCKQUOTE|PRE|FIGCAPTION|DD|DT|BR|HR)$/i;
  const textOf = (node) => {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { out.push(n.data); return; }
      if (n.nodeType !== 1 || SKIP.test(n.nodeName) || n.getAttribute('aria-hidden') === 'true' || n.hidden) return;
      const block = BLOCK.test(n.nodeName);
      if (block) out.push('\n');
      for (const c of n.childNodes) walk(c);
      if (block) out.push('\n');
    };
    walk(node);
    return out.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const root = d.querySelector('article, main, [role="main"], #content, .post-content, .article-body') || d.body;
  let text = root ? textOf(root) : '';
  if (text.length < 400 && root && root !== d.body && d.body) text = textOf(d.body);
  return { url: d.location ? d.location.href : '', meta, text: text.slice(0, maxChars || 16000) };
}

export function isPdfUrl(url) {
  try { return /\.pdf$/i.test(new URL(url).pathname); } catch { return false; }
}

// Runs the extractor in a tab. Throws a user-facing error on pages Chrome won't let extensions read.
export async function extractFromTab(tabId, maxChars = 16000) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageExtractor, args: [maxChars] });
    if (!res || !res.result) throw new Error('empty');
    return res.result;
  } catch {
    throw new Error('Oris can’t read this page. Chrome blocks extensions on chrome:// pages, the Web Store and some built-in viewers.');
  }
}
