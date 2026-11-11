// Oris AI proxy: forwards a limited chat-completion request to NVIDIA (if NVIDIA_API_KEY is set) or Groq with the server's key,
// and (task "search") runs a web search for past papers with the server's search key.
// Users never see the keys. Each install, each IP and the whole service have a daily cap.
// Nothing about the request text is stored; only daily counters (install id, hashed IP).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const GROQ_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const SERPER_KEY = Deno.env.get('SERPER_API_KEY') ?? '';
const BRAVE_KEY = Deno.env.get('BRAVE_API_KEY') ?? '';
const YT_KEY = Deno.env.get('YOUTUBE_API_KEY') ?? '';
const NVIDIA_KEY = Deno.env.get('NVIDIA_API_KEY') ?? '';
const USE_NVIDIA = !!NVIDIA_KEY;
const AI_KEY = USE_NVIDIA ? NVIDIA_KEY : GROQ_KEY;
const AI_URL = USE_NVIDIA ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = Deno.env.get('ORIS_MODEL') ?? (USE_NVIDIA ? 'nvidia/nemotron-3.5-lightning-30b-a3b' : 'llama-3.1-8b-instant');
const LIMIT_INSTALL = Number(Deno.env.get('ORIS_LIMIT_INSTALL') ?? 30);
const LIMIT_IP = Number(Deno.env.get('ORIS_LIMIT_IP') ?? 60);
const LIMIT_GLOBAL = Number(Deno.env.get('ORIS_LIMIT_GLOBAL') ?? 2000);
const MAX_CHARS = 26000;
const TASKS = new Set(['summary', 'syllabus', 'ask', 'notes', 'pyq', 'practice', 'plan', 'quiz', 'coach', 'search', 'yt', 'events']);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-oris-install, x-oris-version, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-oris-left',
};
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

async function sha(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('oris:' + s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Hit = { title: string; url: string; snippet: string };
async function webSearch(q: string): Promise<Hit[]> {
  if (SERPER_KEY) {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 10, gl: 'in' }),
    });
    if (!r.ok) throw new Error(`search ${r.status}`);
    const d = await r.json();
    return (d.organic ?? []).map((x: { title?: string; link?: string; snippet?: string }) => ({ title: x.title ?? '', url: x.link ?? '', snippet: x.snippet ?? '' }));
  }
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=10&country=in&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': BRAVE_KEY },
  });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const d = await r.json();
  return (d.web?.results ?? []).map((x: { title?: string; url?: string; description?: string }) => ({ title: x.title ?? '', url: x.url ?? '', snippet: (x.description ?? '').replace(/<[^>]+>/g, '') }));
}

// ---- YouTube (task "yt") ----
const YT = 'https://www.googleapis.com/youtube/v3';
async function yt(path: string, params: Record<string, string>) {
  const r = await fetch(`${YT}/${path}?` + new URLSearchParams({ ...params, key: YT_KEY }));
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  return await r.json();
}
function dur(iso: string) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '') ?? [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
// deno-lint-ignore no-explicit-any
const vid = (v: any) => ({
  id: v.id, title: v.snippet?.title ?? '', channel: v.snippet?.channelTitle ?? '', durationSec: dur(v.contentDetails?.duration),
  views: +(v.statistics?.viewCount ?? 0), likes: +(v.statistics?.likeCount ?? 0),
  thumb: v.snippet?.thumbnails?.medium?.url ?? '', live: (v.snippet?.liveBroadcastContent ?? 'none') !== 'none',
});
async function details(ids: string[]) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await yt('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') });
    // deno-lint-ignore no-explicit-any
    const by = new Map((d.items ?? []).map((v: any) => [v.id, v]));
    for (const id of ids.slice(i, i + 50)) if (by.has(id)) out.push(vid(by.get(id)));
  }
  return out;
}
async function youtube(action: string, q: string, id: string, lang: string) {
  if (action === 'search') {
    const p: Record<string, string> = { part: 'snippet', type: 'video', maxResults: '15', q, safeSearch: 'strict' };
    if (lang === 'en' || lang === 'hi') p.relevanceLanguage = lang;
    const s = await yt('search', p);
    // deno-lint-ignore no-explicit-any
    return { videos: await details((s.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean)) };
  }
  if (action === 'playlists') {
    const s = await yt('search', { part: 'snippet', type: 'playlist', maxResults: '8', q, safeSearch: 'strict' });
    // deno-lint-ignore no-explicit-any
    const ids = (s.items ?? []).map((i: any) => i.id?.playlistId).filter(Boolean);
    if (!ids.length) return { playlists: [] };
    const d = await yt('playlists', { part: 'snippet,contentDetails', id: ids.join(',') });
    // deno-lint-ignore no-explicit-any
    return { playlists: (d.items ?? []).map((p: any) => ({ id: p.id, title: p.snippet?.title ?? '', channel: p.snippet?.channelTitle ?? '', count: p.contentDetails?.itemCount ?? 0, thumb: p.snippet?.thumbnails?.medium?.url ?? '' })) };
  }
  // playlist items, up to 100
  const ids: string[] = [];
  let page = '';
  for (let i = 0; i < 2; i++) {
    const r = await yt('playlistItems', { part: 'contentDetails', maxResults: '50', playlistId: id, ...(page ? { pageToken: page } : {}) });
    // deno-lint-ignore no-explicit-any
    ids.push(...(r.items ?? []).map((x: any) => x.contentDetails?.videoId).filter(Boolean));
    page = r.nextPageToken ?? '';
    if (!page) break;
  }
  return { videos: await details(ids) };
}

// ---- anonymous study events (task "events", opt-in only) ----
const KIND_RE = /^[a-z]+(\.[a-z]+)?$/;
// deno-lint-ignore no-explicit-any
function cleanEvent(e: any, installHash: string) {
  if (!e || typeof e.kind !== 'string' || !KIND_RE.test(e.kind) || e.kind.length > 32) return null;
  if (typeof e.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.day)) return null;
  const hour = Number(e.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const level = ['school', 'college', 'competitive'].includes(e.level) ? e.level : '';
  const data: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(e.data ?? {}).slice(0, 8)) {
    if (!/^[a-zA-Z]{1,16}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6) data[k] = v;
    else if (typeof v === 'boolean') data[k] = v;
    else if (typeof v === 'string' && /^[a-z]{1,12}$/.test(v)) data[k] = v;
  }
  return { install_hash: installHash, kind: e.kind, day: e.day, hour, level, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const install = req.headers.get('x-oris-install') ?? '';
  if (!/^[a-f0-9-]{36}$/i.test(install)) return reply(400, { error: 'Missing install id.' });

  let body: { task?: string; query?: string; action?: string; id?: string; lang?: string; events?: unknown[]; messages?: { role: string; content: string }[]; temperature?: number };
  try { body = await req.json(); } catch { return reply(400, { error: 'Bad JSON.' }); }
  const task = String(body.task);
  if (!TASKS.has(task)) return reply(400, { error: 'Bad request.' });

  const isSearch = task === 'search';
  const isYt = task === 'yt';
  const isEvents = task === 'events';
  const query = isSearch ? String(body.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const messages = Array.isArray(body.messages) ? body.messages.slice(0, 3) : [];
  const action = String(body.action ?? '');
  const ytId = String(body.id ?? '').slice(0, 64);
  const ytQuery = String(body.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (isSearch) {
    if (!SERPER_KEY && !BRAVE_KEY) return reply(503, { error: 'Paper search isn’t set up yet.', code: 'search_not_configured' });
    if (query.length < 3) return reply(400, { error: 'Bad query.' });
  } else if (isEvents) {
    if (!Array.isArray((body as { events?: unknown[] }).events)) return reply(400, { error: 'Bad request.' });
  } else if (isYt) {
    if (!YT_KEY) return reply(503, { error: 'Lecture search isn’t set up yet. Add your own YouTube key in Settings, or paste video links.', code: 'yt_not_configured' });
    if (!['search', 'playlists', 'playlist'].includes(action)) return reply(400, { error: 'Bad request.' });
    if (action === 'playlist' ? !/^[A-Za-z0-9_-]{10,64}$/.test(ytId) : ytQuery.length < 2) return reply(400, { error: 'Bad request.' });
  } else {
    if (!AI_KEY) return reply(503, { error: 'Oris AI isn’t set up yet.', code: 'not_configured' });
    if (!messages.length) return reply(400, { error: 'Bad request.' });
    for (const m of messages) {
      if (!['system', 'user'].includes(m?.role) || typeof m.content !== 'string') return reply(400, { error: 'Bad message.' });
    }
    if (messages.reduce((a, m) => a + m.content.length, 0) > MAX_CHARS) return reply(413, { error: 'That text is too long for Oris AI.' });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const { data: take, error } = await db.rpc('oris_take', {
    p_install: install, p_ip: await sha(ip), p_install_limit: LIMIT_INSTALL, p_ip_limit: LIMIT_IP, p_global_limit: LIMIT_GLOBAL,
  });
  if (error) return reply(500, { error: 'Oris AI is unavailable right now.' });
  if (!String(take).startsWith('ok')) {
    return reply(429, { error: take === 'global' ? 'Oris AI is very busy today. Try again tomorrow, or add your own free Groq key in Settings.' : 'You’ve used today’s free Oris AI requests. They reset at 5:30 am IST, or add your own free Groq key in Settings.', code: 'limit_' + take });
  }
  const left = String(take).split(':')[1] ?? '';

  if (isEvents) {
    const hash = await sha('install:' + install);
    // deno-lint-ignore no-explicit-any
    const rows = ((body as any).events as unknown[]).slice(0, 500).map((e) => cleanEvent(e, hash)).filter(Boolean);
    if (rows.length) {
      const { error: insErr } = await db.from('coach_events').insert(rows);
      if (insErr) return reply(500, { error: 'Couldn’t save.' });
    }
    return reply(200, { saved: rows.length }, { 'x-oris-left': left });
  }

  if (isYt) {
    try {
      return reply(200, await youtube(action, ytQuery, ytId, String(body.lang ?? '')), { 'x-oris-left': left });
    } catch {
      return reply(502, { error: 'YouTube didn’t answer. Try again later.' });
    }
  }

  if (isSearch) {
    try {
      const results = (await webSearch(query)).filter((h) => /^https?:\/\//.test(h.url)).slice(0, 10);
      return reply(200, { results }, { 'x-oris-left': left });
    } catch {
      return reply(502, { error: 'The search service didn’t answer. Try again.' });
    }
  }

  const payload: Record<string, unknown> = {
    model: MODEL,
    temperature: Math.min(Math.max(Number(body.temperature ?? 0.2), 0), 1),
    max_tokens: ['practice', 'pyq', 'plan', 'quiz'].includes(task) ? 2500 : task === 'coach' ? 600 : 1500,
    response_format: { type: 'json_object' },
    messages,
  };
  if (USE_NVIDIA) payload.chat_template_kwargs = { enable_thinking: false };
  const call = () => fetch(AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55000),
  });
  let ai: Response;
  try {
    ai = await call();
    // If the model doesn't accept JSON mode, ask again without it (the prompt still asks for JSON).
    if (ai.status === 400 && USE_NVIDIA) { delete payload.response_format; ai = await call(); }
  } catch {
    return reply(504, { error: 'The AI service took too long. Try again.' });
  }
  if (ai.status === 429) return reply(429, { error: 'Oris AI is busy. Try again in a minute.', code: 'busy' });
  if (!ai.ok) return reply(502, { error: `The AI service returned ${ai.status}. Try again.` });
  const data = await ai.json();
  let content = String(data?.choices?.[0]?.message?.content ?? '');
  // Some models wrap JSON in fences or add text around it: keep just the JSON object.
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = content.indexOf('{'), b = content.lastIndexOf('}');
  if (a > 0 || (b >= 0 && b < content.length - 1)) { if (a >= 0 && b > a) content = content.slice(a, b + 1); }
  if (Math.random() < 0.01) db.rpc('oris_cleanup').then(() => {}, () => {});
  return reply(200, { content }, { 'x-oris-left': left });
});
