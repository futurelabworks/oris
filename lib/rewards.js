// Focus rewards: XP, levels and badges, all worked out from what the person has actually done
// (focus time, tasks, research, applications, skills, income). Nothing here can be farmed by
// clicking, and nothing is stored except which badges have already been celebrated.
import { computeStreak, todayKey } from './defaults.js';

export function bestStreak(stats) {
  const days = Object.keys((stats && stats.days) || {}).filter((k) => stats.days[k].sessions > 0).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of days) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function xpBreakdown({ stats, planner, research, earn }) {
  const days = Object.values((stats && stats.days) || {});
  const focusMin = Math.floor(days.reduce((a, d) => a + (d.focusMs || 0), 0) / 60000);
  const sessions = days.reduce((a, d) => a + (d.sessions || 0), 0);
  const tasksDone = ((planner && planner.tasks) || []).filter((t) => t.done).length;
  const sources = ((research && research.sources) || []).length;
  const applied = ((earn && earn.jobs) || []).filter((j) => j.stage !== 'saved').length;
  const milestones = ((earn && earn.skills) || []).reduce((a, s) => a + s.milestones.filter((m) => m.done).length, 0);
  const paidIncome = ((earn && earn.income) || []).filter((i) => i.paid).length;
  const workHours = Math.floor(((earn && earn.entries) || []).reduce((a, e) => a + e.minutes, 0) / 60);
  const items = [
    ['Focus minutes', focusMin, 1],
    ['Completed sessions', sessions, 10],
    ['Tasks done', tasksDone, 5],
    ['Sources saved', sources, 3],
    ['Applications sent', applied, 15],
    ['Skill steps finished', milestones, 25],
    ['Hours of client work', workHours, 10],
    ['Payments received', paidIncome, 20],
  ].map(([label, count, each]) => ({ label, count, each, xp: count * each }));
  return { items, total: items.reduce((a, i) => a + i.xp, 0) };
}

// Level n needs 100 × n × (n + 1) / 2 XP in total: 100, 300, 600, 1000, 1500…
export function levelFor(xp) {
  let n = 0;
  while (100 * ((n + 1) * (n + 2)) / 2 <= xp) n++;
  const floor = (100 * n * (n + 1)) / 2;
  const next = (100 * (n + 1) * (n + 2)) / 2;
  return { level: n + 1, into: xp - floor, span: next - floor, toNext: next - xp };
}

export function badges({ stats, planner, research, earn }) {
  const days = Object.values((stats && stats.days) || {});
  const sessions = days.reduce((a, d) => a + (d.sessions || 0), 0);
  const hours = days.reduce((a, d) => a + (d.focusMs || 0), 0) / 3600000;
  const streak = Math.max(bestStreak(stats), computeStreak(stats));
  const tasksDone = ((planner && planner.tasks) || []).filter((t) => t.done).length;
  const sources = ((research && research.sources) || []).length;
  const jobs = (earn && earn.jobs) || [];
  const applied = jobs.filter((j) => j.stage !== 'saved').length;
  const skills = (earn && earn.skills) || [];
  const stepsDone = skills.reduce((a, s) => a + s.milestones.filter((m) => m.done).length, 0);
  const skillDone = skills.some((s) => s.milestones.length >= 2 && s.milestones.every((m) => m.done));
  const paid = ((earn && earn.income) || []).filter((i) => i.paid);
  const earned = paid.reduce((a, i) => a + i.amount, 0);
  const cur = (earn && earn.currency) || 'INR';
  const big = cur === 'INR' ? [10000, 100000] : [500, 5000];
  const bigLabel = cur === 'INR' ? ['₹10,000', '₹1,00,000'] : [`${cur} 500`, `${cur} 5,000`];

  const list = [
    ['first-session', 'First session', 'Finish your first focus session', sessions >= 1],
    ['ten-hours', '10 focused hours', 'Reach 10 hours of focus time', hours >= 10],
    ['fifty-hours', '50 focused hours', 'Reach 50 hours of focus time', hours >= 50],
    ['streak-3', '3-day streak', 'Focus 3 days in a row', streak >= 3],
    ['streak-7', 'Week streak', 'Focus 7 days in a row', streak >= 7],
    ['tasks-10', 'Getting it done', 'Finish 10 tasks', tasksDone >= 10],
    ['researcher', 'Researcher', 'Save 10 sources', sources >= 10],
    ['first-apply', 'First application', 'Apply for a job, internship or gig', applied >= 1],
    ['apply-10', 'Persistent', 'Send 10 applications', applied >= 10],
    ['interview', 'In the room', 'Reach an interview', jobs.some((j) => ['interview', 'offer'].includes(j.stage))],
    ['offer', 'Offer in hand', 'Get an offer', jobs.some((j) => j.stage === 'offer')],
    ['first-step', 'Learning', 'Finish a skill step', stepsDone >= 1],
    ['skill-done', 'Skill unlocked', 'Finish every step of a skill', skillDone],
    ['first-income', 'First earning', 'Log your first payment received', paid.length >= 1],
    ['earned-1', `${bigLabel[0]} earned`, `Earn ${bigLabel[0]} in total`, earned >= big[0]],
    ['earned-2', `${bigLabel[1]} earned`, `Earn ${bigLabel[1]} in total`, earned >= big[1]],
  ];
  return list.map(([id, name, how, got]) => ({ id, name, how, got: !!got }));
}

// Badges earned but not yet celebrated.
export function newBadges(data, seen) {
  const s = new Set(seen || []);
  return badges(data).filter((b) => b.got && !s.has(b.id));
}

export { todayKey };
