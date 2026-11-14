// All data lives in chrome.storage.local on this computer. Nothing is sent anywhere.
//
// Keys:
//   settings        user settings (see DEFAULT_SETTINGS)
//   meta            { installedAt }
//   d:YYYY-MM-DD    one record per day (see emptyDay)
//   reminder        { activeSec, idleSec, snoozeUntil, lastShownAt }
//   focus           the running focus session, or null

import { aiSiteForHost, aiSiteById, hostMatches } from './sites.js';
import { promptFootprint, addFootprints, emptyFootprint, deviceFootprint } from './footprint.js';
import { dayKey, addDays } from './dates.js';

export const DEFAULT_SETTINGS = {
  // tracking
  idleSeconds: 60,          // no mouse/keyboard for this long = idle, stop counting
  countMedia: true,         // keep counting while the active tab plays sound (videos, lectures)
  ignoredDomains: [],       // never recorded at all
  customAiDomains: [],      // extra AI sites (time only + manual prompts)
  retentionDays: 90,
  // reminders
  remindersEnabled: true,
  reminderMinutes: 60,
  breakMinutes: 5,          // this much idle time counts as a real break and resets the reminder
  // goals
  dailyGoalMinutes: 240,
  dailyPromptGoal: 0,       // 0 = off
  // footprint
  gridId: 'NL',
  customGrid: 300,
  laptopWatts: 15,
  // display
  showToolbarBadge: true,
  showPageBadge: true,
  focusMinutes: 25,
};

export function emptyDay() {
  return { v: 1, sites: {}, hours: new Array(24).fill(0), hoursAi: new Array(24).fill(0), prompts: {}, focus: [] };
}

const dKey = (k) => `d:${k}`;

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getDay(key = dayKey()) {
  const k = dKey(key);
  const res = await chrome.storage.local.get(k);
  return normaliseDay(res[k]);
}

export async function getDays(keys) {
  const res = await chrome.storage.local.get(keys.map(dKey));
  const out = {};
  for (const k of keys) out[k] = normaliseDay(res[dKey(k)]);
  return out;
}

export async function setDay(key, rec) {
  await chrome.storage.local.set({ [dKey(key)]: rec });
}

function normaliseDay(rec) {
  const base = emptyDay();
  if (!rec) return base;
  return {
    ...base,
    ...rec,
    hours: Array.isArray(rec.hours) && rec.hours.length === 24 ? rec.hours : base.hours,
    hoursAi: Array.isArray(rec.hoursAi) && rec.hoursAi.length === 24 ? rec.hoursAi : base.hoursAi,
  };
}

export async function allDayKeys() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('d:')).map((k) => k.slice(2)).sort();
}

export async function getMeta() {
  const { meta } = await chrome.storage.local.get('meta');
  return meta || { installedAt: Date.now() };
}

export async function exportAll() {
  const all = await chrome.storage.local.get(null);
  return {
    exportedAt: new Date().toISOString(),
    app: 'Wattch',
    note: 'Everything Wattch has ever stored. Times are in seconds. Site names are hostnames only, never full URLs or page content.',
    data: all,
  };
}

export async function deleteAll() {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.clear();
  // keep the user's settings, everything else is gone
  await chrome.storage.local.set({ settings: settings || DEFAULT_SETTINGS, meta: { installedAt: Date.now() } });
}

/** Number of prompts for one site record { net, page, manual }. */
export function promptTotal(p) {
  if (!p) return 0;
  return (p.net || 0) + (p.page || 0) + (p.manual || 0);
}

/**
 * Turns a raw day record into everything the UI needs.
 */
export function summarizeDay(day, settings) {
  const custom = settings.customAiDomains || [];
  const ignored = settings.ignoredDomains || [];
  let activeSec = 0;
  let aiSec = 0;
  const ai = new Map();
  const ensure = (site) => {
    if (!ai.has(site.id)) {
      ai.set(site.id, { id: site.id, name: site.name, vendor: site.vendor, sec: 0, prompts: 0, bySource: { net: 0, page: 0, manual: 0 } });
    }
    return ai.get(site.id);
  };
  const topSites = [];
  for (const [host, sec] of Object.entries(day.sites || {})) {
    if (hostMatches(host, ignored)) continue;
    activeSec += sec;
    const site = aiSiteForHost(host, custom);
    if (site) {
      aiSec += sec;
      ensure(site).sec += sec;
    }
    topSites.push({ host, sec, ai: site ? site.name : null });
  }
  topSites.sort((a, b) => b.sec - a.sec);

  let prompts = 0;
  let aiFootprint = emptyFootprint();
  for (const [id, p] of Object.entries(day.prompts || {})) {
    const site = aiSiteById(id);
    if (!site) continue;
    const row = ensure(site);
    const n = promptTotal(p);
    row.prompts += n;
    row.bySource.net += p.net || 0;
    row.bySource.page += p.page || 0;
    row.bySource.manual += p.manual || 0;
    prompts += n;
  }
  for (const row of ai.values()) {
    row.footprint = promptFootprint(row.prompts, row.vendor);
    aiFootprint = addFootprints(aiFootprint, row.footprint);
  }
  const aiBySite = [...ai.values()].sort((a, b) => b.prompts - a.prompts || b.sec - a.sec);

  return {
    activeSec,
    aiSec,
    prompts,
    aiBySite,
    aiFootprint,
    device: deviceFootprint(activeSec, settings),
    topSites,
    hours: day.hours || new Array(24).fill(0),
    hoursAi: day.hoursAi || new Array(24).fill(0),
    focus: day.focus || [],
  };
}

/** Sums several day summaries (for a week, a month...). */
export function sumSummaries(list) {
  const out = { activeSec: 0, aiSec: 0, prompts: 0, aiFootprint: emptyFootprint(), deviceWh: 0, deviceCo2: 0, days: list.length };
  for (const s of list) {
    out.activeSec += s.activeSec;
    out.aiSec += s.aiSec;
    out.prompts += s.prompts;
    out.aiFootprint = addFootprints(out.aiFootprint, s.aiFootprint);
    out.deviceWh += s.device.energyWh;
    out.deviceCo2 += s.device.co2g;
  }
  return out;
}

/**
 * Days in a row, ending yesterday, where browsing stayed under the daily goal.
 * Today counts too once it is under goal *and* over. Days with no use count as under goal.
 * The streak never goes back before the install date.
 */
export function computeStreak(summaryByDay, settings, installedAt, today = dayKey()) {
  const goal = settings.dailyGoalMinutes * 60;
  if (!goal) return { streak: 0, todayOk: true };
  const first = dayKey(installedAt || Date.now());
  let streak = 0;
  let k = addDays(today, -1);
  while (k >= first) {
    const s = summaryByDay[k];
    if (s === undefined) break; // not loaded: stop counting
    if (s.activeSec > goal) break;
    streak++;
    k = addDays(k, -1);
  }
  const t = summaryByDay[today];
  return { streak, todayOk: !t || t.activeSec <= goal };
}
