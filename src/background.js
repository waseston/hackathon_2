// Wattch service worker: the tracking engine.
//
// What it does:
//   - counts ACTIVE time per website: only while a Chrome window has focus, the
//     user is not idle and the page is a normal http(s) page;
//   - counts AI prompts (see sites.js and content/ai-content.js);
//   - shows a reminder after N minutes of active use;
//   - runs focus sessions.
//
// What it stores: hostnames (e.g. "chatgpt.com"), seconds and counters. Never full
// URLs, page titles, page content or what you type. Everything is in
// chrome.storage.local on this computer. Wattch makes no network calls at all.

import { NET_URL_FILTERS, aiSiteForHost, aiSiteById, trackableHost, hostMatches } from './lib/sites.js';
import { getSettings, getDay, setDay, summarizeDay, allDayKeys, promptTotal, DEFAULT_SETTINGS } from './lib/store.js';
import { dayKey, addDays } from './lib/dates.js';
import { fmtBadge, fmtDuration, fmtEnergy } from './lib/format.js';
import { promptFootprint } from './lib/footprint.js';

const TICK_ALARM = 'tick';
const FOCUS_ALARM = 'focus-end';
const CLEANUP_ALARM = 'cleanup';
const TICK_MINUTES = 0.5;      // flush time to storage every 30 s
const MAX_GAP_SEC = 150;       // a longer gap means the laptop slept or Chrome froze: count nothing
const DEDUPE_MS = 5000;        // two detections of the same prompt within 5 s count once
const NET_HEALTHY_MS = 2 * 24 * 3600 * 1000; // network detector seen recently = trust it over the page detector
const SNOOZE_MIN = 15;
const ICON = chrome.runtime.getURL('icons/icon128.png');

// ---------------------------------------------------------------------------
// A tiny queue so storage read-modify-write steps never overlap.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch((err) => console.warn('[Wattch]', err));
  return run;
}

// Runtime state lives in chrome.storage.session so it survives the service worker
// being stopped and restarted by Chrome. It is wiped when Chrome closes.
async function getRt() {
  const { rt } = await chrome.storage.session.get('rt');
  return rt || null;
}
async function setRt(rt) {
  await chrome.storage.session.set({ rt });
}
async function getReminder() {
  const { reminder } = await chrome.storage.local.get('reminder');
  return { activeSec: 0, idleSec: 0, snoozeUntil: 0, lastShownAt: 0, ...(reminder || {}) };
}
async function saveReminder(reminder) {
  await chrome.storage.local.set({ reminder });
}
async function getFocus() {
  const { focus } = await chrome.storage.local.get('focus');
  return focus && focus.active ? focus : null;
}

// ---------------------------------------------------------------------------
// Time tracking

function isCounting(rt, settings) {
  if (!rt || !rt.host || !rt.windowFocused) return false;
  if (rt.idleState === 'active') return true;
  // Watching a lecture or a video: no keyboard or mouse, but the tab plays sound.
  return settings.countMedia && rt.audible && rt.idleState === 'idle';
}

/** Reads what the browser is doing right now. */
async function readBrowserState(settings, idleOverride) {
  let win = null;
  try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal', 'popup'] }); } catch { /* no windows */ }
  let tab = null;
  if (win) {
    const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
    tab = tabs[0] || null;
  }
  const idleState = idleOverride || (await chrome.idle.queryState(Math.max(15, settings.idleSeconds)));
  let host = trackableHost(tab && tab.url);
  if (host && hostMatches(host, settings.ignoredDomains)) host = null;
  return {
    host,
    windowFocused: !!(win && win.focused),
    idleState,
    audible: !!(tab && tab.audible),
    incognito: !!(tab && tab.incognito),
  };
}

/** Adds `sec` seconds of active time to `host`. */
async function addActiveTime(host, sec, now, settings) {
  const key = dayKey(now);
  const day = await getDay(key);
  const h = new Date(now).getHours();
  day.sites[host] = (day.sites[host] || 0) + sec;
  day.hours[h] += sec;
  if (aiSiteForHost(host, settings.customAiDomains)) day.hoursAi[h] += sec;
  await setDay(key, day);

  const focus = await getFocus();
  if (focus) {
    focus.activeSec += sec;
    focus.sites[host] = (focus.sites[host] || 0) + sec;
    await chrome.storage.local.set({ focus });
  }
}

/**
 * Chrome only reports "idle" after `idleSeconds` without input. Those seconds were
 * already counted as active, so we take them back when the user goes idle.
 */
async function trimIdleTail(rt, settings, now) {
  const trim = Math.min(settings.idleSeconds, rt.runSec || 0);
  if (trim <= 0 || !rt.host) return 0;
  const key = dayKey(now);
  const day = await getDay(key);
  if (!day.sites[rt.host]) return 0;
  const t = Math.min(trim, day.sites[rt.host]);
  day.sites[rt.host] -= t;
  const h = new Date(now).getHours();
  day.hours[h] = Math.max(0, day.hours[h] - t);
  if (aiSiteForHost(rt.host, settings.customAiDomains)) day.hoursAi[h] = Math.max(0, day.hoursAi[h] - t);
  await setDay(key, day);
  const focus = await getFocus();
  if (focus) {
    focus.activeSec = Math.max(0, focus.activeSec - t);
    if (focus.sites[rt.host]) focus.sites[rt.host] = Math.max(0, focus.sites[rt.host] - t);
    await chrome.storage.local.set({ focus });
  }
  return t;
}

/** Books the time since the last check, then reads the new browser state. */
async function refresh(idleOverride) {
  const now = Date.now();
  const settings = await getSettings();
  const prev = await getRt();
  const next = await readBrowserState(settings, idleOverride);
  next.lastTs = now;
  next.runSec = 0;

  const reminder = await getReminder();
  if (prev && prev.lastTs) {
    const sec = (now - prev.lastTs) / 1000;
    if (sec > MAX_GAP_SEC) {
      // Laptop was asleep or Chrome was frozen: count nothing, and treat it as a break.
      reminder.activeSec = 0;
      reminder.idleSec = 0;
    } else if (sec > 0) {
      const counting = isCounting(prev, settings);
      if (counting) {
        await addActiveTime(prev.host, sec, now, settings);
        reminder.activeSec += sec;
        reminder.idleSec = 0;
        // keep a run counter while nothing changes, for trimIdleTail()
        if (prev.host === next.host && prev.idleState === next.idleState && prev.windowFocused === next.windowFocused) {
          next.runSec = (prev.runSec || 0) + sec;
        }
      } else if (prev.idleState !== 'active') {
        reminder.idleSec += sec;
        if (reminder.idleSec >= settings.breakMinutes * 60) reminder.activeSec = 0;
      }
      // Just went idle (and no sound playing): remove the idle tail we counted.
      const wentIdle = prev.idleState === 'active' && next.idleState !== 'active';
      if (wentIdle && counting && !(settings.countMedia && next.audible && next.idleState === 'idle')) {
        const t = await trimIdleTail({ ...prev, runSec: (prev.runSec || 0) + sec }, settings, now);
        reminder.activeSec = Math.max(0, reminder.activeSec - t);
        reminder.idleSec += t;
      }
    }
  }
  await maybeRemind(reminder, now, settings);
  await saveReminder(reminder);
  await setRt(next);
  await updateBadge(settings);
}

// ---------------------------------------------------------------------------
// Reminders

async function maybeRemind(reminder, now, settings) {
  if (!settings.remindersEnabled) return;
  if (await getFocus()) return; // focus sessions mute reminders
  if (reminder.snoozeUntil && now < reminder.snoozeUntil) return;
  if (reminder.activeSec < settings.reminderMinutes * 60) return;
  reminder.activeSec = 0;
  reminder.lastShownAt = now;
  await showReminder(settings, false);
}

async function showReminder(settings, isTest) {
  const s = summarizeDay(await getDay(), settings);
  const minutes = settings.reminderMinutes;
  const ai = s.prompts
    ? ` · ${s.prompts} AI prompt${s.prompts === 1 ? '' : 's'} (≈ ${fmtEnergy(s.aiFootprint.energyWh.mid)})`
    : '';
  await chrome.notifications.create('wattch-reminder', {
    type: 'basic',
    iconUrl: ICON,
    title: isTest ? 'Wattch: this is what a reminder looks like' : `${minutes} minutes of screen time`,
    message: `Time for a short break: stand up, look 20 m away for 20 s. Today: ${fmtDuration(s.activeSec)} in the browser${ai}.`,
    buttons: [{ title: `Remind me in ${SNOOZE_MIN} min` }, { title: 'Open dashboard' }],
    priority: 0,
  });
}

chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id === 'wattch-reminder' && index === 0) {
    serial(async () => {
      const settings = await getSettings();
      const reminder = await getReminder();
      // next reminder after SNOOZE_MIN more minutes of active use
      reminder.activeSec = Math.max(0, settings.reminderMinutes - SNOOZE_MIN) * 60;
      await saveReminder(reminder);
    });
  } else {
    openDashboard(id === 'wattch-focus' ? 'focus' : 'today');
  }
  chrome.notifications.clear(id);
});
chrome.notifications.onClicked.addListener((id) => {
  openDashboard(id === 'wattch-focus' ? 'focus' : 'today');
  chrome.notifications.clear(id);
});

function openDashboard(section = 'today') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/dashboard/dashboard.html#${section}`) });
}

// ---------------------------------------------------------------------------
// Toolbar badge: today's active time, coloured by the daily goal.

async function updateBadge(settings) {
  const focus = await getFocus();
  if (focus) {
    const left = Math.max(0, Math.ceil((focus.endsAt - Date.now()) / 60000));
    await chrome.action.setBadgeBackgroundColor({ color: '#3559c7' });
    await chrome.action.setBadgeText({ text: `${left}m` });
    await chrome.action.setTitle({ title: `Wattch: focus session, ${left} min left` });
    return;
  }
  const s = summarizeDay(await getDay(), settings);
  await chrome.action.setTitle({ title: `Wattch: ${fmtDuration(s.activeSec)} in the browser today, ${s.prompts} AI prompts` });
  if (!settings.showToolbarBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const goal = settings.dailyGoalMinutes * 60;
  const ratio = goal ? s.activeSec / goal : 0;
  const color = ratio >= 1 ? '#c2410c' : ratio >= 0.8 ? '#b7791f' : '#2f7d4f';
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: fmtBadge(s.activeSec) });
}

// ---------------------------------------------------------------------------
// AI prompts

async function countPrompt(siteId, source, now = Date.now()) {
  const site = aiSiteById(siteId);
  if (!site) return { counted: false, reason: 'unknown-site' };

  const { lastPrompt = {}, netSeen = {} } = await chrome.storage.local.get(['lastPrompt', 'netSeen']);
  if (source === 'net') {
    netSeen[siteId] = now;
    await chrome.storage.local.set({ netSeen });
  }
  if (source === 'page' && site.net && netSeen[siteId] && now - netSeen[siteId] < NET_HEALTHY_MS) {
    // The network detector works on this site and is more exact. Let it do the counting.
    return { counted: false, reason: 'network-detector-active' };
  }
  if (source !== 'manual' && lastPrompt[siteId] && now - lastPrompt[siteId] < DEDUPE_MS) {
    return { counted: false, reason: 'duplicate' };
  }
  if (source !== 'manual') {
    lastPrompt[siteId] = now;
    await chrome.storage.local.set({ lastPrompt });
  }

  const key = dayKey(now);
  const day = await getDay(key);
  const p = day.prompts[siteId] || { net: 0, page: 0, manual: 0 };
  p[source] = (p[source] || 0) + 1;
  day.prompts[siteId] = p;
  await setDay(key, day);

  const focus = await getFocus();
  if (focus) {
    focus.prompts += 1;
    await chrome.storage.local.set({ focus });
  }
  const settings = await getSettings();
  await checkPromptGoal(day, settings);
  return { counted: true };
}

async function undoPrompt(siteId) {
  const key = dayKey();
  const day = await getDay(key);
  const p = day.prompts[siteId];
  if (!p || promptTotal(p) === 0) return { ok: false };
  for (const src of ['manual', 'page', 'net']) {
    if (p[src] > 0) { p[src] -= 1; break; }
  }
  await setDay(key, day);
  return { ok: true };
}

async function checkPromptGoal(day, settings) {
  const goal = settings.dailyPromptGoal;
  if (!goal) return;
  let total = 0;
  for (const p of Object.values(day.prompts)) total += promptTotal(p);
  if (total === goal) {
    await chrome.notifications.create('wattch-goal', {
      type: 'basic',
      iconUrl: ICON,
      title: `You reached your AI goal: ${goal} prompts today`,
      message: 'Tip: one clear, complete prompt often saves three follow-ups.',
      priority: 0,
    });
  }
}

// Network detector: notices that the page sent a request to the "send prompt"
// endpoint. Only method and URL are looked at. Request bodies are never requested
// (no "requestBody" option), so the text you typed is not visible to this code.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST' || details.tabId < 0) return;
    let u;
    try { u = new URL(details.url); } catch { return; }
    const site = aiSiteForHost(u.hostname);
    if (!site || !site.net || !site.net.some((re) => re.test(u.pathname))) return;
    serial(() => countPrompt(site.id, 'net', Date.now()));
  },
  { urls: NET_URL_FILTERS, types: ['xmlhttprequest', 'other'] },
);

// ---------------------------------------------------------------------------
// Focus sessions

async function startFocus(minutes) {
  const m = Math.max(5, Math.min(180, Math.round(Number(minutes) || 25)));
  await refresh();
  const now = Date.now();
  const focus = { active: true, startedAt: now, plannedMin: m, endsAt: now + m * 60000, activeSec: 0, prompts: 0, sites: {} };
  await chrome.storage.local.set({ focus });
  await chrome.alarms.create(FOCUS_ALARM, { when: focus.endsAt });
  await updateBadge(await getSettings());
  return focus;
}

async function endFocus(completed) {
  const focus = await getFocus();
  if (!focus) return null;
  await refresh(); // book the last seconds first
  const f = (await getFocus()) || focus;
  const now = Date.now();
  const top = Object.entries(f.sites).sort((a, b) => b[1] - a[1])[0];
  const record = {
    startedAt: f.startedAt,
    endedAt: now,
    plannedMin: f.plannedMin,
    activeSec: Math.round(f.activeSec),
    prompts: f.prompts,
    topSite: top ? top[0] : null,
    completed: !!completed,
  };
  const key = dayKey(f.startedAt);
  const day = await getDay(key);
  day.focus.push(record);
  await setDay(key, day);
  await chrome.storage.local.set({ focus: null });
  await chrome.alarms.clear(FOCUS_ALARM);
  const reminder = await getReminder();
  reminder.activeSec = 0; // a finished focus block starts a fresh reminder interval
  await saveReminder(reminder);
  await updateBadge(await getSettings());
  if (completed) {
    await chrome.notifications.create('wattch-focus', {
      type: 'basic',
      iconUrl: ICON,
      title: `Focus session done: ${f.plannedMin} min`,
      message: `Active in the browser: ${fmtDuration(record.activeSec)}${record.topSite ? `, mostly on ${record.topSite}` : ''}. AI prompts: ${record.prompts}. Take a break!`,
      priority: 1,
    });
  }
  return record;
}

// ---------------------------------------------------------------------------
// Housekeeping

async function ensureAlarms() {
  if (!(await chrome.alarms.get(TICK_ALARM))) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
  }
  if (!(await chrome.alarms.get(CLEANUP_ALARM))) {
    await chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
  }
}

async function applySettings() {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, settings.idleSeconds));
  await updateBadge(settings);
}

async function cleanup() {
  const settings = await getSettings();
  const keep = Math.max(7, settings.retentionDays || 90);
  const oldest = addDays(dayKey(), -keep);
  const old = (await allDayKeys()).filter((k) => k < oldest).map((k) => `d:${k}`);
  if (old.length) await chrome.storage.local.remove(old);
}

async function init(reason) {
  const { settings, meta } = await chrome.storage.local.get(['settings', 'meta']);
  const patch = {};
  if (!settings) patch.settings = DEFAULT_SETTINGS;
  if (!meta) patch.meta = { installedAt: Date.now() };
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await ensureAlarms();
  await applySettings();
  await refresh();
  if (reason === 'install') openDashboard('welcome');
}

chrome.runtime.onInstalled.addListener((details) => serial(() => init(details.reason)));
chrome.runtime.onStartup.addListener(() => serial(() => init('startup')));

// Browser events that change what we should be counting.
chrome.tabs.onActivated.addListener(() => serial(() => refresh()));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!tab.active) return;
  if (change.url !== undefined || change.audible !== undefined || change.status === 'complete') {
    serial(() => refresh());
  }
});
chrome.windows.onFocusChanged.addListener(() => serial(() => refresh()));
chrome.idle.onStateChanged.addListener((state) => serial(() => refresh(state)));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) serial(() => refresh());
  else if (alarm.name === FOCUS_ALARM) serial(() => endFocus(true));
  else if (alarm.name === CLEANUP_ALARM) serial(() => cleanup());
});

// Messages from the popup, the dashboard and the AI-site content script.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fromHost = trackableHost((sender.tab && sender.tab.url) || sender.url);
  const handle = async () => {
    const settings = await getSettings();
    switch (msg && msg.type) {
      case 'prompt-page': {
        const site = aiSiteForHost(fromHost, settings.customAiDomains);
        return site ? countPrompt(site.id, 'page') : { counted: false };
      }
      case 'prompt-manual': {
        const site = msg.siteId ? aiSiteById(msg.siteId) : aiSiteForHost(fromHost, settings.customAiDomains);
        return site ? countPrompt(site.id, 'manual') : { counted: false };
      }
      case 'prompt-undo': {
        const site = msg.siteId ? aiSiteById(msg.siteId) : aiSiteForHost(fromHost, settings.customAiDomains);
        return site ? undoPrompt(site.id) : { ok: false };
      }
      case 'site-summary': {
        const site = aiSiteForHost(fromHost, settings.customAiDomains);
        if (!site) return null;
        const s = summarizeDay(await getDay(), settings);
        const row = s.aiBySite.find((r) => r.id === site.id);
        const prompts = row ? row.prompts : 0;
        const fp = promptFootprint(prompts, site.vendor);
        return {
          show: settings.showPageBadge,
          siteName: site.name,
          prompts,
          energyWh: fp.energyWh,
          co2g: fp.co2g,
          waterMl: fp.waterMl,
          allPrompts: s.prompts,
          allEnergyWh: s.aiFootprint.energyWh,
        };
      }
      case 'state': {
        await refresh();
        return {
          rt: await getRt(),
          counting: isCounting(await getRt(), settings),
          reminder: await getReminder(),
          focus: await getFocus(),
        };
      }
      case 'focus-start':
        return startFocus(msg.minutes || settings.focusMinutes);
      case 'focus-stop':
        return endFocus(false);
      case 'settings-changed':
        await applySettings();
        await refresh();
        return { ok: true };
      case 'reminder-test':
        await showReminder(settings, true);
        return { ok: true };
      case 'data-deleted':
        await chrome.storage.session.clear();
        await refresh();
        return { ok: true };
      default:
        return null;
    }
  };
  serial(handle).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true; // async response
});

// Every time the service worker wakes up.
serial(async () => {
  await ensureAlarms();
  await applySettings();
});
