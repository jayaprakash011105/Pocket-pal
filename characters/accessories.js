// Outfit pieces for the sprite characters. Each piece is drawn on a small 2D
// canvas (no image assets) and attached to the sprite at anchors measured from
// the sprite's own silhouette, so it fits every pal and custom 2D art alike.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});

  // slot: where it attaches (each pet has a hand-placed head/face/neck anchor
  // in characters/manifest.json). width: multiple of that anchor's width.
  // lift: fraction of the piece's own height its centre sits above (+) /
  // below (-) the anchor point.
  const LIST = [
    { id: 'witch-hat', label: 'Witch hat', slot: 'head', width: 1.35, lift: 0.42, aspect: 0.95 },
    { id: 'crown', label: 'Crown', slot: 'head', width: 0.85, lift: 0.3, aspect: 0.7 },
    { id: 'top-hat', label: 'Top hat', slot: 'head', width: 0.95, lift: 0.38, aspect: 0.95 },
    { id: 'beanie', label: 'Beanie', slot: 'head', width: 1.15, lift: 0.3, aspect: 0.78 },
    { id: 'party-hat', label: 'Party hat', slot: 'head', width: 0.65, lift: 0.4, aspect: 1.25 },
    { id: 'headphones', label: 'Headphones', slot: 'head', width: 1.3, lift: -0.2, aspect: 0.8 },
    { id: 'glasses', label: 'Sunglasses', slot: 'face', width: 1.55, lift: 0, aspect: 0.4 },
    { id: 'bowtie', label: 'Bow tie', slot: 'neck', width: 0.34, lift: 0, aspect: 0.62 },
    { id: 'scarf', label: 'Scarf', slot: 'neck', width: 1.0, lift: 0, aspect: 0.5 },
    { id: 'bandana', label: 'Bandana', slot: 'neck', width: 1.0, lift: -0.4, aspect: 0.62 },
    { id: 'antlers', label: 'Reindeer antlers', slot: 'head', width: 1.2, lift: 0.3, aspect: 0.85 },
    { id: 'elf-hat', label: 'Elf hat', slot: 'head', width: 1.15, lift: 0.4, aspect: 1.0 },
    { id: 'candy-scarf', label: 'Candy scarf', slot: 'neck', width: 1.0, lift: 0, aspect: 0.5 },
  ];

  // One-tap looks: the outfit sets the accessory list in one go.
  const OUTFITS = [
    { id: 'none', label: 'No outfit', items: [] },
    { id: 'wizard', label: 'Little wizard', items: ['witch-hat', 'scarf'] },
    { id: 'gentleman', label: 'Gentleman', items: ['top-hat', 'bowtie', 'glasses'] },
    { id: 'royal', label: 'Royal', items: ['crown', 'scarf'] },
    { id: 'party', label: 'Party time', items: ['party-hat', 'bandana'] },
    { id: 'cozy', label: 'Cozy winter', items: ['beanie', 'scarf'] },
    { id: 'dj', label: 'DJ', items: ['headphones', 'glasses'] },
    { id: 'reindeer', label: 'Reindeer', items: ['antlers', 'candy-scarf'] },
    { id: 'elf', label: 'Elf', items: ['elf-hat', 'bowtie'] },
  ];

  // Seasonal pieces are worn automatically (never listed in the options).
  const SEASONAL = {
    'santa-hat': { id: 'santa-hat', label: 'Santa hat', slot: 'head', width: 1.25, lift: 0.4, aspect: 0.95 },
  };

  const byId = {};
  LIST.forEach((a) => { byId[a.id] = a; });
  const specOf = (id) => byId[id] || SEASONAL[id];

  // 'santa' Dec 1 - Jan 5, 'ghost' Oct 20 - Nov 2, otherwise 'none'.
  function seasonFor(date) {
    const d = date || new Date();
    const m = d.getMonth();
    const day = d.getDate();
    if (m === 11 || (m === 0 && day <= 5)) return 'santa';
    if ((m === 9 && day >= 20) || (m === 10 && day <= 2)) return 'ghost';
    return 'none';
  }

  function path(ctx, points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function outline(ctx, fill) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(40,30,60,0.85)';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Each painter draws into a 256 x (256*aspect) canvas.
  const PAINTERS = {
    'witch-hat'(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.84, w * 0.46, h * 0.11, 0, 0, Math.PI * 2);
      outline(ctx, '#3b2a63');
      path(ctx, [[w * 0.26, h * 0.82], [w * 0.5, h * 0.04], [w * 0.74, h * 0.82]]);
      outline(ctx, '#4a3580');
      ctx.fillStyle = '#e8b64c';
      ctx.fillRect(w * 0.29, h * 0.66, w * 0.42, h * 0.1);
    },
    crown(ctx, w, h) {
      path(ctx, [[w * 0.1, h * 0.88], [w * 0.06, h * 0.22], [w * 0.3, h * 0.5], [w * 0.5, h * 0.08], [w * 0.7, h * 0.5], [w * 0.94, h * 0.22], [w * 0.9, h * 0.88]]);
      outline(ctx, '#f2c744');
      ['#e24a6b', '#4aa3e2', '#5bd68a'].forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(w * (0.3 + i * 0.2), h * 0.72, w * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      });
    },
    'top-hat'(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.86, w * 0.48, h * 0.09, 0, 0, Math.PI * 2);
      outline(ctx, '#23202e');
      path(ctx, [[w * 0.2, h * 0.86], [w * 0.2, h * 0.1], [w * 0.8, h * 0.1], [w * 0.8, h * 0.86]]);
      outline(ctx, '#2e2a3d');
      ctx.fillStyle = '#c0394f';
      ctx.fillRect(w * 0.2, h * 0.62, w * 0.6, h * 0.12);
    },
    beanie(ctx, w, h) {
      ctx.beginPath();
      ctx.moveTo(w * 0.12, h * 0.7);
      ctx.bezierCurveTo(w * 0.1, h * 0.14, w * 0.9, h * 0.14, w * 0.88, h * 0.7);
      ctx.closePath();
      outline(ctx, '#4a8fd6');
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(w * 0.07, h * 0.6, w * 0.86, h * 0.26, 18) : ctx.rect(w * 0.07, h * 0.6, w * 0.86, h * 0.26);
      outline(ctx, '#e6eef7');
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.1, w * 0.085, 0, Math.PI * 2);
      outline(ctx, '#e6eef7');
    },
    'party-hat'(ctx, w, h) {
      path(ctx, [[w * 0.12, h * 0.94], [w * 0.5, h * 0.1], [w * 0.88, h * 0.94]]);
      outline(ctx, '#ff7ab8');
      ['#ffe066', '#7ad7ff', '#ffe066'].forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(w * (0.36 + i * 0.14), h * (0.6 + (i % 2) * 0.12), w * 0.045, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.08, w * 0.08, 0, Math.PI * 2);
      outline(ctx, '#ffe066');
    },
    headphones(ctx, w, h) {
      ctx.lineWidth = 16;
      ctx.strokeStyle = '#2f2a3d';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.62, w * 0.4, Math.PI * 1.02, Math.PI * 1.98);
      ctx.stroke();
      [0.08, 0.92].forEach((x) => {
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(w * x - w * 0.07, h * 0.55, w * 0.14, h * 0.36, 14) : ctx.rect(w * x - w * 0.07, h * 0.55, w * 0.14, h * 0.36);
        outline(ctx, '#e0517a');
      });
    },
    // Lens centres sit at 0.178 / 0.822 of the width: the face anchor's width is
    // the distance between the pet's eyes, and the piece is 1.55x that wide.
    glasses(ctx, w, h) {
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#1d1a28';
      ctx.fillStyle = 'rgba(25,22,40,0.9)';
      [0.178, 0.822].forEach((x) => {
        ctx.beginPath();
        ctx.ellipse(w * x, h * 0.5, w * 0.15, h * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(w * 0.328, h * 0.45);
      ctx.lineTo(w * 0.672, h * 0.45);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(w * 0.1, h * 0.26, w * 0.08, h * 0.1);
      ctx.fillRect(w * 0.75, h * 0.26, w * 0.08, h * 0.1);
    },
    bowtie(ctx, w, h) {
      path(ctx, [[w * 0.5, h * 0.5], [w * 0.06, h * 0.08], [w * 0.06, h * 0.92]]);
      outline(ctx, '#d6385a');
      path(ctx, [[w * 0.5, h * 0.5], [w * 0.94, h * 0.08], [w * 0.94, h * 0.92]]);
      outline(ctx, '#d6385a');
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, w * 0.08, 0, Math.PI * 2);
      outline(ctx, '#a82242');
    },
    scarf(ctx, w, h) {
      ctx.beginPath();
      ctx.moveTo(w * 0.04, h * 0.2);
      ctx.quadraticCurveTo(w * 0.5, h * 0.5, w * 0.96, h * 0.2);
      ctx.lineTo(w * 0.96, h * 0.5);
      ctx.quadraticCurveTo(w * 0.5, h * 0.84, w * 0.04, h * 0.5);
      ctx.closePath();
      outline(ctx, '#e5533d');
      ctx.fillStyle = '#fff1c9';
      for (let i = 0; i < 4; i += 1) {
        ctx.fillRect(w * (0.2 + i * 0.2), h * (0.5 + (i % 2 === 0 ? 0.08 : 0.02)), w * 0.06, h * 0.2);
      }
      path(ctx, [[w * 0.66, h * 0.62], [w * 0.88, h * 0.62], [w * 0.92, h * 1.0], [w * 0.7, h * 1.0]]);
      outline(ctx, '#e5533d');
    },
    'santa-hat'(ctx, w, h) {
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.82);
      ctx.bezierCurveTo(w * 0.12, h * 0.3, w * 0.4, h * 0.08, w * 0.66, h * 0.2);
      ctx.bezierCurveTo(w * 0.78, h * 0.26, w * 0.84, h * 0.4, w * 0.9, h * 0.82);
      ctx.closePath();
      outline(ctx, '#d6322f');
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(w * 0.04, h * 0.7, w * 0.92, h * 0.24, 20) : ctx.rect(w * 0.04, h * 0.7, w * 0.92, h * 0.24);
      outline(ctx, '#ffffff');
      ctx.beginPath();
      ctx.arc(w * 0.7, h * 0.16, w * 0.1, 0, Math.PI * 2);
      outline(ctx, '#ffffff');
    },
    bandana(ctx, w, h) {
      path(ctx, [[w * 0.04, h * 0.1], [w * 0.96, h * 0.1], [w * 0.5, h * 0.95]]);
      outline(ctx, '#3fa7a0');
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      [[0.3, 0.3], [0.5, 0.25], [0.7, 0.3], [0.4, 0.5], [0.6, 0.5], [0.5, 0.7]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(w * x, h * y, w * 0.025, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    antlers(ctx, w, h) {
      const brown = '#8a5a34';
      const branch = (flip) => {
        const X = (x) => (flip ? w - x : x);
        const stroke = (width, color) => {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(X(w * 0.3), h * 0.94);
          ctx.quadraticCurveTo(X(w * 0.16), h * 0.58, X(w * 0.2), h * 0.12);
          ctx.moveTo(X(w * 0.2), h * 0.5);
          ctx.quadraticCurveTo(X(w * 0.1), h * 0.44, X(w * 0.05), h * 0.3);
          ctx.moveTo(X(w * 0.2), h * 0.3);
          ctx.quadraticCurveTo(X(w * 0.3), h * 0.22, X(w * 0.34), h * 0.1);
          ctx.stroke();
        };
        stroke(26, 'rgba(40,30,60,0.85)');
        stroke(16, brown);
        stroke(5, 'rgba(255,214,160,0.55)');
      };
      branch(false);
      branch(true);
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.96);
      ctx.quadraticCurveTo(w * 0.5, h * 0.78, w * 0.76, h * 0.96);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(40,30,60,0.85)';
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.strokeStyle = '#c0394f';
      ctx.lineWidth = 8;
      ctx.stroke();
    },
    'elf-hat'(ctx, w, h) {
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.86);
      ctx.bezierCurveTo(w * 0.1, h * 0.5, w * 0.3, h * 0.22, w * 0.62, h * 0.16);
      ctx.bezierCurveTo(w * 0.8, h * 0.12, w * 0.92, h * 0.2, w * 0.9, h * 0.32);
      ctx.bezierCurveTo(w * 0.82, h * 0.3, w * 0.76, h * 0.34, w * 0.78, h * 0.5);
      ctx.bezierCurveTo(w * 0.82, h * 0.62, w * 0.9, h * 0.72, w * 0.92, h * 0.86);
      ctx.closePath();
      outline(ctx, '#2f9e5b');
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(w * 0.34, h * 0.5, w * 0.1, h * 0.28, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(w * 0.05, h * 0.74, w * 0.9, h * 0.2, 18) : ctx.rect(w * 0.05, h * 0.74, w * 0.9, h * 0.2);
      outline(ctx, '#d6322f');
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.arc(w * (0.15 + i * 0.14), h * 0.84, w * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(w * 0.9, h * 0.32, w * 0.065, 0, Math.PI * 2);
      outline(ctx, '#ffd54a');
    },
    'candy-scarf'(ctx, w, h) {
      const body = () => {
        ctx.beginPath();
        ctx.moveTo(w * 0.04, h * 0.2);
        ctx.quadraticCurveTo(w * 0.5, h * 0.5, w * 0.96, h * 0.2);
        ctx.lineTo(w * 0.96, h * 0.5);
        ctx.quadraticCurveTo(w * 0.5, h * 0.84, w * 0.04, h * 0.5);
        ctx.closePath();
      };
      const tail = () => path(ctx, [[w * 0.66, h * 0.62], [w * 0.88, h * 0.62], [w * 0.92, h * 1.0], [w * 0.7, h * 1.0]]);
      [body, tail].forEach((shape) => {
        shape();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.save();
        shape();
        ctx.clip();
        ctx.fillStyle = '#d6322f';
        for (let i = -4; i < 14; i += 1) {
          ctx.beginPath();
          ctx.moveTo(w * (i * 0.1), 0);
          ctx.lineTo(w * (i * 0.1 + 0.05), 0);
          ctx.lineTo(w * (i * 0.1 + 0.2), h * 1.1);
          ctx.lineTo(w * (i * 0.1 + 0.15), h * 1.1);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        shape();
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(40,30,60,0.85)';
        ctx.lineJoin = 'round';
        ctx.stroke();
      });
    },
  };

  function draw(id) {
    const spec = specOf(id);
    const painter = PAINTERS[id];
    if (!spec || !painter) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.round(256 * spec.aspect);
    const ctx = canvas.getContext('2d');
    painter(ctx, canvas.width, canvas.height);
    return canvas;
  }

  // Measures where head/face/neck sit on a sprite from its alpha channel.
  // Returns pixel coordinates in the bitmap's own space (origin top-left).
  function measureAnchors(bitmap) {
    const size = 96;
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const rowSpan = (y) => {
      let min = -1;
      let max = -1;
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 40) {
          if (min < 0) min = x;
          max = x;
        }
      }
      return min < 0 ? null : { min, max };
    };

    let top = 0;
    while (top < h && !rowSpan(top)) top += 1;
    const body = h - top;
    const at = (frac) => {
      const y = Math.min(h - 1, Math.round(top + body * frac));
      const span = rowSpan(y) || { min: w * 0.25, max: w * 0.75 };
      return { y, cx: (span.min + span.max) / 2, width: span.max - span.min };
    };

    const head = at(0.2);
    const topRow = rowSpan(top) || { min: w * 0.4, max: w * 0.6 };
    const face = at(0.4);
    const neck = at(0.58);
    const px = 1 / scale;
    return {
      head: { x: ((topRow.min + topRow.max) / 2) * px, y: (top + body * 0.04) * px, width: Math.max(head.width, w * 0.3) * px },
      face: { x: face.cx * px, y: face.y * px, width: face.width * 0.5 * px },
      neck: { x: neck.cx * px, y: neck.y * px, width: neck.width * px },
    };
  }

  // Anchors for one pal, in bitmap pixels. Uses the hand-placed "outfit" block
  // from the manifest (fractions of the sprite's width/height, plus an optional
  // clockwise tilt in radians and a list of slots the art already covers).
  function anchorsFor(def, bitmap) {
    const o = def && def.outfit;
    if (!o) {
      const m = measureAnchors(bitmap);
      return Object.assign(m, { skip: [], blink: true, eyeW: 0.62, mouth: defaultMouth(m.face) });
    }
    const px = (a) => ({ x: a.x * bitmap.width, y: a.y * bitmap.height, width: a.w * bitmap.width, rot: a.rot || 0 });
    const face = px(o.face);
    return {
      head: px(o.head),
      face,
      neck: px(o.neck),
      skip: o.skip || [],
      blink: o.blink !== false,
      eyeW: o.eyeW || 0.62,
      mouth: o.mouth ? px(o.mouth) : defaultMouth(face),
      noMouth: o.mouth === null,
    };
  }

  // Mouth sits below the eyes by ~0.4 eye-separations, following the face tilt.
  function defaultMouth(face) {
    const d = 0.4 * face.width;
    const rot = face.rot || 0;
    return { x: face.x - Math.sin(rot) * d, y: face.y + Math.cos(rot) * d, width: face.width * 0.5, rot };
  }

  // Where a piece goes, in bitmap pixels (y down): centre, size and tilt.
  function place(id, anchor) {
    const spec = specOf(id);
    const w = anchor.width * spec.width;
    const h = w * spec.aspect;
    return { cx: anchor.x, cy: anchor.y - h * spec.lift, w, h, rot: anchor.rot || 0 };
  }

  PocketPal.Accessories = { LIST, OUTFITS, SEASONAL, byId, draw, measureAnchors, anchorsFor, place, seasonFor };
})(window);
