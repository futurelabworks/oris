// Backup restore. Accepts the file made by Settings → Download backup.
// Only known data keys are restored; the running timer and API keys on this device are kept.
import { mergeSettings } from './defaults.js';
import { mergeResearch } from './research.js';
import { mergePlanner } from './planner.js';
import { mergeEarn } from './earn.js';
import { mergeStudy } from './study.js';

export const BACKUP_KEYS = ['settings', 'stats', 'syllabi', 'research', 'planner', 'earn', 'study'];

export function parseBackup(text, currentSettings = {}) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('This file isn’t an Oris backup (it isn’t valid JSON).'); }
  if (!json || json.app !== 'oris' || !json.data || typeof json.data !== 'object') {
    throw new Error('This file isn’t an Oris backup. Choose the oris-backup-….json file you downloaded.');
  }
  const d = json.data;
  const out = {};
  if (d.settings) {
    const s = mergeSettings(d.settings);
    // Backups never contain keys; keep the ones already on this device.
    s.groqKey = currentSettings.groqKey || '';
    s.youtubeKey = currentSettings.youtubeKey || '';
    out.settings = s;
  }
  if (d.stats && typeof d.stats === 'object' && d.stats.days && typeof d.stats.days === 'object') out.stats = { days: d.stats.days };
  if (Array.isArray(d.syllabi)) out.syllabi = d.syllabi;
  if (d.research) out.research = mergeResearch(d.research);
  if (d.planner) out.planner = mergePlanner(d.planner);
  if (d.earn) out.earn = mergeEarn(d.earn);
  if (d.study) out.study = mergeStudy(d.study);
  if (!Object.keys(out).length) throw new Error('This backup has no Oris data in it.');

  const counts = {
    sources: out.research ? out.research.sources.length : 0,
    syllabi: out.syllabi ? out.syllabi.length : 0,
    tasks: out.planner ? out.planner.tasks.length : 0,
    days: out.stats ? Object.keys(out.stats.days).length : 0,
  };
  return { data: out, exportedAt: json.exportedAt || null, version: json.version || '', counts };
}
