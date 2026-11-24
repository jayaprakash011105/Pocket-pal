// Painters for the sprite pals' little extras: eyelids, yawning mouth, waving
// mitten, sneeze puffs, ghost sheet and the trail particles. Everything is
// drawn on small 2D canvases (no image assets); content/character-manager.js
// attaches them to the sprite mesh and content/effects.js emits the trail.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Effects = PocketPal.Effects || (PocketPal.Effects = {});

  const OUTLINE = 'rgba(40,30,60,0.85)';

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { c, ctx: c.getContext('2d') };
  }

  function stroke(ctx, width, color) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color || OUTLINE;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Closed eyelid: a soft ellipse in the fur colour with a dark "closed eye" arc.
  function lid(color) {
    const { c, ctx } = canvas(96, 64);
    const g = ctx.createRadialGradient(48, 32, 12, 48, 32, 46);
    g.addColorStop(0, color);
    g.addColorStop(0.9, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(48, 32, 46, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18, 30);
    ctx.quadraticCurveTo(48, 54, 78, 30);
    stroke(ctx, 7, 'rgba(45,30,40,0.9)');
    return c;
  }

  function mouth() {
    const { c, ctx } = canvas(64, 64);
    ctx.beginPath();
    ctx.ellipse(32, 33, 24, 27, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f2e';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(32, 56, 17, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8aa0';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(32, 33, 24, 27, 0, 0, Math.PI * 2);
    stroke(ctx, 5, '#3a1020');
    return c;
  }

  // Mitten drawn upright; its pivot is the bottom centre (the cuff).
  function mitten(color) {
    const { c, ctx } = canvas(64, 72);
    ctx.beginPath();
    ctx.ellipse(11, 40, 8, 13, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.ellipse(33, 34, 19, 25, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.ellipse(28, 24, 6, 9, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.rect(20, 58, 26, 11);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    stroke(ctx, 4);
    return c;
  }

  function puff() {
    const { c, ctx } = canvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  // ---- Trail particles ------------------------------------------------------

  const PARTICLES = {
    sparkles(ctx) {
      const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, 'rgba(255,236,150,0.95)');
      g.addColorStop(1, 'rgba(255,220,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(32, 2);
      ctx.quadraticCurveTo(35, 29, 62, 32);
      ctx.quadraticCurveTo(35, 35, 32, 62);
      ctx.quadraticCurveTo(29, 35, 2, 32);
      ctx.quadraticCurveTo(29, 29, 32, 2);
      ctx.fill();
    },
    bubbles(ctx) {
      const g = ctx.createRadialGradient(26, 24, 4, 32, 32, 28);
      g.addColorStop(0, 'rgba(235,248,255,0.75)');
      g.addColorStop(1, 'rgba(120,185,255,0.45)');
      ctx.beginPath();
      ctx.arc(32, 32, 27, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      stroke(ctx, 4, 'rgba(60,130,220,0.95)');
      ctx.beginPath();
      ctx.arc(32, 32, 18, Math.PI * 1.1, Math.PI * 1.55);
      stroke(ctx, 5, 'rgba(255,255,255,0.95)');
      ctx.beginPath();
      ctx.arc(43, 42, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
    },
    snow(ctx) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i += 1) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26);
        ctx.lineTo(32 - Math.cos(a) * 26, 32 - Math.sin(a) * 26);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(32, 32, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
    hearts(ctx) {
      ctx.beginPath();
      ctx.moveTo(32, 57);
      ctx.bezierCurveTo(2, 36, 8, 5, 32, 20);
      ctx.bezierCurveTo(56, 5, 62, 36, 32, 57);
      const g = ctx.createLinearGradient(0, 8, 0, 58);
      g.addColorStop(0, '#ff8fb5');
      g.addColorStop(1, '#ff3d7f');
      ctx.fillStyle = g;
      ctx.fill();
      stroke(ctx, 4, 'rgba(170,25,80,0.95)');
      ctx.beginPath();
      ctx.ellipse(21, 24, 6, 4, -0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
    },
  };

  function particle(kind) {
    const paint = PARTICLES[kind] || PARTICLES.sparkles;
    const { c, ctx } = canvas(64, 64);
    paint(ctx);
    return c;
  }

  // ---- Ghost sheet ----------------------------------------------------------

  // eyes: [{ u, v, r }] as fractions of the sheet canvas (r = fraction of width).
  function ghostSheet(aspect, eyes) {
    const w = 256;
    const h = Math.round(256 * aspect);
    const { c, ctx } = canvas(w, h);
    const hem = h * 0.9;
    ctx.beginPath();
    ctx.moveTo(w * 0.04, hem);
    ctx.lineTo(w * 0.04, h * 0.42);
    ctx.bezierCurveTo(w * 0.04, h * 0.04, w * 0.96, h * 0.04, w * 0.96, h * 0.42);
    ctx.lineTo(w * 0.96, hem);
    const waves = 5;
    for (let i = waves; i > 0; i -= 1) {
      const x1 = w * (0.04 + (0.92 * (i - 0.5)) / waves);
      const x2 = w * (0.04 + (0.92 * (i - 1)) / waves);
      ctx.quadraticCurveTo(x1, h * (i % 2 ? 1.02 : 0.98), x2, hem);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.97)');
    g.addColorStop(1, 'rgba(228,232,248,0.96)');
    ctx.fillStyle = g;
    ctx.fill();
    stroke(ctx, 5, 'rgba(150,155,185,0.9)');
    ctx.fillStyle = '#17141f';
    eyes.forEach((e) => {
      ctx.beginPath();
      ctx.ellipse(e.u * w, e.v * h, e.r * w * 0.8, e.r * w * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    return c;
  }

  // ---- Colour sampling ------------------------------------------------------

  // Returns sample(x, y) -> 'rgb(r,g,b)' in the bitmap's own pixel space,
  // averaging the opaque pixels around the point.
  function sampler(bitmap) {
    const size = 128;
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const { c, ctx } = canvas(w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return function sample(x, y) {
      const cx = Math.round(x * scale);
      const cy = Math.round(y * scale);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = Math.min(w - 1, Math.max(0, cx + dx));
          const py = Math.min(h - 1, Math.max(0, cy + dy));
          const i = (py * w + px) * 4;
          if (data[i + 3] > 120) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n += 1;
          }
        }
      }
      if (!n) return 'rgb(255,255,255)';
      return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    };
  }

  Object.assign(Effects, { lid, mouth, mitten, puff, particle, ghostSheet, sampler, PARTICLE_KINDS: Object.keys(PARTICLES) });
})(window);
