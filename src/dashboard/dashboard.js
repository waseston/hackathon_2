import {
  getSettings, saveSettings, getDays, getMeta, summarizeDay, sumSummaries, computeStreak,
  exportAll, deleteAll, allDayKeys, DEFAULT_SETTINGS,
} from '../lib/store.js';
import { AI_SITES, NET_URL_FILTERS } from '../lib/sites.js';
import { dayKey, addDays, lastNDays, weekStart, weekdayShort, prettyDay, shortDay, parseDayKey } from '../lib/dates.js';
import { fmtDuration, fmtEnergy, fmtCo2, fmtWater, fmtRangeSpan, fmtNum, pctChange } from '../lib/format.js';
import { PROMPT, GRIDS, SOURCES, VENDOR_NOTE, COMPARE, comparisons, gridIntensity, promptFootprint } from '../lib/footprint.js';
import { tipsFor } from '../lib/tips.js';
import { isDemoOn, loadDemo, removeDemo } from '../lib/demo.js';
import { stackedBars, lineChart } from '../shared/charts.js';
import { line, clock, barcode, esc } from '../shared/receipt.js';

const $ = (sel, root = document) => root.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
const SECTIONS = ['welcome', 'today', 'week', 'trends', 'focus', 'method', 'privacy', 'settings'];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let settings = DEFAULT_SETTINGS;
let meta = { installedAt: Date.now() };
let sums = {};
let today = dayKey();
let demo = false;

async function load() {
  settings = await getSettings();
  meta = await getMeta();
  demo = await isDemoOn();
  today = dayKey();
  const keys = lastNDays(70, today);
  const days = await getDays(keys);
  sums = {};
  for (const k of keys) sums[k] = summarizeDay(days[k], settings);
  $('#demoBanner').hidden = !demo;
}

function current() {
  const h = location.hash.replace('#', '');
  return SECTIONS.includes(h) ? h : 'today';
}
async function route() {
  const s = current();
  for (const id of SECTIONS) $(`#s-${id}`).hidden = id !== s;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.s === s));
  await load();
  await RENDER[s]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

const minutes = (sec) => sec / 60;
const minFmt = (v) => (v >= 60 ? `${fmtNum(v / 60, { maxDigits: 1 })}h` : `${Math.round(v)}m`);
function delta(now, before) {
  const p = pctChange(now, before);
  if (p === null) return '<span class="d-flat">new</span>';
  if (Math.abs(p) < 3) return '<span class="d-flat">± 0%</span>';
  return p > 0 ? `<span class="d-up">+${Math.round(p)}%</span>` : `<span class="d-down">−${Math.abs(Math.round(p))}%</span>`;
}
function gridName() {
  const g = GRIDS.find((x) => x.id === settings.gridId);
  return g && g.id !== 'CUSTOM' ? g.name : 'custom grid';
}
const src = (b) => [
  b.net ? `<span class="mini net" title="counted from the site's send request">${b.net} AUTO</span>` : '',
  b.page ? `<span class="mini page" title="counted from Enter / Send">${b.page} PAGE</span>` : '',
  b.manual ? `<span class="mini manual" title="added by you">${b.manual} MANUAL</span>` : '',
].join('');

// ------------------------------------------------------------------ WELCOME
function renderWelcome() {
  $('#s-welcome').innerHTML = `
    <div class="welcome sheet"><div class="paper torn receipt">
      <div class="head"><div class="logo">WATTCH</div><div class="small up muted">welcome · first receipt</div></div>
      <hr class="rule">
      <p>Every day Wattch prints you a <b>receipt</b> for your time online: minutes per website, minutes and prompts on AI, and what that AI use costs in <b>energy, CO₂ and water</b>.</p>
      <div class="steps"><ol>
        <li><b>Pin it.</b> Puzzle icon in the toolbar → pin Wattch. The badge shows today's active time.</li>
        <li><b>Just browse.</b> Time counts only while Chrome is in front and you are not idle. Prompts on ChatGPT, Gemini, Claude and others are counted when sent. Wattch never reads what you type.</li>
        <li><b>Read your receipt.</b> Click the icon any time. Every hour you get a break reminder.</li>
      </ol></div>
      <hr class="rule">
      <div class="secT">TWO QUICK SETTINGS</div>
      <div class="field" style="grid-template-columns:1fr"><label class="t" for="wGoal">Daily browsing limit</label><div class="inline"><input id="wGoal" type="number" min="0" max="1440" step="15" value="${settings.dailyGoalMinutes}"> minutes</div></div>
      <div class="field" style="grid-template-columns:1fr"><label class="t" for="wGrid">Where do you charge your laptop?</label>
        <select id="wGrid">${GRIDS.filter((g) => g.id !== 'CUSTOM').map((g) => `<option value="${g.id}" ${g.id === settings.gridId ? 'selected' : ''}>${g.name} (${g.g} g/kWh)</option>`).join('')}</select></div>
      <hr class="rule double">
      <div class="center small up">No account · no server · 0 bytes sent</div>
      ${barcode('welcome')}
      <button class="btn solid" id="wGo" style="width:100%;margin-top:8px">Print my first receipt →</button>
    </div></div>`;
  $('#wGo').addEventListener('click', async () => {
    await saveSettings({ dailyGoalMinutes: Number($('#wGoal').value) || 0, gridId: $('#wGrid').value });
    await send({ type: 'settings-changed' });
    location.hash = 'today';
  });
}

// ------------------------------------------------------------------ TODAY
function renderToday() {
  const t = sums[today];
  const goal = settings.dailyGoalMinutes * 60;
  const ratio = goal ? t.activeSec / goal : 0;
  const { streak } = computeStreak(sums, settings, meta.installedAt, today);
  const f = t.aiFootprint;
  const cmp = comparisons(f.energyWh.mid, f.waterMl.mid);
  const tips = tipsFor(t, settings, weekCompare());
  const no = Math.max(1, Math.round((Date.now() - meta.installedAt) / 864e5) + 1);
  const totalWh = f.energyWh.mid + t.device.energyWh;

  const receipt = `
    <div class="sheet"><div class="paper torn receipt">
      <div class="head"><div class="logo">WATTCH</div>
        <div class="small up muted">receipt · ${esc(prettyDay(today))}</div>
        <div class="small faint">No.${String(no).padStart(4, '0')} · printed ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></div>
      <hr class="rule">
      <div class="secT">ITEMS</div>
      ${t.topSites.length ? t.topSites.slice(0, 18).map((s) => line(esc(s.host.replace(/^www\./, '')), clock(s.sec), s.ai ? 'ai' : '')).join('') : '<div class="empty">Nothing yet today.</div>'}
      ${t.topSites.length > 18 ? line(`+ ${t.topSites.length - 18} more`, clock(t.topSites.slice(18).reduce((a, b) => a + b.sec, 0)), 'sub') : ''}
      <hr class="rule">
      ${line('<b>BROWSER TIME</b>', `<b>${clock(t.activeSec)}</b>`, 'big')}
      ${line('of which AI', clock(t.aiSec), 'sub')}
      ${goal ? `<div class="meter ${ratio >= 1 ? 'over' : ''}" style="margin:6px 0"><i style="width:${Math.min(100, ratio * 100)}%"></i></div>
        ${line('DAILY LIMIT', clock(goal))}${line(ratio >= 1 ? 'OVER BY' : 'LEFT', clock(Math.abs(goal - t.activeSec)))}` : ''}
      <hr class="rule">
      <div class="secT">AI ASSISTANTS</div>
      ${t.aiBySite.length ? t.aiBySite.map((r) => line(`${esc(r.name)} ×${r.prompts}`, fmtEnergy(r.footprint.energyWh.mid))).join('') : '<div class="empty">No AI use yet.</div>'}
      ${line('<b>PROMPTS</b>', `<b>${t.prompts}</b>`)}
      <hr class="rule">
      ${line('AI ENERGY', fmtEnergy(f.energyWh.mid))}
      ${line('AI CO₂e', fmtCo2(f.co2g.mid))}
      ${line('AI WATER', fmtWater(f.waterMl.mid))}
      ${line(`LAPTOP ${t.device.watts} W`, fmtEnergy(t.device.energyWh))}
      ${line('LAPTOP CO₂e', fmtCo2(t.device.co2g))}
      <hr class="rule double">
      ${line('<b>TOTAL ENERGY</b>', `<b>${fmtEnergy(totalWh)}</b>`, 'big')}
      ${goal ? `<div class="center" style="margin:10px 0 4px"><span class="stamp ${ratio >= 1 ? 'red' : 'green'}">${ratio >= 1 ? 'over limit' : 'within limit'}</span></div>` : ''}
      ${streak ? `<div class="center small up">streak: ${streak} day${streak > 1 ? 's' : ''} within limit</div>` : ''}
      ${barcode(`${today}-${Math.round(t.activeSec / 60)}-${t.prompts}`)}
      <div class="center small up">thank you · keep the receipt</div>
    </div></div>`;

  $('#s-today').innerHTML = `
    <div class="title"><div><h1>Today</h1><div class="sub">${esc(prettyDay(today))}</div></div><div class="small faint" id="updated"></div></div>
    <div class="cols">
      ${receipt}
      <div class="stack">
        <div class="card">
          <h2>The bill for your AI use</h2>
          <p class="cap">${t.prompts} short text prompts today. Big number = middle estimate, small = honest range.</p>
          <div class="bill">
            <div><div class="k">ENERGY</div><div class="v">${fmtEnergy(f.energyWh.mid)}</div><div class="r">${fmtRangeSpan(f.energyWh, fmtEnergy) || '–'}</div></div>
            <div><div class="k">CO₂e</div><div class="v">${fmtCo2(f.co2g.mid)}</div><div class="r">${fmtRangeSpan(f.co2g, fmtCo2) || '–'}</div></div>
            <div><div class="k">WATER</div><div class="v">${fmtWater(f.waterMl.mid)}</div><div class="r">${fmtRangeSpan(f.waterMl, fmtWater) || '–'}</div></div>
          </div>
          <div class="billFoot"><span>+ your laptop: ${fmtEnergy(t.device.energyWh)} · ${fmtCo2(t.device.co2g)} CO₂e (${t.device.watts} W, ${esc(gridName())} grid ${t.device.gridG} g/kWh)</span><a href="#method">How is this calculated? →</a></div>
        </div>
        <div class="card">
          <h2>What that buys in real life</h2>
          <p class="cap">Your AI use today, in things you know.</p>
          <div class="cmp">${cmp.map((c) => `<div><b>${esc(c.big)}</b><span>${esc(c.label)}</span></div>`).join('')}</div>
          <details class="maths"><summary>Show the maths</summary><ul>${cmp.map((c) => `<li>${esc(c.maths)}</li>`).join('')}</ul></details>
        </div>
        <div class="card">
          <div class="title" style="align-items:center"><div><h2>Hour by hour</h2><p class="cap" style="margin:0">Active minutes per hour today.</p></div>
          <div class="legend"><span class="ai"><i></i>AI sites</span><span class="web"><i></i>Other sites</span></div></div>
          <div id="hourChart" style="margin-top:10px"></div>
        </div>
        <div class="card">
          <h2>Coupons</h2>
          <p class="cap">Small savings, based on your own numbers.</p>
          <div class="coupons">${tips.map((x) => `<div class="coupon"><span class="i">${x.icon}</span><div class="h">SAVE</div>${esc(x.text)}</div>`).join('')}</div>
        </div>
        ${t.aiBySite.length ? `<div class="card">
          <h2>AI line items</h2>
          <p class="cap">How each prompt was counted: <span class="mini net">AUTO</span> send request seen, <span class="mini page">PAGE</span> Enter/Send, <span class="mini manual">MANUAL</span> your +1.</p>
          <table><thead><tr><th>Service</th><th>Counted by</th><th class="r">Time</th><th class="r">Prompts</th><th class="r">Energy</th></tr></thead><tbody>
          ${t.aiBySite.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${src(r.bySource) || '–'}</td><td class="r">${clock(r.sec)}</td><td class="r">${r.prompts}</td><td class="r" title="${esc(fmtRangeSpan(r.footprint.energyWh, fmtEnergy))}">${fmtEnergy(r.footprint.energyWh.mid)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td>Total</td><td></td><td class="r">${clock(t.aiSec)}</td><td class="r">${t.prompts}</td><td class="r">${fmtEnergy(f.energyWh.mid)}</td></tr></tfoot></table>
        </div>` : ''}
      </div>
    </div>`;

  const hours = [...Array(24).keys()];
  stackedBars($('#hourChart'), {
    labels: hours.map((h) => String(h).padStart(2, '0')),
    series: [
      { name: 'AI', color: css('--ai'), values: hours.map((h) => minutes(t.hoursAi[h])) },
      { name: 'Other', color: css('--web'), hatch: true, values: hours.map((h) => minutes(Math.max(0, t.hours[h] - t.hoursAi[h]))) },
    ],
    height: 190,
    kind: 'minutes',
    yFormat: (v) => `${Math.round(v)}m`,
    highlight: new Date().getHours(),
    tipFormat: (i) => `${String(i).padStart(2, '0')}:00 · ${fmtDuration(t.hours[i])}${t.hoursAi[i] ? ` (AI ${fmtDuration(t.hoursAi[i])})` : ''}`,
    ariaLabel: 'Active minutes per hour today',
  });
  $('#updated').textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ------------------------------------------------------------------ WEEK
function weekCompare() {
  const ws = weekStart(today);
  const daysSoFar = Math.round((parseDayKey(today) - parseDayKey(ws)) / 864e5) + 1;
  const thisKeys = [...Array(daysSoFar).keys()].map((i) => addDays(ws, i));
  const lastKeys = thisKeys.map((k) => addDays(k, -7));
  const pick = (keys) => sumSummaries(keys.map((k) => sums[k]).filter(Boolean));
  return { thisKeys, lastKeys, thisWeek: pick(thisKeys), lastWeek: pick(lastKeys), daysSoFar };
}

function renderWeek() {
  const w = weekCompare();
  const a = w.thisWeek;
  const b = w.lastWeek;
  const goal = settings.dailyGoalMinutes;
  const within = w.thisKeys.filter((k) => !goal || sums[k].activeSec <= goal * 60).length;
  const fortnight = lastNDays(14, today);
  const rows = [
    ['Browser time', clock(a.activeSec), clock(b.activeSec), delta(a.activeSec, b.activeSec)],
    ['Time on AI sites', clock(a.aiSec), clock(b.aiSec), delta(a.aiSec, b.aiSec)],
    ['AI prompts', a.prompts, b.prompts, delta(a.prompts, b.prompts)],
    ['AI energy', fmtEnergy(a.aiFootprint.energyWh.mid), fmtEnergy(b.aiFootprint.energyWh.mid), delta(a.aiFootprint.energyWh.mid, b.aiFootprint.energyWh.mid)],
    ['AI CO₂e', fmtCo2(a.aiFootprint.co2g.mid), fmtCo2(b.aiFootprint.co2g.mid), delta(a.aiFootprint.co2g.mid, b.aiFootprint.co2g.mid)],
    ['AI water', fmtWater(a.aiFootprint.waterMl.mid), fmtWater(b.aiFootprint.waterMl.mid), delta(a.aiFootprint.waterMl.mid, b.aiFootprint.waterMl.mid)],
    ['Laptop energy', fmtEnergy(a.deviceWh), fmtEnergy(b.deviceWh), delta(a.deviceWh, b.deviceWh)],
  ];
  $('#s-week').innerHTML = `
    <div class="title"><div><h1>Weekly statement</h1><div class="sub">Monday ${shortDay(w.thisKeys[0])} to today, against the same ${w.daysSoFar} day${w.daysSoFar > 1 ? 's' : ''} last week.</div></div>
      <span class="stamp ${a.activeSec <= b.activeSec ? 'green' : 'red'} bigstamp">${a.activeSec <= b.activeSec ? 'less than last week' : 'more than last week'}</span></div>
    <div class="kpis">
      <div><div class="k">AVG PER DAY</div><div class="v">${clock(a.activeSec / w.daysSoFar)}</div><div class="s">in the browser</div></div>
      <div><div class="k">AI PROMPTS</div><div class="v">${a.prompts}</div><div class="s">${delta(a.prompts, b.prompts)} vs ${b.prompts} last week</div></div>
      <div><div class="k">AI ENERGY</div><div class="v">${fmtEnergy(a.aiFootprint.energyWh.mid)}</div><div class="s">${fmtRangeSpan(a.aiFootprint.energyWh, fmtEnergy) || '–'}</div></div>
      <div><div class="k">DAYS WITHIN LIMIT</div><div class="v">${goal ? `${within}/${w.daysSoFar}` : '–'}</div><div class="s">${goal ? `limit ${clock(goal * 60)} a day` : 'set a limit in settings'}</div></div>
    </div>
    <div class="cols2">
      <div class="card">
        <h2>Statement</h2><p class="cap">Red = more than last week. Green = less.</p>
        <table><thead><tr><th></th><th class="r">This week</th><th class="r">Last week</th><th class="r">Change</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td class="r"><b>${r[1]}</b></td><td class="r muted">${r[2]}</td><td class="r">${r[3]}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="card">
        <h2>Day by day</h2><p class="cap">Each day's receipt, in one line.</p>
        <table><thead><tr><th>Day</th><th class="r">Browser</th><th class="r">AI</th><th class="r">Prompts</th><th class="r">Limit</th></tr></thead>
        <tbody>${[...w.thisKeys].reverse().map((k) => {
          const s = sums[k];
          const ok = !goal || s.activeSec <= goal * 60;
          return `<tr><td>${weekdayShort(k).toUpperCase()} ${shortDay(k)}${k === today ? ' ·today' : ''}</td><td class="r">${clock(s.activeSec)}</td><td class="r">${clock(s.aiSec)}</td><td class="r">${s.prompts}</td><td class="r">${goal ? (ok ? '<span class="ok">OK</span>' : '<span class="no">OVER</span>') : '–'}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${clock(a.activeSec)}</td><td class="r">${clock(a.aiSec)}</td><td class="r">${a.prompts}</td><td></td></tr></tfoot></table>
      </div>
    </div>
    <div class="card">
      <div class="title" style="align-items:center"><div><h2>Last 14 days</h2><p class="cap" style="margin:0">Active time per day. Red dashed line = your daily limit.</p></div>
      <div class="legend"><span class="ai"><i></i>AI sites</span><span class="web"><i></i>Other sites</span></div></div>
      <div id="weekChart" style="margin-top:10px"></div>
    </div>`;
  stackedBars($('#weekChart'), {
    labels: fortnight.map((k) => (k === today ? 'TODAY' : `${weekdayShort(k).toUpperCase()} ${parseDayKey(k).getDate()}`)),
    series: [
      { name: 'AI', color: css('--ai'), values: fortnight.map((k) => minutes(sums[k].aiSec)) },
      { name: 'Other', color: css('--web'), hatch: true, values: fortnight.map((k) => minutes(sums[k].activeSec - sums[k].aiSec)) },
    ],
    height: 230, kind: 'minutes', goal: goal || null, goalLabel: goal ? `LIMIT ${clock(goal * 60)}` : '',
    yFormat: minFmt, highlight: fortnight.length - 1,
    tipFormat: (i) => { const s = sums[fortnight[i]]; return `${prettyDay(fortnight[i])}<br>${fmtDuration(s.activeSec)} · AI ${fmtDuration(s.aiSec)} · ${s.prompts} prompts`; },
    ariaLabel: 'Active time per day, last 14 days',
  });
}

// ------------------------------------------------------------------ TRENDS
function renderTrends() {
  const keys = lastNDays(30, today);
  const list = keys.map((k) => sums[k]);
  const total = sumSummaries(list);
  const used = list.filter((s) => s.activeSec > 0).length || 1;
  const { streak } = computeStreak(sums, settings, meta.installedAt, today);
  const fA = sumSummaries(keys.slice(0, 15).map((k) => sums[k]));
  const fB = sumSummaries(keys.slice(15).map((k) => sums[k]));
  $('#s-trends').innerHTML = `
    <div class="title"><div><h1>Trends</h1><div class="sub">30 days of receipts. How is it changing?</div></div>
      ${streak ? `<span class="stamp green bigstamp">${streak}-day streak</span>` : ''}</div>
    <div class="kpis">
      <div><div class="k">AVERAGE DAY</div><div class="v">${clock(total.activeSec / used)}</div><div class="s">over ${used} day${used > 1 ? 's' : ''} with use</div></div>
      <div><div class="k">PROMPTS · 30 DAYS</div><div class="v">${total.prompts}</div><div class="s">last 15 days vs 15 before: ${delta(fB.prompts, fA.prompts)}</div></div>
      <div><div class="k">AI ENERGY · 30 DAYS</div><div class="v">${fmtEnergy(total.aiFootprint.energyWh.mid)}</div><div class="s">${fmtRangeSpan(total.aiFootprint.energyWh, fmtEnergy) || '–'}</div></div>
      <div><div class="k">AI WATER · 30 DAYS</div><div class="v">${fmtWater(total.aiFootprint.waterMl.mid)}</div><div class="s">≈ ${fmtNum(total.aiFootprint.waterMl.mid / COMPARE.glassMl)} glasses of water</div></div>
    </div>
    <div class="card">
      <div class="title" style="align-items:center"><div><h2>Browser time per day</h2><p class="cap" style="margin:0">With your daily limit.</p></div>
      <div class="legend"><span class="ai"><i></i>AI sites</span><span class="web"><i></i>Other sites</span></div></div>
      <div id="tTime" style="margin-top:10px"></div>
    </div>
    <div class="card">
      <h2>AI energy per day</h2>
      <p class="cap">Line = middle estimate. Shaded band = low to high. Nobody knows the exact number, so we print the whole range.</p>
      <div id="tEnergy"></div>
    </div>`;
  const goal = settings.dailyGoalMinutes;
  stackedBars($('#tTime'), {
    labels: keys.map((k) => `${parseDayKey(k).getDate()}`),
    series: [
      { name: 'AI', color: css('--ai'), values: keys.map((k) => minutes(sums[k].aiSec)) },
      { name: 'Other', color: css('--web'), hatch: true, values: keys.map((k) => minutes(sums[k].activeSec - sums[k].aiSec)) },
    ],
    height: 230, kind: 'minutes', goal: goal || null, goalLabel: goal ? 'LIMIT' : '', yFormat: minFmt, highlight: keys.length - 1,
    tipFormat: (i) => `${prettyDay(keys[i])}<br>${fmtDuration(sums[keys[i]].activeSec)} · AI ${fmtDuration(sums[keys[i]].aiSec)}`,
    ariaLabel: 'Browser time per day, last 30 days',
  });
  lineChart($('#tEnergy'), {
    labels: keys.map((k) => `${parseDayKey(k).getDate()}`),
    series: [{
      name: 'AI energy', color: css('--ink'),
      values: keys.map((k) => sums[k].aiFootprint.energyWh.mid),
      band: { low: keys.map((k) => sums[k].aiFootprint.energyWh.low), high: keys.map((k) => sums[k].aiFootprint.energyWh.high) },
    }],
    height: 210, yFormat: (v) => `${fmtNum(v)} Wh`,
    tipFormat: (i) => { const s = sums[keys[i]]; return `${prettyDay(keys[i])}<br>${s.prompts} prompts · ${fmtEnergy(s.aiFootprint.energyWh.mid)} (${fmtRangeSpan(s.aiFootprint.energyWh, fmtEnergy) || '0'})`; },
    ariaLabel: 'AI energy per day with uncertainty band',
  });
}

// ------------------------------------------------------------------ FOCUS
async function renderFocus() {
  const state = await send({ type: 'state' });
  const running = state && state.focus;
  const sessions = lastNDays(30, today).flatMap((k) => sums[k].focus.map((f) => ({ ...f, day: k }))).sort((x, y) => y.startedAt - x.startedAt);
  const done = sessions.filter((s) => s.completed);
  $('#s-focus').innerHTML = `
    <div class="title"><div><h1>Focus tickets</h1><div class="sub">A study timer. Reminders are muted while it runs, and you get a ticket for each session.</div></div></div>
    <div class="card">
      ${running ? `<div class="inline"><span class="stamp blue bigstamp">${Math.max(0, Math.ceil((running.endsAt - Date.now()) / 60000))} min left</span>
        <span class="muted">${running.plannedMin}-minute session · ${fmtDuration(running.activeSec)} active in the browser · ${running.prompts} prompts</span>
        <button class="btn red" id="fStop">Stop</button></div>`
        : `<div class="inline"><span class="up small muted">Start a session:</span><button class="btn blue" data-min="25">25 min</button><button class="btn blue" data-min="50">50 min</button><button class="btn blue" data-min="90">90 min</button>
           <span class="small faint" style="margin-left:auto">${done.length} completed in 30 days · ${fmtDuration(done.reduce((s, x) => s + x.plannedMin * 60, 0))} of focus</span></div>`}
    </div>
    <div class="tickets">
      ${sessions.length ? sessions.slice(0, 12).map((s) => `<div class="ticket">
        <div class="stub"><span class="small up muted">${weekdayShort(s.day)}</span><b>${s.plannedMin}′</b><span class="small faint">${new Date(s.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="body"><b>${shortDay(s.day).toUpperCase()}</b>
          ${line('Active in browser', fmtDuration(s.activeSec))}${line('AI prompts', s.prompts)}${line('Mostly on', s.topSite ? esc(s.topSite) : '–')}</div>
        <div class="res">${s.completed ? '<span class="stamp green">done</span>' : `<span class="stamp red">stopped ${Math.round((s.endedAt - s.startedAt) / 60000)}′</span>`}</div>
      </div>`).join('') + (sessions.length > 12 ? `<div class="center small faint">+ ${sessions.length - 12} older tickets</div>` : '') : '<div class="card empty">No tickets yet. Start a focus session here or from the receipt popup.</div>'}
    </div>`;
  document.querySelectorAll('#s-focus [data-min]').forEach((b) => b.addEventListener('click', async () => { await send({ type: 'focus-start', minutes: Number(b.dataset.min) }); route(); }));
  const stop = $('#fStop');
  if (stop) stop.addEventListener('click', async () => { await send({ type: 'focus-stop' }); route(); });
}

// ------------------------------------------------------------------ FINE PRINT
function renderMethod() {
  const e = PROMPT.energyWh;
  const w = PROMPT.waterMl;
  const c = PROMPT.dcIntensity;
  const row = (label, v) => {
    const f = promptFootprint(1, v);
    return `<tr><td>${label}</td><td class="r">${fmtNum(f.energyWh.mid)} Wh</td><td class="r">${fmtNum(f.co2g.mid)} g</td><td class="r">${fmtNum(f.waterMl.mid)} mL</td><td>${VENDOR_NOTE[v]}</td></tr>`;
  };
  $('#s-method').innerHTML = `
    <div class="title"><div><h1>The fine print</h1><div class="sub">Every number on your receipt, and where it comes from.</div></div></div>
    <div class="card fine">
      <div class="notice"><b>READ THIS FIRST.</b> Nobody knows exactly what one AI prompt costs. The figures below are the companies' own, not independently checked, and only for short text prompts. Images, files, long answers and "deep research" cost much more. Treat the AI numbers as a lower bound with honest error bars.</div>
      <h2>§1 Time</h2>
      <ol>
        <li>Time is added to a website only while a Chrome window has focus, you are not idle (input in the last ${settings.idleSeconds} s, via Chrome's <code>idle</code> API), and the tab is a normal <code>http(s)</code> page that is not on your ignore list.</li>
        <li>A tab that plays sound (lecture, video) keeps counting while you sit still. This can be switched off.</li>
        <li>Chrome reports "idle" only after ${settings.idleSeconds} s. Those seconds are taken back when you go idle. A sleeping laptop is never counted. Time is saved every 30 s.</li>
      </ol>
      <h2>§2 Prompts</h2>
      <ol>
        <li>${AI_SITES.length} assistants are recognised: ${AI_SITES.map((s) => s.name).join(', ')}, plus any you add.</li>
        <li><b>AUTO</b>: on ChatGPT, Gemini, Claude, Perplexity, DeepSeek and Grok, Wattch notices the page's "send message" request. It sees the method and the address, never the content.</li>
        <li><b>PAGE</b>: elsewhere, Enter in the chat box or a click on Send. The text is never read; only whether Send is enabled.</li>
        <li><b>MANUAL</b>: the +1 / −1 buttons. Two detections within 5 s count once.</li>
      </ol>
      <h2>§3 Price list per prompt</h2>
      <table><thead><tr><th>Assistant</th><th class="r">Energy</th><th class="r">CO₂e</th><th class="r">Water</th><th>Why</th></tr></thead>
        <tbody>${row('Gemini / Google AI', 'google')}${row('ChatGPT', 'openai')}${row('All others', 'other')}</tbody></table>
      <table><thead><tr><th>Range</th><th class="r">Low</th><th class="r">High</th><th>Source</th></tr></thead><tbody>
        <tr><td>Energy</td><td class="r">${e.low} Wh</td><td class="r">${e.high} Wh</td><td>Low: Google, AI chips only. High: OpenAI, average ChatGPT query.</td></tr>
        <tr><td>Water</td><td class="r">${w.low} mL</td><td class="r">${w.high} mL</td><td>Google (Gemini median), OpenAI (ChatGPT average).</td></tr>
        <tr><td>Carbon of the electricity</td><td class="r">${c.low} g/kWh</td><td class="r">${c.high} g/kWh</td><td>Low: Google's 0.03 g ÷ 0.24 Wh (with Google's clean-energy purchases). High: average US grid, Ember 2023. OpenAI gives no carbon figure.</td></tr>
      </tbody></table>
      <h2>§4 Your laptop</h2>
      <p>Energy = active browser time × ${settings.laptopWatts} W (your setting). CO₂e = energy × ${gridIntensity(settings)} g/kWh (${esc(gridName())}, Ember 2023 yearly average). Ordinary websites' servers and the network are not estimated: published numbers differ too much.</p>
      <h2>§5 Comparisons</h2>
      <ul>
        <li>Phone charge ${COMPARE.phoneWh} Wh (4,000 mAh × 3.85 V ≈ 15.4 Wh).</li>
        <li>LED bulb ${COMPARE.ledW} W (≈ an old 60 W bulb).</li>
        <li>1 L of water, 20 → 100 °C: 4.186 kJ/kg·K × 80 K = 335 kJ ≈ ${COMPARE.kettleWh} Wh.</li>
        <li>Teaspoon ${COMPARE.teaspoonMl} mL, glass ${COMPARE.glassMl} mL.</li>
      </ul>
      <h2>§6 Sources</h2>
      <ul>${Object.values(SOURCES).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul>
    </div>`;
}

// ------------------------------------------------------------------ YOUR DATA
async function renderPrivacy() {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const keys = await allDayKeys();
  $('#s-privacy').innerHTML = `
    <div class="title"><div><h1>Your data</h1><div class="sub">No server, no account. This is everything Wattch can see and keeps.</div></div></div>
    <div class="card zero">
      <span class="stamp green bigstamp">0 bytes sent</span>
      <div><b>${fmtNum(bytes / 1024)} KB</b> stored in this browser · ${keys.length} day${keys.length === 1 ? '' : 's'} · kept ${settings.retentionDays} days<br>
      <span class="small muted">There is no network code in Wattch: search the source for <code>fetch(</code> or <code>XMLHttpRequest</code>.</span></div>
    </div>
    <div class="cols2">
      <div class="card">
        <h2>Take it out or wipe it</h2>
        <p class="cap">One click. Settings are kept when you delete.</p>
        <div class="inline"><button class="btn" id="expJson">Export JSON</button><button class="btn" id="expCsv">Export CSV</button><button class="btn red" id="del">Delete all data</button><span class="saved" id="delOk">deleted</span></div>
      </div>
      <div class="card">
        <h2>Demo mode</h2>
        <p class="cap">For a presentation on a fresh install: fills 4 weeks of made-up days. Your real data is set aside and restored when you remove the demo. Time you spend while the demo is on is not kept.</p>
        <div class="inline">${demo ? '<span class="stamp red">demo on</span><button class="btn red" id="demoRemove">Remove demo data</button>' : '<button class="btn" id="demoLoad">Load demo data</button>'}</div>
      </div>
    </div>
    <div class="card">
      <h2>What Wattch can see, and why</h2>
      <table><thead><tr><th>Permission</th><th>Why</th><th>What is stored</th></tr></thead><tbody>
        <tr><td><code>tabs</code></td><td>Which website is in the active tab.</td><td>Hostname only (<code>youtube.com</code>). Never the full address, title or content.</td></tr>
        <tr><td><code>idle</code></td><td>Stop counting when you are away.</td><td>Nothing.</td></tr>
        <tr><td><code>alarms</code></td><td>Save every 30 s, end focus sessions.</td><td>Nothing.</td></tr>
        <tr><td><code>notifications</code></td><td>Break reminder, focus tickets.</td><td>Nothing.</td></tr>
        <tr><td><code>storage</code></td><td>Keep your receipts on this laptop.</td><td>Seconds per hostname, prompt counts, settings.</td></tr>
        <tr><td><code>webRequest</code> + ${NET_URL_FILTERS.length} AI addresses</td><td>Notice that a "send prompt" request happened.</td><td>+1 to a counter. The request body is never asked for. It cannot block or change anything.</td></tr>
        <tr><td>Script on AI sites</td><td>Enter/Send detection and the small prompt tag.</td><td>Nothing. It never reads the chat box or the conversation.</td></tr>
      </tbody></table>
    </div>`;
  $('#expJson').addEventListener('click', async () => download(`wattch-export-${today}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json'));
  $('#expCsv').addEventListener('click', async () => {
    const all = await allDayKeys();
    const days = await getDays(all);
    const lines = ['date,browser_minutes,ai_minutes,ai_prompts,ai_energy_wh_low,ai_energy_wh_mid,ai_energy_wh_high,ai_co2_g_mid,ai_water_ml_mid,laptop_energy_wh,laptop_co2_g'];
    for (const k of all) {
      const s = summarizeDay(days[k], settings);
      const f = s.aiFootprint;
      lines.push([k, (s.activeSec / 60).toFixed(1), (s.aiSec / 60).toFixed(1), s.prompts, f.energyWh.low.toFixed(3), f.energyWh.mid.toFixed(3), f.energyWh.high.toFixed(3), f.co2g.mid.toFixed(4), f.waterMl.mid.toFixed(3), s.device.energyWh.toFixed(2), s.device.co2g.toFixed(2)].join(','));
    }
    download(`wattch-days-${today}.csv`, lines.join('\n'), 'text/csv');
  });
  $('#del').addEventListener('click', async () => {
    if (!confirm('Delete all Wattch data on this laptop? This cannot be undone. (Settings are kept.)')) return;
    await deleteAll();
    await send({ type: 'data-deleted' });
    $('#delOk').classList.add('on');
    setTimeout(route, 800);
  });
  const dl = $('#demoLoad');
  if (dl) dl.addEventListener('click', async () => { await loadDemo(); await send({ type: 'settings-changed' }); location.hash = 'today'; });
  const dr = $('#demoRemove');
  if (dr) dr.addEventListener('click', async () => { await removeDemo(); await send({ type: 'settings-changed' }); route(); });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ------------------------------------------------------------------ SETTINGS
function renderSettings() {
  const s = settings;
  const num = (id, val, min, max, step, unit, help) => `<div class="inline"><input type="number" id="${id}" value="${val}" min="${min}" max="${max}" step="${step}"> ${unit}</div>${help ? `<div class="help">${help}</div>` : ''}`;
  const tog = (id, val, label) => `<label class="toggle"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${label}</label>`;
  const field = (label, forId, body) => `<div class="field"><label class="t" ${forId ? `for="${forId}"` : ''}>${label}</label><div>${body}</div></div>`;
  $('#s-settings').innerHTML = `
    <div class="title"><div><h1>Settings</h1><div class="sub">Saved as soon as you change something.</div></div><span class="saved" id="savedMsg">saved ✓</span></div>
    <div class="card"><h2>Reminders</h2><form class="settings">
      ${field('Break reminder', '', tog('remindersEnabled', s.remindersEnabled, 'Remind me to take a break'))}
      ${field('Remind me after', 'reminderMinutes', `${num('reminderMinutes', s.reminderMinutes, 5, 240, 5, 'min of active use')}<div style="margin-top:8px"><button type="button" class="btn" id="testRem">Show a test reminder</button></div>`)}
      ${field('A break counts after', 'breakMinutes', num('breakMinutes', s.breakMinutes, 1, 60, 1, 'min idle', 'Being away this long resets the reminder clock.'))}
    </form></div>
    <div class="card"><h2>Limits</h2><form class="settings">
      ${field('Daily browsing limit', 'dailyGoalMinutes', num('dailyGoalMinutes', s.dailyGoalMinutes, 0, 1440, 15, 'min', 'Stay within it to build a streak. 0 = no limit.'))}
      ${field('Daily AI prompt limit', 'dailyPromptGoal', num('dailyPromptGoal', s.dailyPromptGoal, 0, 500, 1, 'prompts', 'One notification when you reach it. 0 = off.'))}
      ${field('Default focus session', 'focusMinutes', num('focusMinutes', s.focusMinutes, 5, 180, 5, 'min'))}
    </form></div>
    <div class="card"><h2>Footprint</h2><form class="settings">
      ${field('Electricity grid', 'gridId', `<select id="gridId">${GRIDS.map((g) => `<option value="${g.id}" ${g.id === s.gridId ? 'selected' : ''}>${g.name}${g.g != null ? ` (${g.g} g/kWh)` : ''}</option>`).join('')}</select>
        <div class="inline" id="customGridRow" style="margin-top:6px" ${s.gridId === 'CUSTOM' ? '' : 'hidden'}><input type="number" id="customGrid" value="${s.customGrid}" min="0" max="1500" step="1"> g CO₂e/kWh</div>
        <div class="help">For your laptop's electricity. Ember 2023 yearly averages.</div>`)}
      ${field('Laptop power while browsing', 'laptopWatts', num('laptopWatts', s.laptopWatts, 1, 200, 1, 'W', 'Most laptops use about 10–30 W while browsing.'))}
    </form></div>
    <div class="card"><h2>Tracking</h2><form class="settings">
      ${field('Idle after', 'idleSeconds', num('idleSeconds', s.idleSeconds, 15, 600, 15, 's without input', 'Chrome needs at least 15 s.'))}
      ${field('Videos and lectures', '', tog('countMedia', s.countMedia, 'Keep counting while the tab plays sound'))}
      ${field('Never track', 'ignoredDomains', `<textarea id="ignoredDomains" placeholder="mybank.nl">${esc((s.ignoredDomains || []).join('\n'))}</textarea><div class="help">One site per line, subdomains included. Nothing about them is stored.</div>`)}
      ${field('Extra AI sites', 'customAiDomains', `<textarea id="customAiDomains" placeholder="chat.example.ai">${esc((s.customAiDomains || []).join('\n'))}</textarea><div class="help">Counted as AI time. Log prompts with +1.</div>`)}
      ${field('Keep history for', 'retentionDays', num('retentionDays', s.retentionDays, 7, 730, 1, 'days'))}
    </form></div>
    <div class="card"><h2>Display</h2><form class="settings">
      ${field('Toolbar badge', '', tog('showToolbarBadge', s.showToolbarBadge, "Show today's time on the icon"))}
      ${field('Prompt tag on AI sites', '', tog('showPageBadge', s.showPageBadge, 'Show the small prompt counter on AI websites'))}
    </form></div>`;

  const lines = (v) => v.split(/[\n,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const save = async () => {
    const patch = {};
    for (const id of ['reminderMinutes', 'breakMinutes', 'dailyGoalMinutes', 'dailyPromptGoal', 'focusMinutes', 'customGrid', 'laptopWatts', 'idleSeconds', 'retentionDays']) {
      const el = $(`#${id}`);
      const v = Number(el.value);
      if (Number.isFinite(v)) patch[id] = Math.min(Number(el.max), Math.max(Number(el.min), v));
    }
    for (const id of ['remindersEnabled', 'countMedia', 'showToolbarBadge', 'showPageBadge']) patch[id] = $(`#${id}`).checked;
    patch.gridId = $('#gridId').value;
    patch.ignoredDomains = lines($('#ignoredDomains').value);
    patch.customAiDomains = lines($('#customAiDomains').value);
    $('#customGridRow').hidden = patch.gridId !== 'CUSTOM';
    settings = await saveSettings(patch);
    await send({ type: 'settings-changed' });
    const m = $('#savedMsg');
    m.classList.add('on');
    clearTimeout(save.t);
    save.t = setTimeout(() => m.classList.remove('on'), 1400);
  };
  $('#s-settings').addEventListener('change', save);
  $('#testRem').addEventListener('click', () => send({ type: 'reminder-test' }));
}

const RENDER = { welcome: renderWelcome, today: renderToday, week: renderWeek, trends: renderTrends, focus: renderFocus, method: renderMethod, privacy: renderPrivacy, settings: renderSettings };

async function live() {
  const st = await send({ type: 'state' });
  const el = $('#liveStatus');
  if (!st || !st.rt) { el.textContent = ''; return; }
  el.innerHTML = st.focus ? `<b>●</b> FOCUS · ${Math.max(0, Math.ceil((st.focus.endsAt - Date.now()) / 60000))} min left`
    : st.counting ? `<b>●</b> COUNTING · ${esc(st.rt.host)}` : '○ NOT COUNTING NOW';
}
$('#demoOff').addEventListener('click', async () => { await removeDemo(); await send({ type: 'settings-changed' }); route(); });
setInterval(async () => {
  live();
  if (current() === 'today' && document.visibilityState === 'visible') { await load(); renderToday(); }
}, 30000);

route();
live();
