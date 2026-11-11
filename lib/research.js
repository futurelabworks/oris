// Research mode data: projects, saved sources (with highlights, notes, summary, citation fields)
// and tab sessions. All writes go through applyOp() inside the service worker so the side panel
// and the highlighter never overwrite each other.

export const RESEARCH_KEY = 'research';
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyResearch() {
  const id = uid();
  return {
    projects: [{ id, name: 'My research', createdAt: Date.now() }],
    activeProjectId: id,
    sources: [],
    sessions: [],
  };
}

export function mergeResearch(raw) {
  if (!raw || !Array.isArray(raw.projects) || !raw.projects.length) return emptyResearch();
  const r = {
    projects: raw.projects,
    activeProjectId: raw.activeProjectId,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
  };
  if (!r.projects.some((p) => p.id === r.activeProjectId)) r.activeProjectId = r.projects[0].id;
  return r;
}

// Same page = same source. Drops #hash, tracking params and trailing slash.
export function normalizeUrl(url) {
  let u;
  try { u = new URL(url); } catch { return String(url || ''); }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|igshid$|si$)/i.test(k)) u.searchParams.delete(k);
  }
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  const s = u.toString();
  return u.pathname === '/' && !u.search ? s.replace(/\/$/, '') : s;
}

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// "https://doi.org/10.1000/xyz", "doi:10.1000/xyz" or "10.1000/xyz" -> "10.1000/xyz". '' if not a DOI.
export function normalizeDoi(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
  s = s.replace(/[.,;)\]]+$/, '');
  return /^10\.\d{4,9}\/\S+$/i.test(s) ? s.slice(0, 200) : '';
}

// Lowercase, trimmed, unique, at most 12 tags of 30 characters.
export function cleanTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const tag = String(t || '').toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

function cleanMeta(meta = {}) {
  return {
    title: clip(meta.title, 400).trim(),
    authors: (Array.isArray(meta.authors) ? meta.authors : []).map((a) => clip(a, 120).trim()).filter(Boolean).slice(0, 12),
    published: clip(meta.published, 40).trim(),
    siteName: clip(meta.siteName, 160).trim(),
    publisher: clip(meta.publisher, 160).trim(),
    description: clip(meta.description, 600).trim(),
    doi: normalizeDoi(meta.doi),
    type: meta.type === 'pdf' ? 'pdf' : 'webpage',
  };
}

export function findSourceByUrl(state, url, projectId) {
  const key = normalizeUrl(url);
  const matches = state.sources.filter((s) => s.urlKey === key);
  return matches.find((s) => s.projectId === projectId) || matches[0] || null;
}

function needSource(state, id) {
  const s = state.sources.find((x) => x.id === id);
  if (!s) throw new Error('That source no longer exists.');
  return s;
}

function needProject(state, id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) throw new Error('That project no longer exists.');
  return p;
}

function newSource(state, args) {
  const meta = cleanMeta(args.meta);
  const source = {
    id: uid(),
    projectId: args.projectId || state.activeProjectId,
    url: clip(args.url, 2000),
    urlKey: normalizeUrl(args.url),
    ...meta,
    title: meta.title || clip(args.url, 400),
    savedAt: Date.now(),
    accessedAt: Date.now(),
    notes: '',
    summary: null,
    tags: [],
    highlights: [],
  };
  state.sources.unshift(source);
  return source;
}

// Every op mutates `state` in place and returns a result (or throws a user-facing Error).
export const OPS = {
  addProject(state, { name }) {
    const clean = clip(name, 80).trim();
    if (!clean) throw new Error('Give the project a name.');
    const p = { id: uid(), name: clean, createdAt: Date.now() };
    state.projects.push(p);
    state.activeProjectId = p.id;
    return p;
  },
  renameProject(state, { id, name }) {
    const clean = clip(name, 80).trim();
    if (!clean) throw new Error('Give the project a name.');
    needProject(state, id).name = clean;
    return true;
  },
  deleteProject(state, { id }) {
    needProject(state, id);
    if (state.projects.length === 1) throw new Error('You need at least one project.');
    state.projects = state.projects.filter((p) => p.id !== id);
    state.sources = state.sources.filter((s) => s.projectId !== id);
    state.sessions = state.sessions.filter((s) => s.projectId !== id);
    if (state.activeProjectId === id) state.activeProjectId = state.projects[0].id;
    return true;
  },
  setActiveProject(state, { id }) {
    needProject(state, id);
    state.activeProjectId = id;
    return true;
  },

  // Save (or refresh) the page in the active project. Returns the source.
  saveSource(state, { url, meta, projectId }) {
    if (!/^https?:/i.test(url || '')) throw new Error('Only web pages (http or https) can be saved.');
    const pid = projectId || state.activeProjectId;
    const key = normalizeUrl(url);
    const existing = state.sources.find((s) => s.urlKey === key && s.projectId === pid);
    if (existing) {
      // Fill gaps without overwriting anything the user edited.
      const m = cleanMeta(meta);
      for (const k of ['published', 'siteName', 'publisher', 'description', 'doi']) if (!existing[k] && m[k]) existing[k] = m[k];
      if (!existing.authors.length && m.authors.length) existing.authors = m.authors;
      existing.accessedAt = Date.now();
      return existing;
    }
    return newSource(state, { url, meta, projectId: pid });
  },
  updateSource(state, { id, patch }) {
    const s = needSource(state, id);
    const allowed = {
      title: (v) => clip(v, 400),
      notes: (v) => clip(v, 20000),
      published: (v) => clip(v, 40).trim(),
      siteName: (v) => clip(v, 160),
      publisher: (v) => clip(v, 160),
      authors: (v) => (Array.isArray(v) ? v : []).map((a) => clip(a, 120).trim()).filter(Boolean).slice(0, 12),
      summary: (v) => (v ? { text: clip(v.text, 4000), points: (v.points || []).map((p) => clip(p, 600)).slice(0, 10), method: v.method === 'ai' ? 'ai' : 'basic', length: ['short', 'standard', 'detailed'].includes(v.length) ? v.length : 'standard', at: Date.now() } : null),
      doi: (v) => normalizeDoi(v),
      tags: (v) => cleanTags(v),
      hasText: (v) => !!v,
      projectId: (v) => needProject(state, v).id,
    };
    for (const [k, v] of Object.entries(patch || {})) if (allowed[k]) s[k] = allowed[k](v);
    return s;
  },
  deleteSource(state, { id }) {
    needSource(state, id);
    state.sources = state.sources.filter((s) => s.id !== id);
    return true;
  },

  // Called by the highlighter. Creates the source if the page isn't saved yet.
  addHighlight(state, { url, meta, highlight }) {
    if (!highlight || !String(highlight.text || '').trim()) throw new Error('Select some text first.');
    let source = findSourceByUrl(state, url, state.activeProjectId);
    if (!source) source = OPS.saveSource(state, { url, meta });
    const h = {
      id: highlight.id || uid(),
      text: clip(highlight.text, 5000),
      prefix: clip(highlight.prefix, 64),
      suffix: clip(highlight.suffix, 64),
      color: HIGHLIGHT_COLORS.includes(highlight.color) ? highlight.color : 'yellow',
      note: '',
      createdAt: Date.now(),
    };
    source.highlights.push(h);
    return { source, highlight: h, projectName: (state.projects.find((p) => p.id === source.projectId) || {}).name };
  },
  updateHighlight(state, { sourceId, id, patch }) {
    const h = needSource(state, sourceId).highlights.find((x) => x.id === id);
    if (!h) throw new Error('That highlight no longer exists.');
    if ('note' in patch) h.note = clip(patch.note, 4000);
    if ('color' in patch && HIGHLIGHT_COLORS.includes(patch.color)) h.color = patch.color;
    return h;
  },
  deleteHighlight(state, { sourceId, id }) {
    const s = needSource(state, sourceId);
    s.highlights = s.highlights.filter((h) => h.id !== id);
    return true;
  },

  saveSession(state, { name, tabs }) {
    const list = (tabs || []).filter((t) => /^https?:/i.test(t.url || '')).map((t) => ({ url: clip(t.url, 2000), title: clip(t.title || t.url, 300) })).slice(0, 200);
    if (!list.length) throw new Error('No web pages are open in this window.');
    const s = { id: uid(), projectId: state.activeProjectId, name: clip(name, 80).trim() || 'Untitled session', createdAt: Date.now(), tabs: list };
    state.sessions.unshift(s);
    return s;
  },
  renameSession(state, { id, name }) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) throw new Error('That session no longer exists.');
    s.name = clip(name, 80).trim() || s.name;
    return true;
  },
  deleteSession(state, { id }) {
    state.sessions = state.sessions.filter((s) => s.id !== id);
    return true;
  },
};

export function applyOp(state, op, args = {}) {
  const fn = OPS[op];
  if (!fn) throw new Error(`Unknown research action: ${op}`);
  return fn(state, args);
}

// All highlights stored for this URL, across projects (used to repaint a page).
export function highlightsForUrl(state, url) {
  const key = normalizeUrl(url);
  const out = [];
  for (const s of state.sources) if (s.urlKey === key) for (const h of s.highlights) out.push(h);
  return out;
}

// Every tag used in a project, most used first.
export function projectTags(state, projectId) {
  const count = new Map();
  for (const src of state.sources) if (src.projectId === projectId) for (const t of src.tags || []) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
