import { fmtNum } from './format.js';

// The footprint model. Every number here has a source, listed in SOURCES and
// shown on the dashboard's "How it's calculated" page.
//
// Nobody knows exactly what one prompt costs, so we never show one number on
// its own: each estimate is { low, mid, high }.
//   low  = Google's "chips only" energy (0.10 Wh) with Google's clean-power carbon factor
//   mid  = the company's own published figure for that assistant (see below)
//   high = the highest published figure (0.34 Wh) on an average US grid
// These are short text prompts. Images, files, long answers and "deep research"
// cost much more, which is why we call these figures a floor, not a ceiling.

export const SOURCES = {
  google: {
    label: 'Google, "Measuring the environmental impact of delivering AI at Google scale" (Aug 2025)',
    url: 'https://arxiv.org/abs/2508.15734',
  },
  openai: {
    label: 'Sam Altman, "The Gentle Singularity" (blog, June 2025)',
    url: 'https://blog.samaltman.com/the-gentle-singularity',
  },
  emberEU: {
    label: 'Ember, European Electricity Review 2024 (2023 data)',
    url: 'https://ember-energy.org/latest-insights/european-electricity-review-2024/eu-electricity-trends/',
  },
  emberGlobal: {
    label: 'Ember, electricity carbon intensity by country, 2023 (chart on Statista)',
    url: 'https://www.statista.com/statistics/943137/global-emissions-intensity-power-sector-by-country/',
  },
};

// Per short text prompt.
export const PROMPT = {
  energyWh: {
    low: 0.10,          // Google, same Gemini prompt, counting only the AI chips
    high: 0.34,         // OpenAI, average ChatGPT query
    mid: { google: 0.24, openai: 0.34, other: 0.29 },
  },
  waterMl: {
    low: 0.26,          // Google, Gemini median prompt
    high: 0.32,         // OpenAI, average ChatGPT query ("about 1/15 of a teaspoon")
    mid: { google: 0.26, openai: 0.32, other: 0.29 },
  },
  // Carbon intensity of the data-centre electricity, gCO2e per kWh.
  // Google published 0.03 g for a 0.24 Wh prompt: 0.03 / 0.24 Wh = 125 g/kWh
  // (market-based, counts Google's clean-energy purchases).
  // OpenAI gave no carbon figure. We use the average US grid (369 g/kWh, Ember 2023),
  // because most large AI data centres are in the US.
  dcIntensity: {
    low: 125,
    high: 369,
    mid: { google: 125, openai: 369, other: 369 },
  },
};

export const VENDOR_NOTE = {
  google: "Google's own published median for a Gemini text prompt.",
  openai: "OpenAI's own published average for a ChatGPT query.",
  other: 'No figure published by this company. We use the average of the Google and OpenAI figures, and the full range.',
};

// Electricity grids, gCO2e per kWh, yearly average 2023 (Ember).
// Used for YOUR laptop's electricity, not for the AI data centre.
export const GRIDS = [
  { id: 'NL', name: 'Netherlands', g: 268 },
  { id: 'DE', name: 'Germany', g: 371 },
  { id: 'FR', name: 'France', g: 56 },
  { id: 'IT', name: 'Italy', g: 331 },
  { id: 'PL', name: 'Poland', g: 662 },
  { id: 'CZ', name: 'Czechia', g: 450 },
  { id: 'SE', name: 'Sweden', g: 41 },
  { id: 'FI', name: 'Finland', g: 79 },
  { id: 'NO', name: 'Norway', g: 30 },
  { id: 'CH', name: 'Switzerland', g: 35 },
  { id: 'GB', name: 'United Kingdom', g: 238 },
  { id: 'US', name: 'United States', g: 369 },
  { id: 'EU', name: 'EU average', g: 242 },
  { id: 'WORLD', name: 'World average', g: 481 },
  { id: 'CUSTOM', name: 'Custom value…', g: null },
];

export function gridIntensity(settings) {
  if (settings.gridId === 'CUSTOM') return Math.max(0, Number(settings.customGrid) || 0);
  const g = GRIDS.find((x) => x.id === settings.gridId);
  return g ? g.g : 481;
}

const zero = () => ({ low: 0, mid: 0, high: 0 });

/**
 * Footprint of a number of prompts sent to one AI assistant.
 * @param {number} prompts
 * @param {'google'|'openai'|'other'} vendor
 */
export function promptFootprint(prompts, vendor = 'other') {
  const v = PROMPT.energyWh.mid[vendor] != null ? vendor : 'other';
  const n = Math.max(0, prompts || 0);
  const e = PROMPT.energyWh;
  const w = PROMPT.waterMl;
  const c = PROMPT.dcIntensity;
  return {
    energyWh: { low: n * e.low, mid: n * e.mid[v], high: n * e.high },
    co2g: {
      low: (n * e.low * c.low) / 1000,
      mid: (n * e.mid[v] * c.mid[v]) / 1000,
      high: (n * e.high * c.high) / 1000,
    },
    waterMl: { low: n * w.low, mid: n * w.mid[v], high: n * w.high },
  };
}

export function addFootprints(a, b) {
  const out = { energyWh: zero(), co2g: zero(), waterMl: zero() };
  for (const k of Object.keys(out)) {
    for (const r of ['low', 'mid', 'high']) out[k][r] = (a?.[k]?.[r] || 0) + (b?.[k]?.[r] || 0);
  }
  return out;
}

export function emptyFootprint() {
  return { energyWh: zero(), co2g: zero(), waterMl: zero() };
}

/** Your own laptop's electricity while you were actively browsing. */
export function deviceFootprint(activeSeconds, settings) {
  const watts = Math.max(0, Number(settings.laptopWatts) || 0);
  const energyWh = (activeSeconds / 3600) * watts;
  const g = gridIntensity(settings);
  return { energyWh, co2g: (energyWh * g) / 1000, watts, gridG: g };
}

// Everyday comparisons. Each one carries its maths so the UI can show it.
export const COMPARE = {
  phoneWh: 15,     // phone battery ≈ 4,000 mAh × 3.85 V ≈ 15.4 Wh
  kettleWh: 93,    // 1 L water, 20→100 °C: 4.186 kJ/kg·K × 1 kg × 80 K = 335 kJ ≈ 93 Wh
  ledW: 8,         // LED bulb, about as bright as an old 60 W bulb
  teaspoonMl: 5,
  glassMl: 250,
};

export function comparisons(energyWh, waterMl) {
  return [
    {
      id: 'phone', big: fmtNum(energyWh / COMPARE.phoneWh), label: 'phone charges',
      maths: `${fmtNum(energyWh)} Wh ÷ 15 Wh per charge (4,000 mAh × 3.85 V ≈ 15 Wh)`,
    },
    {
      id: 'led', big: fmtDurationShort((energyWh / COMPARE.ledW) * 3600), label: 'of an 8 W LED bulb',
      maths: `${fmtNum(energyWh)} Wh ÷ 8 W = ${fmtNum(energyWh / COMPARE.ledW)} h`,
    },
    {
      id: 'kettle', big: fmtNum(energyWh / COMPARE.kettleWh), label: 'litres of water boiled',
      maths: `${fmtNum(energyWh)} Wh ÷ 93 Wh per litre (20 → 100 °C: 4.186 kJ/kg·K × 80 K = 335 kJ)`,
    },
    {
      id: 'water', big: fmtNum(waterMl / COMPARE.teaspoonMl), label: 'teaspoons of water',
      maths: `${fmtNum(waterMl)} mL ÷ 5 mL per teaspoon`,
    },
  ];
}

function fmtDurationShort(sec) {
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
