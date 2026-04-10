/* Volume Master - popup.js */

const slider    = document.getElementById('volumeSlider');
const volNumber = document.getElementById('volNumber');
const resetBtn  = document.getElementById('resetBtn');
const settingsBtn=document.getElementById('settingsBtn');
const presetBtns= document.querySelectorAll('.preset-btn');
const audioList = document.getElementById('audioTabsList');
const emptyState= document.getElementById('emptyState');
const modalOverlay=document.getElementById('modalOverlay');
const modalCancel =document.getElementById('modalCancel');
const modalConfirm=document.getElementById('modalConfirm');

let currentTabId = null;
let currentFilter = 'default';
let debounceTimer = null;

function debounce(fn, ms) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;
  currentTabId = tabs[0].id;

  // Get saved state from background
  const state = await browser.runtime.sendMessage({
    type: 'POPUP_GET_STATE',
    tabId: currentTabId
  });

  const vol = (state && state.volume != null) ? state.volume : 100;
  currentFilter = (state && state.filter) || 'default';

  slider.value = vol;
  updateDisplay(vol);
  updateFilterUI(currentFilter);

  await refreshAudioTabs();
}

// ── Volume display ────────────────────────────────────────────────────────

function updateDisplay(vol) {
  volNumber.textContent = Math.round(vol);
}

function updateFilterUI(filter) {
  presetBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
}

// ── Slider events ─────────────────────────────────────────────────────────

// Single 'input' listener with a short debounce so rapid dragging sends one
// message at the end of the gesture rather than flooding the background.
// The display updates instantly; only the network call is debounced.
slider.addEventListener('input', () => {
  const vol = Number(slider.value);
  updateDisplay(vol);
  debounce(() => sendVolume(vol, currentFilter), 40);
});

// ── Presets ───────────────────────────────────────────────────────────────

presetBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    currentFilter = btn.dataset.filter;
    updateFilterUI(currentFilter);
    await sendVolume(Number(slider.value), currentFilter);
  });
});

// ── Reset ─────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', async () => {
  slider.value = 100;
  currentFilter = 'default';
  updateDisplay(100);
  updateFilterUI('default');
  await browser.runtime.sendMessage({ type: 'POPUP_RESET', tabId: currentTabId });
  await refreshAudioTabs();
});

// ── Settings / clear all ──────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  modalOverlay.style.display = 'grid';
});

modalCancel.addEventListener('click', () => {
  modalOverlay.style.display = 'none';
});

modalConfirm.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'POPUP_CLEAR_ALL' });
  modalOverlay.style.display = 'none';
  // Reset current tab to 100%
  slider.value = 100;
  updateDisplay(100);
  currentFilter = 'default';
  updateFilterUI('default');
  await sendVolume(100, 'default');
});

// ── Send volume to background ─────────────────────────────────────────────

async function sendVolume(volume, filter) {
  if (!currentTabId) return;
  try {
    await browser.runtime.sendMessage({
      type: 'POPUP_SET_VOLUME',
      tabId: currentTabId,
      volume,
      filter
    });
    await refreshAudioTabs();
  } catch (e) {
    console.warn('Volume Master: could not send volume', e);
  }
}

// ── Audio tabs list ───────────────────────────────────────────────────────

async function refreshAudioTabs() {
  const tabs = await browser.runtime.sendMessage({ type: 'POPUP_GET_AUDIO_TABS' });

  // Clear existing tab items (keep emptyState)
  Array.from(audioList.children).forEach(el => {
    if (el !== emptyState) el.remove();
  });

  if (!tabs || tabs.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = 'audio-tab-item' + (tab.id === currentTabId ? ' is-current' : '');

    // Favicon
    let faviconEl;
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
      faviconEl = document.createElement('img');
      faviconEl.className = 'tab-favicon';
      faviconEl.src = tab.favIconUrl;
      faviconEl.onerror = () => { faviconEl.style.display='none'; };
    } else {
      faviconEl = document.createElement('div');
      faviconEl.className = 'tab-favicon-placeholder';
      faviconEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    }

    // Info
    const info = document.createElement('div');
    info.className = 'tab-info';

    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = tab.title || 'Unnamed tab';

    const host = document.createElement('div');
    host.className = 'tab-host';
    try { host.textContent = new URL(tab.url).hostname; } catch { host.textContent = ''; }

    info.append(title, host);

    // Volume badge
    const badge = document.createElement('div');
    badge.className = 'tab-vol-badge';
    badge.textContent = `${Math.round(tab.volume)}%`;

    item.append(faviconEl, info, badge);

    // Click to switch focus to that tab and reload popup state
    item.addEventListener('click', async () => {
      await browser.tabs.update(tab.id, { active: true });
      window.close();
    });

    audioList.appendChild(item);
  });
}

// ── Go ────────────────────────────────────────────────────────────────────

init().catch(console.error);

// Refresh audio tabs every 2s while popup is open
setInterval(refreshAudioTabs, 2000);
