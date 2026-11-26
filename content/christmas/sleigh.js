// Santa's sleigh and a team of flying reindeer that cross the window now and
// then, drop gifts into the snow and react to a click. Drawn procedurally on
// two canvas layers (the sleigh above the snow, the falling gifts below it).
(function (global) {
  const Christmas = (global.PocketPal.Christmas = global.PocketPal.Christmas || {});

  const GREETINGS = ['Ho ho ho!', 'Merry Christmas!', 'Happy holidays!', 'Jingle all the way!', 'Season’s greetings!'];
  const GIFT_COLORS = [
    ['#d63a3a', '#ffd86b'],
    ['#3a7bd6', '#ffffff'],
    ['#2f9e5b', '#ff6b6b'],
    ['#8e5bd6', '#ffd86b'],
    ['#1fb5b0', '#ff8fb5'],
    ['#f08a3c', '#ffffff'],
  ];

  const SPACING = 74; // distance between reindeer (design px)
  const TRAIN_FRONT = 48; // lead head tip ahead of the lead's centre
  const REAR_SECONDS = 1.15;
  const MAX_SPARKS = 220;
  const GIFT_REST = 1.1;
  const GIFT_SINK = 1.9;
  const HIP_Y = 6; // reindeer hip height below the body centre
  const REST_DEER = 31.4; // body centre above the snow when standing
  const REST_SLEIGH = 27.5; // sleigh centre above the snow (runners resting on it)
  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };

  // ---- small sprites (soft stars / glows), painted once ---------------------

  function starSprite(color) {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const g = c.getContext('2d');
    const glow = g.createRadialGradient(24, 24, 1, 24, 24, 22);
    glow.addColorStop(0, color.replace('1)', '0.55)'));
    glow.addColorStop(1, color.replace('1)', '0)'));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(24, 24, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(24, 5);
    g.quadraticCurveTo(26, 22, 43, 24);
    g.quadraticCurveTo(26, 26, 24, 43);
    g.quadraticCurveTo(22, 26, 5, 24);
    g.quadraticCurveTo(22, 22, 24, 5);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.arc(24, 24, 3, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function dotSprite(rgb, edge) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.55, `rgba(${rgb},0.75)`);
    grad.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // ---- drawing: reindeer ------------------------------------------------------

  const L1 = 13;
  const L2 = 14;

  // where the foot ends up for the flying-gallop pose (relative to the hip)
  function fkFoot(angle, bend) {
    const la = angle - bend;
    return {
      x: Math.sin(angle) * L1 + Math.sin(la) * L2,
      y: Math.cos(angle) * L1 + Math.cos(la) * L2,
    };
  }

  // trotting foot: carried back along the ground while the body moves, then swung forward
  function groundFoot(psi, move, groundTy) {
    const stride = 15;
    const lift = 9;
    const p = ((psi % TAU) + TAU) % TAU;
    const stanceEnd = 1.2 * Math.PI;
    let x;
    let up = 0;
    if (p < stanceEnd) {
      x = stride - 2 * stride * (p / stanceEnd);
    } else {
      const q = (p - stanceEnd) / (TAU - stanceEnd);
      x = -stride + 2 * stride * smooth(q);
      up = Math.sin(Math.PI * q) * lift;
    }
    return { x: x * move, y: groundTy - up * move };
  }

  // two-bone leg that reaches a foot target given relative to the hip
  function legIK(g, hx, hy, tx, ty, fill, hoof) {
    const d = clamp(Math.hypot(tx, ty), 1.5, L1 + L2 - 0.2);
    const theta = Math.atan2(tx, ty);
    const a1 = theta + Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const a2 = theta - Math.acos(clamp((L2 * L2 + d * d - L1 * L1) / (2 * L2 * d), -1, 1));
    const kx = hx + Math.sin(a1) * L1;
    const ky = hy + Math.cos(a1) * L1;
    const fx = kx + Math.sin(a2) * L2;
    const fy = ky + Math.cos(a2) * L2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = fill;
    g.lineWidth = 5.6;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(kx, ky);
    g.stroke();
    g.lineWidth = 3.8;
    g.beginPath();
    g.moveTo(kx, ky);
    g.lineTo(fx, fy);
    g.stroke();
    g.fillStyle = hoof;
    g.beginPath();
    g.ellipse(fx + Math.sin(a2) * 1.2, fy + 1, 3.2, 2.4, -a2, 0, Math.PI * 2);
    g.fill();
  }

  function antler(g, sc, sway, main, outline) {
    g.save();
    g.rotate(sway);
    g.scale(sc, sc);
    const beam = () => {
      g.beginPath();
      g.moveTo(0, -6);
      g.quadraticCurveTo(-5, -17, 1, -28);
      g.moveTo(-2.2, -13);
      g.quadraticCurveTo(-8, -15, -11, -21);
      g.moveTo(0.4, -21);
      g.quadraticCurveTo(-5, -23, -7, -30);
      g.moveTo(1, -28);
      g.quadraticCurveTo(5, -31, 6, -36);
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = outline;
    g.lineWidth = 4.6;
    beam();
    g.stroke();
    g.strokeStyle = main;
    g.lineWidth = 2.6;
    beam();
    g.stroke();
    g.restore();
  }

  // The reindeer faces right; origin = centre of the body.
  function drawReindeer(g, o) {
    const { t, phase, lead, rear } = o;
    const lg = o.lg || 0; // 0 = flying gallop, 1 = trotting on the snow
    const move = o.move === undefined ? 1 : o.move;
    const groundTy = o.groundTy === undefined ? 24 : o.groundTy;
    const fur = '#b46d41';
    const furDark = '#8f5230';
    const phi = phase;

    const legs = (far) => {
      const off = far ? 0.7 : 0;
      const col = far ? furDark : fur;
      const hoof = far ? '#2c1f1a' : '#3a2a22';
      let fa = 0.55 + 0.75 * Math.sin(phi + off);
      let fb = 0.45 + 0.55 * Math.max(0, Math.sin(phi + off + 1.6));
      let ha = -0.55 - 0.75 * Math.sin(phi + off + 0.5);
      let hb = 0.45 + 0.55 * Math.max(0, Math.sin(phi + off + 2.1));
      fa = lerp(fa, 1.15, rear);
      fb = lerp(fb, 1.2, rear);
      ha = lerp(ha, -0.5, rear);
      const ff = fkFoot(fa, fb);
      const hf = fkFoot(ha, hb);
      let ft = ff;
      let ht = hf;
      if (lg > 0) {
        // trot: diagonal pairs move together (near front with far hind)
        const gf = groundFoot(phi + (far ? Math.PI : 0), move, groundTy);
        const gh = groundFoot(phi + (far ? 0 : Math.PI), move, groundTy);
        const frontX = lerp(gf.x + 3, ff.x, rear);
        const frontY = lerp(gf.y, ff.y, rear);
        ft = { x: lerp(ff.x, frontX, lg), y: lerp(ff.y, frontY, lg) };
        ht = { x: lerp(hf.x, gh.x - 3, lg), y: lerp(hf.y, gh.y, lg) };
      }
      legIK(g, 15, HIP_Y, ft.x, ft.y, col, hoof);
      legIK(g, -15, HIP_Y, ht.x, ht.y, col, hoof);
    };

    legs(true);

    // tail
    g.fillStyle = '#f4e6d2';
    g.beginPath();
    g.ellipse(-25, -3 + Math.sin(t * 7 + phase) * 1.5, 5.2, 4.2, 0.4, 0, Math.PI * 2);
    g.fill();

    // body
    const body = g.createLinearGradient(0, -12, 0, 12);
    body.addColorStop(0, '#c88252');
    body.addColorStop(0.55, fur);
    body.addColorStop(1, furDark);
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(-9, 0, 16, 11.5, 0, 0, Math.PI * 2);
    g.ellipse(11, -1, 14, 11, 0, 0, Math.PI * 2);
    g.rect(-9, -10.5, 20, 21);
    g.fill();
    g.fillStyle = 'rgba(244,222,186,0.85)';
    g.beginPath();
    g.ellipse(0, 7, 19, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.ellipse(-4, -6, 14, 3.2, -0.05, 0, Math.PI * 2);
    g.fill();

    // chest tuft
    g.fillStyle = '#f4e6d2';
    g.beginPath();
    g.ellipse(21, 3.5, 5.4, 7, 0.25, 0, Math.PI * 2);
    g.fill();

    legs(false);

    // neck
    g.lineCap = 'round';
    g.strokeStyle = '#b06a40';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(16, -4);
    g.lineTo(26, -15);
    g.stroke();
    g.strokeStyle = 'rgba(244,222,186,0.55)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(19, 1);
    g.lineTo(27, -9);
    g.stroke();

    // harness: collar, chest strap, belly band and back strap
    g.strokeStyle = '#d23a3a';
    g.lineWidth = 4.6;
    g.beginPath();
    g.moveTo(17.5, -8);
    g.lineTo(24, -5);
    g.stroke();
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(21, -4);
    g.quadraticCurveTo(22, 6, 14, 10.5);
    g.moveTo(5, -11);
    g.quadraticCurveTo(7, 0, 5, 11);
    g.moveTo(15, -10.5);
    g.lineTo(-18, -9.2);
    g.stroke();
    g.fillStyle = '#ffd86b';
    [[19.5, -6.5], [22.5, -4.6], [16.5, -8.1]].forEach(([bx, by]) => {
      g.beginPath();
      g.arc(bx, by, 2.1, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#ffe9a6';
    g.beginPath();
    g.arc(5, 0, 2.2, 0, Math.PI * 2);
    g.fill();

    // head
    g.save();
    g.translate(31, -20 + rear * 1.5);
    g.rotate(0.16 - rear * 0.32 + Math.sin(t * 2.4 + phase) * 0.04);
    antler(g, 0.9, Math.sin(t * 3 + phase) * 0.05 + 0.14, '#cdb48a', '#6e4b2d');
    g.fillStyle = furDark;
    g.beginPath();
    g.ellipse(-5, -7, 3, 6.2, -0.7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b87244';
    g.beginPath();
    g.ellipse(0, 0, 11.5, 9, 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ecd0aa';
    g.beginPath();
    g.ellipse(8.5, 3.2, 7.2, 5.3, 0.25, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,140,150,0.35)';
    g.beginPath();
    g.ellipse(1.5, 4.5, 3.2, 2.1, 0, 0, Math.PI * 2);
    g.fill();
    if (lead) {
      const pulse = 0.55 + Math.sin(t * 5) * 0.2;
      const glow = g.createRadialGradient(15, 3.6, 1, 15, 3.6, 12);
      glow.addColorStop(0, `rgba(255,70,70,${pulse})`);
      glow.addColorStop(1, 'rgba(255,70,70,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(15, 3.6, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff3b3b';
    } else {
      g.fillStyle = '#3a2418';
    }
    g.beginPath();
    g.arc(14.8, 3.4, 2.9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(14, 2.5, 0.9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#7b4a2c';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(11.5, 7);
    g.quadraticCurveTo(9, 8.2, 6.5, 7.2);
    g.stroke();
    g.fillStyle = '#2a1a14';
    g.beginPath();
    g.arc(3.2, -2.6, 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(3.8, -3.2, 0.75, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a45f37';
    g.beginPath();
    g.ellipse(-6.5, -5, 3.1, 6.6, -0.55, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,170,170,0.65)';
    g.beginPath();
    g.ellipse(-6.5, -5, 1.5, 4.2, -0.55, 0, Math.PI * 2);
    g.fill();
    antler(g, 1, Math.sin(t * 3 + phase + 0.6) * 0.05, '#ecdcc0', '#7b5a3a');
    g.restore();
  }

  // ---- drawing: sleigh and Santa -------------------------------------------------

  function drawSleigh(g, o) {
    const t = o.t;

    // runners
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#d9a93a';
    g.lineWidth = 3.6;
    g.beginPath();
    g.moveTo(-48, 20);
    g.quadraticCurveTo(-47, 27, -40, 27);
    g.lineTo(34, 27);
    g.quadraticCurveTo(48, 27, 49, 15);
    g.quadraticCurveTo(49.5, 9, 44, 8);
    g.stroke();
    g.strokeStyle = '#f4d46b';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-38, 25.8);
    g.lineTo(32, 25.8);
    g.stroke();
    g.strokeStyle = '#c9972d';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-26, 12);
    g.lineTo(-26, 26.5);
    g.moveTo(20, 12);
    g.lineTo(20, 26.5);
    g.stroke();

    // sack of gifts (behind Santa)
    g.fillStyle = '#7c4f28';
    g.beginPath();
    g.moveTo(-44, -2);
    g.bezierCurveTo(-54, -14, -48, -32, -34, -32);
    g.bezierCurveTo(-22, -32, -20, -14, -24, -2);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.ellipse(-38, -18, 4, 11, 0.2, 0, Math.PI * 2);
    g.fill();
    // gifts poking out of the sack
    g.fillStyle = '#d63a3a';
    g.fillRect(-46, -40, 12, 11);
    g.fillStyle = '#ffd86b';
    g.fillRect(-41, -40, 2.4, 11);
    g.fillRect(-46, -36, 12, 2.4);
    g.fillStyle = '#3a7bd6';
    g.fillRect(-34, -37, 10, 9);
    g.fillStyle = '#ffffff';
    g.fillRect(-30, -37, 2.2, 9);
    g.fillStyle = '#ffd86b';
    g.beginPath();
    const sx = -33;
    const sy = -39;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 2.2 : 5;
      g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#e3b647';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-45, -3);
    g.quadraticCurveTo(-34, 2, -23, -3);
    g.stroke();

    // hull
    const hull = g.createLinearGradient(0, -22, 0, 20);
    hull.addColorStop(0, '#e24848');
    hull.addColorStop(0.6, '#c42b2e');
    hull.addColorStop(1, '#8c1b22');
    g.fillStyle = hull;
    g.beginPath();
    g.moveTo(-46, -12);
    g.bezierCurveTo(-52, -18, -44, -22, -40, -14);
    g.lineTo(-38, -6);
    g.quadraticCurveTo(0, 2, 30, -8);
    g.quadraticCurveTo(38, -12, 38, -19);
    g.bezierCurveTo(38, -26, 50, -26, 49, -17);
    g.bezierCurveTo(48, 2, 40, 17, 14, 19);
    g.lineTo(-24, 19);
    g.bezierCurveTo(-40, 19, -47, 6, -46, -12);
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffd86b';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-40, -13);
    g.quadraticCurveTo(0, 1, 31, -9);
    g.quadraticCurveTo(39, -12, 40, -19);
    g.stroke();
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-41, 9);
    g.quadraticCurveTo(0, 15, 40, 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.ellipse(-8, 4, 26, 3.4, 0.05, 0, Math.PI * 2);
    g.fill();
    // little lantern on the dash
    const lg = g.createRadialGradient(46, -26, 1, 46, -26, 11);
    lg.addColorStop(0, 'rgba(255,236,150,0.9)');
    lg.addColorStop(1, 'rgba(255,236,150,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.arc(46, -26, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff3b0';
    g.beginPath();
    g.arc(46, -26, 2.6, 0, Math.PI * 2);
    g.fill();

    // Santa
    const nod = Math.sin(t * 2.2 - 0.6) * 0.8;
    g.fillStyle = '#d43a3a';
    g.beginPath();
    g.ellipse(-10, -14, 13, 14.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f6f1ec';
    g.beginPath();
    g.ellipse(-10, -2.2, 13.4, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2230';
    g.fillRect(-23, -9, 26, 3.4);
    g.fillStyle = '#ffd86b';
    g.fillRect(-12.5, -9.6, 5, 4.6);
    // near arm holding the reins
    g.strokeStyle = '#c93434';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-3, -20);
    g.quadraticCurveTo(7, -17, 15, -17);
    g.stroke();
    g.fillStyle = '#2a2230';
    g.beginPath();
    g.arc(16, -17, 3.4, 0, Math.PI * 2);
    g.fill();
    // head
    g.save();
    g.translate(-7, -31 + nod);
    g.fillStyle = '#f8cfa9';
    g.beginPath();
    g.arc(0, 0, 8.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,130,130,0.5)';
    g.beginPath();
    g.arc(4.6, 2.2, 2.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f6f6f6';
    g.beginPath();
    g.moveTo(-8.4, 1);
    g.bezierCurveTo(-9, 12, 2, 17, 9, 9);
    g.bezierCurveTo(10, 4, 7, 2.6, 3, 4);
    g.bezierCurveTo(1, 2, -4, 2, -8.4, 1);
    g.closePath();
    g.fill();
    g.fillStyle = '#e9a98c';
    g.beginPath();
    g.arc(7.2, 2.2, 1.9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2230';
    g.beginPath();
    g.arc(3.4, -2.4, 1.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d43a3a';
    g.beginPath();
    g.moveTo(-9, -3);
    g.quadraticCurveTo(-8, -17, 2, -17);
    g.quadraticCurveTo(10, -16, 10, -4);
    g.closePath();
    g.fill();
    g.fillStyle = '#f6f6f6';
    g.beginPath();
    g.ellipse(0.5, -3.6, 10.4, 3.2, -0.06, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(-6, -15.5, 3.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ---- gifts ---------------------------------------------------------------------

  function drawGift(g, x, y, size, rot, colors) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const w = size;
    const h = size * 0.86;
    g.fillStyle = colors[0];
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(-w / 2, h * 0.18, w, h * 0.32);
    g.fillStyle = colors[0];
    g.fillRect(-w / 2 - 1.5, -h / 2 - 3, w + 3, 5);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(-w / 2 - 1.5, -h / 2 - 3, w + 3, 1.8);
    g.fillStyle = colors[1];
    g.fillRect(-w * 0.09, -h / 2 - 3, w * 0.18, h + 3);
    g.fillRect(-w / 2, -h * 0.05, w, h * 0.16);
    g.beginPath();
    g.ellipse(-w * 0.2, -h / 2 - 5.5, w * 0.2, w * 0.13, -0.5, 0, Math.PI * 2);
    g.ellipse(w * 0.2, -h / 2 - 5.5, w * 0.2, w * 0.13, 0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors[0] === '#ffffff' ? '#ddd' : 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(0, -h / 2 - 3.8, w * 0.07, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ---- rig layout / drawing ----------------------------------------------------------

  const halfLen = (n) => (SPACING * (n - 1) + 142 + TRAIN_FRONT) / 2;
  const sleighOffset = (n) => SPACING * (n - 1) + 92; // sleigh centre behind the lead's centre (design px)

  // A point given in an element's own (facing-right) coordinates, in screen space.
  function ptOf(el, u, lx, ly) {
    const f = el.f === undefined ? 1 : el.f;
    const sg = f >= 0 ? 1 : -1;
    const us = u * (el.k || 1);
    const r = el.pitch * sg;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const px = lx * f * us;
    const py = ly * us;
    return { x: el.x + px * c - py * s, y: el.y + px * s + py * c };
  }

  function drawRig(g, rig, clock) {
    const { u, deer, sleigh } = rig;
    const n = deer.length;

    // traces between the animals and the sleigh
    g.lineCap = 'round';
    g.strokeStyle = '#8a5a34';
    g.lineWidth = 1.7 * u;
    for (let i = 0; i < n; i += 1) {
      const a = ptOf(deer[i], u, -25, 1.5);
      const c = i < n - 1 ? ptOf(deer[i + 1], u, 24, 0.5) : ptOf(sleigh, u, 44, -3);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + c.x) / 2, Math.max(a.y, c.y) + 5 * u, c.x, c.y);
      g.stroke();
    }

    const place = (el) => {
      const sg = el.f >= 0 ? 1 : -1;
      const us = u * (el.k || 1);
      g.translate(el.x, el.y);
      g.rotate(el.pitch * sg);
      g.scale(sg * Math.max(Math.abs(el.f), 0.02) * us, us);
    };

    const reins = () => {
      // reins: lead collar -> Santa's hand, running behind the team's backs
      const collar = ptOf(deer[0], u, 20, -9);
      const hand = ptOf(sleigh, u, 16, -17);
      const dx = collar.x - hand.x;
      const dy = collar.y - hand.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const reach = Math.min(90 * u, dist * 0.27);
      const vx = (dx / dist) * reach;
      const vy = (dy / dist) * reach;
      let top = Infinity;
      deer.forEach((d) => { top = Math.min(top, d.y); });
      const lift = Math.min(0, top - 5 * u - Math.min(collar.y, hand.y));
      g.strokeStyle = '#6e1f26';
      g.lineWidth = 1.5 * u;
      g.beginPath();
      g.moveTo(collar.x, collar.y);
      g.bezierCurveTo(collar.x - vx, collar.y - vy + lift * 0.5 - 1 * u, hand.x + vx, hand.y + vy + lift * 0.5 + 6 * u, hand.x, hand.y);
      g.stroke();
      g.strokeStyle = 'rgba(255,216,107,0.7)';
      g.lineWidth = 0.7 * u;
      g.stroke();
    };

    // farther animals (turning around "into the screen") are painted first; otherwise sleigh, then the
    // team from the rear to the lead
    const order = [{ el: sleigh, idx: 0, sleigh: true }];
    for (let i = n - 1; i >= 0; i -= 1) order.push({ el: deer[i], idx: n - i, lead: i === 0 });
    order.sort((p, q) => ((q.el.dz || 0) - (p.el.dz || 0)) || (p.idx - q.idx));
    order.forEach((o) => {
      g.save();
      place(o.el);
      if (o.sleigh) drawSleigh(g, { t: clock });
      else drawReindeer(g, { t: clock, phase: o.el.phase, lead: o.lead, rear: rig.rear, lg: o.el.lg, move: rig.move, groundTy: o.el.groundTy });
      g.restore();
      if (o.sleigh) reins();
    });
  }

  // ---- module -------------------------------------------------------------------------

  function create(ctx) {
    let disposed = false;
    let enabled = true;
    let wasOn = false;
    let explicit = false; // an explicit callDown() session ignores the setting / reduced motion
    let sawSettingOn = false;
    let callQueued = false;
    let clock = 0;
    let nextPassIn = 0;
    let pass = null; // random / triggered fly-by
    let call = null; // callDown() session: descending -> patrolling -> leaving
    let rig = null;
    let sleighLayer = null;
    let giftLayer = null;
    let hit = null;
    let bubble = null;
    let bubbleTimer = 0;
    let hover = false;
    let rearT = 0;
    let sparkAcc = 0;
    let sprayAcc = 0;
    let lastPos = null;
    const cur = { dir: 1, speed: 0, u: 1 };
    const gifts = [];
    const puffs = [];
    const sparks = [];
    const spray = [];
    const trail = [];
    const dropQueue = [];
    const offs = [];
    let sprites = null;
    let trailT = 0;

    const rand = (a, b) => a + ctx.rand() * (b - a);
    const calm = () => explicit && ctx.reducedMotion();

    function isOn() {
      const s = ctx.settings();
      return enabled && !disposed && s.sleigh !== false && !ctx.reducedMotion();
    }

    function getSprites() {
      if (!sprites) {
        sprites = {
          gold: starSprite('rgba(255,216,107,1)'),
          white: starSprite('rgba(255,255,255,1)'),
          ice: starSprite('rgba(170,215,255,1)'),
          puff: dotSprite('255,255,255', '210,225,245'),
        };
      }
      return sprites;
    }

    function unit() {
      const b = ctx.bounds();
      return clamp(b.height / 900, 0.7, 1.15) * (0.9 + 0.1 * ctx.scale());
    }

    function teamSize() {
      return ctx.quality() === 'low' ? 3 : 4;
    }

    function sparkRate() {
      const q = ctx.quality();
      return (q === 'low' ? 24 : q === 'high' ? 85 : 48) * (calm() ? 0.4 : 1);
    }

    // ---- layers / DOM ----------------------------------------------------------

    function ensureSleighLayer() {
      if (!sleighLayer) sleighLayer = ctx.createLayer('sleigh', 60);
      return sleighLayer;
    }

    function ensureGiftLayer() {
      if (!giftLayer) giftLayer = ctx.createLayer('gifts', 46);
      return giftLayer;
    }

    function releaseSleighLayer() {
      if (!sleighLayer) return;
      sleighLayer.clear();
      sleighLayer.dispose();
      sleighLayer = null;
    }

    function releaseGiftLayer() {
      if (!giftLayer) return;
      giftLayer.clear();
      giftLayer.dispose();
      giftLayer = null;
    }

    function on(el, type, fn) {
      el.addEventListener(type, fn);
      offs.push(() => el.removeEventListener && el.removeEventListener(type, fn));
    }

    function createHit() {
      if (hit) return;
      hit = ctx.makeHit('pp-sleigh-hit');
      hit.style.cursor = 'pointer';
      on(hit, 'pointerenter', () => {
        hover = true;
        showGreeting();
      });
      on(hit, 'pointerleave', () => {
        hover = false;
        if (bubble) bubbleTimer = Math.min(bubbleTimer, 0.5);
      });
      on(hit, 'click', onClick);
    }

    function removeHit() {
      if (!hit) return;
      hit.remove();
      hit = null;
      hover = false;
    }

    function ensureBubble() {
      if (bubble) return bubble;
      bubble = document.createElement('div');
      bubble.style.cssText = [
        'position:absolute', 'pointer-events:none', 'z-index:240', 'background:#ffffff', 'color:#2b2b33',
        'font:600 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', 'padding:7px 12px',
        'border-radius:14px', 'box-shadow:0 6px 18px rgba(20,20,40,0.18)', 'white-space:nowrap', 'opacity:0',
        'transform:translate(-50%,-100%)', 'transition:opacity 0.18s ease',
      ].join(';');
      const label = document.createElement('span');
      const arrow = document.createElement('div');
      arrow.style.cssText = 'position:absolute;left:50%;bottom:-5px;width:10px;height:10px;background:#fff;transform:translateX(-50%);clip-path:polygon(0 0,100% 0,50% 100%)';
      bubble.appendChild(label);
      bubble.appendChild(arrow);
      bubble.label = label;
      ctx.stage.appendChild(bubble);
      return bubble;
    }

    function removeBubble() {
      if (!bubble) return;
      bubble.remove();
      bubble = null;
      bubbleTimer = 0;
    }

    function showGreeting() {
      if (!pass && !call) return;
      const b = ensureBubble();
      if (bubbleTimer <= 0 || !b.label.textContent) {
        b.label.textContent = GREETINGS[Math.floor(ctx.rand() * GREETINGS.length)];
      }
      b.style.opacity = '1';
      bubbleTimer = 2.4;
    }

    // ---- ground / contour helpers ---------------------------------------------------------

    function surfaceAt(x) {
      const b = ctx.bounds();
      return ctx.snow.surfaceY(clamp(x, 0, b.width));
    }

    // the highest snow under the runners
    function runnerSurface(x, u) {
      return Math.min(surfaceAt(x - 34 * u), surfaceAt(x), surfaceAt(x + 34 * u));
    }

    function slopeAt(x, sg, d) {
      return clamp(Math.atan2(surfaceAt(x + sg * d) - surfaceAt(x - sg * d), 2 * d), -0.4, 0.4);
    }

    // ---- fly-by pass ---------------------------------------------------------------------------

    function surfaceSample(b) {
      let maxDepth = 0;
      for (let i = 0; i <= 10; i += 1) maxDepth = Math.max(maxDepth, ctx.snow.heightAt((b.width * i) / 10));
      return maxDepth;
    }

    function startPass(dirIn) {
      const b = ctx.bounds();
      const u = unit();
      const n = teamSize();
      const dir = dirIn === -1 || dirIn === 1 ? dirIn : (ctx.rand() < 0.5 ? -1 : 1);
      const trainBack = SPACING * (n - 1) + 142;
      const startX = dir === 1 ? -(TRAIN_FRONT * u + 24) : b.width + TRAIN_FRONT * u + 24;
      const endX = dir === 1 ? b.width + trainBack * u + 24 : -(trainBack * u + 24);

      const lo = b.height * 0.45;
      const hi = b.height - surfaceSample(b) - 150;
      const baseY = hi < lo ? Math.max(hi, 95 * u) : lerp(lo, hi, Math.pow(ctx.rand(), 0.8));

      pass = {
        dir, u, n, startX, endX, baseY,
        x: startX, y: baseY, ySmooth: baseY,
        speed: rand(170, 230),
        p: 0, midDone: false,
        giftAt: ctx.rand() < 0.55 ? rand(0.3, 0.7) : null,
      };
      cur.dir = dir;
      cur.u = u;
      cur.speed = pass.speed;
      trail.length = 0;
      lastPos = null;
      ensureSleighLayer();
      createHit();
      ctx.events.emit('sleigh:pass', { x: startX, y: baseY, dir });
    }

    function clearRigState() {
      lastPos = null;
      rig = null;
      trail.length = 0;
      removeHit();
      removeBubble();
      rearT = 0;
    }

    function endPass() {
      pass = null;
      clearRigState();
      nextPassIn = rand(25, 70);
    }

    function flybyRig(p, rearAmt) {
      const u = p.u;
      const n = p.n;
      const deer = [];
      let lastLocalY = 0;
      for (let i = 0; i < n; i += 1) {
        const bob = Math.sin(clock * 2.4 + i * 0.7) * 3.2;
        const lift = -rearAmt * (11 - i * 1.5);
        const tilt = Math.sin(clock * 2.4 + i * 0.7 + 0.6) * 0.045 - rearAmt * (0.3 - i * 0.04) - 0.03;
        lastLocalY = bob + lift;
        deer.push({ x: p.x - p.dir * SPACING * i * u, y: p.y + lastLocalY * u, pitch: tilt, phase: clock * 9.5 + i * 0.9, lg: 0, groundTy: 24, f: p.dir, k: 1 });
      }
      const sLocalX = -sleighOffset(n);
      const sBob = Math.sin((clock - 0.55) * 2.2) * 6 + Math.sin((clock - 0.55) * 0.9 + 1) * 4;
      const leadBob = Math.sin(clock * 2.2) * 6 + Math.sin(clock * 0.9 + 1) * 4;
      const sY = sBob - leadBob;
      const hookDx = Math.max(40, -SPACING * (n - 1) - 24 - (sLocalX + 46));
      const sTilt = clamp((lastLocalY + 2 - (sY - 4)) / hookDx, -0.22, 0.22) * 0.9 + Math.sin(clock * 1.7) * 0.015;
      return {
        u, deer, rear: rearAmt, move: 1,
        sleigh: { x: p.x + p.dir * sLocalX * u, y: p.y + sY * u, pitch: sTilt, f: p.dir, k: 1 },
      };
    }

    function stepPass(dt) {
      const p = pass;
      const b = ctx.bounds();
      const u = p.u;
      const total = Math.abs(p.endX - p.startX);
      const edge = Math.min(p.p / 0.14, (1 - p.p) / 0.14, 1);
      const speedFactor = 0.62 + 0.38 * smooth(edge);
      p.x += p.dir * p.speed * speedFactor * dt;
      p.p = clamp(Math.abs(p.x - p.startX) / total, 0, 1);
      cur.speed = p.speed * speedFactor;

      const bob = Math.sin(clock * 2.2) * 6 * u + Math.sin(clock * 0.9 + 1) * 4 * u;
      const rearAmt = rearT > 0 ? Math.sin(Math.PI * clamp(1 - rearT / REAR_SECONDS, 0, 1)) : 0;
      const rearLift = rearT > 0 ? -12 * u * rearAmt : 0;

      // never fly lower than the snow allows (runners ~28 design px below the sleigh centre)
      let limit = Infinity;
      for (let i = 0; i <= 4; i += 1) {
        const lx = p.x - p.dir * (i / 4) * (SPACING * (p.n - 1) + 90) * u;
        limit = Math.min(limit, surfaceAt(lx));
      }
      const maxY = limit - 90 - 34 * u;
      const target = Math.min(p.baseY, maxY) + bob + rearLift;
      p.ySmooth += (target - p.ySmooth) * Math.min(1, dt * 3.2);
      p.y = p.ySmooth;

      rig = flybyRig(p, rearAmt);
      const s = rig.sleigh;
      trailPoint(dt, s.x - p.dir * 50 * u, s.y + 20 * u);
      emitSparkles(dt, s.x, s.y, p.dir, p.speed, u, 1);

      if (!p.midDone && ((p.dir === 1 && p.x >= b.width / 2) || (p.dir === -1 && p.x <= b.width / 2))) {
        p.midDone = true;
        ctx.events.emit('sleigh:pass', { x: p.x, y: p.y, dir: p.dir });
      }
      setLastPos(rig);
      if (p.giftAt !== null && p.p >= p.giftAt && lastPos.x > 20 && lastPos.x < b.width - 20) {
        p.giftAt = null;
        dropGift();
      }

      if (rearT > 0) rearT = Math.max(0, rearT - dt);
      if (p.p >= 1) endPass();
    }

    function setLastPos(r) {
      const sack = ptOf(r.sleigh, r.u, -34, -22);
      lastPos = { x: r.sleigh.x, y: r.sleigh.y, sackX: sack.x, sackY: sack.y };
    }

    function trailPoint(dt, x, y) {
      trailT += dt;
      if (trailT > 0.025) {
        trailT = 0;
        trail.push({ x, y });
        if (trail.length > (ctx.quality() === 'low' ? 18 : 38)) trail.shift();
      }
    }

    function emitSparkles(dt, sx, sy, dirSign, speed, u, mult) {
      sparkAcc += dt * sparkRate() * mult;
      const kinds = ['gold', 'white', 'gold', 'ice'];
      while (sparkAcc >= 1) {
        sparkAcc -= 1;
        const along = ctx.rand();
        addSpark(sx + dirSign * (-40 + along * 40) * u, sy + (8 + ctx.rand() * 22) * u,
          -dirSign * speed * rand(0.05, 0.25) + rand(-12, 12), rand(-6, 18), kinds[Math.floor(ctx.rand() * 4)], rand(6, 12) * u, rand(0.7, 1.4), false);
      }
    }

    // ---- callDown(): descend, land, patrol the snow, take off again ---------------------------------

    // The whole team moves as a chain: every animal follows the lead's recorded path a fixed arc
    // distance behind it. A path sample holds x, the height above the ground (landing / take-off),
    // the "depth" rise (turning around on the snow plain), the size and the facing (-1..1).
    function histAt(c, sq) {
      const hs = c.hist;
      if (sq <= 0) {
        const k = -sq;
        return { x: c.x0 - c.dir0 * k * c.tx, h: c.h0 + k * c.ty, dz: hs[0].dz, k: hs[0].k, f: hs[0].f };
      }
      let i = hs.length - 1;
      while (i > 0 && hs[i].s > sq) i -= 1;
      const a = hs[i];
      const b = hs[Math.min(i + 1, hs.length - 1)];
      const span = b.s - a.s;
      const f = span > 1e-6 ? clamp((sq - a.s) / span, 0, 1) : 0;
      return {
        x: lerp(a.x, b.x, f), h: lerp(a.h, b.h, f), dz: lerp(a.dz, b.dz, f), k: lerp(a.k, b.k, f), f: lerp(a.f, b.f, f),
      };
    }

    function seedChain(c, x, h, tx, ty, face) {
      c.hist = [{ s: 0, x, h, dz: 0, k: 1, f: face }];
      c.s = 0;
      c.xL = x;
      c.hL = h;
      c.dzL = 0;
      c.x0 = x;
      c.h0 = h;
      c.tx = tx;
      c.ty = ty;
      c.dir0 = c.dir;
    }

    function advanceLead(c, dx, hNew, dz, k, f) {
      const dh = hNew + dz - (c.hL + c.dzL);
      c.s += Math.hypot(dx, dh);
      c.xL += dx;
      c.hL = hNew;
      c.dzL = dz;
      c.hist.push({ s: c.s, x: c.xL, h: hNew, dz, k, f });
      const keep = c.s - (sleighOffset(c.n) * c.u + 200);
      while (c.hist.length > 2 && c.hist[1].s < keep) c.hist.shift();
    }

    // distance travelled by time t with the descent speed profile
    function descentDist(c, t) {
      const T = c.T;
      if (t >= T) return c.v1 * T + ((c.v0 - c.v1) * T) / 3 + c.v1 * (t - T);
      return c.v1 * t + ((c.v0 - c.v1) * T / 3) * (1 - Math.pow(1 - t / T, 3));
    }

    function descentSpeed(c, t) {
      return t < c.T ? c.v1 + (c.v0 - c.v1) * Math.pow(1 - t / c.T, 2) : c.v1;
    }

    // ---- the U-turn at the ends of the patrol -----------------------------------------------------
    // The lead sweeps through a wide half-ellipse that rises "into the screen" and settles back onto
    // the lane going the other way. Everyone else follows the same recorded path.

    function arcRise(c, th) {
      return c.D * Math.pow(Math.sin(th / 2), 1.5);
    }

    // path length per radian of the turn parameter
    function arcSpeedM(c, th) {
      const dzd = c.D * 0.75 * Math.sqrt(Math.sin(th / 2)) * Math.cos(th / 2);
      return Math.max(Math.hypot(c.R * Math.cos(th), dzd), 4);
    }

    function beginTurn(c) {
      const u = c.u;
      const avail = c.dir > 0 ? c.Xmax - c.xL : c.xL - c.Xmin;
      c.R = clamp(rand(0.68, 1) * c.Rmax, 20 * u, Math.max(20 * u, avail));
      c.D = rand(48, 72) * u;
      c.kDrop = rand(0.1, 0.15);
      c.Sset = rand(1.6, 2.2) * c.R;
      c.tx0 = c.xL;
      c.th = 0;
      c.sArc = 0;
      c.Lm = Math.max(10 * u, 0.3 * 0.8 * c.v1);
      let sm = 0;
      const steps = 48;
      for (let i = 0; i < steps; i += 1) sm += arcSpeedM(c, ((i + 0.5) / steps) * (Math.PI / 2)) * (Math.PI / 2 / steps);
      c.sMid = sm;
      c.phase = 'arc';
    }

    function turnProgress(c) {
      if (!c || c.mode !== 'patrolling') return 0;
      if (c.phase === 'arc') return (0.6 * c.th) / Math.PI;
      if (c.phase === 'settle') return 0.6 + 0.4 * clamp(c.sSet / c.Sset, 0, 1);
      return 0;
    }

    function stepLead(c, dt) {
      const target = c.v1 * (c.phase === 'arc' ? 0.8 : 1);
      c.vCur += (target - c.vCur) * Math.min(1, dt * 1.6);
      const ds = c.vCur * dt;
      if (c.phase === 'lane') {
        const xe = c.xL + c.dir * ds;
        if ((c.dir > 0 && xe >= c.xB) || (c.dir < 0 && xe <= c.xA)) beginTurn(c);
      }
      let dx = 0;
      let dz = 0;
      let f = c.dir;
      if (c.phase === 'lane') {
        dx = c.dir * ds;
      } else if (c.phase === 'arc') {
        c.th = Math.min(Math.PI, c.th + ds / arcSpeedM(c, c.th));
        c.sArc += ds;
        dx = c.tx0 + c.dir * c.R * Math.sin(c.th) - c.xL;
        dz = arcRise(c, c.th);
        // the sprite mirrors briefly where the path moves most "into the screen"
        f = c.dir * (1 - 2 * smooth((c.sArc - (c.sMid - c.Lm / 2)) / c.Lm));
        if (c.th >= Math.PI) {
          c.phase = 'settle';
          c.sSet = 0;
          c.dir = -c.dir;
        }
      } else {
        dx = c.dir * ds;
        c.sSet += ds;
        const q = clamp(c.sSet / c.Sset, 0, 1);
        dz = c.D * (1 - smooth(q));
        if (q >= 1) c.phase = 'lane';
      }
      advanceLead(c, dx, 0, dz, 1 - c.kDrop * (dz / c.D), f);
    }

    function startCall(dirIn) {
      const b = ctx.bounds();
      const n = teamSize();
      const hh = halfLen(n);
      const u = Math.min(unit(), Math.max(0.45, (b.width - 40) / (2 * hh)));
      const dir = dirIn === -1 || dirIn === 1 ? dirIn : (ctx.rand() < 0.5 ? -1 : 1);
      const c = {
        mode: 'descending', dir, u, n, h: hh, t: 0,
        v1: rand(85, 115), v0: rand(440, 560) * clamp(b.width / 1280, 0.6, 1.2), vCur: 0,
        Td: 2.2, T: 5, H0: b.height + 140 * u,
        phase: 'lane', th: 0, sArc: 0, sMid: 0, R: 0, D: 50 * u, kDrop: 0.12, Sset: 1, tx0: 0, Lm: 10, hx: dir,
        leaveT: 0, leaveRequested: false, nearT: 1.5,
        Xmin: 0, Xmax: 0, Rmax: 0, xA: 0, xB: 0,
        phaseArr: [], gy: [], slope: [], landT: [],
        hist: [], s: 0, xL: 0, hL: 0, dzL: 0, x0: 0, h0: 0, tx: 1, ty: 0, dir0: dir,
      };
      c.phaseArr = [];
      for (let i = 0; i <= n; i += 1) {
        c.phaseArr.push(i * 0.9);
        c.gy.push(null);
        c.slope.push(0);
        c.landT.push(null);
      }
      c.vCur = c.v0;
      bounds4(c);
      const dSleigh = sleighOffset(n) * u;

      // when has the sleigh (the last animal) touched down? solved on the speed profile
      const landDone = () => {
        let lo = c.Td;
        let hi = c.Td + 12;
        for (let k = 0; k < 40; k += 1) {
          const mid = (lo + hi) / 2;
          if (descentDist(c, mid) - descentDist(c, c.Td) >= dSleigh) hi = mid;
          else lo = mid;
        }
        return hi;
      };
      for (let k = 0; k < 3; k += 1) c.T = landDone() + 0.4;
      c.tLand = landDone();

      // where the lead is when the sleigh touches down: the whole team lands inside the screen
      const lo = c.Xmin + dSleigh;
      const hi = Math.max(lo, c.xB - 20 * u);
      const m = lerp(lo, hi, rand(0.1, 0.9));
      const xLand = dir > 0 ? m : b.width - m;
      const xStart = xLand - dir * descentDist(c, c.tLand);
      const len = Math.hypot(c.v0, (2 * c.H0) / c.Td);
      seedChain(c, xStart, c.H0, c.v0 / len, ((2 * c.H0) / c.Td) / len, dir);

      call = c;
      cur.dir = dir;
      cur.u = u;
      cur.speed = c.v0;
      trail.length = 0;
      lastPos = null;
      rearT = 0;
      ensureSleighLayer();
      createHit();
      ctx.events.emit('sleigh:pass', { x: xStart, y: -80 * u, dir });
    }

    // the lead's path stays inside the screen (its head reaches ~48 design px ahead of it)
    function bounds4(c) {
      const b = ctx.bounds();
      const m = 56 * c.u;
      c.Xmin = m;
      c.Xmax = b.width - m;
      if (c.Xmax < c.Xmin) {
        c.Xmin = b.width / 2;
        c.Xmax = b.width / 2;
      }
      c.Rmax = Math.min(120 * c.u, (c.Xmax - c.Xmin) * 0.28);
      c.xA = c.Xmin + c.Rmax;
      c.xB = c.Xmax - c.Rmax;
    }

    function endCall() {
      call = null;
      clearRigState();
      explicit = false;
      sawSettingOn = false;
      spray.length = 0;
      if (callQueued) {
        callQueued = false;
        explicit = true;
        sawSettingOn = ctx.settings().sleigh === true;
        startCall();
        return;
      }
      wasOn = isOn();
      nextPassIn = rand(25, 70);
    }

    function addSpray(x, y, dirSign, power) {
      if (spray.length >= 120) spray.shift();
      spray.push({
        x, y, vx: -dirSign * rand(10, 55) * power + rand(-25, 25), vy: -rand(35, 95) * power,
        age: 0, life: rand(0.45, 0.9), size: rand(6, 12) * cur.u,
      });
    }

    function stepCall(dt) {
      const c = call;
      const u = c.u;
      const n = c.n;
      c.t += dt;
      bounds4(c);
      let speed = 0;

      // take off from the lane (or while settling out of a turn), never half-way round a turn
      if (c.mode === 'patrolling' && c.leaveRequested && c.phase !== 'arc') {
        c.mode = 'leaving';
        c.leaveT = 0;
      }

      if (c.mode === 'descending') {
        speed = descentSpeed(c, c.t);
        const tau = clamp(c.t / c.Td, 0, 1);
        advanceLead(c, c.dir * speed * dt, c.H0 * (1 - tau) * (1 - tau), 0, 1, c.dir);
      } else if (c.mode === 'patrolling') {
        stepLead(c, dt);
        speed = c.vCur;
      } else {
        c.leaveT += dt;
        speed = lerp(c.vCur, 220, smooth(c.leaveT / 1.3));
        const rise = Math.max(0, (c.leaveT - 1.0) / 2.6);
        const dz = c.dzL * Math.exp(-dt * 1.8);
        advanceLead(c, c.dir * speed * dt, (ctx.bounds().height + 200 * u) * Math.pow(Math.min(rise, 1.3), 1.8),
          dz, 1 - c.kDrop * (dz / c.D), c.dir);
      }

      const rearAmt = rearT > 0 ? Math.sin(Math.PI * clamp(1 - rearT / REAR_SECONDS, 0, 1)) : 0;
      const els = [];
      let allGone = true;
      let airSum = 0;
      let allLanded = true;
      let heading = c.hx;

      for (let i = 0; i <= n; i += 1) {
        const isSleigh = i === n;
        const off = isSleigh ? sleighOffset(n) : SPACING * i;
        const sq = c.s - off * u;
        const p0 = histAt(c, sq);
        const p1 = histAt(c, sq + 16);
        const x = p0.x;
        const h = Math.max(0, p0.h);
        const dz = p0.dz;
        const k = p0.k;
        const f = p0.f;
        const sg = f >= 0 ? 1 : -1;
        const us = u * k;
        const dxs = p1.x - p0.x;
        const flightPitch = clamp(Math.atan2(-(p1.h - p0.h), Math.max(Math.abs(dxs), 1)), -0.75, 0.75);
        const turnPitch = clamp(Math.atan2(-(p1.dz - p0.dz), Math.max(Math.abs(dxs), 6)), -0.3, 0.3);
        if (isSleigh) heading = dxs / Math.max(Math.hypot(dxs, p1.h + p1.dz - p0.h - p0.dz), 1e-3);

        const rest = isSleigh ? REST_SLEIGH : REST_DEER;
        const surf = isSleigh ? runnerSurface(x, u) : surfaceAt(x);
        const gTarget = surf - rest * us;
        c.gy[i] = c.gy[i] === null ? gTarget : c.gy[i] + (gTarget - c.gy[i]) * Math.min(1, dt * 10);
        const gy = c.gy[i];
        let y = gy - h - dz;

        if (c.mode === 'descending') {
          if (h <= 0.8 && c.landT[i] === null && c.t > 0.5) {
            c.landT[i] = c.t;
            landed(x, surf, isSleigh);
          }
          if (c.landT[i] === null) allLanded = false;
        } else if (c.mode === 'leaving' && y > -70 * u) {
          allGone = false;
        }

        const lg = 1 - smooth(h / (30 * u));
        airSum += lg;
        const tl = c.landT[i] === null ? null : c.t - c.landT[i];
        const bounce = tl !== null && tl < 1.4 ? -4 * u * Math.exp(-5 * tl) * Math.sin(13 * tl) : 0;
        const bobbing = isSleigh ? 0 : -Math.abs(Math.sin(c.phaseArr[i])) * 1.2 * u * lg * clamp(speed / 28, 0, 1);
        // ground tilt does not depend on which way the sprite faces
        const sl = slopeAt(x, 1, (isSleigh ? 40 : 22) * u);
        c.slope[i] += (sl - c.slope[i]) * Math.min(1, dt * 8);

        let noseDown = (1 - lg) * flightPitch + turnPitch;
        if (!isSleigh) {
          noseDown += Math.sin(clock * 2.4 + i * 0.7 + 0.6) * 0.03 * (1 - lg) - rearAmt * (0.3 - i * 0.04);
          y += -rearAmt * (11 - i * 1.5) * u;
        } else {
          noseDown += Math.sin(clock * 1.7) * 0.012 * (1 - lg);
        }
        y += bounce + bobbing;
        const rot = lg * c.slope[i] + sg * noseDown;

        const rate = lerp(9.5, clamp((speed / u) * 0.1257, 0, 14), lg);
        c.phaseArr[i] += rate * dt;
        els.push({
          x, y, pitch: sg * rot, phase: c.phaseArr[i], lg, surf: surf - dz, f, k, dz,
          groundTy: (surf - dz - (y + HIP_Y * us)) / us - 1.4,
        });
      }

      const deer = els.slice(0, n);
      const sleigh = els[n];
      c.hx += (heading - c.hx) * Math.min(1, dt * 8);
      rig = { u, deer, sleigh, rear: rearAmt, move: clamp(speed / 28, 0, 1) };
      cur.dir = c.hx;
      cur.speed = speed;
      cur.u = u;
      setLastPos(rig);

      // everyone is down: the descent simply carries on as the patrol
      if (c.mode === 'descending' && allLanded && c.t > c.Td) {
        c.mode = 'patrolling';
        c.vCur = speed;
        c.phase = 'lane';
        c.nearT = 0;
      }

      if (c.mode === 'descending' || c.mode === 'leaving') {
        trailPoint(dt, sleigh.x - c.hx * 50 * u, sleigh.y + 20 * u);
        emitSparkles(dt, sleigh.x, sleigh.y, c.hx, Math.max(speed, 80), u, 1);
      } else {
        if (trail.length) trail.shift();
        emitSparkles(dt, sleigh.x, sleigh.y, c.hx, 40, u, 0.3);
      }

      // snow spray from the runners and hooves while trotting on the ground
      const moveF = clamp(speed / 28, 0, 1);
      if (airSum / (n + 1) > 0.6 && moveF > 0.2) {
        sprayAcc += dt * 16 * moveF;
        while (sprayAcc >= 1) {
          sprayAcc -= 1;
          const e = els[Math.floor(ctx.rand() * (n + 1))];
          addSpray(e.x + rand(-12, 12) * u * e.k, e.surf, c.hx, 0.6 + moveF * 0.5);
        }
      }

      if (c.mode === 'patrolling') {
        c.nearT -= dt;
        if (c.nearT <= 0) {
          const pals = ctx.pets();
          const near = !pals.length || pals.some((pl) => Math.abs(pl.brain.body.x - sleigh.x) < 280 * u);
          if (near) {
            ctx.events.emit('sleigh:pass', { x: sleigh.x, y: sleigh.y, dir: c.hx >= 0 ? 1 : -1 });
            c.nearT = 3.2;
          } else {
            c.nearT = 0.6;
          }
        }
      }

      if (rearT > 0) rearT = Math.max(0, rearT - dt);
      if (c.mode === 'leaving' && allGone && c.leaveT > 1.5) endCall();
    }

    function landed(x, surf, isSleigh) {
      const u = call.u;
      for (let k = 0; k < (isSleigh ? 10 : 7); k += 1) addSpray(x + rand(-16, 16) * u, surf, call.dir, 1.4);
      if (isSleigh) {
        ctx.events.emit('sleigh:pass', { x: call.xL, y: surf, dir: call.dir });
      }
    }

    // ---- gifts ----------------------------------------------------------------------------

    function dropGift() {
      if ((!pass && !call) || !lastPos) return;
      const size = rand(17, 24) * cur.u;
      const gift = {
        x: lastPos.sackX + rand(-6, 6),
        y: lastPos.sackY,
        vx: cur.dir * cur.speed * 0.55 + rand(-30, 30),
        vy: rand(-70, -20),
        rot: rand(-0.5, 0.5),
        vr: rand(-2.6, 2.6),
        size,
        colors: GIFT_COLORS[Math.floor(ctx.rand() * GIFT_COLORS.length)],
        state: 'fall',
        timer: 0,
        alpha: 1,
      };
      gifts.push(gift);
      ensureGiftLayer();
      ctx.events.emit('sleigh:gift', { x: gift.x, y: gift.y });
    }

    function puff(x, y, count) {
      for (let i = 0; i < count; i += 1) {
        puffs.push({ x: x + rand(-8, 8), y: y + rand(-2, 2), vx: rand(-50, 50), vy: rand(-80, -20), age: 0, life: rand(0.5, 0.9), size: rand(6, 12) });
      }
    }

    function stepGifts(dt) {
      for (let i = gifts.length - 1; i >= 0; i -= 1) {
        const g = gifts[i];
        const b = ctx.bounds();
        if (g.state === 'fall') {
          g.vy = Math.min(g.vy + 700 * dt, 380);
          g.vx *= Math.exp(-0.8 * dt);
          g.x += g.vx * dt;
          g.y += g.vy * dt;
          g.rot += g.vr * dt;
          const surface = ctx.snow.surfaceY(clamp(g.x, 0, b.width));
          if (g.y + g.size * 0.43 >= surface) {
            g.state = 'rest';
            g.timer = 0;
            g.y = surface - g.size * 0.43 + 3;
            g.vr = 0;
            puff(g.x, surface, 9);
            ctx.events.emit('gift:land', { x: g.x });
          }
        } else {
          g.timer += dt;
          if (g.timer > GIFT_REST) {
            const q = clamp((g.timer - GIFT_REST) / GIFT_SINK, 0, 1);
            g.alpha = 1 - q;
            if (q >= 1) gifts.splice(i, 1);
          }
        }
        if (g.x < -60 || g.x > b.width + 60) gifts.splice(i, 1);
      }
      for (let i = puffs.length - 1; i >= 0; i -= 1) {
        const p = puffs[i];
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 160 * dt;
        p.vx *= Math.exp(-2 * dt);
        if (p.age >= p.life) puffs.splice(i, 1);
      }
    }

    // ---- sparkles and spray ---------------------------------------------------------------------

    function addSpark(x, y, vx, vy, kind, size, life, front) {
      if (sparks.length >= MAX_SPARKS) sparks.shift();
      sparks.push({ x, y, vx, vy, kind, size, life, age: 0, spin: rand(-2, 2), front: !!front });
    }

    function burst(x, y, count) {
      const kinds = ['gold', 'white', 'ice'];
      for (let i = 0; i < count; i += 1) {
        const a = ctx.rand() * Math.PI * 2;
        const sp = rand(60, 220);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40, kinds[i % 3], rand(8, 16), rand(0.7, 1.4), true);
      }
    }

    function stepSparks(dt) {
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= Math.exp(-1.3 * dt);
        s.vy = s.vy * Math.exp(-1.3 * dt) + 38 * dt;
        if (s.age >= s.life) sparks.splice(i, 1);
      }
    }

    function stepSpray(dt) {
      for (let i = spray.length - 1; i >= 0; i -= 1) {
        const s = spray[i];
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 260 * dt;
        s.vx *= Math.exp(-1.6 * dt);
        if (s.age >= s.life) spray.splice(i, 1);
      }
    }

    // ---- click ------------------------------------------------------------------------------------

    function onClick() {
      if ((!pass && !call) || !lastPos) return;
      rearT = REAR_SECONDS;
      burst(lastPos.x, lastPos.y - 10 * cur.u, 36);
      const count = 2 + Math.floor(ctx.rand() * 3);
      for (let i = 0; i < count; i += 1) dropQueue.push(0.12 * (i + 1));
      ctx.events.emit('sleigh:click', { x: lastPos.x, y: lastPos.y });
    }

    function stepDropQueue(dt) {
      for (let i = dropQueue.length - 1; i >= 0; i -= 1) {
        dropQueue[i] -= dt;
        if (dropQueue[i] <= 0) {
          dropQueue.splice(i, 1);
          dropGift();
        }
      }
    }

    // ---- rendering ---------------------------------------------------------------------------------

    function drawSparks(g, front) {
      const sp = getSprites();
      for (let i = 0; i < sparks.length; i += 1) {
        const s = sparks[i];
        if (s.front !== front) continue;
        const q = s.age / s.life;
        g.globalAlpha = Math.min(1, (1 - q) * 1.5);
        const size = s.size * (1 - q * 0.4) * 2;
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.spin * s.age);
        g.drawImage(sp[s.kind], -size / 2, -size / 2, size, size);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    function drawSpray(g) {
      if (!spray.length) return;
      const sp = getSprites();
      spray.forEach((s) => {
        const q = s.age / s.life;
        const size = s.size * (1 + q * 0.8);
        g.globalAlpha = 0.85 * (1 - q);
        g.drawImage(sp.puff, s.x - size / 2, s.y - size / 2, size, size);
      });
      g.globalAlpha = 1;
    }

    function drawTrail(g) {
      if (trail.length < 2 || ctx.quality() === 'low') return;
      g.lineCap = 'round';
      for (let i = 1; i < trail.length; i += 1) {
        const k = i / trail.length;
        g.strokeStyle = `rgba(255,205,110,${0.18 * k})`;
        g.lineWidth = (3 + 12 * k) * cur.u;
        g.beginPath();
        g.moveTo(trail[i - 1].x, trail[i - 1].y);
        g.lineTo(trail[i].x, trail[i].y);
        g.stroke();
        g.strokeStyle = `rgba(255,250,225,${0.5 * k})`;
        g.lineWidth = (1 + 2.6 * k) * cur.u;
        g.beginPath();
        g.moveTo(trail[i - 1].x, trail[i - 1].y);
        g.lineTo(trail[i].x, trail[i].y);
        g.stroke();
      }
    }

    function render() {
      const rigOn = (pass || call) && rig;
      if (rigOn || sparks.length || spray.length) {
        const layer = ensureSleighLayer();
        layer.clear();
        const g = layer.g;
        if (rigOn) drawTrail(g);
        drawSparks(g, false);
        if (rigOn) drawRig(g, rig, clock);
        drawSparks(g, true);
        drawSpray(g);
      } else if (sleighLayer) {
        releaseSleighLayer();
      }

      if (gifts.length || puffs.length) {
        const layer = ensureGiftLayer();
        layer.clear();
        const g = layer.g;
        const sp = getSprites();
        const b = ctx.bounds();
        gifts.forEach((gift) => {
          g.save();
          // sinking gifts disappear below the snow surface
          g.beginPath();
          g.rect(gift.x - 60, 0, 120, ctx.snow.surfaceY(clamp(gift.x, 0, b.width)) + 1);
          g.clip();
          g.globalAlpha = gift.alpha;
          const sunk = gift.state === 'rest' && gift.timer > GIFT_REST ? clamp((gift.timer - GIFT_REST) / GIFT_SINK, 0, 1) * gift.size * 0.7 : 0;
          drawGift(g, gift.x, gift.y + sunk, gift.size, gift.rot, gift.colors);
          g.restore();
        });
        puffs.forEach((p) => {
          const q = p.age / p.life;
          const size = p.size * (1 + q * 1.2);
          g.globalAlpha = 0.8 * (1 - q);
          g.drawImage(sp.puff, p.x - size / 2, p.y - size / 2, size, size);
        });
        g.globalAlpha = 1;
      } else if (giftLayer) {
        releaseGiftLayer();
      }
    }

    function syncHit() {
      if (!(pass || call) || !lastPos || !hit) return;
      const b = ctx.bounds();
      const u = cur.u;
      const w = 130 * u;
      const h = 74 * u;
      const left = lastPos.x - w / 2;
      const top = lastPos.y - h * 0.62;
      const visible = left + w > 0 && left < b.width && top + h > 0 && top < b.height;
      hit.style.display = visible ? 'block' : 'none';
      hit.style.left = `${left}px`;
      hit.style.top = `${top}px`;
      hit.style.width = `${w}px`;
      hit.style.height = `${h}px`;
      if (bubble) {
        bubble.style.left = `${clamp(lastPos.x, 70, b.width - 70)}px`;
        bubble.style.top = `${top - 4}px`;
      }
    }

    // ---- lifecycle -------------------------------------------------------------------------------------

    function abortAll() {
      pass = null;
      call = null;
      explicit = false;
      sawSettingOn = false;
      callQueued = false;
      clearRigState();
      gifts.length = 0;
      puffs.length = 0;
      sparks.length = 0;
      spray.length = 0;
      dropQueue.length = 0;
      releaseSleighLayer();
      releaseGiftLayer();
    }

    function update(dtRaw) {
      if (disposed) return;
      const dt = calm() ? dtRaw * 0.65 : dtRaw;
      clock += dt;

      if (!explicit) {
        const live = isOn();
        if (live !== wasOn) {
          wasOn = live;
          if (live) nextPassIn = rand(6, 12);
          else abortAll();
        }
        if (!live) {
          // after an explicit visit ended with the setting off: let leftovers (gifts, sparks) finish
          const leftovers = gifts.length || puffs.length || sparks.length || spray.length || dropQueue.length || sleighLayer || giftLayer;
          if (!leftovers) return;
        } else if (!pass) {
          nextPassIn -= dt;
          if (nextPassIn <= 0) startPass();
        }
      } else {
        const s = ctx.settings();
        if (s.sleigh === true) sawSettingOn = true;
        else if (sawSettingOn && call && (call.mode === 'descending' || call.mode === 'patrolling')) dismiss();
      }

      if (call) stepCall(dt);
      else if (pass) stepPass(dt);
      stepDropQueue(dt);
      stepGifts(dt);
      stepSparks(dt);
      stepSpray(dt);

      if (bubble && bubbleTimer > 0) {
        bubbleTimer -= dt;
        if (bubbleTimer <= 0 && !hover) bubble.style.opacity = '0';
        else if (bubbleTimer <= 0) bubbleTimer = 0.4;
      }
      if (!pass && !call && bubble) removeBubble();

      render();
      syncHit();
    }

    // ---- public API ---------------------------------------------------------------------------------------

    function dismiss() {
      if (!call) return false;
      if (call.mode === 'leaving') return true;
      call.leaveRequested = true;
      return true;
    }

    function callDown(opts) {
      if (disposed) return false;
      explicit = true;
      enabled = true;
      sawSettingOn = ctx.settings().sleigh === true;
      if (call) {
        if (call.mode === 'leaving') callQueued = true;
        else call.leaveRequested = false;
        return true;
      }
      if (pass) {
        pass = null;
        clearRigState();
      }
      wasOn = true;
      startCall(opts && opts.dir);
      return true;
    }

    // The setting went off: an explicit session ends politely if the setting had been seen on.
    function settingChanged() {
      if (explicit) {
        if (ctx.settings().sleigh === true) sawSettingOn = true;
        else if (sawSettingOn && call && call.mode !== 'leaving') dismiss();
        return;
      }
      if (!isOn() && wasOn) {
        wasOn = false;
        abortAll();
      }
    }

    function setEnabled(on) {
      enabled = !!on;
      if (explicit) {
        if (enabled) sawSettingOn = true;
        else if (sawSettingOn && call && call.mode !== 'leaving') dismiss();
        return;
      }
      if (!isOn()) {
        wasOn = false;
        abortAll();
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      abortAll();
      offs.forEach((off) => off());
      offs.length = 0;
    }

    return {
      update,
      setEnabled,
      applySettings: settingChanged,
      dispose,
      callDown,
      dismiss,
      get active() { return !!(pass || call); },
      get parked() { return !!call && (call.mode === 'patrolling' || call.mode === 'leaving'); },
      get mode() { return call ? call.mode : pass ? 'flyby' : 'idle'; },
      get turnProgress() { return turnProgress(call); },
      position() { return (pass || call) && lastPos ? { x: lastPos.x, y: lastPos.y } : null; },
      triggerPass(dir) {
        if (disposed || !isOn() || pass || call) return false;
        wasOn = true;
        startPass(dir);
        return true;
      },
    };
  }

  Christmas.Sleigh = { create };
})(window);
