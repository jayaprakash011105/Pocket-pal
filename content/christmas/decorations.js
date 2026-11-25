// Christmas decorations, drawn procedurally with canvas and kept airy: a few
// snow-covered fir trees and gift boxes planted at the bottom corners, a thin string of twinkling lights along the very top
// edge, hanging stars and ornaments, rare shooting stars and gentle sparkles.
// Every element has its own switch in settings.deco; the master switch is
// settings.decorations. Layers only exist while something on them is enabled.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const BULB_COLORS = ['#ff5a5a', '#ffd54a', '#4dc3ff', '#ff8ad8', '#62dd93'];
  const GIFT_COLORS = [['#d6322f', '#fff6e0'], ['#2f8f68', '#ffd54a'], ['#3b82d6', '#fff6e0'], ['#8f5fd6', '#ffd1ec']];
  const ORNAMENT_COLORS = ['#d6322f', '#3b82d6', '#c9d3e0', '#e0a63a'];
  const FRAME_GAP = { low: 1 / 12, medium: 1 / 30, high: 1 / 60 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function starPath(g, cx, cy, outer, inner, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  function glow(g, x, y, radius, color, alpha) {
    const grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = alpha;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  // ---- Trees -------------------------------------------------------------------

  // Pre-renders everything about a tree that never changes (foliage tiers,
  // snow caps, trunk); the twinkling lights and topper are drawn live.
  function paintTreeSprite(tree, dpr) {
    const h = tree.h;
    const w = Math.ceil(h * 0.74);
    const pad = 6;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((w + pad * 2) * dpr);
    canvas.height = Math.ceil((h + pad * 2) * dpr);
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const cx = pad + w / 2;
    const baseY = pad + h;
    const trunkH = h * 0.07;
    const foliageH = h - trunkH;

    g.fillStyle = '#7a4a2b';
    g.fillRect(cx - h * 0.03, baseY - trunkH - 1, h * 0.06, trunkH + 1);

    const tiers = 4;
    for (let i = 0; i < tiers; i += 1) {
      const bottomY = baseY - trunkH - i * foliageH * 0.235;
      const tierH = foliageH * (0.42 - i * 0.012);
      const topY = bottomY - tierH;
      const hw = h * 0.33 * (1 - i * 0.2);

      const grad = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
      grad.addColorStop(0, '#1a5a47');
      grad.addColorStop(0.5, '#2b8f66');
      grad.addColorStop(1, '#1d6a50');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx, topY);
      g.quadraticCurveTo(cx + hw * 0.5, topY + tierH * 0.55, cx + hw, bottomY);
      for (let b = 0; b < 3; b += 1) {
        const x0 = cx + hw - (b * 2 * hw) / 3;
        const x1 = cx + hw - ((b + 1) * 2 * hw) / 3;
        g.quadraticCurveTo((x0 + x1) / 2, bottomY + tierH * 0.1, x1, bottomY);
      }
      g.quadraticCurveTo(cx - hw * 0.5, topY + tierH * 0.55, cx, topY);
      g.closePath();
      g.fill();

      // Soft snow cap draped over the upper part of the tier.
      const capDepth = tierH * 0.42;
      const capHw = hw * 0.5;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(cx, topY - 0.5);
      g.quadraticCurveTo(cx + capHw * 0.55, topY + capDepth * 0.5, cx + capHw, topY + capDepth);
      g.quadraticCurveTo(cx + capHw * 0.55, topY + capDepth * 1.18, cx + capHw * 0.2, topY + capDepth * 0.92);
      g.quadraticCurveTo(cx, topY + capDepth * 1.2, cx - capHw * 0.2, topY + capDepth * 0.92);
      g.quadraticCurveTo(cx - capHw * 0.55, topY + capDepth * 1.18, cx - capHw, topY + capDepth);
      g.quadraticCurveTo(cx - capHw * 0.55, topY + capDepth * 0.5, cx, topY - 0.5);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(170,198,232,0.55)';
      g.lineWidth = 1;
      g.stroke();

      // Little snow lumps resting on the tier's lower edge.
      g.fillStyle = 'rgba(255,255,255,0.92)';
      [-0.62, -0.2, 0.3, 0.7].forEach((f, k) => {
        g.beginPath();
        g.ellipse(cx + hw * f, bottomY - 1, hw * 0.12, tierH * (0.035 + (k % 2) * 0.015), 0, 0, Math.PI * 2);
        g.fill();
      });
    }
    return { canvas, w: w + pad * 2, h: h + pad * 2, pad, cx: w / 2 + pad, baseY: h + pad };
  }

  function drawStar(g, x, y, r, rot, alpha) {
    glow(g, x, y, r * 2.4, 'rgba(255,230,140,0.9)', 0.5 * alpha);
    const grad = g.createLinearGradient(x - r, y - r, x + r, y + r);
    grad.addColorStop(0, '#fff2b0');
    grad.addColorStop(1, '#f0b43a');
    g.globalAlpha = alpha;
    starPath(g, x, y, r, r * 0.46, rot);
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(170,110,20,0.55)';
    g.stroke();
    g.globalAlpha = 1;
  }

  function drawBauble(g, x, y, r, color) {
    g.fillStyle = '#9aa7b8';
    g.fillRect(x - r * 0.28, y - r - 3, r * 0.56, 3.5);
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(30,20,50,0.75)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.beginPath();
    g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
    g.fill();
  }

  function drawGift(g, x, baseY, size, colors, rot) {
    g.save();
    g.translate(x, baseY);
    g.rotate(rot);
    const s = size;
    g.fillStyle = colors[0];
    g.fillRect(-s / 2, -s, s, s);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(-s / 2, -s, s * 0.22, s);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(-s / 2, -s, s, s * 0.22);
    g.fillStyle = colors[1];
    g.fillRect(-s * 0.09, -s, s * 0.18, s);
    g.fillRect(-s / 2, -s * 0.6, s, s * 0.16);
    [-1, 1].forEach((side) => {
      g.beginPath();
      g.ellipse(side * s * 0.2, -s - s * 0.1, s * 0.2, s * 0.12, side * 0.5, 0, Math.PI * 2);
      g.fill();
    });
    g.beginPath();
    g.arc(0, -s - s * 0.02, s * 0.07, 0, Math.PI * 2);
    g.fillStyle = colors[1];
    g.fill();
    g.restore();
  }

  function create(ctx) {
    let enabled = true;
    let disposed = false;
    let deco = null;
    let seed = Math.floor(ctx.rand() * 1e9) + 1;
    let clock = 0;
    let sinceFrame = 0;
    let dirty = true;
    let shootingTimer = 0;
    let shooting = null;
    let layout = null;
    let sprites = [];
    let spriteDpr = 0;
    let offResize = [];

    const settings = () => (ctx.settings ? ctx.settings() : {}) || {};
    const bounds = () => ctx.bounds();

    function flags() {
      const s = settings();
      const d = s.deco || {};
      const master = enabled && s.decorations !== false;
      const on = (key) => master && d[key] !== false;
      return {
        master,
        trees: on('trees'),
        gifts: on('gifts'),
        lights: on('lights'),
        stars: on('stars'),
        ornaments: on('ornaments'),
        shootingStars: on('shootingStars') && !ctx.reducedMotion(),
        sparkles: on('sparkles'),
      };
    }

    function needsDeco(f) {
      return f.trees || f.gifts || f.lights || f.stars || f.ornaments || f.shootingStars || f.sparkles;
    }

    // ---- Layout (fractions of the viewport, so a resize just re-scales) ---------

    function buildLayout() {
      const rand = mulberry32(seed);
      const treeSlots = [
        { xf: 0.05, size: 1.0 },
        { xf: 0.955, size: 0.88 },
        { xf: 0.125, size: 0.66 },
        { xf: 0.88, size: 0.58 },
      ];
      const trees = treeSlots.map((slot) => ({
        xf: slot.xf + (rand() - 0.5) * 0.012,
        hf: slot.size * (0.92 + rand() * 0.16),
        lights: Array.from({ length: 8 }, () => {
          const v = 0.2 + rand() * 0.66;
          return { v, u: (rand() * 2 - 1) * (1 - v) * 0.8 + (rand() - 0.5) * 0.05, c: BULB_COLORS[Math.floor(rand() * BULB_COLORS.length)], phase: rand() * 6.28 };
        }),
      }));
      const gifts = [];
      trees.forEach((tree, i) => {
        const count = i < 2 ? 2 : 1;
        for (let k = 0; k < count; k += 1) {
          gifts.push({
            tree: i,
            off: (k === 0 ? 1 : -1) * (0.26 + rand() * 0.16) * (i % 2 === 0 ? 1 : -1),
            sf: 0.12 + rand() * 0.06,
            colors: GIFT_COLORS[Math.floor(rand() * GIFT_COLORS.length)],
            rot: (rand() - 0.5) * 0.18,
          });
        }
      });
      const hang = (xs, kind) => xs.map((xf) => ({
        kind,
        xf: xf + (rand() - 0.5) * 0.02,
        len: kind === 'star' ? 28 + rand() * 34 : 22 + rand() * 38,
        r: kind === 'star' ? 8 + rand() * 4 : 8 + rand() * 4,
        color: ORNAMENT_COLORS[Math.floor(rand() * ORNAMENT_COLORS.length)],
        phase: rand() * 6.28,
        speed: 0.5 + rand() * 0.5,
      }));
      const stars = hang([0.07, 0.19, 0.8, 0.93], 'star');
      const ornaments = hang([0.12, 0.25, 0.74, 0.87], 'ornament');
      const sparkles = Array.from({ length: 18 }, () => ({ xf: rand(), dy: rand(), phase: rand() * 6.28, speed: 0.6 + rand() * 1.2, size: 2.5 + rand() * 2.5 }));
      layout = { trees, gifts, stars, ornaments, sparkles };
    }

    function visibleTrees(W) {
      const n = W < 760 ? 2 : W < 1300 ? 3 : 4;
      return layout.trees.slice(0, n);
    }

    function treeBox(tree, W, H) {
      const base = Math.min(Math.max(H * 0.24, 110), 220);
      const h = base * tree.hf;
      return { x: tree.xf * W, h, baseY: H - 3 };
    }

    function rebuildSprites(dpr) {
      const { width: W, height: H } = bounds();
      spriteDpr = dpr;
      sprites = visibleTrees(W).map((tree) => {
        const box = treeBox(tree, W, H);
        return { tree, box, sprite: paintTreeSprite({ h: box.h }, dpr) };
      });
    }

    // ---- Layers ------------------------------------------------------------------

    function ensureLayers() {
      const f = flags();
      if (needsDeco(f) && !deco) {
        deco = ctx.createLayer('xmas-deco', 30);
        offResize.push(deco.onResize(() => { sprites = []; dirty = true; }));
        dirty = true;
      } else if (!needsDeco(f) && deco) {
        deco.dispose();
        deco = null;
        sprites = [];
      }
      return f;
    }

    // ---- Painting ------------------------------------------------------------------

    function paintLights(g, W, f, reduced) {
      const span = 250;
      const count = Math.ceil(W / span) + 1;
      const step = W / (count - 1 || 1);
      let bulbIndex = 0;
      for (let k = 0; k < count - 1; k += 1) {
        const x0 = k * step;
        const x1 = (k + 1) * step;
        const sag = 9 + 3 * Math.sin(k * 1.7 + seed * 0.001);
        const px = (t) => (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * x1;
        const py = (t) => (1 - t) * (1 - t) * 2 + 2 * (1 - t) * t * (2 + 2 * sag) + t * t * 2;
        g.strokeStyle = 'rgba(30,90,60,0.5)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x0, 2);
        g.quadraticCurveTo((x0 + x1) / 2, 2 + 2 * sag, x1, 2);
        g.stroke();
        const bulbs = Math.max(4, Math.round(step / 26));
        for (let b = 1; b < bulbs; b += 1) {
          const t = b / bulbs;
          const x = px(t);
          const y = py(t) + 3.5;
          const color = BULB_COLORS[bulbIndex % BULB_COLORS.length];
          const twinkle = reduced ? 0.7 : 0.5 + 0.4 * Math.sin(clock * 2.1 + bulbIndex * 1.3);
          glow(g, x, y, 8, color, 0.55 * twinkle);
          g.globalAlpha = 0.5 + 0.45 * twinkle;
          g.fillStyle = color;
          g.beginPath();
          g.ellipse(x, y, 2.1, 3, 0, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          bulbIndex += 1;
        }
      }
    }

    function paintDeco() {
      const g = deco.g;
      const { width: W, height: H } = bounds();
      const f = flags();
      const reduced = ctx.reducedMotion();
      g.clearRect(0, 0, W, H);

      if (f.lights) paintLights(g, W, f, reduced);

      const swayAmp = reduced ? 0 : 1;
      if (f.stars) {
        layout.stars.forEach((s) => {
          const x0 = s.xf * W;
          if (x0 < 0 || x0 > W) return;
          const ang = swayAmp * 0.1 * Math.sin(clock * s.speed + s.phase);
          const px = x0 + Math.sin(ang) * s.len;
          const py = Math.cos(ang) * s.len;
          g.strokeStyle = 'rgba(150,160,180,0.55)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0, 0);
          g.lineTo(px, py);
          g.stroke();
          drawStar(g, px, py + s.r * 0.6, s.r, ang * 0.8, 0.95);
        });
      }
      if (f.ornaments) {
        layout.ornaments.forEach((o) => {
          const x0 = o.xf * W;
          if (x0 < 0 || x0 > W) return;
          const ang = swayAmp * 0.09 * Math.sin(clock * o.speed + o.phase);
          const px = x0 + Math.sin(ang) * o.len;
          const py = Math.cos(ang) * o.len;
          g.strokeStyle = 'rgba(150,160,180,0.55)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0, 0);
          g.lineTo(px, py);
          g.stroke();
          drawBauble(g, px, py + o.r + 3, o.r, o.color);
        });
      }

      const treeBoxes = f.trees || f.gifts ? visibleTrees(W).map((tree) => ({ tree, box: treeBox(tree, W, H) })) : [];
      if (f.trees) {
        if (!sprites.length || spriteDpr !== deco.dpr) rebuildSprites(deco.dpr);
        sprites.forEach(({ tree, box, sprite }) => {
          g.drawImage(sprite.canvas, box.x - sprite.cx, box.baseY - sprite.baseY, sprite.w, sprite.h);
          tree.lights.forEach((l, i) => {
            const lx = box.x + l.u * box.h * 0.4;
            const ly = box.baseY - box.h * 0.07 - l.v * box.h * 0.9;
            const twinkle = reduced ? 0.75 : 0.5 + 0.5 * Math.sin(clock * 1.9 + l.phase + i);
            glow(g, lx, ly, 9, l.c, 0.7 * twinkle);
            g.globalAlpha = 0.6 + 0.4 * twinkle;
            g.fillStyle = l.c;
            g.beginPath();
            g.arc(lx, ly, 2, 0, Math.PI * 2);
            g.fill();
            g.globalAlpha = 1;
          });
          const topY = box.baseY - box.h - 3;
          drawStar(g, box.x, topY + box.h * 0.02, Math.max(6, box.h * 0.055), reduced ? 0 : Math.sin(clock * 0.6) * 0.08, 1);
        });
      }
      if (f.gifts) {
        layout.gifts.forEach((gift) => {
          const entry = treeBoxes[gift.tree];
          if (!entry) return;
          const size = Math.max(14, entry.box.h * gift.sf);
          const gx = entry.box.x + gift.off * entry.box.h;
          const surface = ctx.snow && ctx.snow.surfaceY ? ctx.snow.surfaceY(gx) : entry.box.baseY;
          drawGift(g, gx, Math.min(entry.box.baseY, surface + size * 0.3), size, gift.colors, gift.rot);
        });
      }

      if (f.sparkles) {
        const quality = ctx.quality();
        const shown = quality === 'low' ? 6 : quality === 'medium' ? 12 : 18;
        layout.sparkles.slice(0, shown).forEach((sp) => {
          const x = sp.xf * W;
          const surface = ctx.snow && ctx.snow.surfaceY ? ctx.snow.surfaceY(x) : H - 20;
          const y = surface - 4 - sp.dy * 34;
          const pulse = reduced ? 0.55 : Math.max(0, Math.sin(clock * sp.speed + sp.phase));
          if (pulse < 0.05) return;
          const r = sp.size * (0.6 + pulse * 0.6);
          g.globalAlpha = pulse * 0.85;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.moveTo(x, y - r);
          g.quadraticCurveTo(x + r * 0.14, y - r * 0.14, x + r, y);
          g.quadraticCurveTo(x + r * 0.14, y + r * 0.14, x, y + r);
          g.quadraticCurveTo(x - r * 0.14, y + r * 0.14, x - r, y);
          g.quadraticCurveTo(x - r * 0.14, y - r * 0.14, x, y - r);
          g.fill();
          glow(g, x, y, r * 2.2, 'rgba(200,230,255,0.9)', pulse * 0.3);
          g.globalAlpha = 1;
        });
      }

      if (shooting) {
        const s = shooting;
        const fade = Math.min(1, s.age / 0.1) * Math.min(1, (s.life - s.age) / 0.25);
        const tail = 150;
        const len = Math.hypot(s.vx, s.vy);
        const tx = s.x - (s.vx / len) * tail;
        const ty = s.y - (s.vy / len) * tail;
        const grad = g.createLinearGradient(s.x, s.y, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = grad;
        g.lineWidth = 2;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(tx, ty);
        g.stroke();
        glow(g, s.x, s.y, 9, 'rgba(255,245,200,1)', 0.85 * fade);
      }
      dirty = false;
    }

    function stepShooting(dt, f) {
      if (!f.shootingStars) {
        shooting = null;
        return;
      }
      if (shooting) {
        shooting.age += dt;
        shooting.x += shooting.vx * dt;
        shooting.y += shooting.vy * dt;
        if (shooting.age >= shooting.life) shooting = null;
        return;
      }
      shootingTimer -= dt;
      if (shootingTimer <= 0) {
        const { width: W, height: H } = bounds();
        const dir = ctx.rand() < 0.5 ? 1 : -1;
        shooting = {
          x: W * (dir > 0 ? 0.05 + ctx.rand() * 0.4 : 0.55 + ctx.rand() * 0.4),
          y: H * (0.05 + ctx.rand() * 0.25),
          vx: dir * (780 + ctx.rand() * 260),
          vy: 250 + ctx.rand() * 160,
          age: 0,
          life: 0.8,
        };
        shootingTimer = 28 + ctx.rand() * 50;
      }
    }

    // ---- Public API ------------------------------------------------------------------

    function update(dt) {
      if (disposed) return;
      const f = ensureLayers();
      if (!layout) buildLayout();
      clock += dt;
      sinceFrame += dt;
      if (shootingTimer === 0) shootingTimer = 6 + ctx.rand() * 20;
      stepShooting(dt, f);

      if (deco) {
        const reduced = ctx.reducedMotion();
        const gap = reduced ? 1 : FRAME_GAP[ctx.quality()] || FRAME_GAP.medium;
        if (dirty || sinceFrame >= gap) {
          sinceFrame = 0;
          paintDeco();
        }
      }
      dirty = false;
    }

    function setEnabled(on) {
      enabled = !!on;
      dirty = true;
      ensureLayers();
    }

    function applySettings() {
      dirty = true;
      sprites = [];
      ensureLayers();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      offResize.forEach((off) => { if (typeof off === 'function') off(); });
      offResize = [];
      if (deco) deco.dispose();
      deco = null;
      sprites = [];
    }

    return {
      update,
      setEnabled,
      applySettings,
      dispose,
      get layerCount() { return deco ? 1 : 0; },
    };
  }

  Christmas.Decorations = { create };
})(window);
