/* Volume Master - background.js
   Tracks per-tab volume, persists per-hostname settings,
   re-applies saved volume when tabs navigate or reload.
*/

const DEFAULT_VOLUME = 100;
const VALID_FILTERS   = new Set(['default', 'voice', 'bass']);
const STORAGE_PREFIX  = 'host:';
const tabState = {}; // { [tabId]: { volume, filter, hostname } }

// ── Helpers ────────────────────────────────────────────────────────────────

function hostnameFromUrl(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname || null;
  } catch {
    return null;
  }
}

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.min(600, Math.max(0, Math.round(n)));
}

function sanitiseFilter(f) {
  return VALID_FILTERS.has(f) ? f : 'default';
}

async function loadSavedVolume(hostname) {
  const key    = `${STORAGE_PREFIX}${hostname}`;
  const result = await browser.storage.local.get(key);
  const saved  = result[key];
  if (!saved) return { volume: DEFAULT_VOLUME, filter: 'default' };
  return {
    volume: clampVolume(saved.volume),
    filter: sanitiseFilter(saved.filter),
  };
}

async function saveVolume(hostname, volume, filter) {
  const key = `${STORAGE_PREFIX}${hostname}`;
  await browser.storage.local.set({
    [key]: { volume: clampVolume(volume), filter: sanitiseFilter(filter) }
  });
}

// Delete only keys this extension owns (host: prefix), not unrelated storage.
async function clearAllHostKeys() {
  const all  = await browser.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));
  if (keys.length) await browser.storage.local.remove(keys);
}

async function applyToTab(tabId, volume, filter) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type:   'SET_VOLUME',
      volume: clampVolume(volume),
      filter: sanitiseFilter(filter),
    });
  } catch (_) {
    // Content script not ready or page has no audio — safe to ignore
  }
}

// Verify a tab exists and is a normal http/https page. Returns tab or null.
async function resolveHttpTab(tabId) {
  if (typeof tabId !== 'number') return null;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab || !tab.url) return null;
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return null;
    return tab;
  } catch {
    return null;
  }
}

// ── Tab lifecycle ──────────────────────────────────────────────────────────

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const hostname = hostnameFromUrl(tab.url);
  if (!hostname) return;

  const saved = await loadSavedVolume(hostname);
  tabState[tabId] = { hostname, ...saved };
  await applyToTab(tabId, saved.volume, saved.filter);
});

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId];
});

// ── Messages ───────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(async (msg, sender) => {

  // ── From content script ──────────────────────────────────────────────────
  if (msg.type === 'CONTENT_READY') {
    // Must originate from a real browser tab, not another extension or page script.
    if (!sender.tab || !sender.tab.id) return;
    const tab = await resolveHttpTab(sender.tab.id);
    if (!tab) return;

    const hostname = hostnameFromUrl(tab.url);
    if (!hostname) return;

    const saved = await loadSavedVolume(hostname);
    tabState[tab.id] = { hostname, ...saved };
    await applyToTab(tab.id, saved.volume, saved.filter);
    return;
  }

  // ── From popup ───────────────────────────────────────────────────────────
  // Popup messages must NOT carry sender.tab. Reject anything that does —
  // a content script should never be able to impersonate the popup.
  if (sender.tab) return;

  if (msg.type === 'POPUP_SET_VOLUME') {
    const tab = await resolveHttpTab(msg.tabId);
    if (!tab) return { ok: false, reason: 'invalid tab' };

    const hostname = hostnameFromUrl(tab.url);
    if (!hostname) return { ok: false, reason: 'non-http tab' };

    const volume = clampVolume(msg.volume);
    const filter = sanitiseFilter(msg.filter);

    tabState[tab.id] = { hostname, volume, filter };
    await saveVolume(hostname, volume, filter);
    await applyToTab(tab.id, volume, filter);
    return { ok: true };
  }

  if (msg.type === 'POPUP_GET_STATE') {
    const tab = await resolveHttpTab(msg.tabId);
    if (!tab) return { volume: DEFAULT_VOLUME, filter: 'default' };

    const hostname = hostnameFromUrl(tab.url);
    if (!hostname) return { volume: DEFAULT_VOLUME, filter: 'default' };

    if (tabState[tab.id]) return tabState[tab.id];

    const saved = await loadSavedVolume(hostname);
    tabState[tab.id] = { hostname, ...saved };
    return tabState[tab.id];
  }

  if (msg.type === 'POPUP_RESET') {
    const tab = await resolveHttpTab(msg.tabId);
    if (!tab) return { ok: false };

    const hostname = hostnameFromUrl(tab.url);
    if (!hostname) return { ok: false };

    tabState[tab.id] = { hostname, volume: DEFAULT_VOLUME, filter: 'default' };
    await saveVolume(hostname, DEFAULT_VOLUME, 'default');
    await applyToTab(tab.id, DEFAULT_VOLUME, 'default');
    return { ok: true };
  }

  if (msg.type === 'POPUP_CLEAR_ALL') {
    await clearAllHostKeys();
    // Reset in-memory cache too so live tabs reflect the wipe immediately
    for (const id of Object.keys(tabState)) {
      tabState[id].volume = DEFAULT_VOLUME;
      tabState[id].filter = 'default';
    }
    return { ok: true };
  }

  if (msg.type === 'POPUP_GET_AUDIO_TABS') {
    const tabs = await browser.tabs.query({ audible: true });
    return tabs
      .filter(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')))
      .map(t => ({
        id:         t.id,
        title:      t.title,
        url:        t.url,
        favIconUrl: t.favIconUrl,
        volume:     tabState[t.id]?.volume ?? DEFAULT_VOLUME,
      }));
  }
});
