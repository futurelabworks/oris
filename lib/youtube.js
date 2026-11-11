// Find good lecture videos for a syllabus topic.
// With a YouTube Data API key: search + rank. Without one: a plain YouTube search link.
// Quota: one topic lookup = search (100 units) + videos.list (1 unit). Free quota is 10,000 units/day.

const API = 'https://www.googleapis.com/youtube/v3';

export function buildQuery(topic, subject, lang) {
  let q = topic;
  if (subject && !topic.toLowerCase().includes(subject.toLowerCase())) q += ' ' + subject;
  if (lang === 'hi') q += ' in hindi';
  return q.trim();
}

export function searchUrl(query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
}

export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatViews(n) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1).replace(/\.0$/, '')} crore views`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, '')} lakh views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K views`;
  return `${n} views`;
}

// Higher is better. Rewards search relevance, reach, approval and lecture-like length.
export function scoreVideo(v, rank, total) {
  const relevance = ((total - rank) / total) * 2.5;
  const reach = Math.log10(v.views + 1) / 2;
  const approval = v.views > 0 ? Math.min(1, (v.likes / v.views) * 25) : 0;
  const min = v.durationSec / 60;
  const fit = min >= 8 && min <= 60 ? 1 : min > 60 && min <= 180 ? 0.6 : min >= 4 ? 0.3 : -3;
  return relevance + reach + approval + fit;
}

async function call(path, params, key) {
  const url = `${API}/${path}?` + new URLSearchParams({ ...params, key });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new Error('Today’s YouTube API quota is used up. It resets at midnight US Pacific time (around 12:30–1:30 PM IST). Use “Search on YouTube” until then.');
    }
    if (reason === 'keyInvalid' || res.status === 400 && /API key/i.test(JSON.stringify(data))) {
      throw new Error('Your YouTube API key is invalid. Check it in Settings.');
    }
    if (reason === 'accessNotConfigured') {
      throw new Error('Enable “YouTube Data API v3” for this key in Google Cloud Console.');
    }
    throw new Error((data.error && data.error.message) || `YouTube returned ${res.status}`);
  }
  return data;
}

export async function findVideos(topic, { subject, key, lang }) {
  const q = buildQuery(topic, subject, lang);
  const params = { part: 'snippet', type: 'video', maxResults: '15', q, safeSearch: 'strict' };
  if (lang === 'en' || lang === 'hi') params.relevanceLanguage = lang;
  const search = await call('search', params, key);
  const ids = (search.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
  if (!ids.length) return [];

  const details = await call('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(',') }, key);
  const byId = new Map((details.items || []).map((v) => [v.id, v]));
  const videos = [];
  ids.forEach((id, rank) => {
    const v = byId.get(id);
    if (!v) return;
    const durationSec = parseIsoDuration(v.contentDetails && v.contentDetails.duration);
    if (durationSec < 240 || durationSec > 4 * 3600) return; // skip Shorts/clips and day-long streams
    if (v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none') return;
    const item = {
      id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      durationSec,
      views: +(v.statistics && v.statistics.viewCount) || 0,
      likes: +(v.statistics && v.statistics.likeCount) || 0,
      thumb: (v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.default) || {}).url || '',
      watched: false,
    };
    item.score = scoreVideo(item, rank, ids.length);
    videos.push(item);
  });
  return videos.sort((a, b) => b.score - a.score).slice(0, 5);
}
