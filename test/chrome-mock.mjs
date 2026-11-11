// Minimal in-memory chrome.* mock for running Oris code under Node.
export function createChrome({ extId = 'testextid' } = {}) {
  const store = {};
  const listeners = { storage: [], message: [], alarm: [], installed: [], startup: [], command: [], notifBtn: [], menu: [], tabActivated: [], tabUpdated: [] };
  const menus = [];
  const windowsCreated = [];
  const scriptCalls = [];
  let scriptHandler = () => undefined;
  // What Chrome assigned. Tests can blank one out to simulate a key another extension took.
  const commandList = [{ name: 'toggle-timer', shortcut: 'Alt+Shift+O' }, { name: 'highlight-selection', shortcut: 'Alt+Shift+H' }, { name: 'quick-note', shortcut: 'Alt+Shift+N' }];
  const alarms = new Map();
  let dynamicRules = [];
  const tabs = [];
  const notifications = [];
  const badge = { text: '', color: '' };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const event = (arr) => ({ addListener: (fn) => arr.push(fn) });

  function validateRule(r) {
    if (!Number.isInteger(r.id) || r.id < 1) throw new Error('rule id');
    if (!r.action || !r.condition) throw new Error('rule shape');
    const c = r.condition;
    if (c.requestDomains && !c.requestDomains.length) throw new Error('requestDomains must be non-empty');
    if (r.action.type === 'redirect') {
      const red = r.action.redirect;
      if (red.regexSubstitution && !c.regexFilter) throw new Error('regexSubstitution requires regexFilter');
    }
    if (c.regexFilter) new RegExp(c.regexFilter);
  }

  const chrome = {
    runtime: {
      id: extId,
      getURL: (p) => `chrome-extension://${extId}/${p.replace(/^\//, '')}`,
      getManifest: () => ({ version: '1.0.0' }),
      onMessage: event(listeners.message),
      onInstalled: event(listeners.installed),
      onStartup: event(listeners.startup),
      sendMessage: (msg) => new Promise((resolve) => {
        let handled = false;
        for (const fn of listeners.message) {
          const r = fn(msg, {}, (res) => { handled = true; resolve(res); });
          if (r === true) return;
        }
        if (!handled) resolve(undefined);
      }),
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(store);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = clone(store[k]);
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(store[k]), newValue: clone(v) };
            store[k] = clone(v);
          }
          for (const fn of listeners.storage) fn(changes, 'local');
        },
        async remove(keys) {
          const changes = {};
          for (const k of [].concat(keys)) {
            if (!(k in store)) continue;
            changes[k] = { oldValue: clone(store[k]) };
            delete store[k];
          }
          if (Object.keys(changes).length) for (const fn of listeners.storage) fn(changes, 'local');
        },
      },
      onChanged: event(listeners.storage),
    },
    alarms: {
      async create(name, info) { alarms.set(name, { name, ...info }); },
      async clear(name) { return alarms.delete(name); },
      onAlarm: event(listeners.alarm),
    },
    declarativeNetRequest: {
      async getDynamicRules() { return clone(dynamicRules); },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        addRules.forEach(validateRule);
        dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id));
        const ids = new Set(dynamicRules.map((r) => r.id));
        for (const r of addRules) { if (ids.has(r.id)) throw new Error('duplicate rule id ' + r.id); dynamicRules.push(clone(r)); }
      },
    },
    tabs: {
      async query(q = {}) {
        return clone(tabs.filter((t) => (q.active === undefined || !!t.active === q.active) && (q.windowId === undefined || (t.windowId || 1) === q.windowId)));
      },
      async update(id, props) { const t = tabs.find((x) => x.id === id); if (t) Object.assign(t, props); return t; },
      async getCurrent() { return { id: 99, windowId: 1 }; },
      async create(props) { const t = { id: 1000 + tabs.length, windowId: 1, url: props.url || 'chrome://newtab/', title: '', active: props.active !== false }; tabs.push(t); return clone(t); },
      async remove(ids) { for (const id of [].concat(ids)) { const i = tabs.findIndex((t) => t.id === id); if (i >= 0) tabs.splice(i, 1); } },
      onActivated: event(listeners.tabActivated),
      onUpdated: event(listeners.tabUpdated),
    },
    windows: {
      async getCurrent() { return { id: 1 }; },
      async create(props) { windowsCreated.push(clone(props)); return { id: 2 }; },
    },
    scripting: {
      async executeScript(opts) {
        scriptCalls.push(opts);
        const result = await scriptHandler(opts);
        if (result instanceof Error) throw result;
        return [{ result }];
      },
    },
    contextMenus: {
      removeAll(cb) { menus.length = 0; cb && cb(); },
      create(item) { menus.push(item); },
      onClicked: event(listeners.menu),
    },
    notifications: {
      create(id, opts) { notifications.push({ id, ...opts }); },
      clear(id, cb) { cb && cb(true); },
      onButtonClicked: event(listeners.notifBtn),
    },
    action: {
      async setBadgeText({ text }) { badge.text = text; },
      async setBadgeBackgroundColor({ color }) { badge.color = color; },
      async setBadgeTextColor() {},
    },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    commands: { onCommand: event(listeners.command), getAll: async () => clone(commandList) },
  };

  return {
    chrome,
    store,
    alarms,
    tabs,
    notifications,
    badge,
    menus,
    commandList,
    windowsCreated,
    scriptCalls,
    setScriptHandler(fn) { scriptHandler = fn; },
    get rules() { return dynamicRules; },
    fire: {
      installed: (reason = 'update') => Promise.all(listeners.installed.map((fn) => fn({ reason }))),
      alarm: (name) => Promise.all(listeners.alarm.map((fn) => fn({ name }))),
      command: (c, tab) => Promise.all(listeners.command.map((fn) => fn(c, tab))),
      menu: (info, tab) => Promise.all(listeners.menu.map((fn) => fn(info, tab))),
      tabUpdated: (id, info, tab) => Promise.all(listeners.tabUpdated.map((fn) => fn(id, info, tab))),
      tabActivated: (info) => Promise.all(listeners.tabActivated.map((fn) => fn(info))),
    },
  };
}
