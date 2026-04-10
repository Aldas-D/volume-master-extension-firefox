/* Volume Master - content.js */

(function () {
  if (window.__volumeMasterInit) return;
  window.__volumeMasterInit = true;

  let audioCtx          = null;
  let gainNode          = null;
  let activeFilterNodes = [];
  let currentVolume     = 100;
  let currentFilter     = 'default';

  // All media elements we have found, whether Web Audio connection succeeded or not.
  // Used for the el.volume fallback path.
  const mediaElements = new Set();

  // ── AudioContext ───────────────────────────────────────────────────────────

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      gainNode  = audioCtx.createGain();
      gainNode.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // ── Filter chain ───────────────────────────────────────────────────────────
  // Rebuilds from scratch each time, explicitly disconnecting and discarding
  // all previous filter nodes so nothing orphaned lingers in the graph.

  function buildFilterChain(vol, filter) {
    if (!audioCtx) return;

    try { gainNode.disconnect(); } catch (_) {}
    for (const n of activeFilterNodes) { try { n.disconnect(); } catch (_) {} }
    activeFilterNodes = [];

    if (filter === 'voice') {
      const hi   = audioCtx.createBiquadFilter();
      hi.type    = 'highpass'; hi.frequency.value = 300;

      const pk   = audioCtx.createBiquadFilter();
      pk.type    = 'peaking';  pk.frequency.value = 1000;
      pk.gain.value = 4;       pk.Q.value = 0.8;

      const lo   = audioCtx.createBiquadFilter();
      lo.type    = 'lowpass';  lo.frequency.value = 3400;

      gainNode.connect(hi); hi.connect(pk); pk.connect(lo);
      lo.connect(audioCtx.destination);
      activeFilterNodes = [hi, pk, lo];

    } else if (filter === 'bass') {
      const shelf = audioCtx.createBiquadFilter();
      shelf.type  = 'lowshelf'; shelf.frequency.value = 120; shelf.gain.value = 9;

      const sub   = audioCtx.createBiquadFilter();
      sub.type    = 'peaking';  sub.frequency.value = 60;
      sub.gain.value = 5;       sub.Q.value = 1.4;

      gainNode.connect(shelf); shelf.connect(sub);
      sub.connect(audioCtx.destination);
      activeFilterNodes = [shelf, sub];

    } else {
      gainNode.connect(audioCtx.destination);
    }

    gainNode.gain.setTargetAtTime(vol / 100, audioCtx.currentTime, 0.015);
  }

  // ── Apply volume to a single element ──────────────────────────────────────
  // el.volume handles 0–100% and is the authoritative fallback.
  // The Web Audio gain node handles amplification above 100%.

  function applyNativeVolume(el, vol) {
    // el.volume is 0.0–1.0; clamp so we never exceed 1 via this path
    el.volume = Math.min(1, Math.max(0, vol / 100));
  }

  // ── Connect element to Web Audio graph ────────────────────────────────────

  function connectElement(el) {
    mediaElements.add(el);

    // Always apply native volume immediately as a baseline — this guarantees
    // the 0–100% range works even if Web Audio connection fails.
    applyNativeVolume(el, currentVolume);

    if (el._vmConnected) return;
    el._vmConnected = true;

    const ctx = getAudioCtx();

    // Resume context on first play (autoplay policy)
    if (ctx.state === 'suspended') {
      const resume = () => { ctx.resume(); el.removeEventListener('play', resume); };
      el.addEventListener('play', resume);
    }

    try {
      const source = ctx.createMediaElementSource(el);
      source.connect(gainNode);
      gainNode.gain.setTargetAtTime(currentVolume / 100, ctx.currentTime, 0.015);
      el._vmGainConnected = true;
    } catch (_) {
      // The page already owns a MediaElementSourceNode for this element
      // (common on YouTube, Twitch, etc.). Web Audio is unavailable for it;
      // we fall back to el.volume which was already set above.
      el._vmConnected = false;
    }
  }

  function scanElements() {
    document.querySelectorAll('audio, video').forEach(connectElement);
  }

  // ── Apply volume to everything we know about ──────────────────────────────

  function applyVolume(vol, filter) {
    currentVolume = vol;
    currentFilter = filter;

    // Web Audio path: rebuild filter chain (handles gain > 1)
    if (audioCtx) buildFilterChain(vol, filter);

    // Native fallback path: set el.volume on all tracked elements.
    // This is the only working control for elements we couldn't claim,
    // and a useful safety net for the 0–100% range on all elements.
    for (const el of mediaElements) {
      applyNativeVolume(el, vol);
    }
  }

  // ── DOM observation ────────────────────────────────────────────────────────

  // document_start means the DOM may not exist yet — wait for it.
  function attachObserver() {
    scanElements();
    const observer = new MutationObserver(scanElements);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
  } else {
    attachObserver();
  }

  // ── Background handshake ──────────────────────────────────────────────────

  browser.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});

  // ── Message handler ────────────────────────────────────────────────────────

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SET_VOLUME') {
      applyVolume(msg.volume, msg.filter ?? currentFilter);
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_STATE') {
      sendResponse({ volume: currentVolume, filter: currentFilter });
    }
    return true;
  });

})();
