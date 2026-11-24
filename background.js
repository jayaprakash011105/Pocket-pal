// Minimal service worker. The authoritative settings schema/defaults live in
// utils/storage.js and are seeded lazily by the first content/extension page
// that calls Storage.ensureDefaults() — kept out of this file so there is a
// single source of truth instead of two schemas that can drift apart.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage?.();
  }
});

// Hotkey: hide/show the pal on every tab. Only toggles once the pal has been
// initialised (the schema defaults live in utils/storage.js, not here).
chrome.commands?.onCommand.addListener((command) => {
  if (command !== 'toggle-hidden') return;
  chrome.storage.local.get('pocketPal', (result) => {
    if (!result.pocketPal) return;
    chrome.storage.local.set({ pocketPal: { ...result.pocketPal, hidden: !result.pocketPal.hidden } });
  });
});

const READABLE_RESOURCES =new Set(['content/content.css', 'characters/manifest.json']);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (message?.type === 'get-resource') {
    if (!READABLE_RESOURCES.has(message.path)) {
      sendResponse({ error: 'resource not allowed' });
      return false;
    }
    fetch(chrome.runtime.getURL(message.path))
      .then((res) => res.text())
      .then((text) => sendResponse({ text }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (message?.type === 'get-sprite') {
    if (!/^[a-z0-9-]+$/.test(message.id || '')) {
      sendResponse({ error: 'bad id' });
      return false;
    }
    fetch(chrome.runtime.getURL(`characters/sprites/${message.id}.png`))
      .then((res) => res.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        sendResponse({ base64: btoa(binary) });
      })
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  return false;
});
