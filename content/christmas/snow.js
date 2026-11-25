// Christmas theme, snow core: the falling flakes (SnowfallEngine), the snow that
// piles up along the bottom edge (SnowAccumulationEngine + SnowLayerRenderer)
// and the little snowplow that clears it again (SnowCleanerController). The
// heightfield is the single source of truth: flakes add to it, the plow, the
// snowman game and gifts read and cut into it.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const STEP = 4; // px per heightfield column
  const MAX_HEIGHT = 58; // px the bank saturates at
  const MAX_SLOPE = 2.2; // px of height difference allowed between neighbouring columns

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const smooth = (t) => t * t * (3 - 2 * t);

  // ---- SnowAccumulationEngine: the heightfield -----------------------------------

  function createAccumulation(ctx) {
    let heights = new Float32Array(2);
    let width = 0;
    let dirty = true;
    let relaxClock = 0;
    let clearFactor = 1; // multiplier still to be applied by an animated clear
    let clearLeft = 0; // 0..1 of the animation still to play (about 1 s)

    function resize(newWidth) {
      const w = Math.max(1, Math.round(newWidth));
      if (w === width && heights.length > 2) return;
      const cols = Math.ceil(w / STEP) + 2;
      const next = new Float32Array(cols);
      if (width > 0) {
        // keep the snow where it was, in proportion to the new width
        for (let i = 0; i < cols; i += 1) {
          const src = ((i * STEP) / w) * (width / STEP);
          const i0 = Math.min(heights.length - 1, Math.floor(src));
          const i1 = Math.min(heights.length - 1, i0 + 1);
          const f = src - i0;
          next[i] = heights[i0] * (1 - f) + heights[i1] * f;
        }
      }
      heights = next;
      width = w;
      dirty = true;
    }

    function heightAt(x) {
      const f = clamp(x / STEP, 0, heights.length - 1.001);
      const i = Math.floor(f);
      return heights[i] * (1 - (f - i)) + heights[i + 1] * (f - i);
    }

    function surfaceY(x) {
      return ctx.bounds().height - heightAt(x);
    }

    function addAt(x, amount) {
      const c = Math.round(clamp(x, 0, width) / STEP);
      const kernel = [0.25, 0.6, 1, 0.6, 0.25];
      for (let k = -2; k <= 2; k += 1) {
        const i = c + k;
        if (i < 0 || i >= heights.length) continue;
        const room = Math.max(0, 1 - heights[i] / MAX_HEIGHT);
        heights[i] += amount * kernel[k + 2] * room * room;
      }
      dirty = true;
    }

    function removeAround(x, halfWidth, depth) {
      let volume = 0;
      const c0 = Math.max(0, Math.floor((x - halfWidth) / STEP));
      const c1 = Math.min(heights.length - 1, Math.ceil((x + halfWidth) / STEP));
      for (let i = c0; i <= c1; i += 1) {
        const t = 1 - Math.abs(i * STEP - x) / halfWidth;
        if (t <= 0) continue;
        const cut = Math.min(heights[i], depth * smooth(t));
        heights[i] -= cut;
        volume += cut * STEP;
      }
      if (volume > 0) dirty = true;
      return volume;
    }

    function plowAt(x, halfWidth, keep) {
      let volume = 0;
      const c0 = Math.max(0, Math.floor((x - halfWidth) / STEP));
      const c1 = Math.min(heights.length - 1, Math.ceil((x + halfWidth) / STEP));
      for (let i = c0; i <= c1; i += 1) {
        const d = Math.abs(i * STEP - x) / halfWidth;
        if (d >= 1) continue;
        // full effect in the middle, feathered over the outer quarter
        const w = d < 0.75 ? 1 : smooth(1 - (d - 0.75) / 0.25);
        const target = heights[i] * keep;
        const next = heights[i] + (target - heights[i]) * w;
        volume += (heights[i] - next) * STEP;
        heights[i] = next;
      }
      if (volume > 0) dirty = true;
      return volume;
    }

    function clearAll(fraction) {
      // fold in whatever part of an earlier clear is still pending
      const pending = clearLeft > 0 ? Math.pow(clearFactor, clearLeft) : 1;
      clearFactor = pending * (1 - clamp(fraction, 0, 1));
      clearLeft = 1;
    }

    function total() {
      let sum = 0;
      const n = Math.max(1, heights.length - 2);
      for (let i = 0; i < n; i += 1) sum += heights[i];
      return sum / n;
    }

    // Snow settles: steep slopes slump sideways, tiny crumbs melt into nothing.
    function relax() {
      for (let pass = 0; pass < 2; pass += 1) {
        for (let i = 0; i < heights.length - 1; i += 1) {
          const d = heights[i] - heights[i + 1];
          if (Math.abs(d) > MAX_SLOPE) {
            const move = (Math.abs(d) - MAX_SLOPE) * 0.35 * Math.sign(d);
            heights[i] -= move;
            heights[i + 1] += move;
          }
        }
      }
    }

    // The snowbank this settles at, with or without falling flakes: a thick
    // band with soft mounds and valleys (about 13-45 px).
    function targetAt(x) {
      return 29 + 8 * Math.sin(x * 0.0097 + 1.3) + 5 * Math.sin(x * 0.023 + 0.4) + 2.8 * Math.sin(x * 0.051 + 2.1);
    }

    // Snow settles in by itself, so the layers form even when no flakes fall.
    // `rate` scales the speed (1 = full bank in roughly 45 s).
    function build(dt, rate) {
      const k = 0.055 * rate;
      const floor = 0.35 * rate;
      for (let i = 0; i < heights.length; i += 1) {
        const target = targetAt(i * STEP);
        const gap = target - heights[i];
        if (gap <= 0) continue;
        heights[i] += Math.min(gap, Math.max(gap * k, floor) * dt);
      }
      dirty = true;
    }

    function update(dt, opts) {
      if (opts && opts.autoBuild) build(dt, clamp(opts.rate || 1, 0.1, 6));
      if (clearLeft > 0) {
        const step = Math.min(clearLeft, dt);
        const keep = Math.pow(clearFactor, step / clearLeft);
        for (let i = 0; i < heights.length; i += 1) heights[i] *= keep;
        clearFactor = Math.pow(clearFactor, 1 - step / clearLeft);
        clearLeft -= step;
        dirty = true;
      }
      relaxClock += dt;
      if (relaxClock >= 1 / 30) {
        relaxClock = 0;
        relax();
      }
    }

    return {
      resize,
      heightAt,
      surfaceY,
      addAt,
      removeAround,
      plowAt,
      clearAll,
      total,
      update,
      get dirty() { return dirty; },
      markClean() { dirty = false; },
      targetAt,
      get columns() { return heights.length; },
      get step() { return STEP; },
      raw() { return heights; },
      MAX_HEIGHT,
    };
  }

  // ---- SnowLayerRenderer: three silhouettes with depth, shadow and highlights ------

  const BANK_LAYERS = [
    // Back to front. `mul`/`off` raise the far drifts above the near surface so
    // all three read as separate layers; the front one IS the heightfield
    // (where pals, gifts and snowmen stand).
    { mul: 0.9, off: 10, amp: 8, top: '#d9e6f8', bottom: '#a8c1e3', offset: 1.7, layer: 'back' },
    { mul: 0.85, off: 5, amp: 6.5, top: '#e8f1fc', bottom: '#bad0ee', offset: 4.1, layer: 'back' },
    { mul: 1, off: 0, amp: 5.5, top: '#ffffff', bottom: '#d0e1f6', offset: 0.3, layer: 'front' },
  ];

  function createRenderer(ctx, accumulation) {
    const back = ctx.createLayer('snow-back', 20);
    const front = ctx.createLayer('snow-front', 40);
    let clock = 0;
    let sinceDraw = 1;
    let enabled = true;
    const glints = [];
    for (let i = 0; i < 40; i += 1) glints.push({ u: Math.random(), v: Math.random(), phase: Math.random() * 6.28, speed: 1.2 + Math.random() * 1.8 });

    const noise = (x, o) => Math.sin(x * 0.013 + o) * 0.5 + Math.sin(x * 0.031 + o * 1.7) * 0.3 + Math.sin(x * 0.071 + o * 2.3) * 0.2;

    function crest(layerCfg, x, h, height) {
      const local = accumulation.heightAt(x);
      const base = local * layerCfg.mul + layerCfg.off * clamp(local / 20, 0, 1);
      const bump = layerCfg.amp * noise(x, layerCfg.offset) * clamp(local / 16, 0, 1);
      return height - Math.max(0, base + bump);
    }

    function drawBank(layer, cfg, w, height) {
      const g = layer.g;
      const pts = [];
      for (let x = 0; x <= w + 8; x += 8) pts.push([x, crest(cfg, x, 0, height)]);
      const gradient = g.createLinearGradient(0, height - MAX_HEIGHT, 0, height);
      gradient.addColorStop(0, cfg.top);
      gradient.addColorStop(1, cfg.bottom);

      g.beginPath();
      g.moveTo(-8, height + 4);
      g.lineTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i += 1) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      g.lineTo(w + 8, height + 4);
      g.closePath();
      g.fillStyle = gradient;
      g.fill();

      const rim = new Path2D();
      rim.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i += 1) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        rim.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      // soft shadow just under the crest, an icy line, then the bright rim
      g.save();
      g.translate(0, 5);
      g.strokeStyle = 'rgba(120,150,205,0.22)';
      g.lineWidth = 7;
      g.lineJoin = 'round';
      g.stroke(rim);
      g.restore();
      g.save();
      g.translate(0, 2.5);
      g.strokeStyle = 'rgba(175,215,250,0.65)';
      g.lineWidth = 1.2;
      g.stroke(rim);
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2.4;
      g.stroke(rim);
    }

    function drawGlints(g, w, height) {
      if (accumulation.total() < 4) return;
      glints.forEach((s) => {
        const x = s.u * w;
        const top = crest(BANK_LAYERS[2], x, 0, height);
        const y = top + 7 + s.v * Math.max(2, height - top - 12);
        if (y > height - 3) return;
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(clock * s.speed + s.phase));
        if (a < 0.3) return;
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - 2.5, y);
        g.lineTo(x + 2.5, y);
        g.moveTo(x, y - 2.5);
        g.lineTo(x, y + 2.5);
        g.stroke();
      });
    }

    function redraw() {
      const { width, height } = ctx.bounds();
      back.clear();
      front.clear();
      if (!enabled || accumulation.total() < 0.15) return;
      BANK_LAYERS.forEach((cfg) => drawBank(cfg.layer === 'back' ? back : front, cfg, width, height));
      drawGlints(front.g, width, height);
    }

    function update(dt) {
      clock += dt;
      sinceDraw += dt;
      const interval = ctx.quality() === 'low' ? 0.1 : ctx.quality() === 'medium' ? 0.033 : 0;
      if (sinceDraw < interval) return;
      if (!accumulation.dirty && sinceDraw < 0.16) return;
      sinceDraw = 0;
      accumulation.markClean();
      redraw();
    }

    function setEnabled(on) {
      enabled = !!on;
      sinceDraw = 1;
    }

    back.onResize(() => { sinceDraw = 1; });
    front.onResize(() => { sinceDraw = 1; });

    return {
      update,
      setEnabled,
      redraw,
      dispose() {
        back.dispose();
        front.dispose();
      },
    };
  }

  // ---- SnowfallEngine: layered flakes ---------------------------------------------------

  function paintSprites() {
    const make = (size, draw) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      draw(c.getContext('2d'), size);
      return c;
    };
    const halo = (g, s, color) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, color);
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.beginPath();
      g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
      g.fill();
    };
    const arms = (g, s, branches) => {
      g.translate(s / 2, s / 2);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.98)';
      g.shadowColor = 'rgba(140,175,225,0.85)';
      g.shadowBlur = s * 0.07;
      g.lineWidth = Math.max(1.4, s * 0.07);
      for (let i = 0; i < 6; i += 1) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -s * 0.4);
        if (branches) {
          g.moveTo(0, -s * 0.22);
          g.lineTo(s * 0.1, -s * 0.31);
          g.moveTo(0, -s * 0.22);
          g.lineTo(-s * 0.1, -s * 0.31);
        }
        g.stroke();
        g.restore();
      }
    };
    return [
      // soft round flake with a faint cool rim so it shows on light pages
      make(24, (g, s) => {
        halo(g, s, 'rgba(255,255,255,1)');
        g.strokeStyle = 'rgba(150,185,230,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2);
        g.fill();
      }),
      // six-armed crystal
      make(40, (g, s) => arms(g, s, true)),
      // chunky star flake
      make(32, (g, s) => arms(g, s, false)),
      // large, softly glowing flake
      make(64, (g, s) => {
        halo(g, s, 'rgba(235,245,255,0.75)');
        g.save();
        arms(g, s * 0.8, true);
        g.restore();
      }),
    ];
  }

  function createSnowfall(ctx, accumulation) {
    const layer = ctx.createLayer('flakes', 25);
    const sprites = paintSprites();
    const MAX = 460;
    const f = {
      x: new Float32Array(MAX),
      y: new Float32Array(MAX),
      vy: new Float32Array(MAX),
      sway: new Float32Array(MAX),
      freq: new Float32Array(MAX),
      phase: new Float32Array(MAX),
      size: new Float32Array(MAX),
      rot: new Float32Array(MAX),
      spin: new Float32Array(MAX),
      depth: new Float32Array(MAX),
      alpha: new Float32Array(MAX),
      type: new Uint8Array(MAX),
      live: new Uint8Array(MAX),
    };
    let enabled = true;
    let clock = 0;
    let sinceDraw = 1;
    let active = 0;
    const rand = () => ctx.rand();

    function spawn(i, anywhere) {
      const { width, height } = ctx.bounds();
      const roll = rand();
      const type = roll < 0.55 ? 0 : roll < 0.8 ? 1 : roll < 0.93 ? 2 : 3;
      const depth = type === 3 ? 0.9 + rand() * 0.1 : rand();
      f.type[i] = type;
      f.depth[i] = depth;
      f.size[i] = type === 3 ? 20 + rand() * 12 : type === 0 ? 3 + depth * 5 : 6 + depth * 8;
      f.alpha[i] = type === 3 ? 0.85 : 0.45 + depth * 0.5;
      f.x[i] = rand() * (width + 80) - 40;
      f.y[i] = anywhere ? rand() * height : -rand() * 80 - 10;
      f.vy[i] = 24 + depth * 62 + rand() * 12;
      f.sway[i] = 6 + rand() * 22 * (0.4 + depth);
      f.freq[i] = 0.5 + rand() * 1.4;
      f.phase[i] = rand() * 6.28;
      f.rot[i] = rand() * 6.28;
      f.spin[i] = (rand() - 0.5) * (type === 0 ? 0.6 : 2.2);
      f.live[i] = 1;
    }

    function targetCount() {
      const s = ctx.settings();
      const { width, height } = ctx.bounds();
      const quality = ctx.quality() === 'low' ? 0.5 : ctx.quality() === 'high' ? 1.5 : 1;
      let n = clamp(s.density, 0.1, 1) * (width * height) / (1920 * 1080) * 380 * quality;
      if (ctx.reducedMotion()) n *= 0.4;
      return Math.round(clamp(n, 28, MAX));
    }

    function update(dt) {
      clock += dt;
      const s = ctx.settings();
      const want = enabled && s.snowfall ? targetCount() : 0;
      const { width, height } = ctx.bounds();
      // grow towards the wanted count from the top of the screen; shrink as flakes land
      if (active < want) {
        const add = Math.min(want - active, Math.ceil(dt * 90));
        for (let k = 0; k < add; k += 1) {
          spawn(active, active < 4 && clock < 0.5);
          active += 1;
        }
      }
      const wind = s.wind * (Math.sin(clock * 0.17) * 42 + Math.sin(clock * 0.43 + 1) * 24 + 14) * (ctx.reducedMotion() ? 0.4 : 1);
      const speed = clamp(s.speed, 0.3, 2.5) * (ctx.reducedMotion() ? 0.6 : 1);
      const accumulate = s.accumulation;
      const rate = clamp(s.accumSpeed, 0.2, 4);
      for (let i = 0; i < active; i += 1) {
        f.y[i] += f.vy[i] * speed * dt;
        f.x[i] += (wind * (0.35 + 0.65 * f.depth[i]) + Math.cos(clock * f.freq[i] + f.phase[i]) * f.sway[i] * 0.6) * dt;
        f.rot[i] += f.spin[i] * dt;
        if (f.x[i] < -50) f.x[i] += width + 100;
        else if (f.x[i] > width + 50) f.x[i] -= width + 100;
        const ground = accumulation.surfaceY(clamp(f.x[i], 0, width)) + 1 + f.depth[i] * 3;
        if (f.y[i] >= ground) {
          if (accumulate) accumulation.addAt(f.x[i] + wind * 0.04, (0.55 + f.size[i] * 0.06) * rate * 7);
          if (i >= want) {
            // retire this flake: swap with the last live one
            active -= 1;
            f.x[i] = f.x[active]; f.y[i] = f.y[active]; f.vy[i] = f.vy[active]; f.sway[i] = f.sway[active];
            f.freq[i] = f.freq[active]; f.phase[i] = f.phase[active]; f.size[i] = f.size[active]; f.rot[i] = f.rot[active];
            f.spin[i] = f.spin[active]; f.depth[i] = f.depth[active]; f.alpha[i] = f.alpha[active]; f.type[i] = f.type[active];
            i -= 1;
          } else {
            spawn(i, false);
          }
        }
      }
      if (active === 0 && !enabled) {
        layer.clear();
        return;
      }
      sinceDraw += dt;
      const interval = ctx.quality() === 'low' ? 0.05 : 0;
      if (sinceDraw < interval) return;
      sinceDraw = 0;
      draw(width, height);
    }

    function draw(width, height) {
      const g = layer.g;
      layer.clear();
      for (let i = 0; i < active; i += 1) {
        const sprite = sprites[f.type[i]];
        const size = f.size[i];
        const x = f.x[i] + Math.cos(clock * f.freq[i] + f.phase[i]) * f.sway[i];
        if (x < -size || x > width + size || f.y[i] < -size || f.y[i] > height) continue;
        g.globalAlpha = f.alpha[i];
        if (f.type[i] === 0) {
          g.drawImage(sprite, x - size / 2, f.y[i] - size / 2, size, size);
        } else {
          g.save();
          g.translate(x, f.y[i]);
          g.rotate(f.rot[i]);
          g.drawImage(sprite, -size / 2, -size / 2, size, size);
          g.restore();
        }
      }
      g.globalAlpha = 1;
    }

    function countIn(rect) {
      let n = 0;
      for (let i = 0; i < active; i += 1) {
        const x = f.x[i] + Math.cos(clock * f.freq[i] + f.phase[i]) * f.sway[i];
        if (x >= rect.x && x <= rect.x + rect.w && f.y[i] >= rect.y && f.y[i] <= rect.y + rect.h) n += 1;
      }
      return n;
    }

    return {
      update,
      countIn,
      setEnabled(on) { enabled = !!on; },
      get count() { return active; },
      dispose() { layer.dispose(); },
    };
  }

  // ---- SnowCleanerController: the little snowplow --------------------------------------------

  function createCleaner(ctx, accumulation) {
    const layer = ctx.createLayer('vehicles', 48);
    let hit = null;
    let enabled = false;
    let paused = false;
    let x = 80;
    let dir = 1;
    let turn = 1; // 1 = facing dir, animates through 0 while turning round
    let turnFrom = 1;
    let wheel = 0;
    let bounce = 0;
    let bounceV = 0;
    let clock = 0;
    let lastPass = 0;
    const clods = []; // snow thrown off the blade
    const puffs = []; // exhaust
    let off = null;

    const size = () => clamp(ctx.bounds().height / 800, 0.8, 1.25) * clamp(ctx.scale(), 0.8, 1.4);

    function ensureHit() {
      if (hit) return;
      hit = ctx.makeHit('pp-plow-hit');
      hit.style.cursor = 'pointer';
      hit.title = 'Snowplow';
      hit.addEventListener('pointerdown', onPlowClick);
    }

    function removeHit() {
      if (!hit) return;
      hit.removeEventListener('pointerdown', onPlowClick);
      hit.remove();
      hit = null;
    }

    function onPlowClick(e) {
      e.stopPropagation();
      ctx.audio.play('horn');
      bounceV = -120;
      ctx.events.emit('cleaner:click', { x });
      for (let i = 0; i < 8; i += 1) puffs.push({ x: x - dir * 30 * size(), y: ctx.bounds().height - 30 * size(), vx: -dir * (10 + Math.random() * 20), vy: -20 - Math.random() * 30, life: 0, max: 0.8 });
    }

    function setEnabled(on) {
      enabled = !!on;
      if (enabled) {
        ensureHit();
        const { width } = ctx.bounds();
        x = clamp(x, 60, width - 60);
      } else {
        removeHit();
        layer.clear();
        clods.length = 0;
        puffs.length = 0;
      }
    }

    function spawnClods(volume, bladeX, bladeY, s) {
      const n = Math.min(10, Math.ceil(volume / 24));
      for (let i = 0; i < n; i += 1) {
        clods.push({
          x: bladeX + dir * 2,
          y: bladeY - Math.random() * 10 * s,
          vx: dir * (30 + Math.random() * 70) + (Math.random() - 0.5) * 30,
          vy: -(40 + Math.random() * 110),
          r: 1.5 + Math.random() * 2.8,
          life: 0,
          max: 0.5 + Math.random() * 0.5,
        });
      }
      if (clods.length > 140) clods.splice(0, clods.length - 140);
    }

    function drawVehicle(g, s, facing, lift) {
      // faces right at facing = 1; x scaled for the turn-around
      g.save();
      g.translate(0, lift);
      g.scale(facing, 1);
      // tracks
      const trackY = -9 * s;
      g.fillStyle = '#2b2f3a';
      g.beginPath();
      g.roundRect ? g.roundRect(-28 * s, trackY - 8 * s, 56 * s, 16 * s, 8 * s) : g.rect(-28 * s, trackY - 8 * s, 56 * s, 16 * s);
      g.fill();
      for (let i = 0; i < 4; i += 1) {
        const wx = (-19 + i * 12.6) * s;
        g.fillStyle = '#4a5060';
        g.beginPath();
        g.arc(wx, trackY, 5.4 * s, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#9aa3b8';
        g.lineWidth = 1.4 * s;
        g.beginPath();
        g.moveTo(wx, trackY);
        g.lineTo(wx + Math.cos(wheel + i) * 4.4 * s, trackY + Math.sin(wheel + i) * 4.4 * s);
        g.stroke();
      }
      // body
      g.fillStyle = '#e53935';
      g.beginPath();
      g.roundRect ? g.roundRect(-24 * s, -34 * s, 46 * s, 20 * s, 6 * s) : g.rect(-24 * s, -34 * s, 46 * s, 20 * s);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(-22 * s, -32 * s, 42 * s, 3 * s);
      // cabin
      g.fillStyle = '#c62828';
      g.beginPath();
      g.moveTo(-14 * s, -34 * s);
      g.lineTo(-10 * s, -50 * s);
      g.lineTo(8 * s, -50 * s);
      g.lineTo(12 * s, -34 * s);
      g.closePath();
      g.fill();
      g.fillStyle = '#bfe3ff';
      g.beginPath();
      g.moveTo(-9 * s, -36 * s);
      g.lineTo(-6.5 * s, -47 * s);
      g.lineTo(6 * s, -47 * s);
      g.lineTo(9 * s, -36 * s);
      g.closePath();
      g.fill();
      // beacon
      g.fillStyle = Math.sin(clock * 8) > 0 ? '#ffd54f' : '#ff9800';
      g.beginPath();
      g.arc(-1 * s, -53 * s, 2.6 * s, 0, Math.PI * 2);
      g.fill();
      // exhaust pipe
      g.fillStyle = '#555b6b';
      g.fillRect(-23 * s, -46 * s, 3 * s, 12 * s);
      // headlight
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.arc(21 * s, -27 * s, 2.6 * s, 0, Math.PI * 2);
      g.fill();
      // blade: arm + curved steel plate
      g.strokeStyle = '#6b7384';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.moveTo(20 * s, -22 * s);
      g.lineTo(31 * s, -17 * s);
      g.stroke();
      g.fillStyle = '#f5b021';
      g.beginPath();
      g.moveTo(30 * s, -34 * s);
      g.quadraticCurveTo(40 * s, -22 * s, 33 * s, -6 * s);
      g.lineTo(28 * s, -8 * s);
      g.quadraticCurveTo(33 * s, -22 * s, 26 * s, -32 * s);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }

    function update(dt) {
      const s = ctx.settings();
      const active = enabled && s.cleaner;
      if (!active) {
        if (hit) removeHit();
        if (clods.length || puffs.length) {
          clods.length = 0;
          puffs.length = 0;
          layer.clear();
        }
        return;
      }
      ensureHit();
      clock += dt;
      const { width, height } = ctx.bounds();
      const sz = size();
      const speed = 62 * clamp(s.cleanerSpeed, 0.2, 4) * (ctx.reducedMotion() ? 0.6 : 1) * sz;

      {
        // direction changes: ease the sprite round with a little hop
        if (turn !== dir) {
          turn += (dir - turn) * Math.min(1, dt * 5);
          if (Math.abs(turn - dir) < 0.03) turn = dir;
        }
        const turning = Math.abs(turn - dir) > 0.03 && Math.abs(turn) < 0.98;
        if (!paused && !turning) {
          x += dir * speed * dt;
          wheel += dir * speed * dt * 0.16;
          const margin = 40 * sz;
          if (x > width - margin) { x = width - margin; dir = -1; bounceV = -70; }
          else if (x < margin) { x = margin; dir = 1; bounceV = -70; }
        }

        if (!paused && !turning) {
          const bladeX = x + dir * 33 * sz;
          const volume = accumulation.plowAt(bladeX, 15 * sz, 0.1);
          if (volume > 0.4) {
            spawnClods(volume, bladeX, height - 12 * sz, sz);
            if (clock - lastPass > 0.9) ctx.audio.play('plow', { volume: 0.5 });
          }
          if (clock - lastPass > 1.6) {
            lastPass = clock;
            ctx.events.emit('cleaner:pass', { x, dir });
          }
          if (Math.random() < dt * 14) puffs.push({ x: x - dir * 24 * sz, y: height - 45 * sz, vx: -dir * (6 + Math.random() * 10), vy: -14 - Math.random() * 12, life: 0, max: 0.9 });
        }
      }

      // springy hop after a click / turn
      bounceV += 520 * dt;
      bounce += bounceV * dt;
      if (bounce > 0) { bounce = 0; bounceV = Math.abs(bounceV) > 40 ? -bounceV * 0.35 : 0; }

      layer.clear();
      const g = layer.g;
      // thrown snow + exhaust
      for (let i = clods.length - 1; i >= 0; i -= 1) {
        const c = clods[i];
        c.life += dt;
        c.vy += 360 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.life > c.max || c.y > height) { clods.splice(i, 1); continue; }
        g.fillStyle = `rgba(255,255,255,${1 - c.life / c.max})`;
        g.beginPath();
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = puffs.length - 1; i >= 0; i -= 1) {
        const p = puffs[i];
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life > p.max) { puffs.splice(i, 1); continue; }
        const q = p.life / p.max;
        g.fillStyle = `rgba(210,215,225,${0.5 * (1 - q)})`;
        g.beginPath();
        g.arc(p.x, p.y, (2 + q * 6) * sz, 0, Math.PI * 2);
        g.fill();
      }

      const baseY = height - 2;
      g.save();
      g.translate(x, baseY + Math.sin(clock * 22) * 0.5 * (paused ? 0 : 1));
      drawVehicle(g, sz, turn, bounce);
      g.restore();

      if (hit) {
        hit.style.left = `${x - 34 * sz}px`;
        hit.style.top = `${baseY - 56 * sz + bounce}px`;
        hit.style.width = `${68 * sz}px`;
        hit.style.height = `${58 * sz}px`;
      }
    }

    return {
      update,
      setEnabled,
      get paused() { return paused; },
      setPaused(p) { paused = !!p; },
      togglePaused() { paused = !paused; return paused; },
      get x() { return x; },
      get direction() { return dir; },
      dispose() {
        removeHit();
        layer.dispose();
        clods.length = 0;
        puffs.length = 0;
        off = null;
      },
    };
  }

  Christmas.Accumulation = { create: createAccumulation, STEP, MAX_HEIGHT };
  Christmas.SnowLayerRenderer = { create: createRenderer };
  Christmas.Snowfall = { create: createSnowfall };
  Christmas.Cleaner = { create: createCleaner };
})(window);
