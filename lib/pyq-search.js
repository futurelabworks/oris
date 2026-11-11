// Finding past papers online: search through the Oris server, rank official sources first,
// then fetch the paper the student picks (a PDF, or a page that links to PDFs).
import { ORIS_AI_URL, installId } from './ai.js';

const OFFICIAL_RE = /(\.ac\.in|\.edu|\.edu\.in|\.gov\.in|\.nic\.in|\.res\.in|\.ac\.uk|\.edu\.au)$/i;
const PAPER_RE = /(question\s*papers?|previous\s*years?|pyqs?|past\s*papers?|exam\s*papers?|old\s*papers?|end\s*(term|sem))/i;

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const isPdfUrl = (url) => /\.pdf($|[?#])/i.test(url);

// The searches to run for one subject (at most two, to save the daily allowance).
export function paperQueries({ subject, institution = '', course = '', level = '' }) {
  const s = String(subject || '').trim();
  const inst = String(institution || '').trim();
  if (level === 'competitive') return [`${s} previous year question papers pdf`, `${s} previous year question paper with solutions`];
  const qs = [];
  if (inst) qs.push(`${inst} ${s} previous year question paper pdf`);
  qs.push(`${s} ${course} previous year question paper pdf`.replace(/\s+/g, ' ').trim());
  return qs.slice(0, 2);
}

// Official sites and direct PDFs first.
export function rankResults(results, { institution = '' } = {}) {
  const instWords = String(institution).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['university', 'college', 'institute', 'school', 'the', 'and', 'technology', 'board'].includes(w));
  const seen = new Set();
  return results
    .filter((r) => r && /^https?:\/\//i.test(r.url) && !seen.has(r.url) && seen.add(r.url))
    .map((r) => {
      const host = hostOf(r.url);
      // "Official" only for official domains; a site that merely has the college's name in it isn't.
      const official = OFFICIAL_RE.test(host);
      const pdf = isPdfUrl(r.url);
      const named = instWords.some((w) => host.includes(w));
      const score = (official ? 3 : 0) + (pdf ? 2 : 0) + (named ? 1 : 0) + (PAPER_RE.test(`${r.title} ${r.snippet}`) ? 1 : 0);
      return { title: String(r.title || host).slice(0, 160), url: r.url, snippet: String(r.snippet || '').slice(0, 240), host, official, pdf, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// Run the searches through the Oris server. Throws { code: 'search_not_configured' } when the
// server has no search key yet, so the caller can fall back to a plain Google link.
export async function searchPapers(info) {
  const all = [];
  let lastErr = null;
  for (const q of paperQueries(info)) {
    let res;
    try {
      res = await fetch(ORIS_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-oris-install': await installId() },
        body: JSON.stringify({ task: 'search', query: q }),
      });
    } catch {
      throw Object.assign(new Error('Couldn’t reach Oris. Check your internet connection.'), { code: 'offline' });
    }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      lastErr = Object.assign(new Error(data.error || `Search returned ${res.status}.`), { code: data.code || '' });
      if (data.code === 'search_not_configured' || res.status === 429) throw lastErr;
      continue;
    }
    all.push(...(Array.isArray(data.results) ? data.results : []));
  }
  if (!all.length && lastErr) throw lastErr;
  return rankResults(all, info);
}

// Fetch a result. A PDF comes back as a Blob for the PDF reader; a web page comes back as the
// list of PDF links on it, so the student can pick the actual paper.
export async function fetchPaper(url, { timeoutMs = 25000, maxBytes = 20e6 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'That site took too long to answer.' : 'That site couldn’t be reached. Open it, download the paper and upload it instead.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`That site refused the download (${res.status}). Open it, download the paper and upload it instead.`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('That file is too big to read.');
  if (type.includes('pdf') || (isPdfUrl(url) && !type.includes('html'))) {
    const blob = await res.blob();
    if (blob.size > maxBytes) throw new Error('That file is too big to read.');
    return { kind: 'pdf', blob, name: decodeURIComponent((new URL(res.url || url).pathname.split('/').pop() || 'paper').replace(/\.pdf$/i, '')).slice(0, 80) };
  }
  if (type.includes('html') || !type) {
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = res.url || url;
    const links = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll('a[href]')) {
      let href;
      try { href = new URL(a.getAttribute('href'), base).href; } catch { continue; }
      if (!isPdfUrl(href) || seen.has(href)) continue;
      seen.add(href);
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      links.push({ title: (text || decodeURIComponent(href.split('/').pop())).slice(0, 140), url: href, paper: PAPER_RE.test(text + ' ' + href) });
    }
    links.sort((x, y) => Number(y.paper) - Number(x.paper));
    return { kind: 'page', links: links.slice(0, 25) };
  }
  throw new Error('That link isn’t a PDF or a web page.');
}
