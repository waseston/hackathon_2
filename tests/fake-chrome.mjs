// A minimal fake of the chrome.* APIs Wattch uses, so the tracking engine can be
// tested with plain Node (no browser, no dependencies).

export function createFakeChrome() {
  const listeners = {};
  const on = (name) => ({
    addListener: (fn) => { (listeners[name] ||= []).push(fn); },
  });
  const emit = async (name, ...args) => {
    for (const fn of listeners[name] || []) await fn(...args);
  };

  const area = () => {
    let data = {};
    return {
      _data: () => data,
      async get(keys) {
        if (keys == null) return structuredClone(data);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
      async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
      async clear() { data = {}; },
      async getBytesInUse() { return JSON.stringify(data).length; },
    };
  };

  const world = {
    focused: true,
    tab: { id: 1, url: 'https://example.org/page', audible: false, incognito: false, active: true },
    idle: 'active',
    notifications: [],
    alarms: {},
    badge: '',
  };

  const chrome = {
    storage: { local: area(), session: area(), onChanged: on('storage.onChanged') },
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      onInstalled: on('runtime.onInstalled'),
      onStartup: on('runtime.onStartup'),
      onMessage: on('runtime.onMessage'),
      sendMessage: async () => null,
    },
    tabs: {
      query: async () => (world.tab ? [structuredClone(world.tab)] : []),
      create: async () => ({}),
      onActivated: on('tabs.onActivated'),
      onUpdated: on('tabs.onUpdated'),
    },
    windows: {
      getLastFocused: async () => ({ id: 10, focused: world.focused }),
      onFocusChanged: on('windows.onFocusChanged'),
      WINDOW_ID_NONE: -1,
    },
    idle: {
      queryState: async () => world.idle,
      setDetectionInterval: () => {},
      onStateChanged: on('idle.onStateChanged'),
    },
    alarms: {
      get: async (n) => world.alarms[n] || null,
      create: async (n, info) => { world.alarms[n] = { name: n, ...info }; },
      clear: async (n) => { delete world.alarms[n]; return true; },
      onAlarm: on('alarms.onAlarm'),
    },
    notifications: {
      create: async (id, opts) => { world.notifications.push({ id, ...opts }); return id; },
      clear: async () => true,
      onButtonClicked: on('notifications.onButtonClicked'),
      onClicked: on('notifications.onClicked'),
    },
    action: {
      setBadgeText: async ({ text }) => { world.badge = text; },
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
    },
    webRequest: { onBeforeRequest: on('webRequest.onBeforeRequest') },
  };

  return { chrome, world, emit, listeners };
}
