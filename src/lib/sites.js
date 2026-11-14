// Known AI assistants.
//
// `vendor` decides which published footprint figure is used (see footprint.js).
// `net` lists URL paths that a site calls exactly once when you SEND a prompt.
// The service worker only notices that such a POST request happened. It never
// reads the request body, so it never sees what you typed.
// If a site changes its internals, the on-page detector (content script) and the
// manual "+1 prompt" button still work.

export const AI_SITES = [
  {
    id: 'chatgpt', name: 'ChatGPT', vendor: 'openai',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    net: [/\/backend-api\/(f\/)?conversation$/],
  },
  {
    id: 'gemini', name: 'Gemini', vendor: 'google',
    hosts: ['gemini.google.com'],
    net: [/\/BardFrontendService\/StreamGenerate$/],
  },
  { id: 'aistudio', name: 'Google AI Studio', vendor: 'google', hosts: ['aistudio.google.com'] },
  { id: 'notebooklm', name: 'NotebookLM', vendor: 'google', hosts: ['notebooklm.google.com'] },
  {
    id: 'claude', name: 'Claude', vendor: 'other',
    hosts: ['claude.ai'],
    net: [/\/chat_conversations\/[^/]+\/(completion|retry_completion)$/],
  },
  { id: 'copilot', name: 'Microsoft Copilot', vendor: 'other', hosts: ['copilot.microsoft.com'] },
  {
    id: 'perplexity', name: 'Perplexity', vendor: 'other',
    hosts: ['www.perplexity.ai', 'perplexity.ai'],
    net: [/\/rest\/sse\/perplexity_ask$/],
  },
  { id: 'mistral', name: 'Le Chat (Mistral)', vendor: 'other', hosts: ['chat.mistral.ai'] },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: 'other',
    hosts: ['chat.deepseek.com'],
    net: [/\/api\/v0\/chat\/completion$/],
  },
  {
    id: 'grok', name: 'Grok', vendor: 'other',
    hosts: ['grok.com'],
    net: [/\/rest\/app-chat\/conversations\/(new|[^/]+\/responses)$/],
  },
  { id: 'meta', name: 'Meta AI', vendor: 'other', hosts: ['www.meta.ai', 'meta.ai'] },
  { id: 'poe', name: 'Poe', vendor: 'other', hosts: ['poe.com'] },
];

// URL filters for chrome.webRequest (only sites that have a known send endpoint).
export const NET_URL_FILTERS = AI_SITES
  .filter((s) => s.net)
  .flatMap((s) => s.hosts.map((h) => `https://${h}/*`));

const BY_HOST = new Map();
for (const s of AI_SITES) for (const h of s.hosts) BY_HOST.set(h, s);

export function normaliseHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

/** Returns the AI site for a hostname, including user-added custom domains. */
export function aiSiteForHost(host, customDomains = []) {
  if (!host) return null;
  const h = String(host).toLowerCase();
  if (BY_HOST.has(h)) return BY_HOST.get(h);
  const bare = normaliseHost(h);
  if (BY_HOST.has(bare)) return BY_HOST.get(bare);
  if (customDomains.map(normaliseHost).includes(bare)) {
    return { id: `custom:${bare}`, name: bare, vendor: 'other', hosts: [bare], custom: true };
  }
  return null;
}

export function aiSiteById(id) {
  if (id && id.startsWith('custom:')) {
    const h = id.slice(7);
    return { id, name: h, vendor: 'other', hosts: [h], custom: true };
  }
  return AI_SITES.find((s) => s.id === id) || null;
}

/** Hostname we track for a tab URL, or null for pages we never count. */
export function trackableHost(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.hostname.toLowerCase();
}

/** True if host equals one of the domains or is a subdomain of it. */
export function hostMatches(host, domains = []) {
  const h = normaliseHost(host);
  return domains.some((d) => {
    const n = normaliseHost(d.trim());
    return n && (h === n || h.endsWith(`.${n}`));
  });
}
