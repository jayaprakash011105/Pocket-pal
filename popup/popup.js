(function () {
  const { Storage, Characters, Utils } = window.PocketPal;
  const THREE = window.THREE;

  let state = null;
  let manifestData = null;
  let activeTab = null;

  const els = {
    tabs: document.querySelectorAll('.tab'),
    panels: {
      home: document.getElementById('panel-home'),
      characters: document.getElementById('panel-characters'),
      settings: document.getElementById('panel-settings'),
    },
    enabledToggle: document.getElementById('enabled-toggle'),
    statusText: document.getElementById('status-text'),
    currentName: document.getElementById('current-name'),
    currentTag: document.getElementById('current-tag'),
    gallery: document.getElementById('gallery'),
    btnPlay: document.getElementById('btn-play'),
    btnDance: document.getElementById('btn-dance'),
    btnSleep: document.getElementById('btn-sleep'),
    btnHop: document.getElementById('btn-hop'),
    btnBall: document.getElementById('btn-ball'),
    btnWave: document.getElementById('btn-wave'),
    btnPerch: document.getElementById('btn-perch'),
    btnPeek: document.getElementById('btn-peek'),
    petCount: document.getElementById('petCount'),
    btnHideNow: document.getElementById('btn-hide-now'),
    animationStyle: document.getElementById('animationStyle'),
    btnHideSite: document.getElementById('btn-hide-site'),
    btnOpenOptions: document.getElementById('btn-open-options'),
    scale: document.getElementById('scale'),
    walkSpeed: document.getElementById('walkSpeed'),
    behavior: document.getElementById('behavior'),
    sound: document.getElementById('sound'),
    reducedMotion: document.getElementById('reducedMotion'),
    unlockProgress: document.getElementById('unlock-progress'),
  };

  // ---- Tabs ---------------------------------------------------------------

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => t.classList.toggle('active', t === tab));
      Object.entries(els.panels).forEach(([key, panel]) => {
        panel.classList.toggle('hidden', key !== tab.dataset.tab);
      });
    });
  });

  function spriteUrl(def) {
    return def.sprite ? chrome.runtime.getURL(def.sprite) : '';
  }

  function setPreviewCharacter(def) {
    const img = document.getElementById('preview-img');
    img.src = spriteUrl(def);
    img.style.visibility = def.sprite ? 'visible' : 'hidden';
    els.currentName.textContent = def.name;
    els.currentTag.textContent = def.tagline;
  }

  // ---- Gallery --------------------------------------------------------------

  function renderGallery() {
    els.gallery.innerHTML = '';
    manifestData.characters.forEach((def) => {
      const unlocked = state.unlockedCharacters.includes(def.id);
      const tile = document.createElement('div');
      tile.className = `tile${def.id === state.currentCharacter ? ' selected' : ''}${unlocked ? '' : ' locked'}`;

      const face = document.createElement('img');
      face.className = 'tile-face';
      face.src = spriteUrl(def);
      face.alt = '';

      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = def.name;

      tile.append(face, name);

      if (!unlocked) {
        const lock = document.createElement('div');
        lock.className = 'tile-lock';
        lock.textContent = '🔒';
        tile.appendChild(lock);
        tile.title = `Unlocks after ${def.unlockRequirement.count} interactions`;
      }

      tile.addEventListener('click', () => {
        if (!unlocked) return;
        Storage.set({ currentCharacter: def.id });
      });

      els.gallery.appendChild(tile);
    });
  }

  function renderUnlockProgress() {
    const total = (state.stats && state.stats.totalInteractions) || 0;
    const next = manifestData.characters
      .filter((c) => c.unlockRequirement && !state.unlockedCharacters.includes(c.id))
      .sort((a, b) => a.unlockRequirement.count - b.unlockRequirement.count)[0];
    els.unlockProgress.textContent = next
      ? `${total} / ${next.unlockRequirement.count} interactions to unlock ${next.name}`
      : 'All pals unlocked!';
  }

  // ---- Bindings ---------------------------------------------------------------

  function renderAll() {
    if (!state || !manifestData) return;
    els.enabledToggle.checked = state.enabled;
    const def = manifestData.characters.find((c) => c.id === state.currentCharacter) || manifestData.characters[0];
    setPreviewCharacter(def);
    renderGallery();
    renderUnlockProgress();

    els.scale.value = state.settings.scale;
    els.walkSpeed.value = state.settings.walkSpeed;
    els.behavior.value = state.settings.behavior;
    els.sound.checked = state.settings.soundEnabled;
    els.reducedMotion.checked = state.settings.reducedMotion;
    els.animationStyle.value = state.settings.animationStyle;
    els.petCount.value = String(state.settings.petCount);
    els.btnHideNow.textContent = state.hidden ? 'Show Pocket Pal again (Alt+Shift+P)' : 'Hide for now (Alt+Shift+P)';

    updateStatusText();
  }

  function updateStatusText() {
    if (!activeTab || !activeTab.url || Utils.isRestrictedUrl(activeTab.url)) {
      els.statusText.textContent = 'Unavailable on this page';
      return;
    }
    const host = new URL(activeTab.url).hostname;
    if (!state.enabled) {
      els.statusText.textContent = 'Disabled';
    } else if (state.hidden) {
      els.statusText.textContent = 'Hidden for now';
    } else if (state.perSiteDisabled.includes(host)) {
      els.statusText.textContent = 'Hidden on this site';
    } else {
      els.statusText.textContent = 'Active on this page';
    }
  }

  els.enabledToggle.addEventListener('change', () => {
    Storage.set({ enabled: els.enabledToggle.checked });
  });

  els.scale.addEventListener('input', () => Storage.set({ settings: { scale: Number(els.scale.value) } }));
  els.walkSpeed.addEventListener('input', () => Storage.set({ settings: { walkSpeed: Number(els.walkSpeed.value) } }));
  els.behavior.addEventListener('change', () => Storage.set({ settings: { behavior: els.behavior.value } }));
  els.sound.addEventListener('change', () => Storage.set({ settings: { soundEnabled: els.sound.checked } }));
  els.reducedMotion.addEventListener('change', () => Storage.set({ settings: { reducedMotion: els.reducedMotion.checked } }));

  els.btnOpenOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  function sendActionToTab(action) {
    if (!activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'pp-action', action }, () => void chrome.runtime.lastError);
  }

  els.btnPlay.addEventListener('click', () => sendActionToTab('play'));
  els.btnDance.addEventListener('click', () => sendActionToTab('dance'));
  els.btnSleep.addEventListener('click', () => sendActionToTab('sleep'));
  els.btnHop.addEventListener('click', () => sendActionToTab('hop'));
  els.btnBall.addEventListener('click', () => sendActionToTab('ball'));
  els.btnWave.addEventListener('click', () => sendActionToTab('wave'));
  els.btnPerch.addEventListener('click', () => sendActionToTab('perch'));
  els.btnPeek.addEventListener('click', () => sendActionToTab('peek'));
  els.petCount.addEventListener('change', () => Storage.set({ settings: { petCount: Number(els.petCount.value) } }));
  els.btnHideNow.addEventListener('click', () => Storage.set({ hidden: !state.hidden }));
  els.animationStyle.addEventListener('change', () => Storage.set({ settings: { animationStyle: els.animationStyle.value } }));

  els.btnHideSite.addEventListener('click', () => {
    if (!activeTab || !activeTab.url) return;
    const host = new URL(activeTab.url).hostname;
    const list = state.perSiteDisabled.includes(host) ? state.perSiteDisabled : state.perSiteDisabled.concat(host);
    Storage.set({ perSiteDisabled: list }).then(() => updateStatusText());
  });

  Storage.onChange((next) => {
    state = next;
    renderAll();
  });

  Promise.all([
    Storage.ensureDefaults(),
    Characters.loadManifest(),
    new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))),
  ]).then(([s, manifest, tab]) => {
    state = s;
    manifestData = manifest;
    activeTab = tab;
    renderAll();
  });
})();
