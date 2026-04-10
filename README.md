# Volume Master

A Firefox / LibreWolf extension for per-tab volume control. Boost any tab up to 600%, apply audio filters, and have every site remember its own settings across browser restarts.

![Firefox](https://img.shields.io/badge/Firefox-91%2B-orange?logo=firefox)
![LibreWolf](https://img.shields.io/badge/LibreWolf-compatible-blue)
![Manifest V2](https://img.shields.io/badge/Manifest-V2-lightgrey)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **0 – 600% volume** — amplify quiet tabs or silence loud ones
- **Per-site memory** — volume and filter settings are saved by hostname and restored automatically when you revisit a site, even after restarting the browser
- **Audio filters** — Default (flat), Voice boost (speech clarity), Bass boost (low-end punch)
- **Active audio panel** — see all tabs currently playing audio with their saved volume levels; click any to switch to it
- **Clean, minimal UI** — dark popup with a single accent color, no clutter

---

## Installation

### Temporary (for development / testing)

1. Clone or download this repository
2. Open LibreWolf / Firefox and navigate to `about:debugging`
3. Click **This Firefox** in the left sidebar
4. Click **Load Temporary Add-on...**
5. Select the `manifest.json` file inside the project folder

The extension stays loaded until you close the browser.

### Permanent (unsigned)

LibreWolf ships with signature enforcement disabled by default, so you can install it permanently:

1. Zip the project folder contents (not the folder itself — `manifest.json` must be at the root of the zip)
2. Rename the file to `volume-master.xpi`
3. In LibreWolf, go to `about:addons` → gear icon → **Install Add-on From File...**
4. Select the `.xpi` file

For standard Firefox you need to either sign the extension through Mozilla's process or set `xpinstall.signatures.required` to `false` in `about:config` first.

---

## Usage

Click the extension icon in the toolbar to open the popup.

**Slider** — drag left to reduce volume, right to boost it. The current value is shown above the slider as a large percentage readout.

**Presets:**
- **Default** — flat output, no filtering
- **Voice** — bandpass filter focused on the speech frequency range (~300–3400 Hz) with a presence boost around 1 kHz; useful for podcasts, calls, and videos where dialogue is hard to hear
- **Bass** — low-shelf boost at 120 Hz with a sub-punch peak at 60 Hz; useful for music

**Reset to 100%** — returns the current tab to default volume and clears the filter.

**Gear icon** — opens a confirmation dialog to wipe all saved per-site settings.

---

## Project structure

```
volume-master-firefox/
├── manifest.json
├── background/
│   └── background.js     # Tab tracking, storage, message routing
├── content/
│   └── content.js        # Web Audio API gain + filter injection
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── icons/
    ├── icon48.svg
    └── icon96.svg
```

---

## How it works

When a page loads, `content.js` creates a Web Audio API `AudioContext` and a `GainNode`, then wraps every `<audio>` and `<video>` element it finds (including ones added dynamically) in a `MediaElementSourceNode` connected to that gain node. Setting gain above `1.0` amplifies beyond the element's native maximum.

Audio filter presets (Voice, Bass) insert `BiquadFilterNode` chains between the gain node and the destination. Previous filter nodes are explicitly disconnected before a new chain is built, so no orphaned nodes accumulate over time.

The background script stores settings as `host:<hostname>` keys in `browser.storage.local`, which persists across sessions. When a tab finishes loading or the content script signals it is ready, the background looks up that hostname's saved settings and pushes them to the content script.

---

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Read tab URLs to key settings by hostname |
| `storage` | Persist per-site volume settings |
| `activeTab` | Read the active tab in the popup |
| `http://*/*` `https://*/*` | Inject the audio control script into web pages |

The content script is excluded from known sensitive domains (banking sites, password managers, cloud consoles, login pages). The full exclusion list is in `manifest.json`.

---

## Security notes

- The content script only attaches to `<audio>` and `<video>` elements. It does not read page content, form data, or DOM text.
- All volume values are clamped (0–600) and filter values are checked against a whitelist before being stored or applied.
- Background message handlers verify that popup-originated messages do not carry a `sender.tab` (preventing content scripts from impersonating the popup), and that content-script messages do carry one (preventing extension pages from impersonating content scripts).
- `browser.storage.local.clear()` is never called — the "Clear all" action removes only keys prefixed with `host:`.

---

## Browser compatibility

| Browser | Status |
|---|---|
| LibreWolf | ✅ Fully supported |
| Firefox 91+ | ✅ Fully supported |
| Firefox ESR | ✅ Should work |
| Chrome / Edge | ❌ Manifest V2 + `browser` API — would need porting |

---

## License

MIT
