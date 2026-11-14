// Small helpers shared by the receipt popup and the statement dashboard.
import { escapeHtml } from '../lib/format.js';

/** One printed line: label ........ value */
export function line(label, value, cls = '') {
  return `<div class="line ${cls}"><span class="lbl">${label}</span><span class="dots"></span><span class="val">${value}</span></div>`;
}

/** Clock-style duration for receipts: 2:42 (h:mm) or 37 min. */
export function clock(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

/** A barcode drawn from the day's numbers. Decorative, but it changes with your day. */
export function barcode(seedText) {
  let h = 2166136261;
  for (const c of String(seedText)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let x = 0;
  let rects = '';
  for (let i = 0; i < 46; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const w = 1 + (h % 3);
    const gap = 1 + ((h >>> 3) % 3);
    rects += `<rect x="${x}" y="0" width="${w}" height="38"/>`;
    x += w + gap;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} 38" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">${rects}</svg>`;
}

export const esc = escapeHtml;
