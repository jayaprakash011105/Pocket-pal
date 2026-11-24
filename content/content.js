(function () {
  if (window.__pocketPalInjected) return;
  window.__pocketPalInjected = true;

  const { Utils, Storage, PetEngine, CharacterManager, Movement, Interactions, Perch, Minigames, Effects, Snowfall, Accessories } = window.PocketPal;

  if (Utils.isRestrictedUrl(location.href)) return;

  const FOOT_OFFSET = 2;
  const BUBBLE_MS = 2600;
  const MAX_PETS = 3;

  let engine = null;
  let state = null; // { settings, currentCharacterId, unlockedCharacters, perSiteDisabled, enabled, stats }
  let shadowMesh = null;
  let ballGame = null;
  let snow = null;
  let manifestCache = null;
  const pets = []; // pets[0] is the one picked in settings; the rest are companions
  let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };

  const primary = () => pets[0] || null;

  // When the extension is reloaded/updated, this script keeps running in the
  // open tab but can no longer reach chrome.* APIs. Instead of throwing on
  // every frame, it retires itself (the pal comes back on the next page load).
  let dead = false;
  let pageCheckTimer = null;
  function checkAlive() {
    if (dead) return false;
    if (Storage.extensionAlive()) return true;
    dead = true;
    clearInterval(pageCheckTimer);
    companionEpoch += 1;
    loadEpoch += 1;
    pets.slice().forEach(disposePet);
    if (ballGame) {
      ballGame.dispose();
      ballGame = null;
    }
    if (snow) {
      snow.dispose();
      snow = null;
    }
    if (engine) engine.dispose();
    engine = null;
    host.remove();
    return false;
  }

  // The "animation style" setting: floating (default, roams the whole window),
  // walking (the same smooth float, kept to the bottom line) or bouncing
  // (travelling by jumping). Sprite pals follow it; custom/procedural models
  // keep their own style.
  const ANIMATION_STYLES = ['float', 'walk', 'bounce'];
  function resolveStyle(def, settings) {
    if (!def.sprite) {
      const style = def.movementStyle || (def.floats ? 'float' : 'walk');
      return { style, floats: style === 'float' };
    }
    const choice = settings && settings.animationStyle;
    const style = ANIMATION_STYLES.includes(choice) ? choice : 'float';
    return { style, floats: style !== 'bounce' };
  }

  // 'auto' follows the calendar (Santa hat in December, ghost sheet around
  // Halloween); the setting can also force one on or switch them off.
  function currentSeason() {
    const choice = (state && state.settings.seasonal) || 'auto';
    if (choice === 'off') return 'none';
    if (choice === 'santa' || choice === 'ghost') return choice;
    return Accessories && Accessories.seasonFor ? Accessories.seasonFor(new Date()) : 'none';
  }

  function applyLook(pet) {
    const { style, floats } = resolveStyle(pet.def, state.settings);
    pet.brain.setStyle(style, floats);
    if (pet.instance.setStyle) pet.instance.setStyle(style, floats);
    if (pet.instance.setSeason) pet.instance.setSeason(currentSeason());
  }

  // ---- Shadow DOM scaffold --------------------------------------------

  const host = document.createElement('div');
  host.id = 'pocket-pal-host';
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  shadow.appendChild(styleEl);
  const cssReady = Utils.loadExtensionText('content/content.css')
    .then((css) => { styleEl.textContent = css; })
    .catch(() => {});

  const stage = document.createElement('div');
  stage.className = 'pp-stage';
  shadow.appendChild(stage);

  const canvas = document.createElement('canvas');
  canvas.className = 'pp-canvas';
  stage.appendChild(canvas);

  const menu = document.createElement('div');
  menu.className = 'pp-menu';
  stage.appendChild(menu);

  host.style.cssText = 'all:initial;display:block;position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;';

  // Mounted on <html> and promoted to the top layer so page transforms, filters
  // or stacking contexts on <body> can't displace the fixed-position overlay.
  function ensureMounted() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    try {
      if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
      if (!host.matches(':popover-open')) host.showPopover();
    } catch (e) {
      // Older Chrome without the Popover API: fall back to plain fixed positioning.
    }
  }
  ensureMounted();

  const perchFinder = Perch.createFinder({ host, getScale: () => (state ? state.settings.scale : 1) });

  // ---- Speech bubbles (one per pal) ------------------------------------------

  function showBubble(pet, text) {
    pet.bubble.textContent = text;
    pet.bubble.classList.add('pp-visible');
    clearTimeout(pet.bubbleTimeout);
    pet.bubbleTimeout = setTimeout(() => pet.bubble.classList.remove('pp-visible'), BUBBLE_MS);
  }

  let audioCtx = null;
  function blip(freq) {
    if (!state || !state.settings.soundEnabled) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.04;
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      // Audio is optional; ignore autoplay/context failures.
    }
  }

  function positionBubble(pet) {
    pet.bubble.style.left = `${pet.brain.body.x}px`;
    pet.bubble.style.top = `${pet.brain.body.y - 120 * state.settings.scale}px`;
  }

  // ---- Context / long-press menu -----------------------------------------

  function buildMenu(items) {
    menu.innerHTML = '';
    items.forEach((item) => {
      if (item === '-') {
        menu.appendChild(document.createElement('hr'));
        return;
      }
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        closeMenu();
        item.onClick();
      });
      menu.appendChild(btn);
    });
  }

  function openMenu(x, y, pet) {
    const brain = pet.brain;
    const items = [
      { label: '👋 Play', onClick: () => brain.special('play') },
      { label: '💤 Sleep', onClick: () => brain.forceSleep() },
      { label: '💃 Dance', onClick: () => brain.special('dance') },
      { label: '🙋 Wave', onClick: () => brain.special('wave') },
      { label: '🪂 Hop to a corner', onClick: () => brain.special('hop') },
      { label: '🪑 Sit on something', onClick: () => brain.special('perch') },
      { label: '🫣 Peek from the edge', onClick: () => brain.special('peek') },
      { label: ballGame && ballGame.active ? '🛑 End catch game' : '⚽ Play catch', onClick: () => toggleBallGame() },
      '-',
      {
        label: state.settings.behavior === 'followCursor' ? '✓ Follow cursor' : 'Follow cursor',
        onClick: () => Storage.set({ settings: { behavior: state.settings.behavior === 'followCursor' ? 'wander' : 'followCursor' } }),
      },
      '-',
      { label: '🫥 Hide for now', onClick: () => Storage.set({ hidden: true }) },
      { label: '🙈 Hide on this site', onClick: () => hideOnThisSite() },
      { label: '⚙️ Open settings', onClick: () => chrome.runtime.sendMessage({ type: 'open-options' }) },
    ];
    buildMenu(items);
    menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 380))}px`;
    menu.classList.add('pp-open');
  }

  function closeMenu() {
    menu.classList.remove('pp-open');
  }

  stage.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });
  window.addEventListener('scroll', closeMenu, { passive: true });

  function hideOnThisSite() {
    const hostName = location.hostname;
    Storage.get().then((s) => {
      const list = s.perSiteDisabled.includes(hostName) ? s.perSiteDisabled : s.perSiteDisabled.concat(hostName);
      Storage.set({ perSiteDisabled: list });
    });
  }

  // ---- Catch game ------------------------------------------------------------------

  function toggleBallGame() {
    if (!engine) return;
    if (!ballGame) {
      ballGame = Minigames.createBallGame({
        THREE: window.THREE,
        scene: engine.scene,
        stage,
        getScale: () => state.settings.scale,
        getBounds: () => ({ width: engine.width, height: engine.height }),
        onScore: () => blip(740),
      });
    }
    if (ballGame.active) {
      ballGame.stop();
    } else {
      ballGame.start();
      const lead = primary();
      if (lead) lead.brain.say('Throw the ball!');
    }
  }

  // ---- Pals --------------------------------------------------------------------------

  let loadEpoch = 0;

  function recordInteraction() {
    Storage.get().then((s) => {
      const stats = s.stats || { totalInteractions: 0 };
      const totalInteractions = (stats.totalInteractions || 0) + 1;
      Storage.set({ stats: { totalInteractions } }).then(() => checkUnlocks(totalInteractions));
    });
  }

  function checkUnlocks(totalInteractions) {
    CharacterManager.getManifest().then((manifestData) => {
      Storage.get().then((s) => {
        const newlyUnlocked = manifestData.characters
          .filter((c) => c.unlockRequirement && c.unlockRequirement.type === 'interactions')
          .filter((c) => totalInteractions >= c.unlockRequirement.count)
          .filter((c) => !s.unlockedCharacters.includes(c.id));
        if (newlyUnlocked.length) {
          Storage.set({ unlockedCharacters: s.unlockedCharacters.concat(newlyUnlocked.map((c) => c.id)) }).then(() => {
            const lead = primary();
            if (lead) showBubble(lead, `✨ ${newlyUnlocked[0].name} unlocked!`);
          });
        }
      });
    });
  }

  // Builds one pal: its model, brain, speech bubble and hit-box (click, drag,
  // right-click menu), already added to the scene.
  function createPet(def, index) {
    const startStyle = resolveStyle(def, state.settings);
    return CharacterManager.createInstance(def, index === 0 ? state.settings.accessories : []).then((instance) => {
      if (!engine) {
        instance.dispose();
        return null;
      }
      instance.setScale(state.settings.scale);
      engine.scene.add(instance.group);

      const brain = Movement.createBrain({
        id: `${def.id}-${index}`,
        name: def.name,
        x: Utils.randomRange(120, Math.max(121, window.innerWidth - 120)),
        y: window.innerHeight - FOOT_OFFSET,
        personality: def.personality,
        floats: startStyle.floats,
        movementStyle: startStyle.style,
      });

      const bubble = document.createElement('div');
      bubble.className = 'pp-bubble';
      stage.appendChild(bubble);
      const hitbox = document.createElement('div');
      hitbox.className = 'pp-hitbox';
      stage.appendChild(hitbox);

      const pet = {
        def,
        index,
        instance,
        brain,
        bubble,
        hitbox,
        bubbleTimeout: null,
        hoverTarget: null,
        interactions: null,
        trail: Effects && Effects.createTrail ? Effects.createTrail(engine.scene) : null,
      };
      brain.onSpeak = (text) => showBubble(pet, text);
      applyLook(pet);

      pet.interactions = Interactions.createInteractions(hitbox, brain, {
        onSingleClick: () => {
          recordInteraction();
          blip(660);
          brain.jump();
        },
        onDoubleClick: () => {
          recordInteraction();
          blip(880);
          brain.special('dance');
        },
        onDragStart: () => {
          recordInteraction();
          blip(520);
          closeMenu();
          brain.setDragging(true);
        },
        onDragMove: (x, y) => {
          brain.body.x = Utils.clamp(x, 20, window.innerWidth - 20);
          brain.body.y = Utils.clamp(y, 110 * state.settings.scale, window.innerHeight - FOOT_OFFSET);
          brain.body.vx = 0;
          brain.body.vy = 0;
        },
        onDragEnd: () => {
          brain.setDragging(false);
          if (pet === primary()) savePosition(true);
        },
        onHoverChange: (active, x, y) => {
          pet.hoverTarget = active ? { x, y } : null;
        },
        onHoverMove: (x, y) => {
          pet.hoverTarget = { x, y };
        },
        onContextMenu: (x, y) => openMenu(x, y, pet),
        onLongPress: (x, y) => openMenu(x, y, pet),
      }, () => state.settings.interactionSensitivity);

      pets.push(pet);
      return pet;
    });
  }

  function disposePet(pet) {
    const i = pets.indexOf(pet);
    if (i >= 0) pets.splice(i, 1);
    if (pet.interactions) pet.interactions.destroy();
    if (pet.trail) pet.trail.dispose();
    if (pet.instance.group.parent) pet.instance.group.parent.remove(pet.instance.group);
    pet.instance.dispose();
    clearTimeout(pet.bubbleTimeout);
    pet.bubble.remove();
    pet.hitbox.remove();
  }

  // Companions are the next unlocked pals after the chosen one, in roster order.
  function companionDefs(manifestData) {
    const want = Utils.clamp((state.settings.petCount || 1) - 1, 0, MAX_PETS - 1);
    if (!want) return [];
    const lead = pets[0] ? pets[0].def : null;
    const all = manifestData.characters.filter((c) => !c.custom && (state.unlockedCharacters.includes(c.id) || !c.unlockRequirement));
    const start = lead ? Math.max(0, all.findIndex((c) => c.id === lead.id)) : 0;
    const ordered = all.slice(start + 1).concat(all.slice(0, start)).filter((c) => !lead || c.id !== lead.id);
    return ordered.slice(0, want);
  }

  let companionEpoch = 0;
  function rebuildCompanions() {
    if (!engine || !pets[0]) return;
    const epoch = ++companionEpoch;
    pets.slice(1).forEach(disposePet);
    CharacterManager.getManifest().then((manifestData) => {
      if (epoch !== companionEpoch || !engine) return;
      companionDefs(manifestData).reduce((chain, def, i) => chain.then(() => {
        if (epoch !== companionEpoch || !engine) return null;
        return createPet(def, i + 1);
      }), Promise.resolve());
    });
  }

  function swapPrimary(def) {
    const epoch = ++loadEpoch;
    const lead = pets[0];
    CharacterManager.createInstance(def, state.settings.accessories).then((built) => {
      if (epoch !== loadEpoch || !engine || !lead || pets[0] !== lead) {
        built.dispose();
        return;
      }
      const previous = lead.instance;
      if (previous.group.parent) previous.group.parent.remove(previous.group);
      previous.dispose();
      lead.instance = built;
      lead.def = def;
      built.setScale(state.settings.scale);
      engine.scene.add(built.group);
      lead.brain.setPersonality(def.personality);
      applyLook(lead);
      rebuildCompanions();
    });
  }

  function init() {
    Promise.all([Storage.ensureDefaults(), CharacterManager.getManifest(), cssReady]).then(([s, manifestData]) => {
      state = s;
      manifestCache = manifestData;
      const missingFree = manifestData.characters
        .filter((c) => !c.unlockRequirement && !s.unlockedCharacters.includes(c.id))
        .map((c) => c.id);
      if (missingFree.length) Storage.set({ unlockedCharacters: s.unlockedCharacters.concat(missingFree) });
      if (!shouldRun()) {
        host.remove();
        return;
      }
      ensureMounted();

      engine = PetEngine.createEngine(canvas);
      shadowMesh = engine.makeGroundShadow();
      snow = Snowfall ? Snowfall.createSnowfall(engine.scene) : null;

      const def = CharacterManager.findCharacterDef(manifestData, state.currentCharacter);
      const epoch = ++loadEpoch;
      createPet(def, 0).then((lead) => {
        if (!lead) return;
        if (epoch !== loadEpoch || !engine) {
          disposePet(lead);
          return;
        }
        const startLoop = (pos) => {
          if (epoch !== loadEpoch || !engine) return;
          if (pos) restorePosition(pos);
          engine.start(tick);
          rebuildCompanions();
        };
        if (state.settings.rememberPosition) Storage.getPosition().then(startLoop);
        else startLoop(null);
      });
    });
  }

  // ---- Multi-tab persistence ----------------------------------------------

  const tabId = Math.random().toString(36).slice(2);
  let lastSaved = { x: -1, y: -1, surface: '' };
  let lastSaveAt = 0;
  let lastLocalTs = 0;

  function savePosition(force) {
    const lead = primary();
    if (dead || !lead || !engine || !state.settings.rememberPosition) return;
    const now = performance.now();
    if (!force && (now - lastSaveAt < 1500 || document.hidden)) return;
    const b = lead.brain.body;
    const surface = b.surface === 'air' ? 'air' : 'ground';
    if (!force && Math.abs(b.x - lastSaved.x) < 2 && Math.abs(b.y - lastSaved.y) < 2 && lastSaved.surface === surface) return;
    lastSaveAt = now;
    lastSaved = { x: b.x, y: b.y, surface };
    lastLocalTs = Date.now();
    Storage.setPosition({
      fx: b.x / engine.width,
      fy: b.y / engine.height,
      surface,
      facing: b.facing,
      ts: lastLocalTs,
      tab: tabId,
    });
  }

  function restorePosition(pos) {
    const lead = primary();
    if (!pos || !lead || !engine || typeof pos.fx !== 'number') return;
    const minAirY = 110 * state.settings.scale;
    const x = Utils.clamp(pos.fx * engine.width, 20, engine.width - 20);
    const y = pos.surface === 'air'
      ? Utils.clamp(pos.fy * engine.height, minAirY, engine.height - FOOT_OFFSET)
      : engine.height - FOOT_OFFSET;
    lead.brain.placeAt(x, y, pos.surface);
    if (pos.facing) lead.brain.body.facing = pos.facing;
  }

  document.addEventListener('visibilitychange', () => {
    const lead = primary();
    if (!lead || !checkAlive()) return;
    if (document.hidden) {
      savePosition(true);
      return;
    }
    // Another tab may have moved the pal while this one was in the background.
    if (state.settings.rememberPosition) {
      Storage.getPosition().then((pos) => {
        if (pos && pos.tab !== tabId && pos.ts > lastLocalTs) restorePosition(pos);
      });
    }
    if (state.settings.pageAwareness) lead.brain.welcomeBack();
  });

  // ---- Page awareness -------------------------------------------------------

  let lastHref = location.href;
  let lastScrollY = window.scrollY;
  let scrollAccum = 0;

  window.addEventListener('scroll', (e) => {
    if (!pets.length || !state || !state.settings.pageAwareness || dead) return;
    if (e.target === document || e.target === window) {
      const y = window.scrollY;
      scrollAccum += Math.abs(y - lastScrollY);
      lastScrollY = y;
      if (scrollAccum < 240) return;
      scrollAccum = 0;
    }
    pets.forEach((p) => p.brain.reactToScroll());
  }, { passive: true, capture: true });

  function checkPageChange() {
    if (!checkAlive()) return;
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (pets.length && state && state.settings.pageAwareness) pets.forEach((p) => p.brain.reactToPageChange());
  }
  pageCheckTimer = setInterval(checkPageChange, 1000);
  window.addEventListener('popstate', checkPageChange);
  window.addEventListener('hashchange', checkPageChange);

  // ---- Frame loop ---------------------------------------------------------------

  function tick(dt) {
    if (!checkAlive()) return;
    const lead = primary();
    if (!lead) return;
    const settings = state.settings;
    const bounds = { width: engine.width, height: engine.height };
    const chase = ballGame ? ballGame.update(dt, pets) : null;
    const perch = settings.pageInteraction !== false ? perchFinder : null;
    const season = currentSeason();
    if (snow) snow.update(dt, { enabled: season === 'santa', width: bounds.width, height: bounds.height });
    const roster = pets.map((p) => ({ id: p.brain.id, name: p.def.name, body: p.brain.body, brain: p.brain, state: p.brain.state }));

    pets.forEach((pet, i) => {
      const brain = pet.brain;
      const ctx = {
        bounds,
        pointer,
        footOffset: FOOT_OFFSET,
        settings,
        chase,
        perch,
        others: roster.filter((_, j) => j !== i),
      };
      const currentState = brain.update(dt, ctx);
      if (pet.hoverTarget) brain.lookAt(pet.hoverTarget);
      else if (settings.behavior === 'followCursor' || settings.behavior === 'avoidCursor') brain.lookAt(pointer.active ? pointer : null);
      else brain.lookAt(null);

      pet.instance.update(dt, currentState, brain.body, settings, brain.lookTarget);

      if (pet.trail) {
        const b = brain.body;
        pet.trail.update(dt, b, {
          enabled: settings.trail !== 'none',
          kind: season === 'santa' ? 'snow' : (settings.trail || 'sparkles'),
          scale: settings.scale,
          floats: pet.instance.floats,
          moving: Math.abs(b.svx) > 8 || !b.grounded || currentState === 'hop',
        });
      }

      pet.hitbox.style.width = `${96 * settings.scale}px`;
      pet.hitbox.style.height = `${120 * settings.scale}px`;
      pet.hitbox.style.left = `${brain.body.x - (48 * settings.scale)}px`;
      pet.hitbox.style.top = `${brain.body.y - (116 * settings.scale)}px`;
      positionBubble(pet);
    });

    savePosition(false);

    if (shadowMesh) {
      const body = lead.brain.body;
      const onFloor = body.surface === 'ground';
      shadowMesh.visible = onFloor && !lead.instance.floats;
      if (shadowMesh.visible) {
        const fall = Math.max(0, bounds.height - FOOT_OFFSET - body.y);
        const scale = Utils.clamp(34 - fall * 0.02, 10, 34) * settings.scale;
        shadowMesh.scale.set(scale, scale * 0.45, 1);
        shadowMesh.position.set(body.x, bounds.height - FOOT_OFFSET - 3, -5);
        shadowMesh.material.opacity = 0.28 * settings.shadowIntensity;
      }
    }
  }

  function shouldRun() {
    return state.enabled && !state.hidden && !state.perSiteDisabled.includes(location.hostname);
  }

  function teardown() {
    savePosition(true);
    companionEpoch += 1;
    pets.slice().forEach(disposePet);
    if (ballGame) {
      ballGame.dispose();
      ballGame = null;
    }
    if (snow) {
      snow.dispose();
      snow = null;
    }
    if (engine) engine.dispose();
    engine = null;
    host.remove();
  }

  function handleStorageChange(next) {
    const wasRunning = !!engine;
    const willRun = next.enabled && !next.hidden && !next.perSiteDisabled.includes(location.hostname);
    const characterChanged = state && next.currentCharacter !== state.currentCharacter;
    const accessoriesChanged = state && JSON.stringify(next.settings.accessories) !== JSON.stringify(state.settings.accessories);
    const styleChanged = state && next.settings.animationStyle !== state.settings.animationStyle;
    const seasonChanged = state && next.settings.seasonal !== state.settings.seasonal;
    const countChanged = state && next.settings.petCount !== state.settings.petCount;
    state = next;

    if (!willRun && wasRunning) {
      teardown();
      return;
    }
    if (willRun && !wasRunning) {
      init();
      return;
    }
    if (!willRun) return;

    const lead = primary();
    if (characterChanged && engine && lead) {
      CharacterManager.getManifest().then((manifestData) => {
        swapPrimary(CharacterManager.findCharacterDef(manifestData, state.currentCharacter));
      });
    } else {
      if (accessoriesChanged && lead) lead.instance.setAccessories(state.settings.accessories);
      if (countChanged) rebuildCompanions();
    }
    if (styleChanged || seasonChanged) pets.forEach(applyLook);
    pets.forEach((p) => p.instance.setScale(state.settings.scale));
  }

  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }, { passive: true });

  window.addEventListener('resize', Utils.debounce(() => {
    if (!engine) return;
    engine.resize(window.innerWidth, window.innerHeight);
    pets.forEach((p) => {
      p.brain.body.x = Utils.clamp(p.brain.body.x, 20, window.innerWidth - 20);
      p.brain.body.y = Utils.clamp(p.brain.body.y, 20, window.innerHeight - 20);
    });
  }, 150));

  window.addEventListener('pagehide', teardown);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && !engine) init();
  });

  Storage.onChange(handleStorageChange);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'pp-action') return;
    if (message.action === 'ball') {
      toggleBallGame();
      return;
    }
    const lead = primary();
    if (!lead) return;
    const brain = lead.brain;
    if (message.action === 'sleep') brain.forceSleep();
    else if (['play', 'dance', 'hop', 'wave', 'perch', 'peek', 'yawn', 'sneeze'].includes(message.action)) brain.special(message.action);
  });

  init();
})();
