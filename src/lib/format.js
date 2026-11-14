// Formatting helpers shared by the popup, the dashboard and the service worker.

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return sec === 0 ? '0 min' : '<1 min';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** Very short form for the toolbar badge (max ~4 characters). */
export function fmtBadge(sec) {
  const m = Math.floor((sec || 0) / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${h}:${mm}`;
}

export function fmtNum(x, opts = {}) {
  if (!isFinite(x) || x === 0) return '0';
  const a = Math.abs(x);
  let digits;
  if (a < 0.01) digits = 3;
  else if (a < 1) digits = 2;
  else if (a < 10) digits = 1;
  else digits = 0;
  if (opts.maxDigits != null) digits = Math.min(digits, opts.maxDigits);
  return x.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtEnergy(wh) {
  if (wh >= 1000) return `${fmtNum(wh / 1000)} kWh`;
  return `${fmtNum(wh)} Wh`;
}

export function fmtCo2(g) {
  if (g >= 1000) return `${fmtNum(g / 1000)} kg`;
  return `${fmtNum(g)} g`;
}

export function fmtWater(ml) {
  if (ml >= 1000) return `${fmtNum(ml / 1000)} L`;
  return `${fmtNum(ml)} mL`;
}

/** "0.24 Wh (0.10–0.34)" style range. */
export function fmtRange(r, f) {
  if (!r || (r.high || 0) === 0) return f(0);
  return `${f(r.mid)}`;
}

export function fmtRangeSpan(r, f) {
  if (!r || (r.high || 0) === 0) return '';
  return `${f(r.low)} – ${f(r.high)}`;
}

export function pctChange(now, before) {
  if (!before) return now ? null : 0;
  return ((now - before) / before) * 100;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
