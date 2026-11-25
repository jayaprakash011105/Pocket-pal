(function () {
  const { Storage, Characters } = window.PocketPal;
  const THREE = window.THREE;

  let state = null;
  let manifestData = null;
  let activeCategory = 'All';

  const nav = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.section');

  nav.forEach((btn) => {
    btn.addEventListener('click', () => {
      nav.forEach((b) => b.classList.toggle('active', b === btn));
      sections.forEach((s) => s.classList.toggle('hidden', s.id !== `section-${btn.dataset.section}`));
    });
  });

  const els = {
    enabled: document.getElementById('enabled'),
    scale: document.getElementById('scale'),
    scaleVal: document.getElementById('scale-val'),
    shadowIntensity: document.getElementById('shadowIntensity'),
    shadowVal: document.getElementById('shadow-val'),
    soundEnabled: document.getElementById('soundEnabled'),
    reducedMotion: document.getElementById('reducedMotion'),
    behavior: document.getElementById('behavior'),
    walkSpeed: document.getElementById('walkSpeed'),
    walkSpeedVal: document.getElementById('walkSpeed-val'),
    animSpeed: document.getElementById('animSpeed'),
    animSpeedVal: document.getElementById('animSpeed-val'),
    autoSleepMinutes: document.getElementById('autoSleepMinutes'),
    autoSleepVal: document.getElementById('autoSleep-val'),
    interactionSensitivity: document.getElementById('interactionSensitivity'),
    sensitivityVal: document.getElementById('sensitivity-val'),
    categoryChips: document.getElementById('category-chips'),
    gallery: document.getElementById('gallery'),
    accessoryList: document.getElementById('accessory-list'),
    outfitChips: document.getElementById('outfit-chips'),
    outfitNote: document.getElementById('outfit-note'),
    animationStyle: document.getElementById('animationStyle'),
    windowHopping: document.getElementById('windowHopping'),
    pageAwareness: document.getElementById('pageAwareness'),
    rememberPosition: document.getElementById('rememberPosition'),
    pageInteraction: document.getElementById('pageInteraction'),
    idleAnimations: document.getElementById('idleAnimations'),
    petCount: document.getElementById('petCount'),
    petInteractions: document.getElementById('petInteractions'),
    trail: document.getElementById('trail'),
    seasonal: document.getElementById('seasonal'),
    customUpload: document.getElementById('custom-upload'),
    customList: document.getElementById('custom-list'),
    siteList: document.getElementById('site-list'),
    btnReset: document.getElementById('btn-reset'),
  };

  function bindRange(input, label, suffix) {
    input.addEventListener('input', () => {
      if (label) label.textContent = `${input.value}${suffix || ''}`;
    });
  }
  bindRange(els.scale, els.scaleVal, 'x');
  bindRange(els.shadowIntensity, els.shadowVal, '');
  bindRange(els.walkSpeed, els.walkSpeedVal, 'x');
  bindRange(els.animSpeed, els.animSpeedVal, 'x');
  bindRange(els.autoSleepMinutes, els.autoSleepVal, ' min');
  bindRange(els.interactionSensitivity, els.sensitivityVal, 'x');

  function save(partial) {
    Storage.set(partial);
  }

  els.enabled.addEventListener('change', () => save({ enabled: els.enabled.checked }));
  els.scale.addEventListener('change', () => save({ settings: { scale: Number(els.scale.value) } }));
  els.shadowIntensity.addEventListener('change', () => save({ settings: { shadowIntensity: Number(els.shadowIntensity.value) } }));
  els.soundEnabled.addEventListener('change', () => save({ settings: { soundEnabled: els.soundEnabled.checked } }));
  els.reducedMotion.addEventListener('change', () => save({ settings: { reducedMotion: els.reducedMotion.checked } }));
  els.behavior.addEventListener('change', () => save({ settings: { behavior: els.behavior.value } }));
  els.walkSpeed.addEventListener('change', () => save({ settings: { walkSpeed: Number(els.walkSpeed.value) } }));
  els.animSpeed.addEventListener('change', () => save({ settings: { animSpeed: Number(els.animSpeed.value) } }));
  els.autoSleepMinutes.addEventListener('change', () => save({ settings: { autoSleepMinutes: Number(els.autoSleepMinutes.value) } }));
  els.interactionSensitivity.addEventListener('change', () => save({ settings: { interactionSensitivity: Number(els.interactionSensitivity.value) } }));
  els.animationStyle.addEventListener('change', () => save({ settings: { animationStyle: els.animationStyle.value } }));
  els.windowHopping.addEventListener('change', () => save({ settings: { windowHopping: els.windowHopping.checked } }));
  els.pageAwareness.addEventListener('change', () => save({ settings: { pageAwareness: els.pageAwareness.checked } }));
  els.rememberPosition.addEventListener('change', () => save({ settings: { rememberPosition: els.rememberPosition.checked } }));
  els.pageInteraction.addEventListener('change', () => save({ settings: { pageInteraction: els.pageInteraction.checked } }));
  els.idleAnimations.addEventListener('change', () => save({ settings: { idleAnimations: els.idleAnimations.checked } }));
  els.petInteractions.addEventListener('change', () => save({ settings: { petInteractions: els.petInteractions.checked } }));
  els.petCount.addEventListener('change', () => save({ settings: { petCount: Number(els.petCount.value) } }));
  els.trail.addEventListener('change', () => save({ settings: { trail: els.trail.value, theme: 'custom' } }));
  // Christmas theme controls: every [data-xmas*] control writes settings.christmas.<key>.
  const xmasPatch = (patch) => save({ settings: { christmas: patch } });
  document.querySelectorAll('[data-xmas]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.xmas;
      if (key === 'enabled') {
        // the full Christmas theme replaces the lighter Snow theme
        save({ settings: { christmas: { enabled: input.checked }, theme: input.checked ? 'christmas' : 'classic', seasonal: input.checked ? 'off' : 'auto' } });
      } else {
        xmasPatch({ [key]: input.checked });
      }
    });
  });
  document.querySelectorAll('[data-xmas-deco]').forEach((input) => {
    input.addEventListener('change', () => xmasPatch({ deco: { [input.dataset.xmasDeco]: input.checked } }));
  });
  document.querySelectorAll('[data-xmas-range]').forEach((input) => {
    input.addEventListener('input', () => {
      const label = document.querySelector(`[data-xmas-val="${input.dataset.xmasRange}"]`);
      if (label) label.textContent = Number(input.value).toFixed(2).replace(/\.?0+$/, '');
    });
    input.addEventListener('change', () => xmasPatch({ [input.dataset.xmasRange]: Number(input.value) }));
  });
  document.querySelectorAll('[data-xmas-select]').forEach((select) => {
    select.addEventListener('change', () => xmasPatch({ [select.dataset.xmasSelect]: select.value }));
  });

  els.seasonal.addEventListener('change', () => save({ settings: { seasonal: els.seasonal.value, theme: 'custom' } }));

  els.btnReset.addEventListener('click', () => {
    if (confirm('Reset all Pocket Pal settings to defaults? Unlocked characters and custom models are kept.')) {
      Storage.reset();
    }
  });

  // ---- Characters gallery ----------------------------------------------

  function renderCategoryChips() {
    if (!manifestData) return;
    const cats = ['All'].concat(manifestData.categories || []);
    els.categoryChips.innerHTML = '';
    cats.forEach((cat) => {
      const chip = document.createElement('button');
      chip.className = `chip${cat === activeCategory ? ' active' : ''}`;
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        activeCategory = cat;
        renderCategoryChips();
        renderGallery();
      });
      els.categoryChips.appendChild(chip);
    });
  }

  function renderGallery() {
    els.gallery.innerHTML = '';
    if (!manifestData) return;
    const list = manifestData.characters.filter((c) => activeCategory === 'All' || c.category === activeCategory);
    if (!list.length) {
      els.gallery.innerHTML = '<p class="empty">No characters in this category yet.</p>';
      return;
    }
    list.forEach((def) => {
      const unlocked = state.unlockedCharacters.includes(def.id) || def.custom;
      const tile = document.createElement('div');
      tile.className = `tile${def.id === state.currentCharacter ? ' selected' : ''}${unlocked ? '' : ' locked'}`;

      const face = document.createElement('img');
      face.className = 'tile-face';
      face.src = def.sprite ? chrome.runtime.getURL(def.sprite) : '../assets/icons/icon48.png';
      face.alt = '';

      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = def.name;
      const tag = document.createElement('div');
      tag.className = 'tile-tag';
      tag.textContent = def.tagline || def.category;

      tile.append(face, name, tag);

      if (!unlocked) {
        const lock = document.createElement('div');
        lock.className = 'tile-lock';
        lock.textContent = '🔒';
        tile.appendChild(lock);
        tile.title = `Unlocks after ${def.unlockRequirement.count} interactions`;
      }

      tile.addEventListener('click', () => {
        if (!unlocked) return;
        save({ currentCharacter: def.id });
      });

      els.gallery.appendChild(tile);
    });
  }

  // ---- Accessories ----------------------------------------------------------

  const { Accessories } = window.PocketPal;

  // An outfit is just a saved accessory list; picking a piece by hand clears
  // the outfit label (unless the result happens to match one).
  function matchingOutfit(items) {
    const key = items.slice().sort().join('|');
    const hit = Accessories.OUTFITS.find((o) => o.items.slice().sort().join('|') === key);
    return hit ? hit.id : 'custom';
  }

  function renderOutfits() {
    els.outfitChips.innerHTML = '';
    Accessories.OUTFITS.forEach((outfit) => {
      const chip = document.createElement('button');
      chip.className = `chip${state.settings.outfit === outfit.id ? ' active' : ''}`;
      chip.textContent = outfit.label;
      chip.addEventListener('click', () => {
        save({ settings: { outfit: outfit.id, accessories: outfit.items, theme: 'custom' } });
      });
      els.outfitChips.appendChild(chip);
    });
  }

  function renderAccessories() {
    els.accessoryList.innerHTML = '';
    Accessories.LIST.forEach((piece) => {
      const label = document.createElement('label');
      label.className = 'accessory-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.settings.accessories.includes(piece.id);
      checkbox.addEventListener('change', () => {
        let next = state.settings.accessories.filter((a) => a !== piece.id);
        if (checkbox.checked) {
          // One item per slot (head / face / neck).
          next = next.filter((a) => !Accessories.byId[a] || Accessories.byId[a].slot !== piece.slot).concat(piece.id);
        }
        save({ settings: { accessories: next, outfit: matchingOutfit(next), theme: 'custom' } });
      });
      const span = document.createElement('span');
      span.textContent = `${piece.label} (${piece.slot})`;
      label.append(checkbox, span);
      els.accessoryList.appendChild(label);
    });
  }

  // ---- Custom models ----------------------------------------------------------

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  els.customUpload.addEventListener('change', () => {
    const file = els.customUpload.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert('Please keep custom models under 20MB.');
      els.customUpload.value = '';
      return;
    }
    fileToDataUrl(file).then((dataUrl) => {
      return new Promise((resolve, reject) => {
        const loader = new THREE.GLTFLoader();
        loader.parse(window.PocketPal.Utils.dataUrlToArrayBuffer(dataUrl), '', resolve, reject);
      }).then((gltf) => {
        const clipNames = (gltf.animations || []).map((c) => c.name);
        const entry = {
          id: `custom-${Date.now()}`,
          name: file.name.replace(/\.(glb|gltf)$/i, '').slice(0, 30) || 'Custom pal',
          tagline: clipNames.length ? `Clips: ${clipNames.join(', ')}` : 'No animation clips found',
          colors: { primary: '#cfcae0', secondary: '#ffffff', accent: '#7c5cff' },
          personality: { speed: 1, jumpiness: 0.6, sleepiness: 0.4, danciness: 0.5 },
          unlockRequirement: null,
          custom: true,
          modelDataUrl: dataUrl,
        };
        return Storage.get().then((s) => save({ customCharacters: s.customCharacters.concat(entry) }));
      });
    }).catch((err) => {
      console.error('Pocket Pal: failed to read custom model', err);
      alert('Could not read that file as a glTF/GLB model.');
    }).finally(() => {
      els.customUpload.value = '';
    });
  });

  function renderCustomList() {
    els.customList.innerHTML = '';
    if (!state.customCharacters.length) {
      els.customList.innerHTML = '<p class="empty">No custom models uploaded yet.</p>';
      return;
    }
    state.customCharacters.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span>${c.name}</span><small>${c.tagline}</small>`;
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => {
        const next = state.customCharacters.filter((x) => x.id !== c.id);
        const patch = { customCharacters: next };
        if (state.currentCharacter === c.id) patch.currentCharacter = 'mochi';
        save(patch);
      });
      row.append(meta, btn);
      els.customList.appendChild(row);
    });
  }

  // ---- Site exceptions ----------------------------------------------------------

  function renderSiteList() {
    els.siteList.innerHTML = '';
    if (!state.perSiteDisabled.length) {
      els.siteList.innerHTML = '<p class="empty">No sites hidden. Right-click the pal on any page to hide it there.</p>';
      return;
    }
    state.perSiteDisabled.forEach((host) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span>${host}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Show again';
      btn.addEventListener('click', () => {
        save({ perSiteDisabled: state.perSiteDisabled.filter((h) => h !== host) });
      });
      row.append(meta, btn);
      els.siteList.appendChild(row);
    });
  }

  // ---- Full render ----------------------------------------------------------

  function renderAll() {
    if (!state || !manifestData) return;
    els.enabled.checked = state.enabled;
    els.scale.value = state.settings.scale;
    els.scaleVal.textContent = `${state.settings.scale}x`;
    els.shadowIntensity.value = state.settings.shadowIntensity;
    els.shadowVal.textContent = state.settings.shadowIntensity;
    els.soundEnabled.checked = state.settings.soundEnabled;
    els.reducedMotion.checked = state.settings.reducedMotion;
    els.behavior.value = state.settings.behavior;
    els.walkSpeed.value = state.settings.walkSpeed;
    els.walkSpeedVal.textContent = `${state.settings.walkSpeed}x`;
    els.animSpeed.value = state.settings.animSpeed;
    els.animSpeedVal.textContent = `${state.settings.animSpeed}x`;
    els.autoSleepMinutes.value = state.settings.autoSleepMinutes;
    els.autoSleepVal.textContent = `${state.settings.autoSleepMinutes} min`;
    els.interactionSensitivity.value = state.settings.interactionSensitivity;
    els.sensitivityVal.textContent = `${state.settings.interactionSensitivity}x`;
    els.animationStyle.value = state.settings.animationStyle;
    els.windowHopping.checked = state.settings.windowHopping;
    els.pageAwareness.checked = state.settings.pageAwareness;
    els.rememberPosition.checked = state.settings.rememberPosition;
    els.pageInteraction.checked = state.settings.pageInteraction;
    els.idleAnimations.checked = state.settings.idleAnimations;
    els.petInteractions.checked = state.settings.petInteractions;
    els.petCount.value = String(state.settings.petCount);
    els.trail.value = state.settings.trail;
    els.seasonal.value = state.settings.seasonal;
    const xmas = state.settings.christmas;
    document.querySelectorAll('[data-xmas]').forEach((input) => { input.checked = !!xmas[input.dataset.xmas]; });
    document.querySelectorAll('[data-xmas-deco]').forEach((input) => { input.checked = !!xmas.deco[input.dataset.xmasDeco]; });
    document.querySelectorAll('[data-xmas-range]').forEach((input) => {
      input.value = xmas[input.dataset.xmasRange];
      const label = document.querySelector(`[data-xmas-val="${input.dataset.xmasRange}"]`);
      if (label) label.textContent = Number(input.value).toFixed(2).replace(/\.?0+$/, '');
    });
    document.querySelectorAll('[data-xmas-select]').forEach((select) => { select.value = xmas[select.dataset.xmasSelect]; });

    renderCategoryChips();
    renderGallery();
    renderOutfits();
    renderAccessories();
    const current = manifestData.characters.find((c) => c.id === state.currentCharacter);
    const skipped = (current && current.outfit && current.outfit.skip) || [];
    els.outfitNote.textContent = skipped.length ? `${current.name} already wears something on its ${skipped.join(' and ')}, so those pieces are hidden for this pal.` : '';
    renderCustomList();
    renderSiteList();
  }

  Storage.onChange((next) => {
    state = next;
    renderAll();
  });

  Promise.all([Storage.ensureDefaults(), Characters.loadManifest()]).then(([s, manifest]) => {
    state = s;
    manifestData = manifest;
    renderAll();
    const wanted = location.hash.replace('#', '');
    const target = wanted && document.querySelector(`.nav-btn[data-section="${wanted}"]`);
    if (target) target.click();
  }).catch((err) => console.error('Pocket Pal: could not load the roster', err));
})();
