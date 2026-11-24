// Thin wrapper around chrome.storage.local with schema defaults + change events.
// Loaded as a classic script in content scripts, popup and options pages alike.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});

  const DEFAULTS = {
    enabled: true,
    currentCharacter: 'mochi',
    unlockedCharacters: ['mochi', 'coco', 'robo', 'lumi', 'pip', 'slime', 'puff', 'jelly', 'rex'],
    perSiteDisabled: [],
    hidden: false, // "Hide for now": hidden on every tab until shown again
    customCharacters: [],
    stats: {
      totalInteractions: 0,
    },
    settings: {
      scale: 1.0,
      walkSpeed: 1.0,
      animSpeed: 1.0,
      behavior: 'wander', // 'wander' | 'followCursor' | 'avoidCursor' | 'stationary'
      soundEnabled: true,
      shadowIntensity: 0.5,
      autoSleepMinutes: 5,
      interactionSensitivity: 1.0,
      reducedMotion: false,
      accessories: [],
      outfit: 'none',
      animationStyle: 'float', // 'float' | 'walk' | 'bounce'
      windowHopping: true,
      pageAwareness: true,
      rememberPosition: true,
      petCount: 1, // 1-3 pals on screen at once
      pageInteraction: true, // perch on headings/images/inputs, peek from edges
      idleAnimations: true, // wave, yawn, sneeze
      petInteractions: true, // pals chase, greet and nap together
      trail: 'sparkles', // 'sparkles' | 'bubbles' | 'hearts' | 'none' (behind floating pals)
      seasonal: 'auto', // 'auto' | 'off' | 'santa' | 'ghost'
    },
  };

  function deepMerge(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!override) return out;
    for (const key of Object.keys(override)) {
      const value = override[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object') {
        out[key] = deepMerge(base[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // After the extension is reloaded or updated, content scripts already running
  // in open tabs are orphaned: chrome.storage throws or calls back with an
  // undefined result. These wrappers treat that as "nothing stored" instead of
  // throwing inside a callback.
  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function readKey(key) {
    return new Promise((resolve) => {
      if (!extensionAlive()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(key, (result) => {
          void chrome.runtime.lastError;
          resolve(result || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function writeKeys(items) {
    return new Promise((resolve) => {
      if (!extensionAlive()) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set(items, () => {
          void chrome.runtime.lastError;
          resolve(true);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function get() {
    return readKey('pocketPal').then((result) => deepMerge(DEFAULTS, result.pocketPal));
  }

  // Writes are queued so two quick changes (say, two dropdowns) can't each
  // read the old state and overwrite the other's update.
  let writeQueue = Promise.resolve();

  function set(partialState) {
    const run = writeQueue.then(() => get().then((current) => {
      const merged = deepMerge(current, partialState);
      return writeKeys({ pocketPal: merged }).then(() => merged);
    }));
    writeQueue = run.catch(() => undefined);
    return run;
  }

  // Resets settings/behaviour to defaults but keeps unlock progress and any
  // custom-uploaded characters, since "reset settings" shouldn't delete those.
  function reset() {
    return get().then((current) => {
      const next = {
        ...DEFAULTS,
        unlockedCharacters: current.unlockedCharacters,
        stats: current.stats,
        customCharacters: current.customCharacters,
      };
      return writeKeys({ pocketPal: next }).then(() => next);
    });
  }

  function ensureDefaults() {
    return readKey('pocketPal').then((result) => {
      if (result.pocketPal) return deepMerge(DEFAULTS, result.pocketPal);
      return writeKeys({ pocketPal: DEFAULTS }).then(() => DEFAULTS);
    });
  }

  function onChange(callback) {
    const listener = (changes, areaName) => {
      if (areaName !== 'local' || !changes || !changes.pocketPal) return;
      callback(deepMerge(DEFAULTS, changes.pocketPal.newValue), changes.pocketPal.oldValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch (e) {
        // context already gone
      }
    };
  }

  // The pal's last position lives under its own key so the frequent writes
  // don't fire settings change events (and re-renders) in every open tab.
  const POSITION_KEY = 'pocketPalPos';

  function getPosition() {
    return readKey(POSITION_KEY).then((result) => result[POSITION_KEY] || null);
  }

  function setPosition(position) {
    return writeKeys({ [POSITION_KEY]: position }).then(() => undefined);
  }

  PocketPal.Storage = { DEFAULTS, get, set, ensureDefaults, onChange, reset, getPosition, setPosition, extensionAlive };
})(window);
