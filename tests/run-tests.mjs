// Run with:  node tests/run-tests.mjs
// Tests the tracking engine (service worker) against a fake chrome API with a fake clock,
// plus the footprint maths. No dependencies needed.

import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';

const { chrome, world, emit } = createFakeChrome();
globalThis.chrome = chrome;

let NOW = new Date(2026, 10, 14, 10, 0, 0).getTime(); // 14 Nov 2026, 10:00 local
Date.now = () => NOW;

const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const tick = async (sec) => { NOW += sec * 1000; await emit('alarms.onAlarm', { name: 'tick' }); await settle(); };
const DAY = 'd:2026-11-14';
const day = async (k = DAY) => (await chrome.storage.local.get(k))[k];
const msg = async (m, url = 'https://example.org/') => {
  let out;
  await emit('runtime.onMessage', m, { tab: { url } }, (r) => { out = r; });
  await settle();
  return out;
};
const setSettings = async (patch) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  await msg({ type: 'settings-changed' });
};

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

await import('../src/background.js');
await settle();
await emit('runtime.onInstalled', { reason: 'update' });
await settle();

console.log('Tracking engine');

await test('counts active time on the focused tab', async () => {
  for (let i = 0; i < 10; i++) await tick(30);
  assert.equal(Math.round((await day()).sites['example.org']), 300);
});

await test('stops counting when Chrome is not in focus', async () => {
  world.focused = false;
  await emit('windows.onFocusChanged', -1);
  await settle();
  for (let i = 0; i < 4; i++) await tick(30);
  assert.equal(Math.round((await day()).sites['example.org']), 300);
});

await test('takes back the idle-detection seconds when the user goes idle', async () => {
  world.focused = true;
  await emit('windows.onFocusChanged', 10);
  await settle();
  await tick(30);
  await tick(30);
  NOW += 30 * 1000;
  world.idle = 'idle';
  await emit('idle.onStateChanged', 'idle');
  await settle();
  // 300 + 90 counted, minus the 60 s idle threshold that was not really active
  assert.equal(Math.round((await day()).sites['example.org']), 330);
  for (let i = 0; i < 3; i++) await tick(30);
  assert.equal(Math.round((await day()).sites['example.org']), 330);
});

await test('keeps counting a tab that plays sound while the user is idle', async () => {
  world.tab.audible = true;
  await emit('tabs.onUpdated', 1, { audible: true }, world.tab);
  await settle();
  await tick(30);
  await tick(30);
  assert.equal(Math.round((await day()).sites['example.org']), 390);
});

await test('ignores a long gap (laptop asleep)', async () => {
  world.tab.audible = false;
  world.idle = 'active';
  await emit('idle.onStateChanged', 'active');
  await settle();
  const before = (await day()).sites['example.org'];
  await tick(600);
  assert.equal((await day()).sites['example.org'], before);
});

await test('does not track ignored domains', async () => {
  await setSettings({ ignoredDomains: ['example.org'] });
  const before = (await day()).sites['example.org'];
  await tick(30);
  await tick(30);
  assert.equal((await day()).sites['example.org'], before);
  await setSettings({ ignoredDomains: [] });
});

await test('does not track non-web pages (chrome://, extension pages)', async () => {
  world.tab.url = 'chrome://settings/';
  await emit('tabs.onUpdated', 1, { url: world.tab.url }, world.tab);
  await settle();
  const before = JSON.stringify((await day()).sites);
  await tick(30);
  assert.equal(JSON.stringify((await day()).sites), before);
  world.tab.url = 'https://example.org/page';
  await emit('tabs.onUpdated', 1, { url: world.tab.url }, world.tab);
  await settle();
});

await test('stores only hostnames, never full URLs', async () => {
  world.tab.url = 'https://www.youtube.com/watch?v=secret123&t=10';
  await emit('tabs.onUpdated', 1, { url: world.tab.url }, world.tab);
  await settle();
  await tick(30);
  const raw = JSON.stringify(chrome.storage.local._data());
  assert.ok(raw.includes('www.youtube.com'));
  assert.ok(!raw.includes('secret123'));
  assert.ok(!raw.includes('watch'));
  world.tab.url = 'https://example.org/page';
  await emit('tabs.onUpdated', 1, { url: world.tab.url }, world.tab);
  await settle();
});

console.log('Reminders and focus');

await test('shows a reminder after the chosen interval of active use', async () => {
  await setSettings({ reminderMinutes: 5 });
  const { reminder } = await chrome.storage.local.get('reminder');
  await chrome.storage.local.set({ reminder: { ...reminder, activeSec: 0 } });
  world.notifications.length = 0;
  for (let i = 0; i < 9; i++) await tick(30); // 4.5 min
  assert.equal(world.notifications.filter((n) => n.id === 'wattch-reminder').length, 0);
  await tick(30); // 5 min
  await tick(30);
  assert.equal(world.notifications.filter((n) => n.id === 'wattch-reminder').length, 1);
});

await test('a real break (idle ≥ 5 min) resets the reminder clock', async () => {
  for (let i = 0; i < 4; i++) await tick(30); // 2 min active
  world.idle = 'idle';
  await emit('idle.onStateChanged', 'idle');
  await settle();
  for (let i = 0; i < 11; i++) await tick(30); // 5.5 min idle
  const { reminder } = await chrome.storage.local.get('reminder');
  assert.equal(reminder.activeSec, 0);
  world.idle = 'active';
  await emit('idle.onStateChanged', 'active');
  await settle();
});

await test('focus session mutes reminders and is saved when it ends', async () => {
  world.notifications.length = 0;
  const f = await msg({ type: 'focus-start', minutes: 25 });
  assert.equal(f.plannedMin, 25);
  for (let i = 0; i < 20; i++) await tick(30); // 10 min, reminder interval is 5
  assert.equal(world.notifications.filter((n) => n.id === 'wattch-reminder').length, 0);
  await emit('alarms.onAlarm', { name: 'focus-end' });
  await settle();
  const d = await day();
  assert.equal(d.focus.length, 1);
  assert.equal(d.focus[0].completed, true);
  assert.ok(d.focus[0].activeSec >= 590 && d.focus[0].activeSec <= 610, `activeSec=${d.focus[0].activeSec}`);
  assert.equal(world.notifications.filter((n) => n.id === 'wattch-focus').length, 1);
  await setSettings({ reminderMinutes: 60 });
});

console.log('AI prompts');

const CHAT = 'https://chatgpt.com/c/abc';
const postChat = async () => {
  await emit('webRequest.onBeforeRequest', { method: 'POST', url: 'https://chatgpt.com/backend-api/f/conversation', tabId: 3 });
  await settle();
};

await test('page detector counts a prompt', async () => {
  const r = await msg({ type: 'prompt-page' }, CHAT);
  assert.equal(r.counted, true);
  assert.deepEqual((await day()).prompts.chatgpt, { net: 0, page: 1, manual: 0 });
});

await test('the same prompt seen by the network detector is not counted twice', async () => {
  NOW += 1000;
  await postChat();
  assert.deepEqual((await day()).prompts.chatgpt, { net: 0, page: 1, manual: 0 });
});

await test('network detector counts the next prompt; page detector then steps aside', async () => {
  NOW += 20000;
  await msg({ type: 'prompt-page' }, CHAT); // ignored: network detector is known to work here
  await postChat();
  assert.deepEqual((await day()).prompts.chatgpt, { net: 1, page: 1, manual: 0 });
});

await test('other requests to the same site are not prompts', async () => {
  NOW += 20000;
  await emit('webRequest.onBeforeRequest', { method: 'POST', url: 'https://chatgpt.com/backend-api/conversation/gen_title/abc', tabId: 3 });
  await emit('webRequest.onBeforeRequest', { method: 'GET', url: 'https://chatgpt.com/backend-api/conversation', tabId: 3 });
  await settle();
  assert.deepEqual((await day()).prompts.chatgpt, { net: 1, page: 1, manual: 0 });
});

await test('manual +1 and −1', async () => {
  await msg({ type: 'prompt-manual', siteId: 'gemini' }, 'chrome-extension://test/popup.html');
  await msg({ type: 'prompt-manual', siteId: 'gemini' }, 'chrome-extension://test/popup.html');
  await msg({ type: 'prompt-undo', siteId: 'gemini' }, 'chrome-extension://test/popup.html');
  assert.deepEqual((await day()).prompts.gemini, { net: 0, page: 0, manual: 1 });
});

await test('prompts on non-AI sites are ignored', async () => {
  const r = await msg({ type: 'prompt-page' }, 'https://example.org/');
  assert.equal(r.counted, false);
});

console.log('Footprint maths');

const { promptFootprint, deviceFootprint, comparisons } = await import('../src/lib/footprint.js');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

await test('Gemini prompt uses Google\'s published figures (0.24 Wh, 0.03 g, 0.26 mL)', async () => {
  const f = promptFootprint(1, 'google');
  close(f.energyWh.mid, 0.24);
  close(f.co2g.mid, 0.03);
  close(f.waterMl.mid, 0.26);
});

await test('ChatGPT prompt uses OpenAI\'s figures (0.34 Wh, 0.32 mL)', async () => {
  const f = promptFootprint(1, 'openai');
  close(f.energyWh.mid, 0.34);
  close(f.waterMl.mid, 0.32);
});

await test('range is low ≤ mid ≤ high for every vendor', async () => {
  for (const v of ['google', 'openai', 'other']) {
    const f = promptFootprint(10, v);
    for (const k of ['energyWh', 'co2g', 'waterMl']) {
      assert.ok(f[k].low <= f[k].mid && f[k].mid <= f[k].high, `${v} ${k}`);
    }
  }
});

await test('laptop: 1 h at 15 W on the Dutch grid = 15 Wh, 4.02 g', async () => {
  const d = deviceFootprint(3600, { laptopWatts: 15, gridId: 'NL' });
  close(d.energyWh, 15);
  close(d.co2g, (15 * 268) / 1000);
});

await test('comparisons: 15 Wh = 1 phone charge', async () => {
  assert.equal(comparisons(15, 5)[0].big, '1');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
