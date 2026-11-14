import { getSettings, getDays, getMeta, summarizeDay, computeStreak } from '../lib/store.js';
import { AI_SITES, aiSiteForHost } from '../lib/sites.js';
import { dayKey, lastNDays } from '../lib/dates.js';
import { fmtEnergy, fmtCo2, fmtWater, fmtRangeSpan, fmtNum } from '../lib/format.js';
import { COMPARE } from '../lib/footprint.js';
import { line, clock, barcode, esc } from '../shared/receipt.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
let state = null;

async function render() {
  const settings = await getSettings();
  const meta = await getMeta();
  const keys = lastNDays(60);
  const days = await getDays(keys);
  const sums = {};
  for (const k of keys) sums[k] = summarizeDay(days[k], settings);
  const t = sums[dayKey()];
  const { demoBackup } = await chrome.storage.local.get('demoBackup');

  // header
  const now = new Date();
  const no = Math.max(1, Math.round((Date.now() - (meta.installedAt || Date.now())) / 864e5) + 1);
  $('meta').textContent = `${now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}  ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}  No.${String(no).padStart(4, '0')}`;

  // status
  let status = '';
  if (demoBackup) status = '<span class="stamp red small">demo data</span>';
  else if (state && state.focus) status = '<span class="on">● FOCUS SESSION RUNNING</span>';
  else if (state && state.counting) status = `<span class="on">● COUNTING</span> ${esc(state.rt.host)}`;
  else if (state && state.rt) status = `<span class="off">○ PAUSED</span> <span class="faint">${!state.rt.host ? 'not a website' : state.rt.idleState !== 'active' ? 'you are idle' : ''}</span>`;
  $('status').innerHTML = status;

  // items
  const top = t.topSites.slice(0, 7);
  const rest = t.topSites.slice(7);
  $('items').innerHTML = `<div class="secT">ITEMS</div>${
    top.length ? top.map((s) => line(esc(s.host.replace(/^www\./, '')), clock(s.sec), s.ai ? 'ai' : '')).join('') : '<div class="empty">Nothing yet today.</div>'
  }${rest.length ? line(`+ ${rest.length} more site${rest.length > 1 ? 's' : ''}`, clock(rest.reduce((a, b) => a + b.sec, 0)), 'sub') : ''}`;

  // time + goal
  const goal = settings.dailyGoalMinutes * 60;
  const ratio = goal ? t.activeSec / goal : 0;
  const { streak } = computeStreak(sums, settings, meta.installedAt);
  $('time').innerHTML = `
    ${line('<b>BROWSER TIME</b>', `<b>${clock(t.activeSec)}</b>`, 'big')}
    ${goal ? `<div class="meter ${ratio >= 1 ? 'over' : ''}"><i style="width:${Math.min(100, ratio * 100)}%"></i></div>
    <div class="goalRow small"><span class="muted">LIMIT ${clock(goal)} · ${ratio >= 1 ? `<b style="color:var(--red)">OVER ${clock(t.activeSec - goal)}</b>` : `LEFT ${clock(goal - t.activeSec)}`}</span>
    <span>${streak ? `STREAK ${streak}d` : ''}</span></div>` : ''}`;

  // AI
  $('ai').innerHTML = `<div class="secT">AI ASSISTANTS</div>${
    t.aiBySite.length ? t.aiBySite.map((r) => line(`${esc(r.name)} ×${r.prompts}`, clock(r.sec))).join('') : '<div class="empty">No AI use yet today.</div>'
  }${line('<b>PROMPTS</b>', `<b>${t.prompts}</b>`)}${line('TIME ON AI', clock(t.aiSec), 'sub')}`;

  // footprint
  const f = t.aiFootprint;
  const span = (r, fn) => (r.high ? `<span class="faint">(${fmtRangeSpan(r, fn)})</span>` : '');
  $('fp').innerHTML = `<div class="secT">FOOTPRINT · MID (RANGE)</div>
    ${line('AI ENERGY', `${fmtEnergy(f.energyWh.mid)}`)}${f.energyWh.high ? line('', fmtRangeSpan(f.energyWh, fmtEnergy), 'sub') : ''}
    ${line('AI CO₂e', `${fmtCo2(f.co2g.mid)} ${span(f.co2g, fmtCo2)}`)}
    ${line('AI WATER', `${fmtWater(f.waterMl.mid)} ${span(f.waterMl, fmtWater)}`)}
    ${line('LAPTOP', `${fmtEnergy(t.device.energyWh)} · ${fmtCo2(t.device.co2g)}`)}`;

  const totalWh = f.energyWh.mid + t.device.energyWh;
  $('total').innerHTML = `${line('<b>TOTAL ENERGY</b>', `<b>${fmtEnergy(totalWh)}</b>`, 'big')}
    <div class="small muted center">≈ ${fmtNum(totalWh / COMPARE.phoneWh)} phone charges · ${fmtNum(f.waterMl.mid / COMPARE.teaspoonMl)} tsp of water</div>
    ${goal ? `<div class="stampWrap"><span class="stamp ${ratio >= 1 ? 'red' : 'green'}">${ratio >= 1 ? 'over limit' : 'within limit'}</span></div>` : ''}`;

  $('barcode').innerHTML = barcode(`${dayKey()}-${Math.round(t.activeSec / 60)}-${t.prompts}`);

  // focus
  const focus = state && state.focus;
  $('focusIdle').hidden = !!focus;
  $('focusRun').hidden = !focus;
  if (focus) {
    const left = Math.max(0, focus.endsAt - Date.now());
    $('focusLeft').textContent = `focus ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left`;
  }
}

async function fillSiteSelect() {
  const settings = await getSettings();
  const sel = $('logSite');
  const opts = AI_SITES.map((s) => ({ id: s.id, name: s.name }));
  for (const d of settings.customAiDomains || []) opts.push({ id: `custom:${d.replace(/^www\./, '')}`, name: d });
  sel.innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try { host = tab && tab.url ? new URL(tab.url).hostname : null; } catch { /* ignore */ }
  const site = aiSiteForHost(host, settings.customAiDomains);
  if (site) sel.value = site.id;
}

$('plus').addEventListener('click', async () => { await send({ type: 'prompt-manual', siteId: $('logSite').value }); render(); });
$('minus').addEventListener('click', async () => { await send({ type: 'prompt-undo', siteId: $('logSite').value }); render(); });
document.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', async () => {
  await send({ type: 'focus-start', minutes: Number(b.dataset.min) });
  state = await send({ type: 'state' });
  render();
}));
$('focusStop').addEventListener('click', async () => {
  await send({ type: 'focus-stop' });
  state = await send({ type: 'state' });
  render();
});
$('openDash').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html#today') });
  window.close();
});

(async () => {
  await fillSiteSelect();
  await render();
  state = await send({ type: 'state' }).catch(() => null);
  await render();
  setInterval(render, 1000);
  setInterval(async () => { state = await send({ type: 'state' }).catch(() => state); }, 5000);
})();
