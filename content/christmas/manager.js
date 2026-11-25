// ChristmasThemeManager: builds the layered canvas stack inside the extension's
// shadow-DOM stage, wires the independent Christmas modules together through
// one shared context (layers, the snow heightfield, audio, events, pals) and
// shows the small unobtrusive control for the interactive extras.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  const PANEL_CSS = `
    .pp-xmas-fab { position:absolute; left:12px; bottom:12px; z-index:240; width:36px; height:36px; border:0; border-radius:50%;
      background:linear-gradient(145deg,#ff5a5f,#c62828); color:#fff; font-size:18px; line-height:36px; text-align:center; cursor:pointer;
      pointer-events:auto; box-shadow:0 4px 14px rgba(120,20,30,.4), inset 0 1px 0 rgba(255,255,255,.35); opacity:.82; transition:opacity .15s, transform .15s; padding:0; }
    .pp-xmas-fab:hover { opacity:1; transform:scale(1.08); }
    .pp-xmas-panel { position:absolute; left:12px; bottom:56px; z-index:241; width:236px; padding:10px; border-radius:18px; pointer-events:auto;
      background:rgba(255,255,255,.96); color:#23304a; box-shadow:0 14px 40px rgba(20,40,90,.28); border:1px solid rgba(200,220,245,.9);
      font:600 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; display:none; flex-direction:column; gap:4px; }
    .pp-xmas-panel.open { display:flex; }
    .pp-xmas-title { display:flex; align-items:center; justify-content:space-between; padding:2px 4px 6px; font-weight:800; font-size:13px; color:#c62828; }
    .pp-xmas-row { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:9px; padding:8px 9px; border-radius:12px; cursor:pointer; color:#23304a; font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    .pp-xmas-row:hover { background:#eef4fc; }
    .pp-xmas-row .pp-xmas-ico { width:22px; text-align:center; font-size:16px; }
    .pp-xmas-row .pp-xmas-state { margin-left:auto; font-size:11px; font-weight:800; color:#6b7a96; }
    .pp-xmas-row.on { background:#fde8e8; }
    .pp-xmas-row.on .pp-xmas-state { color:#c62828; }
    .pp-xmas-slider { display:flex; align-items:center; gap:8px; padding:4px 9px 6px 40px; font-size:11px; color:#6b7a96; }
    .pp-xmas-slider input { flex:1; accent-color:#c62828; height:4px; }
  `;

  function createManager(options) {
    const stage = options.stage;
    const layers = [];
    const hits = new Set();
    const listeners = {};
    const modules = {};
    let disposed = false;
    let lastW = 0;
    let lastH = 0;
    let lastDpr = 0;
    let lastQuality = '';
    let clock = 0;
    let panelOpen = false;
    const failed = new Set();

    const settings = () => options.getChristmas();
    const bounds = () => options.getBounds();
    const quality = () => {
      const q = settings().quality;
      return q === 'low' || q === 'high' ? q : 'medium';
    };
    const dprCap = () => (quality() === 'low' ? 1 : quality() === 'high' ? 2 : 1.5);
    const currentDpr = () => Math.min(global.devicePixelRatio || 1, dprCap());

    // ---- layers --------------------------------------------------------------

    function sizeLayer(layer) {
      const { width, height } = bounds();
      const dpr = currentDpr();
      layer.dpr = dpr;
      layer.width = width;
      layer.height = height;
      layer.canvas.width = Math.max(1, Math.round(width * dpr));
      layer.canvas.height = Math.max(1, Math.round(height * dpr));
      layer.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer.resizeCallbacks.forEach((fn) => fn(layer));
    }

    function createLayer(name, order) {
      const canvas = document.createElement('canvas');
      canvas.className = `pp-xmas-layer pp-xmas-${name}`;
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${order};display:block;`;
      stage.insertBefore(canvas, stage.firstChild);
      const layer = {
        canvas,
        g: canvas.getContext('2d'),
        width: 0,
        height: 0,
        dpr: 1,
        name,
        resizeCallbacks: [],
        clear() {
          layer.g.clearRect(0, 0, layer.width, layer.height);
        },
        onResize(fn) {
          layer.resizeCallbacks.push(fn);
        },
        dispose() {
          const i = layers.indexOf(layer);
          if (i >= 0) layers.splice(i, 1);
          canvas.remove();
        },
      };
      layers.push(layer);
      sizeLayer(layer);
      return layer;
    }

    function makeHit(cls) {
      const el = document.createElement('div');
      el.className = cls || '';
      el.style.cssText = 'position:absolute;pointer-events:auto;z-index:230;touch-action:none;background:transparent;';
      stage.appendChild(el);
      hits.add(el);
      const remove = el.remove.bind(el);
      el.remove = () => {
        hits.delete(el);
        remove();
      };
      return el;
    }

    // ---- events + audio ------------------------------------------------------------

    function on(name, fn) {
      (listeners[name] || (listeners[name] = new Set())).add(fn);
      return () => listeners[name] && listeners[name].delete(fn);
    }

    function emit(name, data) {
      if (!listeners[name]) return;
      listeners[name].forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('Pocket Pal Christmas event handler failed', name, e);
        }
      });
    }

    const audioProxy = {
      play(name, opts) {
        if (modules.audio && modules.audio.play) modules.audio.play(name, opts);
      },
    };

    // ---- context shared with every module ------------------------------------------

    const accumulation = Christmas.Accumulation.create({ bounds, quality });
    const ctx = {
      stage,
      bounds,
      scale: options.getScale,
      settings,
      reducedMotion: options.reducedMotion,
      quality,
      rand: Math.random,
      createLayer,
      makeHit,
      audio: audioProxy,
      events: { on, emit },
      pets: options.getPets,
      say: (text) => {
        const pets = options.getPets();
        if (pets[0]) pets[0].brain.say(text);
      },
      snow: {
        heightAt: accumulation.heightAt,
        surfaceY: accumulation.surfaceY,
        addAt: accumulation.addAt,
        removeAround: accumulation.removeAround,
        plowAt: accumulation.plowAt,
        clearAll: accumulation.clearAll,
        total: accumulation.total,
      },
      flakes: { countIn: (rect) => (modules.snowfall ? modules.snowfall.countIn(rect) : 0) },
    };
    accumulation.resize(bounds().width);

    function build(name, factory) {
      try {
        const impl = factory();
        if (impl) modules[name] = impl;
      } catch (e) {
        console.error(`Pocket Pal Christmas: ${name} failed to start`, e);
      }
    }

    // The audio manager comes first so every other module can play sounds.
    build('audio', () => (Christmas.Audio ? Christmas.Audio.create(ctx) : null));
    build('renderer', () => Christmas.SnowLayerRenderer.create(ctx, accumulation));
    build('snowfall', () => Christmas.Snowfall.create(ctx, accumulation));
    build('decorations', () => (Christmas.Decorations ? Christmas.Decorations.create(ctx) : null));
    build('snowman', () => (Christmas.Snowman ? Christmas.Snowman.create(ctx) : null));
    build('cleaner', () => Christmas.Cleaner.create(ctx, accumulation));
    build('sleigh', () => (Christmas.Sleigh ? Christmas.Sleigh.create(ctx) : null));
    build('companions', () => (Christmas.Companions ? Christmas.Companions.create(ctx) : null));

    // ---- small control panel ---------------------------------------------------------

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    stage.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'pp-xmas-fab';
    fab.type = 'button';
    fab.title = 'Christmas';
    fab.textContent = '🎄';
    stage.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'pp-xmas-panel';
    stage.appendChild(panel);

    const rows = {};
    function addRow(key, icon, label, handler) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pp-xmas-row';
      row.innerHTML = '<span class="pp-xmas-ico"></span><span class="pp-xmas-label"></span><span class="pp-xmas-state"></span>';
      row.querySelector('.pp-xmas-ico').textContent = icon;
      row.querySelector('.pp-xmas-label').textContent = label;
      row.addEventListener('click', () => {
        handler();
        refreshPanel();
      });
      panel.appendChild(row);
      rows[key] = row;
      return row;
    }

    const title = document.createElement('div');
    title.className = 'pp-xmas-title';
    title.innerHTML = '<span>🎄 Christmas</span>';
    panel.appendChild(title);

    addRow('snowman', '⛄', 'Build a snowman', () => {
      const m = modules.snowman;
      if (!m || !settings().snowman) return;
      m.setActive(!m.active);
      if (m.active) panelOpen = false;
    });
    addRow('cleaner', '🚜', 'Snowplow', () => {
      const m = modules.cleaner;
      if (!m) return;
      if (!settings().cleaner) options.saveChristmas({ cleaner: true });
      else m.togglePaused();
    });
    const speedWrap = document.createElement('div');
    speedWrap.className = 'pp-xmas-slider';
    speedWrap.innerHTML = '<span>Speed</span><input type="range" min="0.3" max="3" step="0.1" /><span class="pp-xmas-speedval"></span>';
    panel.appendChild(speedWrap);
    const speedInput = speedWrap.querySelector('input');
    speedInput.addEventListener('input', () => {
      speedWrap.querySelector('.pp-xmas-speedval').textContent = `${Number(speedInput.value).toFixed(1)}x`;
      options.saveChristmas({ cleanerSpeed: Number(speedInput.value) });
    });
    addRow('sleigh', '🛷', 'Call the sleigh', () => {
      const m = modules.sleigh;
      if (!m) return;
      // Calling is an explicit request: it works even if the random fly-bys are off.
      if (m.callDown) {
        if (m.parked || m.mode === 'descending') m.dismiss();
        else m.callDown();
      } else if (m.triggerPass) {
        m.triggerPass();
      }
      panelOpen = false;
    });
    addRow('pets', '🐾', 'Show my pals', () => {
      options.saveChristmas({ pets: settings().pets === false });
    });
    addRow('sweep', '🧹', 'Sweep the snow away', () => {
      accumulation.clearAll(0.92);
      audioProxy.play('whoosh');
    });
    addRow('reset', '🗑️', 'Remove snowmen', () => {
      if (modules.snowman && modules.snowman.reset) modules.snowman.reset();
    });

    function setRow(key, text, on, hidden) {
      const row = rows[key];
      if (!row) return;
      row.style.display = hidden ? 'none' : 'flex';
      row.classList.toggle('on', !!on);
      row.querySelector('.pp-xmas-state').textContent = text;
    }

    function refreshPanel() {
      const s = settings();
      const snowman = modules.snowman;
      const cleaner = modules.cleaner;
      setRow('snowman', snowman && snowman.active ? 'Playing' : s.snowman ? 'Off' : 'Disabled', snowman && snowman.active, !snowman);
      setRow('cleaner', !s.cleaner ? 'Off' : cleaner && cleaner.paused ? 'Paused' : 'Running', s.cleaner && cleaner && !cleaner.paused, !cleaner);
      const sleigh = modules.sleigh;
      const out = !!(sleigh && (sleigh.parked || sleigh.mode === 'descending'));
      rows.sleigh.querySelector('.pp-xmas-label').textContent = out ? 'Send the sleigh away' : 'Call the sleigh';
      setRow('sleigh', out ? 'Here' : '', out, !sleigh);
      setRow('reset', snowman ? `${snowman.count || 0}` : '', false, !snowman);
      setRow('pets', s.pets === false ? 'Off' : 'On', s.pets !== false, false);
      speedWrap.style.display = cleaner && s.cleaner ? 'flex' : 'none';
      speedInput.value = s.cleanerSpeed;
      speedWrap.querySelector('.pp-xmas-speedval').textContent = `${Number(s.cleanerSpeed).toFixed(1)}x`;
      panel.classList.toggle('open', panelOpen);
    }

    fab.addEventListener('click', () => {
      panelOpen = !panelOpen;
      refreshPanel();
    });
    const outsideClose = (e) => {
      if (!panelOpen) return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(panel) || path.includes(fab)) return;
      panelOpen = false;
      refreshPanel();
    };
    global.addEventListener('pointerdown', outsideClose, true);

    // ---- settings + frame loop ----------------------------------------------------------

    function guard(name, fn) {
      if (failed.has(name)) return;
      try {
        fn();
      } catch (e) {
        failed.add(name);
        console.error(`Pocket Pal Christmas: ${name} stopped after an error`, e);
      }
    }

    function applySettings() {
      const s = settings();
      const flags = {
        renderer: s.accumulation,
        snowfall: s.snowfall,
        decorations: s.decorations,
        sleigh: s.sleigh,
        snowman: s.snowman,
        cleaner: s.cleaner,
        companions: true,
        audio: s.sound,
      };
      Object.keys(flags).forEach((name) => {
        const m = modules[name];
        if (!m) return;
        guard(name, () => {
          if (m.setEnabled) m.setEnabled(!!flags[name]);
          if (m.applySettings) m.applySettings();
        });
      });
      if (!s.snowman && modules.snowman && modules.snowman.active) modules.snowman.setActive(false);
      refreshPanel();
    }

    function checkResize() {
      const { width, height } = bounds();
      const dpr = currentDpr();
      const q = quality();
      if (width === lastW && height === lastH && dpr === lastDpr && q === lastQuality) return;
      lastW = width;
      lastH = height;
      lastDpr = dpr;
      lastQuality = q;
      accumulation.resize(width);
      layers.slice().forEach(sizeLayer);
    }

    function update(dt) {
      if (disposed) return;
      clock += dt;
      checkResize();
      const s = settings();
      // The bank builds itself while "snow builds up" is on; falling flakes add to it on top.
      accumulation.update(dt, { autoBuild: !!s.accumulation, rate: clamp(s.accumSpeed, 0.2, 4) * (s.snowfall ? 0.7 + clamp(s.density, 0.1, 1) * 0.6 : 1) });
      ['snowfall', 'renderer', 'decorations', 'snowman', 'cleaner', 'sleigh', 'companions', 'audio'].forEach((name) => {
        const m = modules[name];
        if (m && m.update) guard(name, () => m.update(dt));
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      emit('theme:off', {});
      global.removeEventListener('pointerdown', outsideClose, true);
      Object.keys(modules).forEach((name) => {
        try {
          if (modules[name].setEnabled) modules[name].setEnabled(false);
          if (modules[name].dispose) modules[name].dispose();
        } catch (e) {
          console.error(`Pocket Pal Christmas: ${name} failed to clean up`, e);
        }
      });
      layers.slice().forEach((l) => l.dispose());
      hits.forEach((el) => el.remove());
      hits.clear();
      fab.remove();
      panel.remove();
      style.remove();
      Object.keys(listeners).forEach((k) => listeners[k].clear());
    }

    applySettings();

    return {
      ctx,
      modules,
      accumulation,
      update,
      applySettings,
      dispose,
      get panelOpen() { return panelOpen; },
      openPanel(open) {
        panelOpen = !!open;
        refreshPanel();
      },
    };
  }

  Christmas.createManager = createManager;
})(window);
