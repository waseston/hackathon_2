// Small SVG chart helpers in a printed-receipt style. No libraries, no network.

const NS = 'http://www.w3.org/2000/svg';
let tipEl = null;

function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'status');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add('on');
  const w = t.offsetWidth;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
  t.style.left = `${left}px`;
  t.style.top = `${Math.max(8, y - t.offsetHeight - 10)}px`;
}
function hideTip() { if (tipEl) tipEl.classList.remove('on'); }

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

// Picks a round tick step. kind 'minutes' gives steps like 15 min, 30 min, 1 h, 2 h.
function niceScale(maxValue, ticks = 4, kind) {
  const raw = Math.max(maxValue, 1e-9) / ticks;
  let step;
  if (kind === 'minutes') {
    step = [1, 2, 5, 10, 15, 20, 30, 60, 90, 120, 180, 240, 360, 480, 720].find((c) => c >= raw) || 720;
  } else {
    const p = 10 ** Math.floor(Math.log10(raw));
    step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((c) => c >= raw);
  }
  const n = Math.max(1, Math.ceil(maxValue / step));
  return { max: step * n, ticks: n };
}

/**
 * Stacked bar chart.
 * opts: { labels, series:[{name, color, values}], height, yFormat(v), tipFormat(i),
 *         goal (number, optional), goalLabel, highlight (index), yTicks }
 */
export function stackedBars(container, opts) {
  const draw = () => {
    container.innerHTML = '';
    const W = Math.max(240, container.clientWidth || 600);
    const H = opts.height || 200;
    const m = { t: 12, r: 8, b: 26, l: 46 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = opts.labels.length;
    const totals = opts.labels.map((_, i) => opts.series.reduce((s, se) => s + (se.values[i] || 0), 0));
    const sc = niceScale(Math.max(...totals, opts.goal || 0, opts.kind === 'minutes' ? 5 : 0) * 1.02, opts.yTicks || 4, opts.kind);
    const max = sc.max;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || 'Bar chart' });
    container.appendChild(svg);
    const pid = `h${Math.random().toString(36).slice(2, 8)}`;
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: pid, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 5, height: 5, fill: 'var(--paper)' }, pat);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: 'var(--ink-2)', 'stroke-width': 2.2 }, pat);

    const ticks = sc.ticks;
    for (let k = 0; k <= ticks; k++) {
      const v = (max / ticks) * k;
      const y = m.t + ih - (v / max) * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: k === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': k === 0 ? 1.5 : 1, 'stroke-dasharray': k === 0 ? '' : '2 3' }, svg);
      const t = el('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10.5, 'font-family': 'var(--mono)', fill: 'var(--ink-3)' }, svg);
      t.textContent = opts.yFormat ? opts.yFormat(v) : Math.round(v);
    }

    const band = iw / n;
    const bw = Math.max(3, Math.min(34, band * 0.68));
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(iw / 38)));
    opts.labels.forEach((lab, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      let y = m.t + ih;
      const g = el('g', {}, svg);
      opts.series.forEach((se, si) => {
        const v = se.values[i] || 0;
        if (v <= 0) return;
        const h = (v / max) * ih;
        y -= h;
        const top = si === opts.series.length - 1 || opts.series.slice(si + 1).every((s2) => !(s2.values[i] > 0));
        const r = el('rect', { x, y, width: bw, height: Math.max(0.5, h), fill: se.hatch ? `url(#${pid})` : se.color, stroke: se.hatch ? 'var(--ink-2)' : 'none', 'stroke-width': se.hatch ? 1 : 0 }, g);
        void top;
        if (opts.highlight != null && opts.highlight !== i) r.setAttribute('opacity', '0.55');
      });
      // hit area for tooltip
      const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' }, g);
      hit.addEventListener('mousemove', (e) => showTip(opts.tipFormat ? opts.tipFormat(i) : `${lab}: ${totals[i]}`, e.clientX, e.clientY));
      hit.addEventListener('mouseleave', hideTip);
      if (i % labelEvery === 0 || i === n - 1) {
        const t = el('text', { x: m.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, 'font-family': 'var(--mono)', fill: i === opts.highlight ? 'var(--ink)' : 'var(--ink-3)', 'font-weight': i === opts.highlight ? 700 : 400 }, svg);
        t.textContent = lab;
      }
    });

    if (opts.goal) {
      const y = m.t + ih - (opts.goal / max) * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'var(--red)', 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }, svg);
      const t = el('text', { x: W - m.r, y: y - 5, 'text-anchor': 'end', 'font-size': 10.5, 'font-family': 'var(--mono)', fill: 'var(--red)', 'font-weight': 700 }, svg);
      t.textContent = opts.goalLabel || 'goal';
    }
  };
  draw();
  if (!container.__ro) {
    let w = container.clientWidth;
    container.__ro = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - w) > 4) { w = container.clientWidth; container.__draw(); }
    });
    container.__ro.observe(container);
  }
  container.__draw = draw;
}

/** Simple line chart with an optional shaded range band. series: [{name,color,values,band:{low,high}}] */
export function lineChart(container, opts) {
  const draw = () => {
    container.innerHTML = '';
    const W = Math.max(240, container.clientWidth || 600);
    const H = opts.height || 180;
    const m = { t: 12, r: 10, b: 26, l: 46 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = opts.labels.length;
    let maxV = 0;
    for (const s of opts.series) {
      for (let i = 0; i < n; i++) maxV = Math.max(maxV, s.values[i] || 0, s.band ? s.band.high[i] || 0 : 0);
    }
    const sc = niceScale(maxV * 1.02, 4);
    const max = sc.max;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || 'Line chart' });
    container.appendChild(svg);
    const X = (i) => m.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const Y = (v) => m.t + ih - (v / max) * ih;
    for (let k = 0; k <= sc.ticks; k++) {
      const v = (max / sc.ticks) * k;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: k === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': k === 0 ? 1.5 : 1, 'stroke-dasharray': k === 0 ? '' : '2 3' }, svg);
      const t = el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, 'font-family': 'var(--mono)', fill: 'var(--ink-3)' }, svg);
      t.textContent = opts.yFormat ? opts.yFormat(v) : Math.round(v);
    }
    for (const s of opts.series) {
      if (s.band) {
        let d = '';
        for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${X(i)},${Y(s.band.high[i] || 0)}`;
        for (let i = n - 1; i >= 0; i--) d += `L${X(i)},${Y(s.band.low[i] || 0)}`;
        el('path', { d: `${d}Z`, fill: s.color, opacity: 0.13 }, svg);
      }
      let d = '';
      for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${X(i)},${Y(s.values[i] || 0)}`;
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 1.8, 'stroke-linejoin': 'miter' }, svg);
      if (n <= 31) {
        for (let i = 0; i < n; i++) el('rect', { x: X(i) - 2.5, y: Y(s.values[i] || 0) - 2.5, width: 5, height: 5, fill: 'var(--paper)', stroke: s.color, 'stroke-width': 1.5 }, svg);
      }
    }
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(iw / 44)));
    opts.labels.forEach((lab, i) => {
      if (i % labelEvery === 0 || i === n - 1) {
        const t = el('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, 'font-family': 'var(--mono)', fill: 'var(--ink-3)' }, svg);
        t.textContent = lab;
      }
      const hit = el('rect', { x: X(i) - iw / n / 2, y: m.t, width: iw / n, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (e) => showTip(opts.tipFormat ? opts.tipFormat(i) : lab, e.clientX, e.clientY));
      hit.addEventListener('mouseleave', hideTip);
    });
  };
  draw();
  if (!container.__ro) {
    let w = container.clientWidth;
    container.__ro = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - w) > 4) { w = container.clientWidth; container.__draw(); }
    });
    container.__ro.observe(container);
  }
  container.__draw = draw;
}
