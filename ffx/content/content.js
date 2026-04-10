/* Volume Master - content.js */

(function () {
  if (window.__volumeMasterInit) return;
  window.__volumeMasterInit = true;

  let audioCtx      = null;
  let masterGain    = null;
  let activeFilters = [];
  let currentVolume = 100;
  let currentFilter = 'default';

  // ── Audio context ──────────────────────────────────────────────────────

  function getCtx() {
    if (!audioCtx) {
      audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // ── Filter chain ───────────────────────────────────────────────────────

  function buildFilterChain(vol, filter) {
    if (!audioCtx) return;

    try { masterGain.disconnect(); } catch (_) {}
    for (const n of activeFilters) { try { n.disconnect(); } catch (_) {} }
    activeFilters = [];

    if (filter === 'voice') {
      const hi   = audioCtx.createBiquadFilter();
      hi.type = 'highpass'; hi.frequency.value = 300;
      const peak = audioCtx.createBiquadFilter();
      peak.type = 'peaking'; peak.frequency.value = 1000;
      peak.gain.value = 4; peak.Q.value = 0.8;
      const lo   = audioCtx.createBiquadFilter();
      lo.type = 'lowpass'; lo.frequency.value = 3400;
      masterGain.connect(hi); hi.connect(peak); peak.connect(lo);
      lo.connect(audioCtx.destination);
      activeFilters = [hi, peak, lo];

    } else if (filter === 'bass') {
      const shelf = audioCtx.createBiquadFilter();
      shelf.type = 'lowshelf'; shelf.frequency.value = 120; shelf.gain.value = 9;
      const sub   = audioCtx.createBiquadFilter();
      sub.type = 'peaking'; sub.frequency.value = 60;
      sub.gain.value = 5; sub.Q.value = 1.4;
      masterGain.connect(shelf); shelf.connect(sub);
      sub.connect(audioCtx.destination);
      activeFilters = [shelf, sub];

    } else {
      masterGain.connect(audioCtx.destination);
      activeFilters = [];
    }

    masterGain.gain.setTargetAtTime(vol / 100, audioCtx.currentTime, 0.015);
  }

  // ── Per-element connection ─────────────────────────────────────────────
  // Each element gets its own elementGain node.
  // We override el.volume via Object.defineProperty so the site's own
  // volume control writes to elementGain instead of the real property.
  // The real HTMLMediaElement volume is kept at 1.0 permanently so it
  // never interferes with our gain graph.
  //
  // Graph: source → elementGain → masterGain → [filters] → destination

  function connectElement(el) {
    if (el._vmConnected) return;
    el._vmConnected = true;

    const ctx = getCtx();

    if (ctx.state === 'suspended') {
      const resume = () => { ctx.resume(); el.removeEventListener('play', resume); };
      el.addEventListener('play', resume);
    }

    try {
      const elementGain = ctx.createGain();

      // Snapshot whatever the site already set before we take over
      let _siteVolume = el.volume;
      elementGain.gain.value = _siteVolume;

      const source = ctx.createMediaElementSource(el);
      source.connect(elementGain);
      elementGain.connect(masterGain);

      // Lock the real element volume at 1.0 once, silently.
      // We use the native setter via the prototype to avoid triggering
      // our own override below.
      Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype, 'volume'
      ).set.call(el, 1.0);

      // Shadow the volume property on this specific element instance.
      // The site's JS reads/writes el.volume as normal — it just goes
      // through our getter/setter instead of the native one.
      Object.defineProperty(el, 'volume', {
        configurable: true,
        enumerable:   true,
        get() {
          return _siteVolume;
        },
        set(v) {
          const clamped = Math.min(1, Math.max(0, v));
          _siteVolume = clamped;
          // Route the site's volume intent into elementGain
          elementGain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
          // Fire volumechange so the site's own UI stays in sync
          el.dispatchEvent(new Event('volumechange'));
        }
      });

    } catch (e) {
      // Element already owned by another AudioContext — skip safely.
      el._vmConnected = false;
    }
  }

  function scanElements() {
    document.querySelectorAll('audio, video').forEach(connectElement);
  }

  scanElements();

  const observer = new MutationObserver(scanElements);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  browser.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});

  // ── Messages ───────────────────────────────────────────────────────────

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SET_VOLUME') {
      currentVolume = msg.volume;
      currentFilter = msg.filter ?? currentFilter;
      getCtx();
      buildFilterChain(currentVolume, currentFilter);
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_STATE') {
      sendResponse({ volume: currentVolume, filter: currentFilter });
    }
    return true;
  });
})();
