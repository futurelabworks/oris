// YouTube lookups for lectures: with the student's own YouTube key straight to the API,
// otherwise through the Oris server (which holds a key and shares the daily allowance).
import { ORIS_AI_URL, installId } from './ai.js';
import { buildQuery, findVideos, scoreVideo } from './youtube.js';

// Pull a video id, playlist id and start time out of anything a student might paste.
export function parseYouTubeUrl(text) {
  const s = String(text || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { videoId: s, playlistId: '', start: 0 };
  let u;
  try { u = new URL(s.startsWith('http') ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let videoId = '';
  if (host === 'youtu.be') videoId = u.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/) || [])[1] || '';
  } else return null;
  const playlistId = u.searchParams.get('list') || '';
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const start = /^\d+$/.test(t) ? Number(t) : (() => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; })();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = '';
  if (!videoId && !playlistId) return null;
  return { videoId, playlistId, start };
}

async function server(body) {
  let res;
  try {
    res = await fetch(ORIS_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-oris-install': await installId() },
      body: JSON.stringify({ task: 'yt', ...body }),
    });
  } catch {
    throw new Error('Couldn’t reach Oris. Check your internet connection.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Video search returned ${res.status}.`), { code: data.code || '' });
  return data;
}

// Best lectures for one topic, best first.
export async function topicVideos(topic, subject, settings = {}) {
  if (settings.youtubeKey) return findVideos(topic, { subject, key: settings.youtubeKey, lang: settings.videoLang });
  const q = buildQuery(topic, subject, settings.videoLang);
  const { videos = [] } = await server({ action: 'search', query: q, lang: settings.videoLang || '' });
  return rank(videos);
}

function rank(videos) {
  const ok = videos.filter((v) => v.durationSec >= 240 && v.durationSec <= 4 * 3600 && !v.live);
  return ok.map((v, i) => ({ ...v, score: scoreVideo(v, i, ok.length) })).sort((a, b) => b.score - a.score).slice(0, 5);
}

// Whole-course playlists for a subject.
export async function findPlaylists(subject, settings = {}) {
  const q = `${subject} full course lectures`.trim();
  if (settings.youtubeKey) return ownKeyPlaylists(q, settings.youtubeKey);
  const { playlists = [] } = await server({ action: 'playlists', query: q });
  return playlists;
}

// All videos of a playlist (up to 100), in order.
export async function playlistVideos(playlistId, settings = {}) {
  if (settings.youtubeKey) return ownKeyPlaylist(playlistId, settings.youtubeKey);
  const { videos = [] } = await server({ action: 'playlist', id: playlistId });
  return videos;
}

// ---- own key (same calls the server makes) ----
const API = 'https://www.googleapis.com/youtube/v3';
async function api(path, params, key) {
  const res = await fetch(`${API}/${path}?` + new URLSearchParams({ ...params, key }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `YouTube returned ${res.status}`);
  return data;
}
async function ownKeyPlaylists(q, key) {
  const s = await api('search', { part: 'snippet', type: 'playlist', maxResults: '8', q, safeSearch: 'strict' }, key);
  const ids = (s.items || []).map((i) => i.id.playlistId).filter(Boolean);
  if (!ids.length) return [];
  const d = await api('playlists', { part: 'snippet,contentDetails', id: ids.join(',') }, key);
  return (d.items || []).map((p) => ({ id: p.id, title: p.snippet.title, channel: p.snippet.channelTitle, count: p.contentDetails.itemCount, thumb: ((p.snippet.thumbnails || {}).medium || {}).url || '' }));
}
async function ownKeyPlaylist(id, key) {
  const ids = [];
  let page = '';
  for (let i = 0; i < 2; i++) {
    const r = await api('playlistItems', { part: 'contentDetails', maxResults: '50', playlistId: id, ...(page ? { pageToken: page } : {}) }, key);
    ids.push(...(r.items || []).map((x) => x.contentDetails.videoId));
    page = r.nextPageToken || '';
    if (!page) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await api('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') }, key);
    const by = new Map((d.items || []).map((v) => [v.id, v]));
    for (const vid of ids.slice(i, i + 50)) {
      const v = by.get(vid);
      if (v) out.push(normal(v));
    }
  }
  return out;
}
function normal(v) {
  const iso = (v.contentDetails && v.contentDetails.duration) || '';
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) || [];
  return {
    id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
    durationSec: (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0),
    views: +(v.statistics && v.statistics.viewCount) || 0, likes: +(v.statistics && v.statistics.likeCount) || 0,
    thumb: ((v.snippet.thumbnails || {}).medium || {}).url || '', live: v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none',
  };
}
