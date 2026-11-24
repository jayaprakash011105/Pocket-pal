// Shared math/DOM helpers, exposed as a global namespace since content scripts
// are loaded as classic (non-module) scripts for Manifest V3 compatibility.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomInt(min, max) {
    return Math.floor(randomRange(min, max + 1));
  }

  function pick(array) {
    return array[randomInt(0, array.length - 1)];
  }

  function chance(probability) {
    return Math.random() < probability;
  }

  function throttle(fn, waitMs) {
    let last = 0;
    let timeout = null;
    return function throttled(...args) {
      const now = performance.now();
      const remaining = waitMs - (now - last);
      if (remaining <= 0) {
        last = now;
        fn.apply(this, args);
      } else if (!timeout) {
        timeout = setTimeout(() => {
          last = performance.now();
          timeout = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  function debounce(fn, waitMs) {
    let timeout = null;
    return function debounced(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), waitMs);
    };
  }

  function isRestrictedUrl(href) {
    return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(href);
  }

  function prefersReducedMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  // Content scripts on web pages cannot fetch chrome-extension:// URLs unless
  // they are web-accessible (which would expose them to every page), so bundled
  // text files are read through the background service worker instead.
  function loadExtensionText(path) {
    if (global.location.protocol === 'chrome-extension:') {
      return fetch(chrome.runtime.getURL(path)).then((res) => res.text());
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'get-resource', path }, (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          reject(new Error((response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'resource load failed'));
        } else {
          resolve(response.text);
        }
      });
    });
  }

  function dataUrlToArrayBuffer(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Sprites go through the background worker too; ImageBitmap avoids page
  // CSP img-src restrictions that data: URLs would hit.
  function loadSpriteBitmap(id) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'get-sprite', id }, (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          reject(new Error('sprite load failed'));
          return;
        }
        const binary = atob(response.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        createImageBitmap(new Blob([bytes], { type: 'image/png' })).then(resolve, reject);
      });
    });
  }

  PocketPal.Utils = {
    loadSpriteBitmap,
    loadExtensionText,
    dataUrlToArrayBuffer,
    clamp,
    lerp,
    randomRange,
    randomInt,
    pick,
    chance,
    throttle,
    debounce,
    isRestrictedUrl,
    prefersReducedMotion,
    easeOutCubic,
    easeInOutSine,
  };
})(window);
