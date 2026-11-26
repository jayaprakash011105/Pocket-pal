(function () {
  const { Storage, Characters, Utils, Accessories: Acc, Effects: FX } = window.PocketPal;

  let state = null;
  let manifestData = null;
  let activeTab = null; // the browser tab the popup was opened on
  let activeFilter = 'All';
  let currentView = 'home';
  let renderToken = 0;

  const $ = (id) => document.getElementById(id);

  // The real themes. Applying one switches the others off: Snow and Halloween
  // are the light seasonal looks, Christmas is the full winter environment.
  const THEMES = [
    { id: 'christmas', label: 'Christmas', featured: true, desc: 'Falling snow that piles up, Santa\'s sleigh, a snowman game and a snowplow', season: 'santa', seasonal: 'off', christmas: true, deco: [['🎄', 6, 14], ['🛷', 74, 12], ['⛄', 84, 62], ['🎁', 12, 66], ['❄️', 48, 8], ['❄️', 92, 36], ['❄️', 26, 36]] },
    { id: 'classic', label: 'Classic', desc: 'Just your pal, no theme', season: 'none', seasonal: 'off', christmas: false, deco: [['✨', 12, 14], ['✨', 78, 70]] },
    { id: 'snow', label: 'Snow', desc: 'Santa hat and soft snowfall', season: 'santa', seasonal: 'santa', christmas: false, deco: [['❄️', 10, 12], ['❄️', 82, 22], ['❄️', 74, 70]] },
    { id: 'halloween', label: 'Halloween', desc: 'A spooky ghost sheet', season: 'ghost', seasonal: 'ghost', christmas: false, deco: [['🎃', 10, 70], ['🦇', 76, 12], ['🕸️', 8, 10]] },
  ];

  const STYLE_LABELS = { float: 'Floating', walk: 'Walking', bounce: 'Bouncing' };

  // ---- Helpers ---------------------------------------------------------------

  const imageCache = new Map();
  function loadImage(def) {
    if (!def.sprite) return Promise.resolve(null);
    const url = chrome.runtime.getURL(def.sprite);
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  function currentDef() {
    return manifestData.characters.find((c) => c.id === state.currentCharacter) || manifestData.characters[0];
  }

  // Which theme is really on, worked out from the settings themselves.
  function activeThemeId() {
    const s = state.settings;
    if (s.christmas && s.christmas.enabled) return 'christmas';
    if (s.seasonal === 'santa') return 'snow';
    if (s.seasonal === 'ghost') return 'halloween';
    if (s.seasonal === 'off') return 'classic';
    const auto = Acc && Acc.seasonFor ? Acc.seasonFor(new Date()) : 'none';
    return auto === 'santa' ? 'snow' : auto === 'ghost' ? 'halloween' : 'classic';
  }

  function seasonFor(setting) {
    const choice = setting || 'auto';
    if (choice === 'off') return 'none';
    if (choice === 'santa' || choice === 'ghost') return choice;
    return Acc && Acc.seasonFor ? Acc.seasonFor(new Date()) : 'none';
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // Draws the pal the way it looks in the page: sprite, worn pieces, Santa hat
  // or ghost sheet. Sized in CSS pixels (w x h) and scaled for the screen.
  function drawPal(canvas, def, img, look, w, h, opts) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!img) return;

    const o = opts || {};
    const k = Math.min((w * (o.fillW || 0.7)) / img.naturalWidth, (h * (o.fillH || 0.76)) / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    const ox = (w - iw) / 2;
    const oy = h - ih - h * (o.bottom || 0.05);

    // soft ground shadow
    ctx.fillStyle = 'rgba(30,20,60,0.16)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h - h * (o.bottom || 0.05) + 1, iw * 0.34, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.drawImage(img, ox, oy, iw, ih);
    if (!Acc) return;

    const anchors = Acc.anchorsFor(def, { width: img.naturalWidth, height: img.naturalHeight });
    const place = (id) => {
      const spec = Acc.byId[id] || (Acc.SEASONAL && Acc.SEASONAL[id]);
      if (!spec || anchors.skip.includes(spec.slot)) return;
      const piece = Acc.draw(id);
      if (!piece) return;
      const s = Acc.place(id, anchors[spec.slot]);
      ctx.save();
      ctx.translate(ox + s.cx * k, oy + s.cy * k);
      ctx.rotate(s.rot);
      ctx.drawImage(piece, (-s.w * k) / 2, (-s.h * k) / 2, s.w * k, s.h * k);
      ctx.restore();
    };

    if (look.season === 'ghost' && FX && FX.ghostSheet) {
      const sep = anchors.face.width;
      const rot = anchors.face.rot || 0;
      const eyes = [-1, 1].map((sgn) => {
        const ex = anchors.face.x + sgn * Math.cos(rot) * sep / 2;
        const ey = anchors.face.y + sgn * Math.sin(rot) * sep / 2;
        return {
          u: (ex / img.naturalWidth - 0.5) / 1.1 + 0.5,
          v: (ey / img.naturalHeight - 0.5) / 1.1 + 0.5,
          r: (sep / img.naturalWidth) * 0.17 / 1.1,
        };
      });
      const sheet = FX.ghostSheet(img.naturalHeight / img.naturalWidth, eyes);
      ctx.drawImage(sheet, ox - iw * 0.05, oy - ih * 0.05, iw * 1.1, ih * 1.1);
      return;
    }

    (look.accessories || []).forEach(place);
    const hasHead = (look.accessories || []).some((id) => Acc.byId[id] && Acc.byId[id].slot === 'head');
    if (look.season === 'santa' && !hasHead) place('santa-hat');
  }

  // ---- Navigation -------------------------------------------------------------

  const tabs = document.querySelectorAll('.tab');
  const panels = {
    home: $('panel-home'),
    characters: $('panel-characters'),
    themes: $('panel-themes'),
    settings: $('panel-settings'),
  };

  function showView(name) {
    currentView = name;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('hidden', key !== name));
    document.querySelector('.views').scrollTop = 0;
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.tab)));

  // ---- Home -------------------------------------------------------------------------

  function renderHero() {
    const def = currentDef();
    $('current-name').textContent = def.name;
    $('current-tag').textContent = def.tagline || def.category || '';
    const theme = THEMES.find((t) => t.id === activeThemeId());
    $('pill-theme').textContent = theme ? theme.label : 'Classic';
    $('pill-style').textContent = STYLE_LABELS[state.settings.animationStyle] || 'Floating';
    const hat = state.settings.christmas && state.settings.christmas.enabled && state.settings.christmas.hat !== false;
    const look = { accessories: state.settings.accessories, season: hat ? 'santa' : state.settings.christmas && state.settings.christmas.enabled ? 'none' : seasonFor(state.settings.seasonal) };
    const token = renderToken;
    loadImage(def).then((img) => {
      if (token !== renderToken) return;
      drawPal($('hero-canvas'), def, img, look, 132, 128, { fillW: 0.78, fillH: 0.8, bottom: 0.04 });
    });
  }

  function renderUnlockProgress() {
    const total = (state.stats && state.stats.totalInteractions) || 0;
    const next = manifestData.characters
      .filter((c) => c.unlockRequirement && !state.unlockedCharacters.includes(c.id))
      .sort((a, b) => a.unlockRequirement.count - b.unlockRequirement.count)[0];
    if (next) {
      const need = next.unlockRequirement.count;
      $('unlock-count').textContent = `${Math.min(total, need)} / ${need}`;
      $('unlock-bar').style.width = `${Math.min(100, (total / need) * 100)}%`;
      $('unlock-progress').textContent = `Keep playing to unlock ${next.name}`;
    } else {
      $('unlock-count').textContent = 'Complete';
      $('unlock-bar').style.width = '100%';
      $('unlock-progress').textContent = 'All pals unlocked!';
    }
  }

  function updateStatus() {
    const text = $('status-text');
    const dot = $('status-dot');
    let label = 'Active on this page';
    let on = true;
    if (!activeTab || !activeTab.url || Utils.isRestrictedUrl(activeTab.url)) {
      label = 'Unavailable on this page';
      on = false;
    } else {
      const host = new URL(activeTab.url).hostname;
      if (!state.enabled) { label = 'Turned off'; on = false; }
      else if (state.hidden) { label = 'Hidden for now'; on = false; }
      else if (state.perSiteDisabled.includes(host)) { label = 'Hidden on this site'; on = false; }
    }
    text.textContent = label;
    dot.classList.toggle('off', !on);
    $('btn-hide-now').textContent = state.hidden ? 'Show again' : 'Hide for now';
  }

  // ---- Characters ----------------------------------------------------------------------

  function renderFilters() {
    const wrap = $('char-filters');
    wrap.innerHTML = '';
    ['All'].concat(manifestData.categories).forEach((cat) => {
      const has = cat === 'All' || manifestData.characters.some((c) => c.category === cat);
      if (!has) return;
      const chip = document.createElement('button');
      chip.className = `chip${cat === activeFilter ? ' active' : ''}`;
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        activeFilter = cat;
        renderFilters();
        renderGallery();
      });
      wrap.appendChild(chip);
    });
  }

  function renderGallery() {
    const gallery = $('gallery');
    gallery.innerHTML = '';
    const list = manifestData.characters.filter((c) => activeFilter === 'All' || c.category === activeFilter);
    const unlockedCount = manifestData.characters.filter((c) => state.unlockedCharacters.includes(c.id) || c.custom).length;
    $('char-count').textContent = `${unlockedCount} of ${manifestData.characters.length} unlocked`;

    list.forEach((def) => {
      const unlocked = state.unlockedCharacters.includes(def.id) || def.custom;
      const tile = document.createElement('button');
      tile.className = `tile${def.id === state.currentCharacter ? ' selected' : ''}${unlocked ? '' : ' locked'}`;
      tile.title = unlocked ? def.name : `Unlocks after ${def.unlockRequirement.count} interactions`;

      const face = document.createElement('img');
      face.className = 'tile-face';
      face.alt = '';
      face.src = def.sprite ? chrome.runtime.getURL(def.sprite) : '../assets/icons/icon48.png';

      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = def.name;
      const tag = document.createElement('div');
      tag.className = 'tile-tag';
      tag.textContent = def.tagline || def.category;
      tile.append(face, name, tag);

      if (!unlocked) {
        const lock = document.createElement('span');
        lock.className = 'tile-lock';
        lock.textContent = `🔒 ${def.unlockRequirement.count}`;
        tile.appendChild(lock);
      }

      tile.addEventListener('click', () => {
        if (!unlocked) {
          toast(`${def.name} unlocks after ${def.unlockRequirement.count} interactions`);
          return;
        }
        Storage.set({ currentCharacter: def.id });
      });
      gallery.appendChild(tile);
    });
  }

  // ---- Themes ------------------------------------------------------------------------------

  function applyTheme(theme) {
    Storage.set({
      settings: {
        theme: theme.id,
        seasonal: theme.seasonal,
        christmas: { enabled: theme.christmas },
      },
    }).then(() => toast(`${theme.label} theme applied`));
  }

  function renderSeasonBanner() {
    const season = Acc && Acc.seasonFor ? Acc.seasonFor(new Date()) : 'none';
    const banner = $('season-banner');
    if (season === 'santa') {
      banner.innerHTML = '<span>❄️</span><span>It is the snowy season, so Snow switches on by itself. Christmas is yours to switch on any time.</span>';
    } else if (season === 'ghost') {
      banner.innerHTML = '<span>🎃</span><span>It is Halloween season, so Halloween switches on by itself.</span>';
    } else {
      banner.innerHTML = '<span>🗓️</span><span>Snow comes on by itself Dec 1 – Jan 5 and Halloween Oct 20 – Nov 2. Pick any theme any time.</span>';
    }
  }

  const THEME_W = 168;
  const THEME_H = 128;
  const FEATURED_W = 336;
  const FEATURED_H = 150;

  function openOptionsSection(section) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html#${section}`) });
  }

  function renderThemes() {
    const def = currentDef();
    $('theme-pal').textContent = def.name;
    renderSeasonBanner();
    const grid = $('theme-grid');
    grid.innerHTML = '';
    const token = renderToken;
    const imgPromise = loadImage(def);
    const activeId = activeThemeId();

    THEMES.forEach((theme) => {
      const card = document.createElement('div');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.className = `theme-card t-${theme.id}${theme.featured ? ' featured' : ''}${activeId === theme.id ? ' active' : ''}`;
      card.title = theme.desc;

      const preview = document.createElement('div');
      preview.className = 'theme-preview';
      theme.deco.forEach(([emoji, x, y]) => {
        const d = document.createElement('span');
        d.className = 'deco';
        d.textContent = emoji;
        d.style.left = `${x}%`;
        d.style.top = `${y}%`;
        preview.appendChild(d);
      });
      const canvas = document.createElement('canvas');
      preview.appendChild(canvas);
      card.appendChild(preview);

      const body = document.createElement('div');
      body.className = 'theme-body';
      const name = document.createElement('div');
      name.className = 'theme-name';
      name.textContent = theme.label;
      const desc = document.createElement('div');
      desc.className = 'theme-desc';
      desc.textContent = theme.desc;
      body.append(name, desc);
      if (theme.christmas) {
        const custom = document.createElement('button');
        custom.className = 'theme-customize';
        custom.textContent = 'Customize →';
        custom.addEventListener('click', (e) => {
          e.stopPropagation();
          openOptionsSection('christmas');
        });
        body.appendChild(custom);
      }
      card.appendChild(body);

      if (activeId === theme.id) {
        const badge = document.createElement('span');
        badge.className = 'theme-badge';
        badge.textContent = 'Active';
        card.appendChild(badge);
      }

      const apply = () => applyTheme(theme);
      card.addEventListener('click', apply);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          apply();
        }
      });
      grid.appendChild(card);

      imgPromise.then((img) => {
        if (token !== renderToken) return;
        const w = theme.featured ? FEATURED_W : THEME_W;
        const h = theme.featured ? FEATURED_H : THEME_H;
        drawPal(canvas, def, img, { accessories: [], season: theme.season }, w, h, { fillW: theme.featured ? 0.3 : 0.6, fillH: theme.featured ? 0.74 : 0.7, bottom: 0.07 });
      });
    });
  }

  // ---- Settings -----------------------------------------------------------------------------------

  function bindSegmented(id, key, parse) {
    const seg = $(id);
    seg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        Storage.set({ settings: { [key]: parse ? parse(btn.dataset.value) : btn.dataset.value } });
      });
    });
  }

  function syncSegmented(id, value) {
    $(id).querySelectorAll('button').forEach((btn) => btn.classList.toggle('active', btn.dataset.value === String(value)));
  }

  function renderSettings() {
    const s = state.settings;
    $('scale').value = s.scale;
    $('scale-val').textContent = `${Number(s.scale).toFixed(2).replace(/\.?0+$/, '')}x`;
    $('walkSpeed').value = s.walkSpeed;
    $('walkSpeed-val').textContent = `${Number(s.walkSpeed).toFixed(2).replace(/\.?0+$/, '')}x`;
    $('behavior').value = s.behavior;
    $('reducedMotion').checked = s.reducedMotion;
    syncSegmented('seg-animationStyle', s.animationStyle);
    syncSegmented('seg-petCount', s.petCount);
  }

  bindSegmented('seg-animationStyle', 'animationStyle');
  bindSegmented('seg-petCount', 'petCount', Number);
  $('scale').addEventListener('input', () => {
    $('scale-val').textContent = `${Number($('scale').value).toFixed(2).replace(/\.?0+$/, '')}x`;
    Storage.set({ settings: { scale: Number($('scale').value) } });
  });
  $('walkSpeed').addEventListener('input', () => {
    $('walkSpeed-val').textContent = `${Number($('walkSpeed').value).toFixed(2).replace(/\.?0+$/, '')}x`;
    Storage.set({ settings: { walkSpeed: Number($('walkSpeed').value) } });
  });
  $('behavior').addEventListener('change', () => Storage.set({ settings: { behavior: $('behavior').value } }));
  $('reducedMotion').addEventListener('change', () => Storage.set({ settings: { reducedMotion: $('reducedMotion').checked } }));
  $('enabled-toggle').addEventListener('change', () => Storage.set({ enabled: $('enabled-toggle').checked }));
  $('btn-open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // ---- Quick actions ---------------------------------------------------------------------------------

  function sendActionToTab(action) {
    if (!activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'pp-action', action }, () => void chrome.runtime.lastError);
  }

  [['btn-play', 'play'], ['btn-dance', 'dance'], ['btn-sleep', 'sleep'], ['btn-wave', 'wave'],
    ['btn-hop', 'hop'], ['btn-perch', 'perch'], ['btn-peek', 'peek'], ['btn-ball', 'ball']].forEach(([id, action]) => {
    $(id).addEventListener('click', () => sendActionToTab(action));
  });

  $('btn-hide-now').addEventListener('click', () => Storage.set({ hidden: !state.hidden }));
  $('btn-hide-site').addEventListener('click', () => {
    if (!activeTab || !activeTab.url) return;
    const host = new URL(activeTab.url).hostname;
    const list = state.perSiteDisabled.includes(host) ? state.perSiteDisabled : state.perSiteDisabled.concat(host);
    Storage.set({ perSiteDisabled: list }).then(() => {
      updateStatus();
      toast(`Hidden on ${host}`);
    });
  });

  // ---- Render + boot ------------------------------------------------------------------------------------

  function renderAll() {
    if (!state || !manifestData) return;
    renderToken += 1;
    $('enabled-toggle').checked = state.enabled;
    renderHero();
    renderUnlockProgress();
    renderFilters();
    renderGallery();
    renderThemes();
    renderSettings();
    updateStatus();
  }

  Storage.onChange((next) => {
    state = next;
    renderAll();
  });

  Promise.all([
    Storage.ensureDefaults(),
    Characters.loadManifest(),
    new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (list) => resolve(list && list[0]))),
  ]).then(([s, manifest, tab]) => {
    state = s;
    manifestData = manifest;
    activeTab = tab;
    renderAll();
  }).catch((err) => console.error('Pocket Pal popup failed to load', err));
})();
