// Wattch content script. Runs only on the AI sites listed in manifest.json.
//
// It does two things:
//   1. Notices THAT a prompt was sent: the Enter key in the chat box, or a click on
//      the site's "Send" button. It never reads what you typed. It looks only at the
//      Send button's label and whether that button is disabled.
//   2. Shows a small badge with today's prompt count and footprint for this site,
//      with "+1" / "−1" buttons in case automatic detection misses something.
//
// It sends messages only to Wattch's own service worker, never to the internet.

(() => {
  if (window.__wattchLoaded) return;
  window.__wattchLoaded = true;

  const SEND_LABEL = /\bsend\b|submit|verstuur|verzend|senden|envoyer|enviar|invia|wyślij|отправ|надіс/i;
  const NOT_SEND = /feedback|share|invite|report|email/i;
  let lastReport = 0;

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null); // extension was reloaded; this old script is orphaned
    }
  }

  function reportPrompt() {
    const now = Date.now();
    if (now - lastReport < 1500) return;
    lastReport = now;
    send({ type: 'prompt-page' });
  }

  function labelOf(btn) {
    return [btn.getAttribute('aria-label'), btn.getAttribute('data-testid'), btn.getAttribute('title')]
      .filter(Boolean).join(' ');
  }

  function isSendButton(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    const label = labelOf(btn);
    if (NOT_SEND.test(label)) return false;
    return SEND_LABEL.test(label);
  }

  function isDisabled(btn) {
    return btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  function isComposer(el) {
    if (!el || el.nodeType !== 1) return false;
    return el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'textbox';
  }

  // Look for a Send button near the chat box (same form or a few levels up).
  function findSendButton(from) {
    let node = from;
    for (let i = 0; i < 10 && node; i++) {
      const buttons = node.querySelectorAll ? node.querySelectorAll('button') : [];
      for (const b of buttons) if (isSendButton(b)) return b;
      node = node.parentElement;
    }
    return null;
  }

  // Enter (without Shift) inside the chat box = the prompt is sent on these sites.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.altKey) return;
    if (!isComposer(e.target)) return;
    const btn = findSendButton(e.target);
    if (btn && isDisabled(btn)) return; // empty box: nothing is sent
    reportPrompt();
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!isSendButton(btn) || isDisabled(btn)) return;
    reportPrompt();
  }, true);

  // ------------------------------------------------------------------ badge
  let host = null;
  let root = null;
  let hiddenThisPage = false;

  const fmt = (x) => {
    if (!x) return '0';
    if (x < 0.1) return x.toFixed(3);
    if (x < 10) return x.toFixed(2);
    return Math.round(x).toString();
  };

  function buildBadge() {
    host = document.createElement('div');
    host.setAttribute('data-wattch', '');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; right: 0; top: 38%;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .tab { font: 500 12px/1.35 "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace; color: #1c1b19;
          background: #fffdf6; border: 1.5px solid #1c1b19; border-right: 0; box-shadow: -3px 3px 0 #1c1b19;
          display: flex; align-items: stretch; overflow: hidden; opacity: .9; transition: opacity .15s; }
        .tab:hover, .tab:focus-within { opacity: 1; }
        .peek { padding: 8px 9px; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 34px; border-right: 1.5px dashed #958e82; }
        .peek b { font-size: 16px; font-weight: 900; }
        .peek span { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #57524a; }
        .more { display: none; padding: 8px 10px; gap: 4px; flex-direction: column; min-width: 200px; }
        .tab:hover .more, .tab:focus-within .more { display: flex; }
        .row { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
        .muted { color: #57524a; font-size: 11px; }
        button { font: 700 11px "Cascadia Mono", Consolas, monospace; text-transform: uppercase; letter-spacing: .05em;
          border: 1.5px solid #1c1b19; background: #1c1b19; color: #fffdf6; border-radius: 3px; padding: 3px 7px; cursor: pointer; }
        button.ghost { background: transparent; color: #1c1b19; }
        button:hover { opacity: .85; }
        .leaf { width: 14px; height: 14px; }
      </style>
      <div class="tab" role="complementary" aria-label="Wattch prompt meter">
        <div class="peek" title="Wattch: AI prompts today on this site">
          <svg class="leaf" viewBox="0 0 24 24" aria-hidden="true"><path fill="#c3341b" d="M20 3C9 3 4 9 4 15c0 2 .6 3.6 1.4 4.8L3.5 21.7l1.4 1.4 2-2C8.1 22 9.8 22.5 12 22.5 18 22.5 21 15 20 3zm-8 16.5c-1.4 0-2.6-.3-3.6-.9L15 12l-1.4-1.4-6.6 6.6c-.4-.7-.6-1.4-.6-2.2 0-4.5 3.6-9 11.6-9.6-.3 8.6-2.8 14.1-6 14.1z"/></svg>
          <b id="n">0</b><span>today</span>
        </div>
        <div class="more">
          <div><b id="site">AI</b>: <span id="p">0 prompts</span></div>
          <div class="muted" id="fp">≈ 0 Wh · 0 g CO₂e · 0 mL water</div>
          <div class="muted" id="all"></div>
          <div class="row">
            <button id="plus" title="Count a prompt Wattch missed">+1 prompt</button>
            <button id="minus" class="ghost" title="Remove one prompt">−1</button>
            <button id="hide" class="ghost" title="Hide on this page (turn off for good in Wattch settings)">Hide</button>
          </div>
        </div>
      </div>`;
    root.getElementById('plus').addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'prompt-manual' }).then(update); });
    root.getElementById('minus').addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'prompt-undo' }).then(update); });
    root.getElementById('hide').addEventListener('click', (e) => { e.stopPropagation(); hiddenThisPage = true; host.remove(); });
    // keep site shortcuts from firing while the badge is used
    host.addEventListener('keydown', (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
  }

  async function update() {
    if (hiddenThisPage) return;
    const s = await send({ type: 'site-summary' });
    if (!s || !s.show) {
      if (host) host.remove();
      host = null;
      return;
    }
    if (!host || !host.isConnected) buildBadge();
    root.getElementById('n').textContent = s.prompts;
    root.getElementById('site').textContent = s.siteName;
    root.getElementById('p').textContent = `${s.prompts} prompt${s.prompts === 1 ? '' : 's'} today`;
    root.getElementById('fp').textContent =
      `≈ ${fmt(s.energyWh.mid)} Wh · ${fmt(s.co2g.mid)} g CO₂e · ${fmt(s.waterMl.mid)} mL water`;
    root.getElementById('all').textContent =
      s.allPrompts !== s.prompts ? `All AI today: ${s.allPrompts} prompts ≈ ${fmt(s.allEnergyWh.mid)} Wh` : 'Short text prompts. Images and long answers cost more.';
  }

  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 400);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((k) => k.startsWith('d:') || k === 'settings')) scheduleUpdate();
    });
  } catch { /* orphaned */ }

  update();
})();
