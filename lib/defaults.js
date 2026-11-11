// Shared defaults and helpers. Imported by the service worker, side panel and blocked page.
// (The content script keeps its own copy of the distraction defaults because it can't import modules.)

export const KEYS = { settings: 'settings', timer: 'timer', stats: 'stats', syllabi: 'syllabi', planner: 'planner', earn: 'earn' };

export const DEFAULT_DISTRACTIONS = {
  ytShorts: true,
  ytHome: true,
  ytSidebar: true,
  ytEndscreen: true,
  ytComments: false,
  igReels: true,
  igFeed: false,
  fbFeed: true,
  xFeed: true,
  redditFeed: false,
  liFeed: false,
};

export const DEFAULT_SETTINGS = {
  // Timer
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  hardMode: false,
  notify: true,
  // Website blocker
  blockMode: 'focus', // 'off' | 'focus' | 'session' (focus + breaks) | 'always'
  listType: 'block', // 'block' = block these sites, 'allow' = allow only these sites
  blocklist: ['instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com', 'netflix.com', 'primevideo.com', 'hotstar.com'],
  allowlist: ['youtube.com', 'google.com', 'wikipedia.org', 'khanacademy.org', 'nptel.ac.in'],
  // Distraction blocker
  distractMode: 'always', // 'off' | 'focus' | 'always'
  distractions: { ...DEFAULT_DISTRACTIONS },
  // AI: Oris AI server (free daily allowance) unless the user adds their own Groq key
  cloudAI: true,
  // Syllabus
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  youtubeKey: '',
  videoLang: 'en', // 'en' | 'hi' | 'any'
  // Research
  citeStyle: 'apa', // 'apa' | 'mla' | 'chicago' | 'ieee'
  summaryLength: 'standard', // 'short' | 'standard' | 'detailed'
  // Look and onboarding
  animation: 'full', // 'full' | 'low' | 'off' (reduced-motion in the OS always means 'off')
  onboarded: false,
  profile: null, // { goal, style, level } from onboarding
};

export const DEFAULT_TIMER = {
  phase: 'focus', // 'focus' | 'short' | 'long'
  status: 'idle', // 'idle' | 'running' | 'paused'
  durationMs: null,
  endsAt: null,
  remainingMs: null,
  completedFocus: 0,
  task: '',
  taskId: null,
  skillId: null,
  startedAt: null,
  focusStartedAt: null,
};

export const PHASE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export const TIMER_PRESETS = [
  { name: 'Classic', focusMin: 25, shortMin: 5, longMin: 15 },
  { name: 'Deep', focusMin: 50, shortMin: 10, longMin: 20 },
  { name: 'Marathon', focusMin: 90, shortMin: 20, longMin: 30 },
];

export const BLOCK_PRESETS = {
  Social: ['instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'snapchat.com', 'reddit.com', 'threads.net', 'pinterest.com'],
  Entertainment: ['netflix.com', 'primevideo.com', 'hotstar.com', 'jiocinema.com', 'twitch.tv', 'sonyliv.com', 'mxplayer.in'],
  Shopping: ['amazon.in', 'flipkart.com', 'myntra.com', 'meesho.com', 'ajio.com'],
  News: ['news.google.com', 'timesofindia.indiatimes.com', 'ndtv.com', 'hindustantimes.com', 'moneycontrol.com'],
};

export function mergeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.distractions = { ...DEFAULT_DISTRACTIONS, ...((raw && raw.distractions) || {}) };
  return s;
}

export function mergeTimer(raw) {
  return { ...DEFAULT_TIMER, ...(raw || {}) };
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "https://www.Instagram.com/reels/" -> "instagram.com". Returns '' when invalid.
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/^\*\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return '';
  return s;
}

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function remainingOf(timer, now = Date.now()) {
  if (timer.status === 'running') return Math.max(0, timer.endsAt - now);
  if (timer.status === 'paused') return timer.remainingMs;
  return null;
}

// Consecutive days (ending today, or yesterday if nothing logged today yet) with >= 1 completed focus session.
export function computeStreak(stats, now = new Date()) {
  const days = (stats && stats.days) || {};
  let streak = 0;
  const d = new Date(now);
  if (!(days[todayKey(d)] && days[todayKey(d)].sessions > 0)) d.setDate(d.getDate() - 1);
  while (days[todayKey(d)] && days[todayKey(d)].sessions > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
