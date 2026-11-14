// Demo mode, for presentations on a fresh install.
//
// "Load demo data" first saves your real data under the key `demoBackup`, then writes
// four weeks of made-up but realistic days. While demo data is on, the dashboard and
// the popup say so clearly. "Remove demo data" deletes the made-up days and puts your
// real data back. Nothing leaves the laptop.

import { emptyDay } from './store.js';
import { dayKey, addDays } from './dates.js';

const DEMO_DAYS = 28;

// Deterministic pseudo-random numbers, so every demo looks the same.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const WEB = {
  'docs.google.com': 40,
  'brightspace.nhlstenden.com': 30,
  'www.youtube.com': 45,
  'github.com': 22,
  'stackoverflow.com': 12,
  'www.reddit.com': 16,
  'web.whatsapp.com': 14,
  'www.netflix.com': 18,
};
const AI = { 'chatgpt.com': 32, 'gemini.google.com': 9, 'claude.ai': 13 };
// share of the day's use per hour (a student day: lectures, afternoon, evening)
const HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.8, 1, 1, 0.7, 0.9, 1, 1, 0.8, 0.6, 0.5, 0.7, 1, 1.1, 0.8, 0.4];

export function buildDemoDays(now = Date.now()) {
  const rnd = rng(7);
  const today = dayKey(now);
  const nowHour = new Date(now).getHours();
  const out = {};
  for (let i = DEMO_DAYS - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    const isToday = i === 0;
    const growth = 1 + (DEMO_DAYS - 1 - i) * 0.02; // AI use slowly growing: a story for the trends page
    const weekend = [0, 6].includes(new Date(`${key}T12:00:00`).getDay());
    const scale = (isToday ? Math.min(1, (nowHour + 1) / 22) : 0.6 + rnd() * 0.9) * (weekend ? 0.75 : 1);
    const rec = emptyDay();

    for (const [h, m] of Object.entries(WEB)) rec.sites[h] = Math.round(m * 60 * scale * (0.5 + rnd()));
    for (const [h, m] of Object.entries(AI)) rec.sites[h] = Math.round(m * 60 * scale * (0.4 + rnd()) * growth);
    const total = Object.values(rec.sites).reduce((a, b) => a + b, 0);
    const aiTotal = Object.keys(AI).reduce((a, h) => a + rec.sites[h], 0);

    const last = isToday ? nowHour : 23;
    let w = HOURS.slice(0, last + 1);
    if (!w.some((x) => x > 0)) w = w.map(() => 1); // very early in the day: spread evenly
    const wsum = w.reduce((a, b) => a + b, 0);
    w.forEach((x, h) => {
      rec.hours[h] = (total * x) / wsum;
      rec.hoursAi[h] = Math.min(rec.hours[h], ((aiTotal * x) / wsum) * (h >= 9 && h <= 17 ? 1.3 : 0.7));
    });

    rec.prompts.chatgpt = { net: Math.round((12 + rnd() * 18) * scale * growth), page: Math.round(rnd() * 2), manual: 0 };
    rec.prompts.gemini = { net: Math.round(rnd() * 8 * scale), page: 0, manual: 0 };
    rec.prompts.claude = { net: Math.round((3 + rnd() * 8) * scale), page: 0, manual: Math.round(rnd() * 1.4) };

    const at = (h, m) => new Date(`${key}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
    if ((rnd() > 0.45 && !weekend) || (isToday && nowHour >= 11)) {
      rec.focus.push({ startedAt: at(10, 5), endedAt: at(10, 30), plannedMin: 25, activeSec: 900 + Math.round(rnd() * 400), prompts: Math.round(rnd() * 3), topSite: 'docs.google.com', completed: true });
    }
    if (rnd() > 0.7 && !isToday) {
      rec.focus.push({ startedAt: at(14, 30), endedAt: at(15, 1), plannedMin: 50, activeSec: 1500, prompts: 4, topSite: 'chatgpt.com', completed: false });
    }
    out[`d:${key}`] = rec;
  }
  return out;
}

export async function isDemoOn() {
  const { demoBackup } = await chrome.storage.local.get('demoBackup');
  return !!demoBackup;
}

export async function loadDemo() {
  if (await isDemoOn()) return;
  const all = await chrome.storage.local.get(null);
  const backup = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('d:') || k === 'meta') backup[k] = v;
  }
  const oldDays = Object.keys(all).filter((k) => k.startsWith('d:'));
  await chrome.storage.local.remove(oldDays);
  await chrome.storage.local.set({
    ...buildDemoDays(),
    meta: { installedAt: Date.now() - DEMO_DAYS * 864e5 },
    demoBackup: { savedAt: Date.now(), data: backup },
  });
}

export async function removeDemo() {
  const all = await chrome.storage.local.get(null);
  if (!all.demoBackup) return;
  const days = Object.keys(all).filter((k) => k.startsWith('d:'));
  await chrome.storage.local.remove([...days, 'demoBackup', 'meta']);
  await chrome.storage.local.set(all.demoBackup.data || {});
  if (!all.demoBackup.data || !all.demoBackup.data.meta) {
    await chrome.storage.local.set({ meta: { installedAt: Date.now() } });
  }
}
