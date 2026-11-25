// Snowman building mini-game (SnowmanGameEngine). Press on the snow and drag to
// roll a snowball (it really pulls snow out of the snowbank), stack a large, a
// medium and a small ball to build a snowman, then decorate it. Pure sizing /
// stacking rules live in Christmas.Snowman.logic so they can be unit-tested.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const AREA_FACTOR = 1.0; // ball area gained per px^2 of snow cut from the bank
  const GAIN_PER_CUT = 95; // target ball-area growth per cut (so ~500 px of rolling makes a large ball)
  const STACK_OFFSET = 0.84; // upper ball sinks slightly into the lower one
  const START_RADIUS = 8;
  const GRAVITY = 1500;
  const ROLL_STEP = 5; // px of rolling between cuts into the snow

  // ---- Pure rules ---------------------------------------------------------------

  function sizeFactor(scale) {
    return clamp(0.75 + 0.25 * (scale || 1), 0.8, 1.25);
  }

  function ranges(scale) {
    const f = sizeFactor(scale);
    return { small: [20 * f, 30 * f], medium: [32 * f, 44 * f], large: [46 * f, 60 * f] };
  }

  const maxRadius = (scale) => ranges(scale).large[1];

  function classify(r, scale) {
    const rg = ranges(scale);
    if (r < rg.small[0] * 0.9) return 'tiny';
    if (r < (rg.small[1] + rg.medium[0]) / 2) return 'small';
    if (r < (rg.medium[1] + rg.large[0]) / 2) return 'medium';
    return 'large';
  }

  const radiusToArea = (r) => Math.PI * r * r;
  const areaToRadius = (a) => Math.sqrt(Math.max(0, a) / Math.PI);

  function snapSpot(under, r) {
    return { x: under.x, y: under.y - (under.r + r) * STACK_OFFSET };
  }

  const snapTolerance = (under, r) => Math.max(under.r, r) * 1.1;

  function wantedUnder(size) {
    if (size === 'medium') return 'large';
    if (size === 'small') return 'medium';
    return null;
  }

  function indexBalls(balls) {
    const ix = {};
    balls.forEach((b) => { ix[b.id] = b; });
    return ix;
  }

  // Can `ball` (about to be released) snap onto `under`?
  function canSnap(ball, under, scale, ix) {
    if (!ball || !under || ball === under) return false;
    const need = wantedUnder(classify(ball.r, scale));
    if (!need || classify(under.r, scale) !== need) return false;
    if (under.topId && under.topId !== ball.id) return false;
    if (need === 'medium') {
      const base = under.supportId ? ix[under.supportId] : null;
      if (!base || classify(base.r, scale) !== 'large') return false;
    }
    const spot = snapSpot(under, ball.r);
    return Math.hypot(ball.x - spot.x, ball.y - spot.y) <= snapTolerance(under, ball.r);
  }

  function findSnapTarget(ball, balls, scale) {
    const ix = indexBalls(balls);
    let best = null;
    let bestD = Infinity;
    balls.forEach((cand) => {
      if (!canSnap(ball, cand, scale, ix)) return;
      const spot = snapSpot(cand, ball.r);
      const d = Math.hypot(ball.x - spot.x, ball.y - spot.y);
      if (d < bestD) {
        best = cand;
        bestD = d;
      }
    });
    return best;
  }

  // Walks up from a base ball: [base, middle, head] as far as the stack goes.
  function stackOf(base, ix) {
    const out = [base];
    let cur = base;
    for (let i = 0; i < 4 && cur.topId && ix[cur.topId]; i += 1) {
      cur = ix[cur.topId];
      out.push(cur);
    }
    return out;
  }

  // 1 = a large ball on the snow, 2 = + medium, 3 = + small (a snowman); 0 = not a valid stack.
  function stackStage(stack, scale) {
    const want = ['large', 'medium', 'small'];
    let stage = 0;
    for (let i = 0; i < want.length && i < stack.length; i += 1) {
      if (classify(stack[i].r, scale) !== want[i]) break;
      stage = i + 1;
    }
    return stage;
  }

  // Nearest circle overlapped by a projectile, or -1.
  function projectileHit(proj, circles) {
    let best = -1;
    let bestPen = 0;
    circles.forEach((c, i) => {
      const pen = c.r + proj.r - Math.hypot(proj.x - c.x, proj.y - c.y);
      if (pen > bestPen) {
        best = i;
        bestPen = pen;
      }
    });
    return best;
  }

  // 1st hit: wobble + loose decorations pop off; 2nd: head knocked off; 3rd: it bursts.
  function advanceDamage(stage) {
    const next = Math.min(3, (stage || 0) + 1);
    return { stage: next, effect: next === 1 ? 'wobble' : next === 2 ? 'head' : 'break' };
  }

  // Velocity of a flick from recent pointer samples [{t (ms), x, y}], clamped to maxSpeed.
  function flickVelocity(samples, maxSpeed) {
    if (!samples || samples.length < 2) return { vx: 0, vy: 0, speed: 0 };
    const a = samples[0];
    const b = samples[samples.length - 1];
    const span = Math.max((b.t - a.t) / 1000, 0.016);
    let vx = (b.x - a.x) / span;
    let vy = (b.y - a.y) / span;
    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }
    return { vx, vy, speed: Math.min(speed, maxSpeed) };
  }

  const chunkCount = (r) => clamp(Math.round(r / 3.4), 6, 16);

  // Throw-mode ammo: small balls rolled out of the bank (never bigger than a "small" ball).
  const MAX_AMMO_BALLS = 3;
  const SNOW_UNIT = 4 * 2.7; // px^2 of bank volume per px of addAt() height (STEP 4 x kernel sum 2.7)

  function ammoRange(scale) {
    const f = sizeFactor(scale);
    return { min: 11 * f, max: 28 * f };
  }

  // 0.5 for the tiniest ball that still counts, 1 for a full-size one; scales wobble/knock a bit.
  function ammoPower(r, scale) {
    const a = ammoRange(scale);
    return clamp(0.5 + (0.5 * (r - a.min)) / (a.max - a.min), 0.5, 1);
  }

  // Splits `vol` px^2 of snow into `pieces` equal drops spread over x +/- half (kept inside the viewport),
  // so giving snow back to the bank never leaves a single spike. The pieces always sum to `vol`.
  function snowReturnPlan(x, vol, half, width, pieces) {
    const n = Math.max(1, pieces || 5);
    const out = [];
    for (let k = 0; k < n; k += 1) {
      const t = n === 1 ? 0 : k / (n - 1) - 0.5;
      out.push({ x: clamp(x + t * 2 * half, 0, Math.max(0, width)), vol: vol / n });
    }
    return out;
  }

  // ---- Module ---------------------------------------------------------------------

  const TOOLS = [
    { id: 'nose', icon: '🥕', label: 'Carrot nose' },
    { id: 'eyes', icon: '⚫', label: 'Coal eyes' },
    { id: 'smile', icon: '😊', label: 'Smile' },
    { id: 'buttons', icon: '🔘', label: 'Buttons' },
    { id: 'arms', icon: '🪵', label: 'Stick arms' },
    { id: 'scarf', icon: '🧣', label: 'Scarf' },
    { id: 'hat', icon: '🎩', label: 'Hat' },
    { id: 'holly', icon: '🌿', label: 'Holly sprig' },
    { id: 'candy', icon: '🍬', label: 'Candy cane' },
  ];

  const MAX_THROW = 1600;
  const THROW_GRAVITY = 1100;

  const BAR_CSS = `
.pp-sm-bar{position:absolute;left:50%;transform:translateX(-50%);z-index:235;pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:94vw;font:600 12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#23314d;user-select:none}
.pp-sm-hint{padding:5px 12px;border-radius:999px;background:rgba(35,49,77,.88);color:#fff;font-weight:600;font-size:11.5px;white-space:nowrap;box-shadow:0 4px 14px rgba(20,40,80,.25)}
.pp-sm-palette,.pp-sm-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 6px 20px rgba(30,60,120,.22);border:1px solid rgba(160,190,230,.6)}
.pp-sm-palette[hidden]{display:none}
.pp-sm-tool{all:unset;box-sizing:border-box;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;font-size:16px;cursor:pointer;position:relative;background:#eef4fc;transition:transform .12s ease,background .12s ease}
.pp-sm-tool:hover{transform:translateY(-2px);background:#dce9fa}
.pp-sm-tool[data-active="1"]{background:#d8344b;box-shadow:0 0 0 2px #fff,0 0 0 4px #d8344b}
.pp-sm-tool[data-on="1"]::after{content:"";position:absolute;right:1px;bottom:1px;width:8px;height:8px;border-radius:50%;background:#2fbf71;border:1.5px solid #fff}
.pp-sm-count{padding:0 8px;font-weight:800}
.pp-sm-btn{all:unset;box-sizing:border-box;padding:6px 12px;border-radius:999px;background:#eef4fc;cursor:pointer;font-weight:700}
.pp-sm-btn:hover{background:#dce9fa}
.pp-sm-btn[data-active="1"]{background:#2a6fd6;color:#fff}
.pp-sm-btn.primary{background:#d8344b;color:#fff}
.pp-sm-btn.primary:hover{background:#c02a40}
`;

  function create(ctx) {
    const settings = () => (ctx.settings && ctx.settings()) || {};
    const rnd = () => (ctx.rand ? ctx.rand() : Math.random());
    const scaleNow = () => (ctx.scale ? ctx.scale() : 1);
    const reduced = () => !!(ctx.reducedMotion && ctx.reducedMotion());
    const qualityMul = () => ({ low: 0.5, medium: 1, high: 1.6 }[(ctx.quality && ctx.quality()) || 'medium'] || 1);
    const audio = (name, opts) => { if (ctx.audio && ctx.audio.play) ctx.audio.play(name, opts); };
    const emit = (name, data) => { if (ctx.events && ctx.events.emit) ctx.events.emit(name, data); };

    let enabled = settings().snowman !== false;
    let active = false;
    let disposed = false;
    let layer = ctx.createLayer('snowmen', 45);
    layer.onResize(() => { forceDraw = true; clampToViewport(); });

    let balls = [];
    let snowmen = [];
    let particles = [];
    let floaters = [];
    let nextBallId = 1;
    let nextSnowmanId = 1;
    let built = 0;
    let selectedId = null;
    let tool = null;
    let roll = null;
    let grab = null;
    let snapCand = null;
    let throwMode = false;
    let aim = null;
    let projectiles = [];
    let chunks = [];
    let debris = [];
    let smashed = 0;
    let returns = [];
    let hintFlash = null;
    let hit = null;
    let bar = null;
    let barRefs = null;
    let removeSpots = [];
    let time = 0;
    let forceDraw = true;
    let drewContent = false;
    let zoneH = 280;
    let barTimer = 0;
    const pointer = { x: -999, y: -999, inside: false };

    function makePatches() {
      const out = [];
      for (let i = 0; i < 8; i += 1) {
        out.push({ x: (rnd() - 0.5) * 1.5, y: (rnd() - 0.5) * 1.5, r: 0.14 + rnd() * 0.2, a: rnd() * TAU, light: rnd() < 0.55 });
      }
      for (let i = 0; i < 26; i += 1) {
        const a = rnd() * TAU;
        const d = Math.sqrt(rnd()) * 0.95;
        out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.025 + rnd() * 0.035, a: 0, light: rnd() < 0.5, speck: true });
      }
      return out;
    }

    function makeBall(x, y, r) {
      return {
        id: `b${nextBallId++}`, x, y, r, area: radiusToArea(r), vy: 0, falling: false, bounced: false,
        rot: rnd() * TAU, supportId: null, topId: null, locked: false, snowmanId: null,
        squash: 0, stage1: false, kickVx: 0, detached: false, patches: makePatches(),
        ammo: false, taken: 0,
      };
    }

    const index = () => indexBalls(balls);

    function levelOf(ball, ix) {
      let lv = 0;
      let cur = ball;
      for (let i = 0; i < 4 && cur.supportId && ix[cur.supportId]; i += 1) {
        lv += 1;
        cur = ix[cur.supportId];
      }
      return lv;
    }

    function restY(b) {
      const sn = ctx.snow;
      const surf = Math.min(sn.surfaceY(b.x - b.r * 0.45), sn.surfaceY(b.x), sn.surfaceY(b.x + b.r * 0.45));
      return surf - b.r * 0.82;
    }

    function clampToViewport() {
      const B = ctx.bounds();
      balls.forEach((b) => {
        b.x = clamp(b.x, b.r, Math.max(b.r, B.width - b.r));
        if (!b.supportId) b.y = Math.min(b.y, restY(b));
      });
    }

    // ---- Particles / floaters -------------------------------------------------------

    function addParticle(p) {
      const cap = Math.round(140 * qualityMul());
      if (particles.length >= cap) particles.shift();
      particles.push(p);
    }

    function puff(x, y, n, spread, up) {
      const count = Math.max(1, Math.round(n * qualityMul() * (reduced() ? 0.4 : 1)));
      for (let i = 0; i < count; i += 1) {
        addParticle({ type: 'snow', x, y, vx: (rnd() - 0.5) * spread, vy: -(up || 60) * (0.4 + rnd()), life: 0, max: 0.5 + rnd() * 0.5, size: 1.5 + rnd() * 2.5 });
      }
    }

    function sparkBurst(x, y, n) {
      const count = Math.round(n * qualityMul() * (reduced() ? 0.5 : 1));
      const colors = ['#fff6c2', '#ffd36b', '#ffffff', '#ff8aa0', '#aee0ff'];
      for (let i = 0; i < count; i += 1) {
        const a = rnd() * TAU;
        const sp = 70 + rnd() * 170;
        addParticle({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0, max: 0.7 + rnd() * 0.7, size: 3 + rnd() * 4, color: colors[Math.floor(rnd() * colors.length)] });
      }
    }

    function floatText(x, y, text) {
      floaters.push({ x, y, text, t: 0, max: 1.8 });
    }

    // ---- Snowmen ---------------------------------------------------------------------

    function snowmanById(id) {
      return snowmen.find((s) => s.id === id) || null;
    }

    function parts(sm, ix) {
      const arr = sm.ballIds.map((id) => ix[id]);
      return arr.every(Boolean) ? { base: arr[0], mid: arr[1], head: arr[2] } : null;
    }

    function makeSnowman(stack) {
      const sm = {
        id: `sm${nextSnowmanId++}`,
        ballIds: stack.map((b) => b.id),
        decor: {},
        cel: 0,
        look: 0,
        dir: rnd() < 0.5 ? -1 : 1,
        phase: rnd() * TAU,
        damage: 0,
        headOff: false,
        wobble: null,
        cool: 0,
      };
      stack.forEach((b) => { b.locked = true; b.snowmanId = sm.id; });
      snowmen.push(sm);
      built += 1;
      selectedId = sm.id;
      const head = stack[2];
      sparkBurst(head.x, head.y - head.r, 26);
      audio('build');
      floatText(head.x, head.y - head.r * 2.2, 'Snowman built!');
      emit('snowman:progress', { stage: 3 });
      emit('snowman:built', { id: sm.id, x: stack[0].x, y: stack[0].y + stack[0].r * 0.82 });
      refreshBar();
      return sm;
    }

    function removeSnowman(id) {
      const sm = snowmanById(id);
      if (!sm) return false;
      const doomed = new Set(sm.ballIds);
      balls.filter((b) => doomed.has(b.id)).forEach((b) => puff(b.x, b.y, 10, 160, 110));
      balls = balls.filter((b) => !doomed.has(b.id));
      snowmen = snowmen.filter((s) => s.id !== id);
      if (selectedId === id) selectedId = snowmen.length ? snowmen[snowmen.length - 1].id : null;
      audio('pop', { volume: 0.7 });
      emit('snowman:removed', { id });
      forceDraw = true;
      refreshBar();
      return true;
    }

    function reset() {
      finishInteractions(true);
      const ids = snowmen.map((s) => s.id);
      dissolveAmmo(false);
      clearProjectiles(false);
      balls = [];
      snowmen = [];
      particles = [];
      floaters = [];
      chunks = [];
      debris = [];
      selectedId = null;
      ids.forEach((id) => emit('snowman:removed', { id }));
      forceDraw = true;
      refreshBar();
    }

    function applyTool(sm, id) {
      sm.decor[id] = !sm.decor[id];
      const ix = index();
      const p = parts(sm, ix);
      if (p) puff(p.head.x, p.head.y, 5, 80, 50);
      audio('sparkle', { volume: 0.6 });
      refreshBar();
    }

    // ---- Giving snow back to the bank ----------------------------------------------------------

    function applyReturn(x, vol, half) {
      const B = ctx.bounds();
      snowReturnPlan(x, vol, half, B.width).forEach((p) => ctx.snow.addAt(p.x, p.vol / SNOW_UNIT));
    }

    // The snow an ammo ball took from the bank flows back into it (smoothly, unless `instant`).
    function returnSnow(x, vol, instant) {
      if (!(vol > 0.5)) return;
      const half = clamp(10 + Math.sqrt(vol) * 0.5, 14, 40);
      if (instant) applyReturn(x, vol, half);
      else returns.push({ x, left: vol, rate: Math.max(vol / 0.45, 200), half });
    }

    function stepReturns(dt) {
      for (let i = returns.length - 1; i >= 0; i -= 1) {
        const r = returns[i];
        const amt = Math.min(r.left, r.rate * dt);
        applyReturn(r.x, amt, r.half);
        r.left -= amt;
        moved = true;
        if (r.left <= 0.5) returns.splice(i, 1);
      }
    }

    function flushReturns() {
      returns.forEach((r) => applyReturn(r.x, r.left, r.half));
      returns = [];
    }

    // Ammo balls sitting on the bank melt back into it (leaving Throw mode, Done, Reset).
    function dissolveAmmo(instant) {
      const gone = balls.filter((b) => b.ammo);
      if (!gone.length) return;
      gone.forEach((b) => {
        puff(b.x, b.y, 6, 120, 70);
        returnSnow(b.x, b.taken, instant);
      });
      balls = balls.filter((b) => !b.ammo);
      forceDraw = true;
    }

    function clearProjectiles(instant) {
      const B = ctx.bounds();
      projectiles.forEach((p) => returnSnow(clamp(p.x, 0, B.width), p.taken, instant));
      projectiles = [];
    }

    const ammoCount = () => balls.filter((b) => b.ammo).length;

    function ammoAt(x, y) {
      let best = null;
      let bestD = Infinity;
      balls.forEach((b) => {
        if (!b.ammo) return;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d <= b.r + 6 && d < bestD) {
          best = b;
          bestD = d;
        }
      });
      return best;
    }

    function flashHint(text) {
      hintFlash = { text, t: 2.2 };
      refreshBar();
    }

    // ---- Interaction -----------------------------------------------------------------

    function ballAt(x, y) {
      const ix = index();
      const cands = balls.filter((b) => !(roll && roll.ball === b) && Math.hypot(b.x - x, b.y - y) <= b.r + 4);
      cands.sort((a, b) => levelOf(b, ix) - levelOf(a, ix) || a.r - b.r);
      return cands[0] || null;
    }

    function removeSpot(sm, ix) {
      const p = parts(sm, ix);
      if (!p) return null;
      if (sm.headOff) return { x: p.mid.x + p.mid.r * 1.25, y: p.mid.y - p.mid.r * 0.95 };
      return { x: p.head.x + p.head.r * 1.4, y: p.head.y - p.head.r * 1.2 };
    }

    function startRoll(e, opts) {
      const sn = ctx.snow;
      const ammo = !!(opts && opts.ammo);
      if (sn.heightAt(pointer.x) < 1.5) {
        floatText(pointer.x, pointer.y - 26, 'No snow here');
        audio('click', { volume: 0.4 });
        return;
      }
      if (ammo && ammoCount() >= MAX_AMMO_BALLS) {
        floatText(pointer.x, pointer.y - 26, 'Throw your snowballs first');
        audio('click', { volume: 0.4 });
        return;
      }
      const f = sizeFactor(scaleNow());
      const ball = makeBall(clamp(pointer.x, 8, ctx.bounds().width - 8), 0, START_RADIUS * f);
      ball.ammo = ammo;
      ball.y = restY(ball);
      balls.push(ball);
      roll = { ball, dist: 0, starved: 0, size: 'tiny', pointerId: e.pointerId, ammo };
      hit.setPointerCapture?.(e.pointerId);
      audio('click', { volume: 0.6 });
    }

    function startGrab(ball, e) {
      const ix = index();
      if (ball.supportId && ix[ball.supportId]) ix[ball.supportId].topId = null;
      ball.supportId = null;
      ball.falling = false;
      ball.vy = 0;
      ball.bounced = false;
      grab = { ball, offX: pointer.x - ball.x, offY: pointer.y - ball.y, pointerId: e.pointerId };
      hit.setPointerCapture?.(e.pointerId);
      audio('click', { volume: 0.5 });
    }

    function placeStageEvent(ball) {
      if (classify(ball.r, scaleNow()) === 'large' && !ball.stage1 && !ball.supportId) {
        ball.stage1 = true;
        emit('snowman:progress', { stage: 1 });
      }
    }

    function finishRoll() {
      const ball = roll.ball;
      if (roll.ammo) {
        if (ball.r < ammoRange(scaleNow()).min) {
          puff(ball.x, ball.y, 6, 110, 70);
          returnSnow(ball.x, ball.taken);
          balls = balls.filter((b) => b !== ball);
          floatText(ball.x, ball.y - 24, 'Roll it a bit longer');
        } else {
          ball.falling = false;
          audio('thud', { volume: 0.4 });
          floatText(ball.x, ball.y - ball.r - 18, 'Ammo ready: flick it!');
        }
        roll = null;
        refreshBar();
        return;
      }
      const size = classify(ball.r, scaleNow());
      if (size === 'tiny') {
        puff(ball.x, ball.y, 8, 120, 80);
        balls = balls.filter((b) => b !== ball);
        floatText(ball.x, ball.y - 24, 'Too small, keep rolling');
      } else {
        ball.falling = false;
        placeStageEvent(ball);
        audio('thud', { volume: 0.5 });
      }
      roll = null;
    }

    function finishGrab() {
      const ball = grab.ball;
      const target = snapCand;
      grab = null;
      snapCand = null;
      if (target) {
        ball.supportId = target.id;
        target.topId = ball.id;
        ball.falling = false;
        const size = classify(ball.r, scaleNow());
        audio('pop', { volume: 0.6 });
        puff(ball.x, ball.y + ball.r * 0.6, 6, 100, 50);
        if (size === 'medium') {
          emit('snowman:progress', { stage: 2 });
        } else {
          const ix = index();
          let base = ball;
          while (base.supportId && ix[base.supportId]) base = ix[base.supportId];
          const stack = stackOf(base, ix);
          if (stackStage(stack, scaleNow()) === 3 && stack.length === 3) makeSnowman(stack);
        }
      } else {
        ball.falling = true;
        ball.vy = 0;
        ball.bounced = false;
      }
    }

    function finishInteractions(silent) {
      if (aim) {
        hit?.releasePointerCapture?.(aim.pointerId);
        const a = aim;
        aim = null;
        if (silent) returnSnow(a.ball.x, a.ball.taken);
        else dropAmmo(a);
      }
      if (roll) {
        if (silent) {
          if (roll.ammo) returnSnow(roll.ball.x, roll.ball.taken);
          balls = balls.filter((b) => b !== roll.ball);
        } else finishRoll();
        roll = null;
      }
      if (grab) {
        if (silent) {
          grab.ball.falling = true;
          grab = null;
          snapCand = null;
        } else finishGrab();
      }
    }

    function updatePointer(e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
    }

    function onDown(e) {
      if (e.button !== 0 || !active) return;
      updatePointer(e);
      if (roll || grab || aim) finishInteractions(false); // a lost pointerup must never wedge the game
      const ix = index();
      for (const sm of snowmen) {
        const p = removeSpot(sm, ix);
        if (p && Math.hypot(pointer.x - p.x, pointer.y - p.y) <= 13) {
          removeSnowman(sm.id);
          return;
        }
      }
      if (throwMode) {
        const am = ammoAt(pointer.x, pointer.y);
        if (am) startAmmoAim(am, e);
        else if (pointer.y >= ctx.snow.surfaceY(pointer.x) - 26) startRoll(e, { ammo: true });
        else flashHint('Roll a snowball out of the snow first, then flick it at a snowman');
        return;
      }
      const b = ballAt(pointer.x, pointer.y);
      if (b) {
        if (b.locked) {
          const sm = snowmanById(b.snowmanId);
          if (sm) {
            selectedId = sm.id;
            if (tool) applyTool(sm, tool);
            else audio('click', { volume: 0.4 });
            refreshBar();
          }
          return;
        }
        if (b.topId) {
          floatText(b.x, b.y - b.r - 16, 'Lift the top ball first');
          return;
        }
        startGrab(b, e);
        return;
      }
      if (pointer.y >= ctx.snow.surfaceY(pointer.x) - 26) startRoll(e);
    }

    function onMove(e) {
      updatePointer(e);
      if (aim) {
        // coalesced events keep their own timestamps, so a flick is measured right even when frames are slow
        const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
        if (list.length > 1) list.forEach((c) => sampleAim(c.clientX, c.clientY, c.timeStamp));
        else sampleAim(e.clientX, e.clientY, e.timeStamp);
      }
      updateCursor();
    }

    function onUp(e) {
      if (aim && (e.pointerId === aim.pointerId || e.type === 'pointercancel')) {
        hit.releasePointerCapture?.(e.pointerId);
        if (e.type !== 'pointercancel') sampleAim(e.clientX, e.clientY, e.timeStamp);
        releaseAim(e.type === 'pointercancel');
      }
      if (roll && (e.pointerId === roll.pointerId || e.type === 'pointercancel')) {
        hit.releasePointerCapture?.(e.pointerId);
        finishRoll();
      }
      if (grab && (e.pointerId === grab.pointerId || e.type === 'pointercancel')) {
        hit.releasePointerCapture?.(e.pointerId);
        finishGrab();
      }
      updateCursor();
    }

    function onLeave() {
      if (!roll && !grab && !aim) pointer.inside = false;
    }

    function onKey(e) {
      if (e.key === 'Escape' && active) setActive(false);
    }

    function updateCursor() {
      if (!hit) return;
      let cursor = 'default';
      if (grab || aim) cursor = 'grabbing';
      else if (roll) cursor = 'grabbing';
      else if (throwMode) cursor = ammoAt(pointer.x, pointer.y) || pointer.y >= ctx.snow.surfaceY(pointer.x) - 26 ? 'grab' : 'default';
      else {
        const ix = index();
        const overRemove = snowmen.some((sm) => {
          const p = removeSpot(sm, ix);
          return p && Math.hypot(pointer.x - p.x, pointer.y - p.y) <= 13;
        });
        const b = ballAt(pointer.x, pointer.y);
        if (overRemove) cursor = 'pointer';
        else if (b && b.locked) cursor = tool ? 'copy' : 'pointer';
        else if (b && !b.topId) cursor = 'grab';
      }
      hit.style.cursor = cursor;
    }

    // ---- Toolbar -----------------------------------------------------------------------

    function buildBar() {
      bar = document.createElement('div');
      bar.className = 'pp-sm-bar';
      const style = document.createElement('style');
      style.textContent = BAR_CSS;
      bar.appendChild(style);
      const hint = document.createElement('div');
      hint.className = 'pp-sm-hint';
      const palette = document.createElement('div');
      palette.className = 'pp-sm-palette';
      palette.hidden = true;
      const toolBtns = {};
      TOOLS.forEach((t) => {
        const b = document.createElement('button');
        b.className = 'pp-sm-tool';
        b.textContent = t.icon;
        b.title = t.label;
        b.addEventListener('click', () => {
          tool = tool === t.id ? null : t.id;
          audio('click', { volume: 0.4 });
          refreshBar();
        });
        palette.appendChild(b);
        toolBtns[t.id] = b;
      });
      const row = document.createElement('div');
      row.className = 'pp-sm-row';
      const count = document.createElement('span');
      count.className = 'pp-sm-count';
      const smashedEl = document.createElement('span');
      smashedEl.className = 'pp-sm-count';
      const throwBtn = document.createElement('button');
      throwBtn.className = 'pp-sm-btn';
      throwBtn.textContent = '🎯 Throw';
      throwBtn.title = 'Roll snowballs out of the snow and throw them at a snowman';
      throwBtn.addEventListener('click', () => setThrow(!throwMode));
      const resetBtn = document.createElement('button');
      resetBtn.className = 'pp-sm-btn';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', () => reset());
      const done = document.createElement('button');
      done.className = 'pp-sm-btn primary';
      done.textContent = 'Done';
      done.addEventListener('click', () => setActive(false));
      row.append(count, smashedEl, throwBtn, resetBtn, done);
      bar.append(hint, palette, row);
      ctx.stage.appendChild(bar);
      barRefs = { hint, palette, toolBtns, count, smashedEl, throwBtn };
      refreshBar();
    }

    function computeHint() {
      if (throwMode) {
        if (hintFlash) return hintFlash.text;
        if (aim) return 'Release to throw: flick fast for a harder hit';
        if (roll) {
          const full = roll.ball.r >= ammoRange(scaleNow()).max - 0.2;
          if (roll.starved >= 6) return 'Out of snow here: roll somewhere else';
          return full ? 'Full size: let go, then flick it at a snowman' : 'Keep rolling for a bigger snowball…';
        }
        return ammoCount() ? 'Grab a snowball and flick it at a snowman' : 'Roll a snowball out of the snow, then flick it at a snowman';
      }
      if (roll) {
        const size = classify(roll.ball.r, scaleNow());
        if (roll.starved >= 6) return 'Out of snow here: roll somewhere else';
        return size === 'tiny' ? 'Keep rolling…' : `${size[0].toUpperCase()}${size.slice(1)} ball: keep rolling for bigger`;
      }
      if (grab) {
        const size = classify(grab.ball.r, scaleNow());
        const need = wantedUnder(size);
        return need ? `Drop it on a ${need} ball` : 'Drop it on the snow';
      }
      if (ctx.snow.total() < 2 && !balls.length) return 'Wait for snow to build up…';
      if (snowmen.length && tool) return 'Click a snowman to add or remove it';
      if (snowmen.length) return 'Pick a tool to decorate, or roll another snowman';
      return 'Press on the snow and drag to roll a ball: large, medium, small';
    }

    function refreshBar() {
      if (!barRefs) return;
      const sm = snowmanById(selectedId);
      barRefs.count.textContent = `⛄ ${built} built`;
      barRefs.smashedEl.textContent = `💥 ${smashed} smashed`;
      barRefs.throwBtn.dataset.active = throwMode ? '1' : '0';
      barRefs.palette.hidden = snowmen.length === 0 || throwMode;
      TOOLS.forEach((t) => {
        const b = barRefs.toolBtns[t.id];
        b.dataset.active = tool === t.id ? '1' : '0';
        b.dataset.on = sm && sm.decor[t.id] ? '1' : '0';
      });
      barRefs.hint.textContent = computeHint();
    }

    // ---- Overlay lifecycle -----------------------------------------------------------------

    function createOverlay() {
      hit = ctx.makeHit('pp-snowman-hit');
      Object.assign(hit.style, { left: '0', right: '0', bottom: '0', top: 'auto', width: '100%', height: `${zoneH}px` });
      hit.addEventListener('pointerdown', onDown);
      hit.addEventListener('pointermove', onMove);
      hit.addEventListener('pointerup', onUp);
      hit.addEventListener('pointercancel', onUp);
      hit.addEventListener('pointerleave', onLeave);
      global.addEventListener('keydown', onKey, true);
      buildBar();
    }

    function destroyOverlay() {
      global.removeEventListener('keydown', onKey, true);
      if (hit) {
        hit.removeEventListener('pointerdown', onDown);
        hit.removeEventListener('pointermove', onMove);
        hit.removeEventListener('pointerup', onUp);
        hit.removeEventListener('pointercancel', onUp);
        hit.removeEventListener('pointerleave', onLeave);
        hit.remove();
        hit = null;
      }
      if (bar) {
        bar.remove();
        bar = null;
        barRefs = null;
      }
    }

    function setActive(on) {
      const want = !!on && enabled && settings().snowman !== false;
      if (want === active) return;
      if (!want) {
        finishInteractions(false);
        dissolveAmmo(false);
        throwMode = false;
        hintFlash = null;
        destroyOverlay();
        tool = null;
        pointer.inside = false;
      }
      active = want;
      if (want) createOverlay();
      forceDraw = true;
    }

    // ---- Simulation --------------------------------------------------------------------------

    let moved = false;

    function stepPhysics(dt, ix) {
      const B = ctx.bounds();
      const order = balls.slice().sort((a, b) => levelOf(a, ix) - levelOf(b, ix));
      order.forEach((b) => {
        if ((grab && grab.ball === b) || (roll && roll.ball === b)) return;
        if (b.squash > 0.001) { b.squash *= Math.max(0, 1 - 9 * dt); moved = true; }
        if (b.supportId) {
          const s = ix[b.supportId];
          if (!s) {
            b.supportId = null;
            b.falling = true;
            return;
          }
          const t = snapSpot(s, b.r);
          const k = Math.min(1, 14 * dt);
          const nx = b.x + (t.x - b.x) * k;
          const ny = b.y + (t.y - b.y) * k;
          if (Math.abs(nx - b.x) > 0.02 || Math.abs(ny - b.y) > 0.02) moved = true;
          b.x = nx;
          b.y = ny;
          return;
        }
        b.x = clamp(b.x, b.r, Math.max(b.r, B.width - b.r));
        if (b.kickVx) {
          b.x += b.kickVx * dt;
          b.rot += (b.kickVx * dt) / Math.max(8, b.r);
          if (!b.falling) b.kickVx *= Math.exp(-1.5 * dt);
          if (Math.abs(b.kickVx) < 8) b.kickVx = 0;
          if (b.x <= b.r || b.x >= B.width - b.r) b.kickVx = -b.kickVx * 0.5;
          moved = true;
        }
        const ty = restY(b);
        if (b.falling) {
          b.vy += GRAVITY * dt;
          b.y += b.vy * dt;
          moved = true;
          if (b.vy > 0 && b.y >= ty) {
            b.y = ty;
            if (b.vy > 240 && !b.bounced) {
              audio('thud', { volume: clamp(b.vy / 900, 0.25, 0.9) });
              puff(b.x, ty + b.r * 0.8, 6, 140, 70);
              if (!b.locked) b.squash = clamp(b.vy / 1800, 0.05, 0.2);
              b.vy = -b.vy * 0.22;
              b.bounced = true;
            } else {
              b.vy = 0;
              b.falling = false;
              b.bounced = false;
              placeStageEvent(b);
            }
          }
        } else {
          const d = ty - b.y;
          if (d > 1.5) {
            b.falling = true;
            b.vy = 0;
            moved = true;
          } else if (Math.abs(d) > 0.02) {
            b.y += d * Math.min(1, 12 * dt);
            moved = true;
          }
        }
      });

      const base = balls.filter((b) => !b.supportId && !b.falling && !(grab && grab.ball === b) && !(roll && roll.ball === b));
      for (let i = 0; i < base.length; i += 1) {
        for (let j = i + 1; j < base.length; j += 1) {
          const a = base[i];
          const c = base[j];
          if (a.locked && c.locked) continue;
          const dx = c.x - a.x;
          const overlap = (a.r + c.r) * 0.9 - Math.abs(dx);
          if (overlap <= 0 || Math.abs(c.y - a.y) > Math.min(a.r, c.r)) continue;
          const dir = dx === 0 ? (rnd() < 0.5 ? -1 : 1) : Math.sign(dx);
          const step = overlap * Math.min(1, 8 * dt);
          if (a.locked) c.x += dir * step;
          else if (c.locked) a.x -= dir * step;
          else {
            a.x -= (dir * step) / 2;
            c.x += (dir * step) / 2;
          }
          moved = true;
        }
      }
    }

    function stepRoll(dt) {
      const ball = roll.ball;
      const B = ctx.bounds();
      const maxR = roll.ammo ? ammoRange(scaleNow()).max : maxRadius(scaleNow());
      const target = clamp(pointer.x, ball.r, Math.max(ball.r, B.width - ball.r));
      const maxStep = 1100 * dt;
      const dx = clamp(target - ball.x, -maxStep, maxStep);
      ball.x += dx;
      ball.rot += dx / Math.max(8, ball.r);
      roll.dist += Math.abs(dx);
      let cuts = 0;
      while (roll.dist >= ROLL_STEP && cuts < 12) {
        roll.dist -= ROLL_STEP;
        cuts += 1;
        if (ball.r >= maxR) continue;
        const half = clamp(ball.r * 0.9, 8, 62);
        const want = GAIN_PER_CUT * sizeFactor(scaleNow()) ** 2;
        const depth = clamp(want / half, 1.5, 14);
        const vol = ctx.snow.removeAround(ball.x, half, depth) || 0;
        if (vol > 0.3) {
          roll.starved = 0;
          ball.taken += vol;
          ball.area += Math.min(vol * AREA_FACTOR, want * 1.3);
          ball.r = Math.min(maxR, areaToRadius(ball.area));
          if (rnd() < 0.5) puff(ball.x - Math.sign(dx || 1) * ball.r * 0.9, restY(ball) + ball.r * 0.7, 1, 90, 90);
        } else {
          roll.starved += 1;
        }
      }
      if (cuts) moved = true;
      ball.y = restY(ball);
      const size = classify(ball.r, scaleNow());
      if (size !== roll.size) {
        if (size !== 'tiny' && !roll.ammo) audio('pop', { volume: 0.5 });
        roll.size = size;
      }
    }

    function stepGrab() {
      const ball = grab.ball;
      const B = ctx.bounds();
      ball.x = clamp(pointer.x - grab.offX, ball.r, Math.max(ball.r, B.width - ball.r));
      ball.y = clamp(pointer.y - grab.offY, ball.r, B.height - ball.r * 0.5);
      snapCand = findSnapTarget(ball, balls, scaleNow());
      moved = true;
    }

    function stepEffects(dt) {
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += (p.type === 'spark' ? 220 : 520) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.max(0, 1 - 2.2 * dt);
      }
      for (let i = floaters.length - 1; i >= 0; i -= 1) {
        const f = floaters[i];
        f.t += dt;
        f.y -= 18 * dt;
        if (f.t >= f.max) floaters.splice(i, 1);
      }
      snowmen.forEach((sm) => {
        if (sm.cel < 1) sm.cel = Math.min(1, sm.cel + dt / 1.1);
        if (sm.cool > 0) sm.cool -= dt;
        if (sm.wobble) {
          sm.wobble.t += dt;
          if (sm.wobble.t > 1.4) sm.wobble = null;
        }
      });
    }

    function stepZone() {
      const B = ctx.bounds();
      let tallest = 0;
      balls.forEach((b) => { tallest = Math.max(tallest, B.height - (b.y - b.r)); });
      const want = Math.min(B.height, Math.max(throwMode ? 360 : 280, tallest + 70, ctx.snow.total() + 160));
      if (Math.abs(want - zoneH) > 1) {
        zoneH = want;
        if (hit) hit.style.height = `${zoneH}px`;
      }
      if (bar) bar.style.bottom = `${Math.round(zoneH + 10)}px`;
    }

    // ---- Throwing snowballs --------------------------------------------------------------

    function setThrow(on) {
      const want = !!on && active;
      if (want === throwMode) return;
      finishInteractions(false);
      if (!want) dissolveAmmo(false);
      hintFlash = null;
      throwMode = want;
      tool = null;
      forceDraw = true;
      updateCursor();
      refreshBar();
    }

    // Pick up an ammo ball from the bank: it follows the pointer until released.
    function startAmmoAim(ball, e) {
      balls = balls.filter((b) => b !== ball);
      ball.falling = false;
      ball.vy = 0;
      ball.kickVx = 0;
      ball.squash = 0;
      aim = { ball, x: ball.x, y: ball.y, r: ball.r, rot: ball.rot, samples: [{ t: e.timeStamp > 0 ? e.timeStamp : performance.now(), x: pointer.x, y: pointer.y }], trail: [], pointerId: e.pointerId };
      hit.setPointerCapture?.(e.pointerId);
      puff(ball.x, ball.y + ball.r * 0.6, 3, 70, 50);
      audio('click', { volume: 0.5 });
    }

    // A held ammo ball that wasn't thrown goes back down onto the snow.
    function dropAmmo(a) {
      const b = a.ball;
      const B = ctx.bounds();
      b.x = clamp(a.x, b.r, Math.max(b.r, B.width - b.r));
      b.y = a.y;
      b.falling = true;
      b.vy = 0;
      b.bounced = false;
      b.ammo = true;
      balls.push(b);
      forceDraw = true;
    }

    function sampleAim(x, y, t) {
      const now = t > 0 ? t : performance.now();
      aim.samples.push({ t: now, x, y });
      while (aim.samples.length > 2 && now - aim.samples[0].t > 130) aim.samples.shift();
    }

    function stepAim(dt) {
      const k = Math.min(1, 28 * dt);
      aim.x += (pointer.x - aim.x) * k;
      aim.y += (pointer.y - aim.y) * k;
      aim.rot += dt * 6;
      aim.ball.x = aim.x;
      aim.ball.y = aim.y;
      aim.ball.rot = aim.rot;
      aim.trail.push({ x: aim.x, y: aim.y });
      if (aim.trail.length > 12) aim.trail.shift();
      moved = true;
    }

    function releaseAim(cancelled) {
      const a = aim;
      aim = null;
      if (cancelled) {
        dropAmmo(a);
        return;
      }
      const v = flickVelocity(a.samples, MAX_THROW);
      if (v.speed < 200) {
        dropAmmo(a);
        return;
      }
      // the ball leaves from where the pointer was released (frame-rate independent)
      const last = a.samples[a.samples.length - 1];
      projectiles.push({
        x: last.x, y: last.y, vx: v.vx, vy: v.vy, r: a.r, rot: a.rot, spin: (rnd() - 0.5) * 12 + v.vx * 0.004, bounces: 0, trail: [], acc: 0,
        age: 0, ball: a.ball, taken: a.ball.taken || 0, power: ammoPower(a.r, scaleNow()),
      });
      audio('whoosh', { volume: clamp(v.speed / 1200, 0.2, 0.9) });
    }

    function standingCircles(sm, ix) {
      const pp = parts(sm, ix);
      if (!pp) return null;
      const out = [{ b: pp.base, part: 'base' }, { b: pp.mid, part: 'mid' }];
      if (!sm.headOff) out.push({ b: pp.head, part: 'head' });
      return out;
    }

    function isLoose(b) {
      return !(roll && roll.ball === b) && !(grab && grab.ball === b) && (!b.snowmanId || b.detached);
    }

    function spawnChunk(x, y, vx, vy, r) {
      if (chunks.length > Math.round(220 * qualityMul())) chunks.shift();
      chunks.push({ x, y, vx, vy, r, rot: rnd() * TAU, spin: (rnd() - 0.5) * 10 });
    }

    function spawnDebris(kind, x, y, vx, vy, size, extra) {
      debris.push({ kind, x, y, vx, vy, size, rot: (rnd() - 0.5) * 1.2, spin: (rnd() - 0.5) * 16, bounces: 0, rest: 0, dir: (extra && extra.dir) || 1 });
    }

    function popDecor(sm, ix, dir) {
      const pp = parts(sm, ix);
      if (!pp) return;
      const d = sm.decor;
      const hr = pp.head.r;
      const toss = (kind, x, y, size, extra) => spawnDebris(kind, x, y, dir * (90 + rnd() * 190) + (rnd() - 0.5) * 90, -(240 + rnd() * 220), size, extra);
      if (d.hat) { toss('hat', pp.head.x, pp.head.y - hr * 0.85, hr); d.hat = false; }
      if (d.scarf) { toss('scarf', (pp.head.x + pp.mid.x) / 2, pp.head.y + hr * 0.92, hr); d.scarf = false; }
      if (d.nose) { toss('nose', pp.head.x + sm.dir * hr * 0.3, pp.head.y + hr * 0.06, hr, { dir: sm.dir }); d.nose = false; }
      if (d.holly) { toss('holly', pp.head.x + hr * 0.45, pp.head.y - hr * 0.95, hr); d.holly = false; }
      if (d.candy) { toss('candy', pp.base.x + pp.base.r * 1.2, pp.base.y, pp.base.r); d.candy = false; }
      refreshBar();
    }

    function knockHead(sm, ix, dir, pw) {
      const pp = parts(sm, ix);
      if (!pp) return;
      const { head, mid } = pp;
      mid.topId = null;
      head.supportId = null;
      head.falling = true;
      head.vy = -320 * (0.7 + 0.3 * pw);
      head.bounced = false;
      head.kickVx = dir * (260 + rnd() * 140) * (0.65 + 0.35 * pw);
      head.detached = true;
      sm.headOff = true;
      popDecor(sm, ix, dir);
      puff(head.x, head.y, 10, 220, 120);
      audio('pop', { volume: 0.8 });
    }

    function breakSnowman(sm, ix, dir, pw) {
      const kick = 0.75 + 0.25 * (pw || 1);
      const pp = parts(sm, ix);
      if (pp) {
        [pp.base, pp.mid, pp.head].forEach((b) => {
          const n = chunkCount(b.r);
          for (let i = 0; i < n; i += 1) {
            const a = rnd() * TAU;
            const dist = rnd() * b.r * 0.8;
            const sp = (120 + rnd() * 200) * kick;
            spawnChunk(b.x + Math.cos(a) * dist, b.y + Math.sin(a) * dist, Math.cos(a) * sp + dir * 80, Math.sin(a) * sp - 180, 3 + rnd() * (b.r * 0.12 + 3));
          }
          sparkBurst(b.x, b.y, 8);
          puff(b.x, b.y, 12, 280, 130);
        });
        const d = sm.decor;
        const coal = (n, x, y, spread) => {
          for (let i = 0; i < n; i += 1) spawnDebris('coal', x + (rnd() - 0.5) * spread, y, (rnd() - 0.5) * 260, -(180 + rnd() * 200), pp.head.r);
        };
        if (d.eyes) coal(2, pp.head.x, pp.head.y, pp.head.r * 0.7);
        if (d.smile) coal(3, pp.head.x, pp.head.y + pp.head.r * 0.3, pp.head.r * 0.8);
        if (d.buttons) coal(3, pp.mid.x, pp.mid.y, pp.mid.r * 0.4);
        if (d.arms) [-1, 1].forEach((sg) => spawnDebris('stick', pp.mid.x + sg * pp.mid.r, pp.mid.y - pp.mid.r * 0.3, sg * (80 + rnd() * 120), -(200 + rnd() * 150), pp.mid.r));
        popDecor(sm, ix, dir);
      }
      audio('pop', { volume: 1 });
      sparkBurst(pp ? pp.mid.x : 0, pp ? pp.mid.y : 0, 18);
      const doomed = new Set(sm.ballIds);
      balls = balls.filter((b) => !doomed.has(b.id));
      snowmen = snowmen.filter((s) => s.id !== sm.id);
      smashed += 1;
      if (selectedId === sm.id) selectedId = snowmen.length ? snowmen[snowmen.length - 1].id : null;
      emit('snowman:removed', { id: sm.id, broken: true });
      forceDraw = true;
      refreshBar();
    }

    function damageSnowman(sm, proj, contactX, contactY) {
      if (sm.cool > 0) return;
      sm.cool = 0.3;
      const ix = index();
      const dir = Math.sign(proj.vx) || 1;
      const pw = proj.power || 1;
      const step = advanceDamage(sm.damage);
      sm.damage = step.stage;
      puff(contactX, contactY, 9, 220, 110);
      audio('thud', { volume: 0.8 });
      if (step.effect === 'wobble') {
        sm.wobble = { t: 0, amp: 0.11 * (0.65 + 0.35 * pw), dir };
        popDecor(sm, ix, dir);
      } else if (step.effect === 'head') {
        sm.wobble = { t: 0, amp: 0.16 * (0.65 + 0.35 * pw), dir };
        knockHead(sm, ix, dir, pw);
      } else {
        breakSnowman(sm, ix, dir, pw);
      }
    }

    // A loose (or unfinished) ball takes a hit: it rolls, and anything stacked on it tumbles.
    function kickBall(b, proj) {
      const ix = index();
      const dir = Math.sign(proj.vx) || 1;
      if (b.supportId && ix[b.supportId]) {
        ix[b.supportId].topId = null;
        b.supportId = null;
        b.falling = true;
        b.vy = -180;
        b.bounced = false;
      }
      if (b.topId && ix[b.topId]) {
        const top = ix[b.topId];
        top.supportId = null;
        top.falling = true;
        top.vy = -220;
        top.bounced = false;
        top.kickVx = dir * (120 + rnd() * 100);
        b.topId = null;
      }
      b.kickVx = clamp(proj.vx * 0.45 * (proj.power || 1), -420, 420) || dir * 160;
      puff(proj.x, proj.y, 6, 180, 90);
      audio('thud', { volume: 0.5 });
    }

    function stepProjectiles(dt, ix) {
      if (!projectiles.length) return;
      const B = ctx.bounds();
      for (let i = projectiles.length - 1; i >= 0; i -= 1) {
        const p = projectiles[i];
        const steps = Math.max(1, Math.ceil((Math.max(Math.abs(p.vx), Math.abs(p.vy)) * dt) / 8));
        const sdt = dt / steps;
        let dead = false;
        for (let s = 0; s < steps && !dead; s += 1) {
          p.vy += THROW_GRAVITY * sdt;
          p.x += p.vx * sdt;
          p.y += p.vy * sdt;
          p.rot += p.spin * sdt;
          p.acc += Math.hypot(p.vx, p.vy) * sdt;
          p.age += sdt;

          for (const sm of snowmen) {
            if (sm.damage >= 3) continue;
            const circles = standingCircles(sm, ix);
            if (!circles) continue;
            const idx = projectileHit(p, circles.map((c) => c.b));
            if (idx < 0) continue;
            const b = circles[idx].b;
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const len = Math.hypot(dx, dy) || 1;
            damageSnowman(sm, p, b.x + (dx / len) * b.r, b.y + (dy / len) * b.r);
            dead = true;
            break;
          }
          if (!dead && p.age > 0.1) {
            const loose = balls.filter(isLoose);
            const idx = projectileHit(p, loose);
            if (idx >= 0) {
              kickBall(loose[idx], p);
              dead = true;
            }
          }
          if (dead) break;

          if (p.vy > 0 && p.y + p.r >= ctx.snow.surfaceY(p.x)) {
            if (p.bounces === 0 && Math.hypot(p.vx, p.vy) > 260) {
              p.y = ctx.snow.surfaceY(p.x) - p.r;
              p.vy = -p.vy * 0.4;
              p.vx *= 0.7;
              p.spin *= 0.6;
              p.bounces += 1;
              puff(p.x, p.y + p.r, 5, 130, 70);
              audio('thud', { volume: 0.3 });
            } else {
              puff(p.x, p.y, 8, 200, 100);
              sparkBurst(p.x, p.y, 3);
              audio('pop', { volume: 0.5 });
              dead = true;
            }
          } else if (p.x < -40 || p.x > B.width + 40 || p.y > B.height + 40) {
            puff(clamp(p.x, 0, B.width), clamp(p.y, 0, B.height), 6, 160, 80);
            dead = true;
          }
        }
        if (dead) {
          // whatever the ball did, the snow it carried goes back into the bank
          returnSnow(clamp(p.x, 0, B.width), p.taken);
          projectiles.splice(i, 1);
          continue;
        }
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 9) p.trail.shift();
        if (p.acc > 16) {
          p.acc = 0;
          puff(p.x, p.y, 1, 30, 20);
        }
      }
      moved = true;
    }

    function stepDebris(dt) {
      for (let i = debris.length - 1; i >= 0; i -= 1) {
        const d = debris[i];
        d.vy += THROW_GRAVITY * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.spin * dt;
        const floor = ctx.snow.surfaceY(d.x) - d.size * 0.1;
        if (d.y >= floor && d.vy > 0) {
          d.y = floor;
          if (Math.abs(d.vy) > 150 && d.bounces < 2) {
            d.vy = -d.vy * 0.35;
            d.vx *= 0.6;
            d.spin *= 0.55;
            d.bounces += 1;
          } else {
            d.vy = 0;
            d.vx *= Math.exp(-6 * dt);
            d.spin *= Math.exp(-6 * dt);
            d.rest += dt;
          }
        }
        if (d.rest > 1.9 || d.x < -60 || d.x > ctx.bounds().width + 60) debris.splice(i, 1);
      }
    }

    function stepChunks(dt) {
      for (let i = chunks.length - 1; i >= 0; i -= 1) {
        const c = chunks[i];
        c.vy += 1000 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.spin * dt;
        if (c.y + c.r * 0.4 >= ctx.snow.surfaceY(c.x)) {
          ctx.snow.addAt(c.x, Math.max(0.8, c.r * 0.45));
          puff(c.x, c.y, 2, 80, 50);
          chunks.splice(i, 1);
        } else if (c.y > ctx.bounds().height + 60) {
          chunks.splice(i, 1);
        }
      }
    }

    function drawDebrisPiece(g2, d) {
      const s = d.size;
      const fade = d.rest > 1.2 ? clamp(1 - (d.rest - 1.2) / 0.7, 0, 1) : 1;
      g2.save();
      g2.globalAlpha = fade;
      g2.translate(d.x, d.y);
      g2.rotate(d.rot);
      if (d.kind === 'hat') {
        g2.fillStyle = '#26232f';
        g2.beginPath();
        g2.ellipse(0, 0, s * 0.98, s * 0.2, 0, 0, TAU);
        g2.fill();
        g2.fillRect(-s * 0.6, -s * 0.98, s * 1.2, s * 0.98);
        g2.fillStyle = '#d8344b';
        g2.fillRect(-s * 0.6, -s * 0.34, s * 1.2, s * 0.2);
        g2.fillStyle = '#34303f';
        g2.beginPath();
        g2.ellipse(0, -s * 0.98, s * 0.6, s * 0.14, 0, 0, TAU);
        g2.fill();
      } else if (d.kind === 'scarf') {
        g2.fillStyle = '#d8344b';
        g2.fillRect(-s * 0.95, -s * 0.15, s * 1.9, s * 0.3);
        g2.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = -4; i <= 4; i += 2) g2.fillRect(i * s * 0.2 - 1, -s * 0.15, Math.max(2, s * 0.05), s * 0.3);
      } else if (d.kind === 'nose') {
        g2.fillStyle = '#ff8a2a';
        g2.beginPath();
        g2.moveTo(0, -s * 0.11);
        g2.lineTo(d.dir * s * 0.66, s * 0.04);
        g2.lineTo(0, s * 0.11);
        g2.closePath();
        g2.fill();
      } else if (d.kind === 'holly') {
        const lr = Math.max(4, s * 0.26);
        g2.fillStyle = '#2f9d57';
        [-0.7, 0.7].forEach((a) => {
          g2.save();
          g2.rotate(a);
          g2.beginPath();
          g2.ellipse(lr * 0.7, 0, lr, lr * 0.42, 0, 0, TAU);
          g2.fill();
          g2.restore();
        });
        dot(g2, 0, 0, lr * 0.3, '#d8344b');
        dot(g2, lr * 0.5, lr * 0.2, lr * 0.28, '#d8344b');
      } else if (d.kind === 'candy') {
        const h = s * 0.95;
        const w = Math.max(3, s * 0.1);
        const path = () => {
          g2.beginPath();
          g2.moveTo(0, h / 2);
          g2.lineTo(0, -h / 2);
          g2.arc(-h * 0.2, -h / 2, h * 0.2, 0, -Math.PI, true);
        };
        g2.lineCap = 'butt';
        path();
        g2.strokeStyle = '#ffffff';
        g2.lineWidth = w;
        g2.stroke();
        path();
        g2.strokeStyle = '#d8344b';
        g2.setLineDash([w * 0.9, w * 0.9]);
        g2.stroke();
      } else if (d.kind === 'stick') {
        g2.strokeStyle = '#6b4a2b';
        g2.lineCap = 'round';
        g2.lineWidth = Math.max(2.5, s * 0.09);
        g2.beginPath();
        g2.moveTo(-s * 0.45, 0);
        g2.lineTo(s * 0.45, 0);
        g2.moveTo(s * 0.1, 0);
        g2.lineTo(s * 0.28, -s * 0.2);
        g2.stroke();
      } else {
        dot(g2, 0, 0, Math.max(2.5, s * 0.1), '#2b2b36');
        dot(g2, -s * 0.03, -s * 0.03, Math.max(0.8, s * 0.025), 'rgba(255,255,255,0.7)');
      }
      g2.restore();
    }

    function drawThrowing(g2) {
      debris.forEach((d) => drawDebrisPiece(g2, d));
      chunks.forEach((c) => {
        g2.save();
        g2.translate(c.x, c.y);
        g2.rotate(c.rot);
        const gr = g2.createRadialGradient(-c.r * 0.3, -c.r * 0.3, c.r * 0.1, 0, 0, c.r);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.7, '#eef5fd');
        gr.addColorStop(1, '#d3e2f4');
        g2.fillStyle = gr;
        g2.beginPath();
        g2.arc(0, 0, c.r, 0, TAU);
        g2.arc(c.r * 0.6, c.r * 0.15, c.r * 0.62, 0, TAU);
        g2.arc(-c.r * 0.45, c.r * 0.4, c.r * 0.5, 0, TAU);
        g2.fill();
        g2.restore();
      });
      projectiles.forEach((p) => {
        p.trail.forEach((t, i) => {
          g2.fillStyle = `rgba(255,255,255,${((i + 1) / p.trail.length * 0.5).toFixed(3)})`;
          g2.beginPath();
          g2.arc(t.x, t.y, p.r * 0.5 * ((i + 1) / p.trail.length), 0, TAU);
          g2.fill();
        });
        p.ball.x = p.x;
        p.ball.y = p.y;
        p.ball.rot = p.rot;
        drawBall(g2, p.ball, { noRing: true });
      });
      if (aim) {
        aim.trail.forEach((t, i) => {
          g2.fillStyle = `rgba(255,255,255,${((i + 1) / aim.trail.length * 0.45).toFixed(3)})`;
          g2.beginPath();
          g2.arc(t.x, t.y, aim.r * 0.55 * ((i + 1) / aim.trail.length), 0, TAU);
          g2.fill();
        });
        const v = flickVelocity(aim.samples, MAX_THROW);
        if (v.speed > 200) {
          g2.fillStyle = 'rgba(255,255,255,0.7)';
          let px = aim.x;
          let py = aim.y;
          let vx = v.vx;
          let vy = v.vy;
          for (let i = 0; i < 9; i += 1) {
            vy += THROW_GRAVITY * 0.06;
            px += vx * 0.06;
            py += vy * 0.06;
            g2.beginPath();
            g2.arc(px, py, 2.2 - i * 0.15, 0, TAU);
            g2.fill();
          }
        }
        drawBall(g2, aim.ball, { noRing: true });
      }
    }

    // ---- Drawing --------------------------------------------------------------------------------

    function surfacePath(g2, x0, x1, topY, inset) {
      g2.beginPath();
      g2.moveTo(x0, topY);
      g2.lineTo(x1, topY);
      for (let x = x1; x >= x0; x -= 4) g2.lineTo(x, ctx.snow.surfaceY(x) + inset);
      g2.closePath();
    }

    function drawBall(g2, b, opts) {
      const o = opts || {};
      const r = b.r;
      g2.save();
      if (o.clipToSnow) {
        surfacePath(g2, b.x - r - 6, b.x + r + 6, b.y - r - 8, 3);
        g2.clip();
      }
      g2.translate(b.x, b.y);
      const sq = b.squash || 0;
      if (sq) g2.scale(1 + sq * 0.6, 1 - sq);
      const grad = g2.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.6, '#f7fbff');
      grad.addColorStop(0.9, '#e0ebf8');
      grad.addColorStop(1, '#c6d8ee');
      g2.beginPath();
      g2.arc(0, 0, r, 0, TAU);
      g2.fillStyle = grad;
      g2.fill();

      g2.save();
      g2.clip();
      g2.rotate(b.rot);
      b.patches.forEach((p) => {
        if (p.speck) g2.fillStyle = p.light ? 'rgba(255,255,255,0.95)' : 'rgba(140,168,210,0.38)';
        else g2.fillStyle = p.light ? 'rgba(255,255,255,0.7)' : 'rgba(150,180,222,0.22)';
        g2.beginPath();
        g2.ellipse(p.x * r, p.y * r, p.r * r, p.r * r * (p.speck ? 1 : 0.7), p.a, 0, TAU);
        g2.fill();
      });
      g2.restore();

      const sh = g2.createRadialGradient(0, r * 0.12, r * 0.5, 0, r * 0.12, r * 1.05);
      sh.addColorStop(0, 'rgba(110,140,195,0)');
      sh.addColorStop(1, 'rgba(110,140,195,0.3)');
      g2.beginPath();
      g2.arc(0, 0, r, 0, TAU);
      g2.fillStyle = sh;
      g2.fill();

      g2.lineCap = 'round';
      g2.beginPath();
      g2.arc(0, 0, r * 0.82, Math.PI * 1.05, Math.PI * 1.45);
      g2.strokeStyle = 'rgba(255,255,255,0.55)';
      g2.lineWidth = Math.max(1.5, r * 0.06);
      g2.stroke();
      g2.fillStyle = 'rgba(255,255,255,0.8)';
      g2.beginPath();
      g2.ellipse(-r * 0.42, -r * 0.5, r * 0.08, r * 0.045, -0.7, 0, TAU);
      g2.fill();
      g2.beginPath();
      g2.arc(0, 0, r - 0.5, 0, TAU);
      g2.strokeStyle = 'rgba(130,160,205,0.42)';
      g2.lineWidth = 1;
      g2.stroke();
      if (b.ammo && !o.noRing) {
        g2.setLineDash([4, 4]);
        g2.lineDashOffset = reduced() ? 0 : -time * 10;
        g2.strokeStyle = 'rgba(70,130,230,0.9)';
        g2.lineWidth = 2;
        g2.beginPath();
        g2.arc(0, 0, r + 4, 0, TAU);
        g2.stroke();
      }
      g2.restore();
    }

    function drawAmbient(g2, lower, upper) {
      g2.save();
      g2.beginPath();
      g2.arc(lower.x, lower.y, lower.r, 0, TAU);
      g2.clip();
      const gr = g2.createRadialGradient(upper.x, upper.y + upper.r * 0.7, upper.r * 0.2, upper.x, upper.y + upper.r * 0.7, upper.r * 1.5);
      gr.addColorStop(0, 'rgba(85,110,165,0.4)');
      gr.addColorStop(1, 'rgba(85,110,165,0)');
      g2.fillStyle = gr;
      g2.fillRect(lower.x - lower.r, lower.y - lower.r, lower.r * 2, lower.r * 2);
      g2.restore();
    }

    function drawShadow(g2, b) {
      const sy = ctx.snow.surfaceY(b.x);
      g2.save();
      g2.fillStyle = 'rgba(70,95,150,0.22)';
      g2.beginPath();
      g2.ellipse(b.x + b.r * 0.12, sy + 2, b.r * 0.95, Math.max(3, b.r * 0.16), 0, 0, TAU);
      g2.fill();
      g2.restore();
    }

    function dot(g2, x, y, r, color) {
      g2.fillStyle = color;
      g2.beginPath();
      g2.arc(x, y, r, 0, TAU);
      g2.fill();
    }

    function drawDecor(g2, sm, p, opts) {
      const headOnly = !!(opts && opts.headOnly);
      const skipHead = !!(opts && opts.skipHead);
      const d = sm.decor;
      const { base, mid, head } = p;
      const dir = Math.abs(sm.look) > 0.25 ? Math.sign(sm.look) : sm.dir;
      const hr = head.r;
      const mr = mid.r;
      const fx = head.x + sm.look * hr * 0.28;
      const sway = Math.sin(time * 1.6 + sm.phase);
      const coal = '#2b2b36';

      if (d.arms && !headOnly) {
        const wave = sm.cel < 1 ? Math.sin(time * 14) * 0.18 * (1 - sm.cel) : sway * 0.05;
        g2.strokeStyle = '#6b4a2b';
        g2.lineCap = 'round';
        g2.lineWidth = Math.max(2.5, mr * 0.09);
        [-1, 1].forEach((sg) => {
          const sx = mid.x + sg * mr * 0.9;
          const sy = mid.y - mr * 0.1;
          const ang = (sg < 0 ? -2.45 : -0.7) + (sg > 0 ? wave : -wave * 0.4);
          const len = mr * 1.0;
          const ex = sx + Math.cos(ang) * len;
          const ey = sy + Math.sin(ang) * len;
          g2.beginPath();
          g2.moveTo(sx, sy);
          g2.lineTo(ex, ey);
          g2.stroke();
          g2.lineWidth = Math.max(1.8, mr * 0.06);
          [0.55, 0.8].forEach((t, i) => {
            const bx = sx + Math.cos(ang) * len * t;
            const by = sy + Math.sin(ang) * len * t;
            const ta = ang + (i === 0 ? 0.7 : -0.7) * (sg < 0 ? 1 : -1);
            g2.beginPath();
            g2.moveTo(bx, by);
            g2.lineTo(bx + Math.cos(ta) * len * 0.26, by + Math.sin(ta) * len * 0.26);
            g2.stroke();
          });
          g2.lineWidth = Math.max(2.5, mr * 0.09);
        });
      }

      if (d.buttons && !headOnly) {
        for (let i = -1; i <= 1; i += 1) {
          const bx = mid.x + sm.look * mr * 0.06;
          const by = mid.y + i * mr * 0.4;
          dot(g2, bx, by, mr * 0.09, coal);
          dot(g2, bx - mr * 0.025, by - mr * 0.03, mr * 0.025, 'rgba(255,255,255,0.7)');
        }
      }

      const neckY = head.y + hr * 0.92;
      const neckX = (head.x + mid.x) / 2;
      let scarfTailX = neckX + hr * 0.62;
      let scarfTailY = neckY + hr * 0.2;
      if (d.scarf && !headOnly) {
        const rx = hr * 0.98;
        const ry = hr * 0.27;
        g2.save();
        g2.lineCap = 'round';
        g2.beginPath();
        g2.ellipse(neckX, neckY, rx, ry, 0, 0.05, Math.PI - 0.05);
        g2.strokeStyle = '#d8344b';
        g2.lineWidth = ry * 1.7;
        g2.stroke();
        g2.strokeStyle = 'rgba(255,255,255,0.85)';
        g2.lineWidth = Math.max(1.5, ry * 0.2);
        for (let i = 0; i < 5; i += 1) {
          const t = 0.18 + i * 0.16;
          const a = Math.PI * t * 1.0 + 0.05;
          g2.beginPath();
          g2.moveTo(neckX + Math.cos(a) * rx, neckY + Math.sin(a) * ry - ry * 0.7);
          g2.lineTo(neckX + Math.cos(a) * rx, neckY + Math.sin(a) * ry + ry * 0.7);
          g2.stroke();
        }
        const tailLen = hr * 1.05;
        const tx = neckX + rx * 0.55;
        const ty = neckY + ry * 0.4;
        const sw = sway * hr * 0.1;
        g2.fillStyle = '#d8344b';
        g2.beginPath();
        g2.moveTo(tx - hr * 0.16, ty);
        g2.lineTo(tx + hr * 0.2, ty);
        g2.lineTo(tx + hr * 0.24 + sw, ty + tailLen);
        g2.lineTo(tx - hr * 0.12 + sw, ty + tailLen);
        g2.closePath();
        g2.fill();
        g2.strokeStyle = 'rgba(255,255,255,0.85)';
        g2.lineWidth = Math.max(1.5, hr * 0.06);
        g2.beginPath();
        g2.moveTo(tx - hr * 0.13 + sw * 0.7, ty + tailLen * 0.72);
        g2.lineTo(tx + hr * 0.22 + sw * 0.7, ty + tailLen * 0.72);
        g2.stroke();
        g2.strokeStyle = '#d8344b';
        g2.lineWidth = Math.max(1.2, hr * 0.045);
        for (let i = 0; i < 4; i += 1) {
          const fx2 = tx - hr * 0.1 + i * hr * 0.11 + sw;
          g2.beginPath();
          g2.moveTo(fx2, ty + tailLen);
          g2.lineTo(fx2 + sw * 0.1, ty + tailLen + hr * 0.12);
          g2.stroke();
        }
        scarfTailX = tx + hr * 0.1 + sw;
        scarfTailY = ty + tailLen * 0.35;
        g2.restore();
      }

      if (d.eyes && !skipHead) {
        const spread = hr * 0.36 * (1 - Math.abs(sm.look) * 0.22);
        [-1, 1].forEach((sg) => {
          const ex = fx + sg * spread;
          const ey = head.y - hr * 0.16;
          dot(g2, ex, ey, hr * 0.115, coal);
          dot(g2, ex - hr * 0.035, ey - hr * 0.04, hr * 0.032, 'rgba(255,255,255,0.85)');
        });
      }
      if (d.smile && !skipHead) {
        for (let i = 0; i < 5; i += 1) {
          const t = i / 4;
          const sx = fx + (t - 0.5) * hr * 0.9;
          const sy = head.y + hr * 0.3 + Math.sin(t * Math.PI) * hr * 0.17;
          dot(g2, sx, sy, hr * 0.062, coal);
        }
      }
      if (d.nose && !skipHead) {
        const nx = fx + dir * hr * 0.06;
        const ny = head.y + hr * 0.06;
        const len = hr * 0.66;
        g2.fillStyle = '#ff8a2a';
        g2.beginPath();
        g2.moveTo(nx, ny - hr * 0.11);
        g2.lineTo(nx + dir * len, ny + hr * 0.06);
        g2.lineTo(nx, ny + hr * 0.11);
        g2.closePath();
        g2.fill();
        g2.strokeStyle = 'rgba(190,80,10,0.7)';
        g2.lineWidth = Math.max(1, hr * 0.03);
        [0.3, 0.55].forEach((t) => {
          g2.beginPath();
          g2.moveTo(nx + dir * len * t, ny - hr * 0.085 + t * hr * 0.1);
          g2.lineTo(nx + dir * len * t, ny + hr * 0.085 + t * 0.02 * hr);
          g2.stroke();
        });
      }

      let hatBandX = head.x + hr * 0.5;
      let hatBandY = head.y - hr * 0.95;
      if (d.hat && !skipHead) {
        g2.save();
        g2.translate(head.x, head.y - hr * 0.8);
        g2.rotate(-0.1 * dir);
        g2.fillStyle = '#26232f';
        g2.beginPath();
        g2.ellipse(0, 0, hr * 0.98, hr * 0.2, 0, 0, TAU);
        g2.fill();
        g2.fillRect(-hr * 0.6, -hr * 0.98, hr * 1.2, hr * 0.98);
        g2.fillStyle = '#d8344b';
        g2.fillRect(-hr * 0.6, -hr * 0.34, hr * 1.2, hr * 0.2);
        g2.fillStyle = '#34303f';
        g2.beginPath();
        g2.ellipse(0, -hr * 0.98, hr * 0.6, hr * 0.14, 0, 0, TAU);
        g2.fill();
        g2.fillStyle = 'rgba(255,255,255,0.18)';
        g2.fillRect(-hr * 0.46, -hr * 0.9, hr * 0.12, hr * 0.8);
        g2.restore();
        hatBandX = head.x + Math.cos(-0.1 * dir) * hr * 0.42 - Math.sin(-0.1 * dir) * 0;
        hatBandY = head.y - hr * 0.8 - hr * 0.24;
      }
      if (d.holly && !skipHead) {
        const hx = d.hat ? hatBandX : scarfTailX;
        const hy = d.hat ? hatBandY : scarfTailY;
        const lr = Math.max(4, hr * 0.26);
        g2.fillStyle = '#2f9d57';
        [-0.7, 0.7].forEach((a) => {
          g2.save();
          g2.translate(hx, hy);
          g2.rotate(a);
          g2.beginPath();
          g2.ellipse(lr * 0.7, 0, lr, lr * 0.42, 0, 0, TAU);
          g2.fill();
          g2.restore();
        });
        [[-0.1, 0], [0.12, 0.08], [0.02, -0.12]].forEach(([ox, oy]) => {
          dot(g2, hx + ox * lr * 2, hy + oy * lr * 2, lr * 0.3, '#d8344b');
        });
      }
      if (d.candy && !headOnly) {
        const cx = base.x + base.r * 1.2;
        const gy = ctx.snow.surfaceY(cx) + 3;
        const h = base.r * 0.95;
        const w = Math.max(3, base.r * 0.1);
        const path = () => {
          g2.beginPath();
          g2.moveTo(cx, gy);
          g2.lineTo(cx, gy - h);
          g2.arc(cx - h * 0.2, gy - h, h * 0.2, 0, -Math.PI, true);
        };
        g2.save();
        g2.lineCap = 'butt';
        path();
        g2.strokeStyle = '#ffffff';
        g2.lineWidth = w;
        g2.stroke();
        path();
        g2.strokeStyle = '#d8344b';
        g2.setLineDash([w * 0.9, w * 0.9]);
        g2.stroke();
        g2.restore();
      }
    }

    function drawStack(g2, root, ix) {
      const stack = stackOf(root, ix);
      const sm = root.snowmanId ? snowmanById(root.snowmanId) : null;
      const isHead = !!(sm && sm.headOff && root.id === sm.ballIds[2]);
      g2.save();
      if (sm && sm.wobble && !isHead && root.id === sm.ballIds[0]) {
        const w = sm.wobble;
        const k = reduced() ? 0.4 : 1;
        const decay = Math.exp(-w.t * 4.5);
        const ang = w.dir * w.amp * Math.sin(w.t * 20) * decay * k;
        const sq = Math.sin(w.t * 28) * 0.06 * decay * (w.amp / 0.12) * k;
        const gy = root.y + root.r * 0.82;
        g2.translate(root.x, gy);
        g2.rotate(ang);
        g2.scale(1 + sq, 1 - sq);
        g2.translate(-root.x, -gy);
      }
      if (sm && sm.cel < 1 && !reduced()) {
        const t = sm.cel;
        const bounce = -Math.abs(Math.sin(t * Math.PI * 3)) * 11 * (1 - t);
        const sq = Math.sin(t * Math.PI * 6) * 0.05 * (1 - t);
        const gy = root.y + root.r * 0.82;
        g2.translate(root.x, gy);
        g2.scale(1 + sq, 1 - sq);
        g2.translate(-root.x, -gy + bounce);
      }
      drawShadow(g2, root);
      stack.forEach((b, i) => {
        if (i > 0) drawAmbient(g2, stack[i - 1], b);
        drawBall(g2, b, { clipToSnow: i === 0 });
      });
      if (sm) {
        const p = parts(sm, ix);
        if (p) {
          const targetLook = pointer.inside || active ? clamp((pointer.x - p.head.x) / 260, -1, 1) : 0;
          sm.look += (targetLook - sm.look) * 0.08;
          if (isHead) drawDecor(g2, sm, p, { headOnly: true });
          else drawDecor(g2, sm, p, { skipHead: sm.headOff });
        }
        if (active && !isHead && !sm.headOff && selectedId === sm.id) {
          g2.strokeStyle = 'rgba(216,52,75,0.32)';
          g2.lineWidth = 1.5;
          g2.setLineDash([4, 6]);
          g2.beginPath();
          g2.arc(root.x, root.y - root.r * 0.2, root.r * 1.18, 0, TAU);
          g2.stroke();
          g2.setLineDash([]);
        }
      }
      g2.restore();
    }

    function drawSpark(g2, p, a) {
      g2.save();
      g2.globalAlpha = a;
      g2.translate(p.x, p.y);
      g2.rotate(p.life * 3);
      g2.fillStyle = p.color;
      const s = p.size;
      g2.beginPath();
      g2.moveTo(0, -s);
      g2.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
      g2.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
      g2.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
      g2.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
      g2.fill();
      g2.restore();
    }

    function pill(g2, x, y, text, bg, fg) {
      g2.font = '700 11.5px -apple-system, "Segoe UI", Roboto, sans-serif';
      const w = g2.measureText(text).width + 16;
      g2.save();
      g2.shadowColor = 'rgba(20,40,80,0.25)';
      g2.shadowBlur = 8;
      g2.fillStyle = bg;
      g2.beginPath();
      if (g2.roundRect) g2.roundRect(x - w / 2, y - 11, w, 22, 11);
      else g2.rect(x - w / 2, y - 11, w, 22);
      g2.fill();
      g2.restore();
      g2.fillStyle = fg;
      g2.textAlign = 'center';
      g2.textBaseline = 'middle';
      g2.fillText(text, x, y + 0.5);
    }

    function draw() {
      const g2 = layer.g;
      const B = ctx.bounds();
      g2.clearRect(0, 0, B.width, B.height);
      const ix = index();
      const roots = balls.filter((b) => !b.supportId && !(roll && roll.ball === b) && !(grab && grab.ball === b));
      roots.sort((a, b) => a.y - b.y);
      roots.forEach((root) => drawStack(g2, root, ix));

      if (roll) {
        drawShadow(g2, roll.ball);
        drawBall(g2, roll.ball, { clipToSnow: true });
        const size = classify(roll.ball.r, scaleNow());
        const atMax = roll.ball.r >= (roll.ammo ? ammoRange(scaleNow()).max : maxRadius(scaleNow())) - 0.2;
        let label = size === 'tiny' ? 'Tiny' : `${size[0].toUpperCase()}${size.slice(1)}${atMax ? ' (max)' : ''}`;
        if (roll.ammo) label = atMax ? 'Ammo (full)' : 'Ammo';
        pill(g2, roll.ball.x, roll.ball.y - roll.ball.r - 18, label, 'rgba(255,255,255,0.94)', '#23314d');
      }
      if (grab) {
        if (snapCand) {
          const spot = snapSpot(snapCand, grab.ball.r);
          g2.save();
          g2.strokeStyle = 'rgba(47,191,113,0.9)';
          g2.lineWidth = 2.5;
          g2.setLineDash([7, 5]);
          g2.beginPath();
          g2.arc(spot.x, spot.y, grab.ball.r, 0, TAU);
          g2.stroke();
          g2.restore();
        }
        drawBall(g2, grab.ball, {});
      }

      drawThrowing(g2);

      particles.forEach((p) => {
        const a = 1 - p.life / p.max;
        if (p.type === 'spark') drawSpark(g2, p, Math.min(1, a * 1.6));
        else {
          g2.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(3)})`;
          g2.beginPath();
          g2.arc(p.x, p.y, p.size * (0.6 + a * 0.4), 0, TAU);
          g2.fill();
        }
      });

      removeSpots = [];
      if (active) {
        snowmen.forEach((sm) => {
          const sp = removeSpot(sm, ix);
          if (!sp) return;
          removeSpots.push(sp);
          g2.save();
          g2.shadowColor = 'rgba(20,40,80,0.3)';
          g2.shadowBlur = 6;
          g2.fillStyle = '#ffffff';
          g2.beginPath();
          g2.arc(sp.x, sp.y, 10, 0, TAU);
          g2.fill();
          g2.restore();
          g2.strokeStyle = '#d8344b';
          g2.lineWidth = 2;
          g2.lineCap = 'round';
          g2.beginPath();
          g2.moveTo(sp.x - 3.5, sp.y - 3.5);
          g2.lineTo(sp.x + 3.5, sp.y + 3.5);
          g2.moveTo(sp.x + 3.5, sp.y - 3.5);
          g2.lineTo(sp.x - 3.5, sp.y + 3.5);
          g2.stroke();
        });

        if (pointer.inside && !roll && !grab && !aim) {
          const hover = throwMode ? ammoAt(pointer.x, pointer.y) : ballAt(pointer.x, pointer.y);
          g2.save();
          g2.strokeStyle = 'rgba(255,255,255,0.95)';
          g2.lineWidth = 2;
          if (hover) {
            if (!hover.locked && !hover.topId) {
              g2.setLineDash([5, 4]);
              g2.beginPath();
              g2.arc(hover.x, hover.y, hover.r + 5, 0, TAU);
              g2.stroke();
            } else if (hover.locked && tool) {
              g2.strokeStyle = 'rgba(216,52,75,0.7)';
              g2.beginPath();
              g2.arc(hover.x, hover.y, hover.r + 5, 0, TAU);
              g2.stroke();
            }
          } else if (pointer.y >= ctx.snow.surfaceY(pointer.x) - 26 && ctx.snow.heightAt(pointer.x) > 1.5) {
            const sy = ctx.snow.surfaceY(pointer.x);
            const pulse = reduced() ? 0 : Math.sin(time * 4) * 1.5;
            g2.strokeStyle = 'rgba(120,170,235,0.95)';
            g2.shadowColor = 'rgba(255,255,255,0.9)';
            g2.shadowBlur = 6;
            g2.beginPath();
            g2.ellipse(pointer.x, sy + 1, 17 + pulse, 6 + pulse * 0.3, 0, 0, TAU);
            g2.stroke();
            g2.shadowBlur = 0;
            g2.fillStyle = 'rgba(255,255,255,0.95)';
            g2.font = '14px sans-serif';
            g2.textAlign = 'center';
            g2.fillText('❄', pointer.x, sy - 9);
          }
          g2.restore();
        }
      }

      floaters.forEach((f) => {
        const a = Math.min(1, (1 - f.t / f.max) * 2);
        g2.save();
        g2.globalAlpha = a;
        pill(g2, f.x, f.y, f.text, 'rgba(35,49,77,0.9)', '#ffffff');
        g2.restore();
      });
      drewContent = true;
    }

    // ---- Public API ---------------------------------------------------------------------------------

    function update(dt) {
      if (!enabled || disposed) return;
      time += dt;
      moved = false;
      const ix = index();
      stepPhysics(dt, ix);
      if (roll) stepRoll(dt);
      if (grab) stepGrab();
      if (aim) stepAim(dt);
      stepProjectiles(dt, ix);
      stepDebris(dt);
      stepChunks(dt);
      stepEffects(dt);
      stepReturns(dt);
      if (hintFlash) {
        hintFlash.t -= dt;
        if (hintFlash.t <= 0) {
          hintFlash = null;
          refreshBar();
        }
      }
      if (active) stepZone();

      barTimer -= dt;
      if (barTimer <= 0 && barRefs) {
        barTimer = 0.2;
        refreshBar();
      }

      const busy = projectiles.length > 0 || chunks.length > 0 || debris.length > 0 || !!aim;
      const animating = moved || busy || particles.length > 0 || floaters.length > 0 || active || snowmen.some((s) => s.cel < 1 || s.wobble);
      if (animating || forceDraw) {
        forceDraw = false;
        if (balls.length || busy || particles.length || floaters.length || drewContent) draw();
        if (!balls.length && !busy && !particles.length && !floaters.length) drewContent = false;
      }
    }

    function setEnabled(on) {
      if (on === enabled) return;
      if (!on) {
        setActive(false);
        enabled = false;
        layer.canvas.style.display = 'none';
        layer.clear();
      } else {
        enabled = settings().snowman !== false || on;
        layer.canvas.style.display = '';
        forceDraw = true;
      }
    }

    function applySettings() {
      const on = settings().snowman !== false;
      if (on !== enabled) setEnabled(on);
    }

    function list() {
      const ix = index();
      const out = [];
      snowmen.forEach((sm) => {
        const p = parts(sm, ix);
        if (p) out.push({ id: sm.id, x: p.base.x, y: p.base.y + p.base.r * 0.82, radius: p.base.r, complete: !sm.headOff });
      });
      balls.forEach((b) => {
        if (b.supportId || b.locked || !b.topId) return;
        out.push({ id: `stack-${b.id}`, x: b.x, y: b.y + b.r * 0.82, radius: b.r, complete: false });
      });
      return out;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      finishInteractions(true);
      dissolveAmmo(true);
      clearProjectiles(true);
      flushReturns();
      destroyOverlay();
      active = false;
      balls = [];
      snowmen = [];
      particles = [];
      floaters = [];
      chunks = [];
      debris = [];
      aim = null;
      if (layer) {
        layer.dispose();
        layer = null;
      }
    }

    return {
      update,
      setEnabled,
      applySettings,
      setActive,
      reset,
      removeSnowman,
      list,
      dispose,
      _debug() {
        return {
          zoneH,
          balls: balls.map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r, size: classify(b.r, scaleNow()), supportId: b.supportId, topId: b.topId, locked: b.locked, snowmanId: b.snowmanId, ammo: !!b.ammo, taken: Math.round(b.taken || 0) })),
          snowmen: snowmen.map((s) => ({ id: s.id, decor: { ...s.decor }, ballIds: s.ballIds.slice(), damage: s.damage, headOff: s.headOff })),
          projectiles: projectiles.length,
          projInfo: projectiles.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), vx: Math.round(q.vx), vy: Math.round(q.vy) })),
          debris: debris.length,
          chunks: chunks.length,
          aiming: !!aim,
          ammo: ammoCount(),
          holding: aim ? { r: aim.r, taken: Math.round(aim.ball.taken || 0) } : null,
          returning: Math.round(returns.reduce((s, r) => s + r.left, 0)),
          smashed,
          tool,
          selectedId,
        };
      },
      get active() { return active; },
      get count() { return snowmen.length; },
      get built() { return built; },
      get smashed() { return smashed; },
      get throwMode() { return throwMode; },
      setThrow,
    };
  }

  Christmas.Snowman = {
    create,
    logic: {
      sizeFactor, ranges, maxRadius, classify, radiusToArea, areaToRadius, snapSpot, snapTolerance,
      wantedUnder, canSnap, findSnapTarget, stackOf, stackStage, indexBalls, AREA_FACTOR, STACK_OFFSET,
      projectileHit, advanceDamage, flickVelocity, chunkCount, ammoRange, ammoPower, snowReturnPlan, MAX_AMMO_BALLS, SNOW_UNIT,
    },
  };
})(window);
