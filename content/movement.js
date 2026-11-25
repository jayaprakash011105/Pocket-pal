// Behaviour / animation state machine: decides what the creature is doing
// moment to moment (wander, jump, sleep, dance, climb, corner-hop, perch on a
// page element, peek from an edge, chase, play with other pals...) and drives
// the physics body accordingly. Pure logic, no Three.js.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const { Physics } = PocketPal;
  const { clamp, randomRange, chance, pick, easeInOutSine } = PocketPal.Utils;

  const SPEECH_LINES = {
    idle: ['Hello!', 'Hey, look at me!', "What's up?"],
    play: ["Let's play!", 'Wheee!', 'Tag, you\'re it!'],
    sleepy: ["I'm sleepy...", 'Zzzzz...', 'Just five more minutes...'],
    hungry: ['Feed me!', 'Got any snacks?'],
    wake: ['Good morning!', 'I\'m up, I\'m up!'],
    drag: ['Wheee!', 'Put me down!'],
    scroll: ['Whoa, scrolling!', 'Ooh, what is down there?', 'Wheee, so fast!'],
    page: ['New page!', 'Ooh, where are we now?', 'What did we find?'],
    back: ['Welcome back!', 'I missed you!'],
    hop: ['Off I go!', 'Corner time!', 'Hop hop!'],
    wave: ['Hi there!', 'Hello!', 'Over here!'],
    yawn: ['*yawn*', 'So sleepy...'],
    sneeze: ['Achoo!', '*sneeze*', 'Achoo! Excuse me!'],
    perchHeading: ['Nice heading!', 'I can read this one!', 'Best seat in the house!'],
    perchImage: ['Cute picture!', 'Ooh, pretty!', 'Nice view from here!'],
    perchInput: ['Type something!', 'Search time?', 'Ready when you are!'],
    perchOther: ['Great view up here!', 'Look how high I am!'],
    peek: ['Peekaboo!', 'Can you see me?', 'Hehe!'],
    tag: ['Tag, you\'re it!', 'Got you!', 'Now you chase me!'],
    catch: ['Got it!', 'Caught it!', 'Throw it again!'],
  };

  // The three animation styles. `groundBound` styles glide along the bottom
  // edge of the window and never leave it (no air hovering, climbing or top
  // corners). `hopper` styles get around purely by jumping: every bit of
  // horizontal travel happens in the air, between squashy landings.
  // velEase: how briskly velocity eases toward a target (lower = floatier).
  const STYLE_PROFILES = {
    walk: { allowJump: true, allowSit: false, allowClimb: false, groundBound: true, velEase: 2.2 },
    bounce: { allowJump: true, allowSit: false, allowClimb: false, hopper: true, velEase: 9.5 },
    float: { allowJump: true, allowSit: false, allowClimb: true, velEase: 1.6 },
  };
  const DEFAULT_STYLE_PROFILE = STYLE_PROFILES.walk;

  const MAX_FLOAT_FALL = 160; // px/s: floaters drift down instead of dropping
  const SCROLL_REACT_COOLDOWN = 6; // seconds
  const IDLE_ANIMATIONS = { wave: 1.8, yawn: 2.0, sneeze: 1.0 };
  const NON_WALKING = new Set(['sit', 'look', 'dance', 'react', 'wave', 'yawn', 'sneeze', 'peek']);

  function createBrain(opts) {
    let personality = opts.personality || { speed: 1, jumpiness: 0.5, sleepiness: 0.5, danciness: 0.5 };
    let floats = !!opts.floats;
    let movementStyle = opts.movementStyle || (floats ? 'float' : 'walk');
    const getStyleProfile = () => STYLE_PROFILES[movementStyle] || DEFAULT_STYLE_PROFILE;
    const isHover = () => floats && !getStyleProfile().groundBound;

    const id = opts.id || 'pal';
    const name = opts.name || 'Pal';
    const body = Physics.createBody(opts.x || 100, opts.y || 0);
    let state = 'idle';
    let stateTimer = 0;
    let decisionTimer = randomRange(1.5, 3);
    let idleSeconds = 0;
    let climbPhase = null; // null | 'up-wall' | 'across-ceiling' | 'down-wall'
    let dragging = false;
    let lookTarget = null;
    let onSpeak = null;
    let lastLandedTick = false;
    let hopTween = null; // corner / perch hop in flight
    let hopWalk = null; // bounce style: { dir, remaining, wait } — travelling by jumping
    let wanderTarget = null; // x the pet is strolling to (ground)
    let wanderSpeed = 60;
    let roam = null; // floating style: { x, y, timer } — drifting to a spot in the window
    let perch = null; // { token, offset, timer, rect } while standing on a page element
    let peekPlan = null; // { side, phase: 'go' | 'show' | 'hide' }
    let social = null; // { mode: 'greet'|'chase'|'flee'|'join', otherId, timer }
    let lastSocialEnd = -99;
    let pendingPeek = false;
    let arriveCb = null; // one-shot callback for goTo()
    let ceilingTimer = 0;
    let easeBoost = false;
    let clock = 0;
    let lastScrollReact = -999;
    let jumpCooldown = 0;
    let lastBounds = { width: 1024, height: 768 };
    let lastFootOffset = 2;
    let lastScale = 1;
    let lastCtx = null;
    let reducedMotion = false;

    function speakText(text) {
      if (onSpeak && text) onSpeak(text);
    }

    function speak(category) {
      if (!onSpeak) return;
      const lines = SPEECH_LINES[category];
      if (!lines) return;
      onSpeak(pick(lines));
    }

    function setState(next, duration) {
      state = next;
      stateTimer = duration != null ? duration : 0;
    }

    function stopMoving() {
      body.vx = 0;
      wanderTarget = null;
      hopWalk = null;
    }

    // Drops whatever multi-frame plan is running (used by interruptions).
    function cancelPlans() {
      arriveCb = null;
      wanderTarget = null;
      hopWalk = null;
      roam = null;
      peekPlan = null;
      social = null;
    }

    function leavePerch(fall) {
      perch = null;
      if (fall !== false) {
        body.surface = 'ground';
        body.grounded = false;
        body.vy = 0;
        body.vx = 0;
        setState('fall');
      }
    }

    function notifyInteraction() {
      idleSeconds = 0;
      if (state === 'sleep') {
        setState('wake', 0.6);
        speak('wake');
      }
    }

    function setDragging(value) {
      dragging = value;
      if (value) {
        hopTween = null;
        climbPhase = null;
        cancelPlans();
        perch = null;
        body.svx = 0;
        setState('dragged', 0);
        speak('drag');
      } else if (isHover()) {
        // Floaters stay wherever they are dropped and hover there.
        body.surface = 'air';
        body.grounded = true;
        body.vx = 0;
        body.svx = 0;
        body.vy = 0;
        decisionTimer = randomRange(2, 4);
        setState('idle');
      } else {
        body.surface = 'ground';
        body.grounded = false;
        setState('fall', 0);
      }
    }

    function reactOnce(category) {
      idleSeconds = 0;
      cancelPlans();
      setState('react', 0.5);
      if (category) speak(category);
    }

    function jump(power) {
      if (!body.grounded || body.surface !== 'ground' || dragging || hopTween) return false;
      const p = power || (floats ? randomRange(260, 320) : 480);
      Physics.jump(body, p);
      setState('jump');
      return true;
    }

    function jumpPower() {
      if (floats) return randomRange(240, 330) * (0.7 + personality.jumpiness * 0.5);
      return randomRange(500, 650) * (0.6 + personality.jumpiness);
    }

    // ---- Wandering --------------------------------------------------------

    // A destination anywhere across the window (not just a random direction),
    // so pets cover the whole width instead of piling up against the edges.
    function pickWanderX() {
      const lo = lastFootOffset + 60;
      const hi = Math.max(lo + 1, lastBounds.width - lastFootOffset - 60);
      let x = randomRange(lo, hi);
      for (let i = 0; i < 8 && Math.abs(x - body.x) < 160; i += 1) x = randomRange(lo, hi);
      return x;
    }

    function startGroundWalk(targetX) {
      const dx = targetX - body.x;
      if (getStyleProfile().hopper && body.surface === 'ground') {
        startHopWalk(Math.sign(dx) || 1, clamp(Math.ceil(Math.abs(dx) / 62), 2, 14));
        return;
      }
      wanderTarget = targetX;
      wanderSpeed = randomRange(45, 90) * personality.speed;
      body.vx = (Math.sign(dx) || 1) * wanderSpeed;
      setState('walk');
      decisionTimer = Math.abs(dx) / wanderSpeed + 2.5;
    }

    function stepWander() {
      const dx = wanderTarget - body.x;
      const passed = body.vx !== 0 && Math.sign(dx) !== Math.sign(body.vx);
      if (Math.abs(dx) < 8 || passed) {
        wanderTarget = null;
        body.vx = 0;
        decisionTimer = Math.min(decisionTimer, randomRange(0.3, 1.0));
        if (peekPlan && peekPlan.phase === 'go') beginPeekShow();
        fireArrive();
        return;
      }
      // Ease off over the last stretch so the pet glides to a stop.
      body.vx = Math.sign(dx) * wanderSpeed * clamp(Math.abs(dx) / 90, 0.25, 1);
    }

    function fireArrive() {
      if (!arriveCb) return;
      const cb = arriveCb;
      arriveCb = null;
      cb();
    }

    // Walk (or drift, or hop) to x and call back on arrival. Returns false when
    // the pal is busy (dragged, asleep, climbing, perched, mid-hop).
    function goTo(x, onArrive) {
      if (dragging || hopTween || perch || climbPhase || state === 'sleep') return false;
      const minX = lastFootOffset + 30;
      const maxX = Math.max(minX, lastBounds.width - lastFootOffset - 30);
      const tx = clamp(x, minX, maxX);
      cancelPlans();
      arriveCb = onArrive || null;
      if (body.surface === 'air') startRoam({ x: tx, y: body.y });
      else startGroundWalk(tx);
      return true;
    }

    // Floating style: drift to a random spot anywhere in the window.
    function startRoam(target) {
      const minY = 130 * lastScale;
      const bottom = lastBounds.height - lastFootOffset;
      const t = target || {
        x: pickWanderX(),
        y: randomRange(minY + 10, Math.max(minY + 20, bottom - 30)),
      };
      if (body.surface !== 'air') {
        body.surface = 'air';
        body.grounded = true;
        body.vy = 0;
      }
      roam = { x: t.x, y: t.y, timer: Math.hypot(t.x - body.x, t.y - body.y) / 60 + 5 };
      setState('walk');
    }

    function stepRoam(dt) {
      const r = roam;
      r.timer -= dt;
      const dx = r.x - body.x;
      const dy = r.y - body.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 22 || r.timer <= 0) {
        roam = null;
        body.vx = 0;
        decisionTimer = randomRange(1.2, 3);
        if (peekPlan && peekPlan.phase === 'go') beginPeekShow();
        else setState('idle');
        fireArrive();
        return;
      }
      const speed = Math.min(100 * personality.speed, dist * 1.1 + 14);
      body.vx = (dx / dist) * speed;
      body.vy += ((dy / dist) * speed - body.vy) * Math.min(1, getStyleProfile().velEase * dt);
      body.facing = Math.sign(dx) || body.facing;
      if (state !== 'walk') setState('walk');
    }

    // ---- Bounce style: travel by jumping -------------------------------------

    function startHopWalk(dir, hops) {
      hopWalk = { dir, remaining: hops, wait: 0.05 };
      setState('walk');
    }

    function stepHopWalk(dt) {
      const h = hopWalk;
      if (!body.grounded) {
        h.wait = randomRange(0.07, 0.15);
        return;
      }
      body.vx = 0;
      body.svx = 0;
      h.wait -= dt;
      if (h.wait > 0) return;
      if (h.remaining <= 0) {
        hopWalk = null;
        decisionTimer = randomRange(0.8, 2);
        if (peekPlan && peekPlan.phase === 'go') beginPeekShow();
        else setState('idle');
        fireArrive();
        return;
      }
      h.remaining -= 1;
      if (h.dir > 0 && body.x > lastBounds.width - lastFootOffset - 40) h.dir = -1;
      else if (h.dir < 0 && body.x < lastFootOffset + 40) h.dir = 1;
      Physics.jump(body, randomRange(470, 560) * (0.78 + personality.jumpiness * 0.3));
      body.vx = h.dir * randomRange(120, 170) * personality.speed;
      body.svx = body.vx;
      body.facing = h.dir;
      setState('jump');
    }

    function hopToward(dir) {
      if (!hopWalk) startHopWalk(dir, 2);
      else {
        hopWalk.dir = dir;
        hopWalk.remaining = Math.max(hopWalk.remaining, 2);
      }
    }

    // ---- Corner / perch hops -------------------------------------------------

    function beginHop(target, duration, arc) {
      perch = null;
      hopTween = {
        fromX: body.x,
        fromY: body.y,
        toX: target.x,
        toY: target.y,
        surface: target.surface,
        token: target.token || null,
        t: 0,
        duration,
        arc,
      };
      cancelPlans();
      body.vx = 0;
      body.svx = 0;
      body.vy = 0;
      body.facing = Math.sign(target.x - body.x) || body.facing;
      setState('hop', 0);
    }

    // Hop in an arc to another corner of the viewport. Bottom corners land on
    // the ground; top corners are hovered at (floaters) or clung to briefly.
    function startCornerHop() {
      if (climbPhase || dragging || hopTween || !body.grounded) return false;
      const bounds = lastBounds;
      const foot = lastFootOffset;
      const left = foot + 36;
      const right = bounds.width - foot - 36;
      const bottom = bounds.height - foot;
      const hover = isHover();
      const topY = hover ? Math.min(bottom, 150) : foot;
      const topSurface = hover ? 'air' : 'ceiling';
      const corners = [
        { x: left, y: bottom, surface: 'ground' },
        { x: right, y: bottom, surface: 'ground' },
        { x: left, y: topY, surface: topSurface },
        { x: right, y: topY, surface: topSurface },
      ].filter((c) => (!getStyleProfile().groundBound || c.surface === 'ground') && Math.hypot(c.x - body.x, c.y - body.y) > 140);
      if (!corners.length) return false;
      const target = pick(corners);
      const dist = Math.hypot(target.x - body.x, target.y - body.y);
      beginHop(target, clamp(dist / 520, 0.9, 1.9), floats ? Math.min(70, dist * 0.1) : Math.min(150, dist * 0.2));
      speak('hop');
      return true;
    }

    // Hop up onto a heading, image or the search box and stand on top of it.
    function startPerch(api) {
      if (!api || climbPhase || dragging || hopTween || !body.grounded || perch) return false;
      const token = api.pick(body.x, body.y);
      if (!token) return false;
      const r = token.rect;
      const x = clamp(body.x, r.left + 24, r.right - 24);
      const dist = Math.hypot(x - body.x, r.top - body.y);
      beginHop({ x, y: r.top, surface: 'perch', token }, clamp(dist / 480, 0.8, 1.7), floats ? Math.min(60, dist * 0.1) : Math.min(130, dist * 0.2));
      return true;
    }

    function advanceHop(dt) {
      const h = hopTween;
      if (h.surface === 'perch') {
        // The element may scroll while the pet is in the air: keep aiming at it.
        const r = lastCtx && lastCtx.perch ? lastCtx.perch.rect(h.token.id) : null;
        if (!r) {
          hopTween = null;
          body.surface = 'ground';
          body.grounded = false;
          setState('fall');
          return;
        }
        h.toX = clamp(h.toX, r.left + 24, r.right - 24);
        h.toY = r.top;
      }
      h.t += dt / h.duration;
      const k = easeInOutSine(Math.min(1, h.t));
      body.x = h.fromX + (h.toX - h.fromX) * k;
      body.y = h.fromY + (h.toY - h.fromY) * k - Math.sin(Math.PI * Math.min(1, h.t)) * h.arc;
      if (h.t < 1) return;

      body.x = h.toX;
      body.y = h.toY;
      body.surface = h.surface;
      body.grounded = true;
      body.vx = 0;
      body.vy = 0;
      body.svx = 0;
      ceilingTimer = randomRange(1.5, 3);
      decisionTimer = randomRange(0.5, 1.2);
      hopTween = null;
      setState(h.surface === 'ground' ? 'land' : 'idle', 0.2);
      if (h.surface === 'perch') {
        const r = lastCtx.perch.rect(h.token.id);
        perch = { token: h.token, offset: body.x - (r ? r.left : 0), timer: randomRange(9, 18), rect: r };
        speak(`perch${{ heading: 'Heading', image: 'Image', input: 'Input' }[h.token.kind] || 'Other'}`);
      } else if (h.surface === 'ground') {
        startGroundWalk(pickWanderX());
      } else if (h.surface === 'air') {
        startRoam();
      }
    }

    // ---- Perch -----------------------------------------------------------------

    function updatePerch(ctx) {
      const p = perch;
      const r = ctx.perch ? ctx.perch.rect(p.token.id) : null;
      const minTop = 110 * lastScale;
      if (!r || r.top < minTop || r.top > ctx.bounds.height - 30 || ctx.chase) {
        leavePerch(true);
        return;
      }
      p.rect = r;
      body.x = clamp(r.left + p.offset, r.left + 20, r.right - 20);
      body.y = r.top;
      body.vy = 0;
      body.surface = 'perch';
      body.grounded = true;
    }

    // After physics: remember where on the element the pet ended up, and turn
    // around at its ends.
    function settlePerch(dt) {
      const p = perch;
      if (!p || !p.rect) return;
      const r = p.rect;
      const lo = r.left + 20;
      const hi = r.right - 20;
      if (body.x <= lo && body.vx < 0) body.vx = Math.abs(body.vx);
      if (body.x >= hi && body.vx > 0) body.vx = -Math.abs(body.vx);
      body.x = clamp(body.x, lo, hi);
      p.offset = body.x - r.left;
      p.timer -= dt;
      if (p.timer <= 0 && state !== 'sleep') leavePerch(true);
    }

    // ---- Peeking out from a screen edge -------------------------------------

    function startPeek() {
      if (climbPhase || dragging || hopTween || perch || !body.grounded) return false;
      const side = body.x < lastBounds.width / 2 ? -1 : 1;
      const edgeX = side < 0 ? lastFootOffset + 26 * lastScale : lastBounds.width - lastFootOffset - 26 * lastScale;
      peekPlan = { side, phase: 'go' };
      if (isHover()) {
        const minY = 130 * lastScale;
        startRoam({ x: edgeX, y: randomRange(minY + 20, Math.max(minY + 40, lastBounds.height - 120)) });
      } else {
        startGroundWalk(edgeX);
      }
      return true;
    }

    function beginPeekShow() {
      peekPlan.phase = 'show';
      stopMoving();
      roam = null;
      body.facing = -peekPlan.side;
      setState('peek', randomRange(3, 4.5));
      decisionTimer = stateTimer + 0.2;
      speak('peek');
    }

    function stepPeek() {
      if (!peekPlan) return;
      if (peekPlan.phase === 'show' && stateTimer <= 0) {
        peekPlan.phase = 'hide';
        setState('idle', 0.7);
      } else if (peekPlan.phase === 'hide' && stateTimer <= 0) {
        peekPlan = null;
        decisionTimer = randomRange(0.4, 1);
        if (body.surface === 'ground') startGroundWalk(pickWanderX());
        else startRoam();
      }
    }

    // ---- Playing with other pals -----------------------------------------------

    function findOther(ctx, otherId) {
      return ctx.others ? ctx.others.find((o) => o.id === otherId) : null;
    }

    function nearestOther(ctx, filter) {
      let best = null;
      let bestD = Infinity;
      (ctx.others || []).forEach((o) => {
        if (filter && !filter(o)) return;
        const d = Math.hypot(o.body.x - body.x, o.body.y - body.y);
        if (d < bestD) {
          best = o;
          bestD = d;
        }
      });
      return best;
    }

    function startSocial(mode, other, seconds) {
      cancelPlans();
      social = { mode, otherId: other.id, timer: seconds };
      if (mode === 'chase') speak('play');
    }

    // Called by another pal's brain.
    function flee(otherId, seconds) {
      if (dragging || hopTween || perch || climbPhase || state === 'sleep') return;
      cancelPlans();
      social = { mode: 'flee', otherId, timer: seconds };
      setState('walk');
    }

    function invite(kind) {
      if (dragging || hopTween || perch || climbPhase || state === 'sleep') return;
      cancelPlans();
      stopMoving();
      setState(kind, IDLE_ANIMATIONS[kind] || 1.5);
      decisionTimer = stateTimer;
    }

    function stepSocial(ctx, dt) {
      const s = social;
      const other = findOther(ctx, s.otherId);
      s.timer -= dt;
      if (!other || s.timer <= 0 || dragging || state === 'sleep') {
        social = null;
        lastSocialEnd = clock;
        decisionTimer = Math.min(decisionTimer, 0.4);
        body.vx = 0;
        return false;
      }
      s.grace = (s.grace || 0) - dt;
      const dx = other.body.x - body.x;
      const dy = other.body.y - body.y;
      const close = Math.abs(dx) < 90 * lastScale && Math.abs(dy) < 90 * lastScale + (isHover() ? 120 : 0);
      if (s.mode === 'greet') {
        if (close) {
          stopMoving();
          roam = null;
          setState('wave', IDLE_ANIMATIONS.wave);
          decisionTimer = stateTimer;
          speakText(`Hi ${other.name}!`);
          other.brain.invite('wave');
          social = null;
          lastSocialEnd = clock;
          return true;
        }
        return applyBehaviorMode('followCursor', other.body, dt, 1);
      }
      if (s.mode === 'join') {
        if (Math.abs(dx) < 70 * lastScale && Math.abs(dy) < 60 * lastScale + (isHover() ? 120 : 0)) {
          social = null;
          lastSocialEnd = clock;
          forceSleep();
          return true;
        }
        if (other.state !== 'sleep') {
          social = null;
          return false;
        }
        return applyBehaviorMode('followCursor', { x: other.body.x + 52 * lastScale * (body.x < other.body.x ? -1 : 1), y: other.body.y }, dt, 1.4);
      }
      if (s.mode === 'chase') {
        if (close && s.grace <= 0) {
          // Tag! Swap roles.
          speakText(pick(SPEECH_LINES.tag));
          s.swaps = (s.swaps || 0) + 1;
          if (s.swaps >= 4) {
            // Enough tag for now: both pals stop and catch their breath.
            other.brain.endSocial();
            social = null;
            lastSocialEnd = clock;
            decisionTimer = Math.min(decisionTimer, 0.4);
            return false;
          }
          other.brain.startChase(id, s.timer, s.swaps);
          social = { mode: 'flee', otherId: other.id, timer: s.timer, swaps: s.swaps };
          return true;
        }
        const theirs = other.brain.socialInfo;
        if (!theirs || theirs.mode !== 'flee' || theirs.otherId !== id) other.brain.flee(id, s.timer);
        return applyBehaviorMode('followCursor', other.body, dt, 1.7);
      }
      // flee
      return fleeFrom(other.body, dt);
    }

    function startChaseOf(otherId, seconds, swaps) {
      if (dragging || hopTween || perch || climbPhase || state === 'sleep') return;
      cancelPlans();
      social = { mode: 'chase', otherId, timer: seconds || 12, grace: 1.6, swaps: swaps || 0 };
    }

    function endSocial() {
      if (!social) return;
      social = null;
      lastSocialEnd = clock;
      decisionTimer = Math.min(decisionTimer, 0.4);
    }

    function fleeFrom(point, dt) {
      const dx = body.x - point.x;
      const dy = body.y - point.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (isHover()) {
        if (body.surface !== 'air') {
          body.surface = 'air';
          body.grounded = true;
          body.vy = 0;
        }
        const speed = 190 * personality.speed;
        const minY = 130 * lastScale;
        let away = dist < 4 ? 1 : dx / dist;
        if ((away < 0 && body.x < lastFootOffset + 140) || (away > 0 && body.x > lastBounds.width - lastFootOffset - 140)) away = -away;
        body.vx = away * speed;
        const wantVy = clamp((dy / dist) * speed, -speed, speed);
        body.vy += (wantVy - body.vy) * Math.min(1, 3 * dt);
        if (body.y < minY + 20) body.vy = Math.abs(body.vy);
        easeBoost = true;
      } else if (getStyleProfile().hopper) {
        let dir = Math.sign(dx) || 1;
        if ((dir < 0 && body.x < lastFootOffset + 140) || (dir > 0 && body.x > lastBounds.width - lastFootOffset - 140)) dir = -dir;
        hopToward(dir);
        return true;
      } else {
        let dir = Math.sign(dx) || 1;
        const cornered = (dir < 0 && body.x < lastFootOffset + 140) || (dir > 0 && body.x > lastBounds.width - lastFootOffset - 140);
        if (cornered) dir = -dir;
        body.vx = dir * 150 * personality.speed;
        easeBoost = true;
      }
      body.facing = Math.sign(body.vx) || body.facing;
      setState('walk');
      return true;
    }

    // ---- Misc commands ---------------------------------------------------------

    function special(category) {
      idleSeconds = 0;
      if (body.grounded) cancelPlans();
      body.vx = 0;
      if (category === 'dance') {
        setState('dance', 2.5);
        decisionTimer = 2.5;
      } else if (category === 'hop') {
        startCornerHop();
        return;
      } else if (category === 'perch') {
        if (!startPerch(lastCtx && lastCtx.perch)) speak('idle');
        return;
      } else if (category === 'peek') {
        if (perch) {
          // Step down first, then head for the edge.
          pendingPeek = true;
          leavePerch(true);
          return;
        }
        startPeek();
        return;
      } else if (IDLE_ANIMATIONS[category]) {
        setState(category, IDLE_ANIMATIONS[category]);
        decisionTimer = stateTimer;
        speak(category);
        return;
      } else {
        setState('react', 0.6);
        decisionTimer = 0.6;
      }
      speak('play');
    }

    function forceSleep() {
      idleSeconds = 0;
      cancelPlans();
      body.vx = 0;
      setState('sleep', 0);
      decisionTimer = randomRange(6, 12);
      speak('sleepy');
    }

    // Page awareness: brief reactions to scrolling and to navigating.
    function reactToScroll() {
      if (dragging || hopTween || climbPhase) return;
      if (state === 'sleep' || state === 'wake' || state === 'dance') return;
      if (clock - lastScrollReact < SCROLL_REACT_COOLDOWN) return;
      lastScrollReact = clock;
      cancelPlans();
      body.vx = 0;
      setState('react', 0.8);
      if (chance(0.5)) speak('scroll');
    }

    function reactToPageChange() {
      if (dragging || hopTween || climbPhase) return;
      idleSeconds = 0;
      cancelPlans();
      body.vx = 0;
      if (perch) leavePerch(true);
      setState('react', 1);
      decisionTimer = 1.2;
      speak('page');
    }

    function welcomeBack() {
      if (state === 'sleep') return;
      speak('back');
    }

    // ---- Decisions -----------------------------------------------------------------

    function weightedChoice(ctx) {
      const settings = ctx.settings;
      const profile = getStyleProfile();
      const onGround = body.surface === 'ground';
      const inAir = body.surface === 'air';
      const onPerch = body.surface === 'perch';
      const page = settings.pageInteraction !== false && !reducedMotion;
      const idleAnim = settings.idleAnimations !== false && !reducedMotion;
      const canSocial = settings.petInteractions !== false && ctx.others && ctx.others.length > 0 && clock - lastSocialEnd > 10;
      const sleeper = canSocial && ctx.others.find((o) => o.state === 'sleep');
      const options = [
        { key: 'walk', weight: 3 },
        { key: 'sit', weight: profile.allowSit && !onPerch ? 1.2 : 0 },
        { key: 'look', weight: profile.allowSit ? 1.4 : 2.2 },
        { key: 'jump', weight: reducedMotion || !profile.allowJump || !onGround ? 0 : 0.6 + personality.jumpiness },
        { key: 'dance', weight: reducedMotion ? 0 : 0.3 + personality.danciness },
        { key: 'sleep', weight: 0.2 + personality.sleepiness * 0.6 },
        { key: 'climb', weight: onGround && !reducedMotion && profile.allowClimb ? 0.12 : 0 },
        { key: 'hop', weight: reducedMotion || settings.windowHopping === false || onPerch ? 0 : 0.15 },
        { key: 'settle', weight: inAir ? 1.0 : 0 },
        { key: 'roam', weight: isHover() && !onPerch && !reducedMotion ? 2.2 : 0 },
        { key: 'perch', weight: page && ctx.perch && onGround ? 0.6 : 0 },
        { key: 'peek', weight: page && !onPerch && (onGround || inAir) ? 0.35 : 0 },
        { key: 'wave', weight: idleAnim ? 0.5 : 0 },
        { key: 'yawn', weight: idleAnim ? 0.3 + personality.sleepiness * 0.5 : 0 },
        { key: 'sneeze', weight: idleAnim ? 0.25 : 0 },
        { key: 'greet', weight: canSocial && !onPerch ? 0.7 : 0 },
        { key: 'tag', weight: canSocial && !onPerch ? 0.45 : 0 },
        { key: 'join', weight: sleeper && !onPerch ? 1.6 : 0 },
      ];
      const total = options.reduce((sum, o) => sum + o.weight, 0);
      let r = Math.random() * total;
      for (const o of options) {
        if (r < o.weight) return o.key;
        r -= o.weight;
      }
      return 'walk';
    }

    function nearWall() {
      return body.x < lastFootOffset + 55 || body.x > lastBounds.width - lastFootOffset - 55;
    }

    function startDecision(ctx) {
      const bounds = ctx.bounds;
      if (pendingPeek) {
        pendingPeek = false;
        if (startPeek()) return;
      }
      let choice = weightedChoice(ctx);
      // Pets shouldn't sit parked against a wall or in a corner: head back in.
      if (nearWall() && (body.surface === 'ground' || body.surface === 'air') && !climbPhase
        && !['walk', 'roam', 'hop', 'peek', 'climb', 'jump', 'dance', 'wave'].includes(choice) && chance(0.85)) {
        choice = body.surface === 'air' ? 'roam' : 'walk';
      }
      if (nearWall() && (choice === 'walk') && body.surface === 'ground') {
        startGroundWalk(pickWanderX());
        return;
      }
      switch (choice) {
        case 'walk':
          if (body.surface === 'air') {
            startRoam();
            break;
          }
          if (body.surface === 'perch' && perch && perch.rect) {
            body.vx = (chance(0.5) ? 1 : -1) * randomRange(30, 55) * personality.speed;
            setState('walk');
            decisionTimer = randomRange(1.5, 3.5);
            break;
          }
          startGroundWalk(pickWanderX());
          break;
        case 'sit':
          stopMoving();
          setState('sit', randomRange(2, 4));
          decisionTimer = stateTimer;
          break;
        case 'look':
          stopMoving();
          setState('look', randomRange(1.2, 2.4));
          decisionTimer = stateTimer;
          speak('idle');
          break;
        case 'jump':
          if (body.grounded && body.surface === 'ground' && getStyleProfile().allowJump) {
            Physics.jump(body, jumpPower());
            setState('jump');
            speak('play');
          }
          decisionTimer = randomRange(1.5, 3);
          break;
        case 'dance':
          stopMoving();
          setState('dance', randomRange(2, 3.5));
          decisionTimer = stateTimer;
          speak('play');
          break;
        case 'sleep':
          stopMoving();
          setState('sleep', 0);
          speak('sleepy');
          decisionTimer = randomRange(6, 12);
          break;
        case 'climb':
          climbPhase = 'up-wall';
          body.surface = body.x < bounds.width / 2 ? 'wall-left' : 'wall-right';
          setState('walk');
          decisionTimer = randomRange(3, 5);
          break;
        case 'hop':
          if (!startCornerHop()) decisionTimer = randomRange(1.5, 3);
          break;
        case 'roam':
          startRoam();
          break;
        case 'perch':
          if (!startPerch(ctx.perch)) decisionTimer = randomRange(1, 2.5);
          break;
        case 'peek':
          if (!startPeek()) decisionTimer = randomRange(1, 2.5);
          break;
        case 'wave':
        case 'yawn':
        case 'sneeze':
          stopMoving();
          setState(choice, IDLE_ANIMATIONS[choice]);
          decisionTimer = stateTimer;
          if (choice !== 'wave' || chance(0.5)) speak(choice);
          break;
        case 'greet':
        case 'tag':
        case 'join': {
          const other = choice === 'join'
            ? nearestOther(ctx, (o) => o.state === 'sleep')
            : nearestOther(ctx, (o) => o.state !== 'sleep' && o.state !== 'dragged' && o.body.surface !== 'perch');
          if (!other) {
            decisionTimer = randomRange(1, 2);
            break;
          }
          if (choice === 'tag') {
            startSocial('chase', other, 12);
            other.brain.flee(id, 12);
          } else {
            startSocial(choice, other, 14);
          }
          break;
        }
        case 'settle':
          body.vx = 0;
          body.surface = 'ground';
          body.grounded = false;
          body.vy = 0;
          setState('fall');
          decisionTimer = randomRange(2, 4);
          break;
        default:
          decisionTimer = randomRange(2, 4);
      }
    }

    // Floaters chase a point in 2D, hovering just above it.
    function floatFollow(point, dt, boost) {
      if (body.surface !== 'air') {
        body.surface = 'air';
        body.grounded = true;
        body.vy = 0;
      }
      const tx = point.x;
      const ty = point.y + 70;
      const dx = tx - body.x;
      const dy = ty - body.y;
      const dist = Math.hypot(dx, dy);
      let desiredVy = 0;
      if (dist > 26) {
        const speed = Math.min(260 * personality.speed * boost, dist * 2.2);
        body.vx = (dx / dist) * speed;
        desiredVy = (dy / dist) * speed;
        body.facing = Math.sign(dx) || body.facing;
        setState('walk');
      } else {
        body.vx = 0;
        setState('idle');
      }
      easeBoost = true;
      body.vy += (desiredVy - body.vy) * Math.min(1, 3.2 * dt);
      return true;
    }

    // Walks/floats/hops toward a point (the cursor, the ball, another pal).
    function applyBehaviorMode(mode, pointer, dt, boost) {
      if (!pointer || (pointer.active === false)) return false;
      const dx = pointer.x - body.x;
      const dist = Math.abs(dx);
      const b = boost || 1;
      if (mode === 'followCursor') {
        if (isHover() && !climbPhase) return floatFollow(pointer, dt, b);
        if (getStyleProfile().hopper && body.surface === 'ground') {
          if (dist > 36) {
            hopToward(Math.sign(dx));
          } else {
            hopWalk = null;
            body.vx = 0;
            if (body.grounded) setState('idle');
          }
          return true;
        }
        if (dist > 36) {
          body.vx = Math.sign(dx) * Math.min(110 * b, (40 + dist * 0.4) * b) * personality.speed;
          body.facing = Math.sign(dx) || body.facing;
          setState('walk');
          if (b > 1) easeBoost = true;
          // Something up in the air (a tossed ball): hop to reach it.
          if (b > 1 && body.grounded && body.surface === 'ground' && pointer.y < body.y - 90 * lastScale && dist < 90 && jumpCooldown <= 0) {
            jumpCooldown = 1.1;
            Physics.jump(body, isHover() ? 330 : 560);
            setState('jump');
          }
          return true;
        }
        body.vx = 0;
        setState(getStyleProfile().allowSit ? 'sit' : 'idle', 1.5);
        return true;
      }
      if (mode === 'avoidCursor') {
        if (dist < 220 && getStyleProfile().hopper && body.surface === 'ground') {
          hopToward(-Math.sign(dx || 1));
          return true;
        }
        if (dist < 220) {
          body.vx = -Math.sign(dx || 1) * randomRange(90, 160) * personality.speed;
          body.facing = Math.sign(body.vx) || body.facing;
          setState('walk');
          return true;
        }
      }
      return false;
    }

    function handleClimbTransitions(bounds, footOffset) {
      if (!climbPhase) return;
      if (climbPhase === 'up-wall') {
        body.vx = 0;
        body.vy = -105 * personality.speed;
        if (body.y <= footOffset + 2) {
          climbPhase = 'across-ceiling';
          body.surface = 'ceiling';
          body.vy = 0;
          body.vx = (body.x < bounds.width / 2 ? 1 : -1) * 105 * personality.speed;
        }
      } else if (climbPhase === 'across-ceiling') {
        const farEdge = body.vx > 0 ? bounds.width - footOffset - 4 : footOffset + 4;
        if ((body.vx > 0 && body.x >= farEdge) || (body.vx < 0 && body.x <= farEdge)) {
          climbPhase = 'down-wall';
          body.surface = body.vx > 0 ? 'wall-right' : 'wall-left';
          body.vx = 0;
          body.vy = 105 * personality.speed;
        }
      } else if (climbPhase === 'down-wall') {
        if (body.y >= bounds.height - footOffset - 2) {
          climbPhase = null;
          body.surface = 'ground';
          body.vy = 0;
          startGroundWalk(pickWanderX());
        }
      }
    }

    // ---- Frame update ---------------------------------------------------------------

    function update(dt, ctx) {
      const { bounds, pointer, footOffset, settings } = ctx;
      lastBounds = bounds;
      lastFootOffset = footOffset;
      lastScale = settings.scale || 1;
      lastCtx = ctx;
      clock += dt;
      jumpCooldown -= dt;
      reducedMotion = !!settings.reducedMotion || PocketPal.Utils.prefersReducedMotion();
      stateTimer -= dt;
      body.facing = body.vx > 0.5 ? 1 : body.vx < -0.5 ? -1 : body.facing;

      // Peek amount eases in/out whatever else is going on.
      const peekGoal = peekPlan && peekPlan.phase === 'show' ? 1 : 0;
      body.peek += (peekGoal - body.peek) * Math.min(1, 5 * dt);
      if (peekPlan) body.peekSide = peekPlan.side;
      else if (body.peek < 0.01) body.peekSide = 0;

      if (dragging) {
        return state;
      }

      if (hopTween) {
        advanceHop(dt);
        return state;
      }

      if (perch) updatePerch(ctx);

      const velEase = easeBoost ? Math.max(getStyleProfile().velEase, 3.2) : getStyleProfile().velEase;
      easeBoost = false;
      body.svx += (body.vx - body.svx) * Math.min(1, velEase * dt);

      idleSeconds += dt;
      const autoSleepSeconds = (settings.autoSleepMinutes || 0) * 60;
      if (
        state !== 'sleep' &&
        state !== 'dragged' &&
        autoSleepSeconds > 0 &&
        idleSeconds > autoSleepSeconds &&
        body.grounded
      ) {
        cancelPlans();
        body.vx = 0;
        setState('sleep', 0);
        speak('sleepy');
      }

      if (state === 'sleep') {
        Physics.applyGravity(body, dt);
        Physics.integrate(body, dt);
        Physics.resolveBounds(body, bounds, footOffset);
        Physics.relaxSquash(body, dt);
        if (perch) settlePerch(dt);
        return state;
      }

      if (state === 'wake') {
        if (stateTimer <= 0) {
          idleSeconds = 0;
          decisionTimer = 0.1;
          setState('idle');
        }
        Physics.applyGravity(body, dt);
        Physics.integrate(body, dt);
        Physics.resolveBounds(body, bounds, footOffset);
        return state;
      }

      if (body.surface === 'ceiling' && !climbPhase) {
        ceilingTimer -= dt;
        if (ceilingTimer <= 0) {
          body.surface = 'ground';
          body.grounded = false;
          body.vy = 0;
          body.vx = 0;
          setState('fall');
        }
      }

      stepPeek();

      let followingCursor = false;
      const chase = ctx.chase || null;
      const mode = chase ? 'followCursor' : settings.behavior;
      let handled = false;
      if (social && !chase) {
        handled = stepSocial(ctx, dt);
        followingCursor = handled && isHover();
      }
      if (!handled && (chase || mode !== 'stationary') && !perch) {
        handled = applyBehaviorMode(mode, chase || pointer, dt, chase ? 1.7 : 1);
        followingCursor = handled && isHover() && mode === 'followCursor';
        if (handled && chase) {
          cancelPlansForChase();
        }
      }
      if (!handled && (chase || mode !== 'stationary')) {
        decisionTimer -= dt;
        if (climbPhase) {
          handleClimbTransitions(bounds, footOffset);
        } else if (hopWalk || roam || peekPlan || wanderTarget !== null) {
          // mid-plan: the step functions below decide when it ends
        } else if (decisionTimer <= 0 && body.grounded) {
          startDecision(ctx);
        } else if (state !== 'walk' && state !== 'jump' && stateTimer <= 0 && body.grounded) {
          // Shorten a stale wait once this state's own timer is done, but
          // only ever shrink it — overwriting it every frame pinned it at
          // 0.05 forever and froze the pet in place until a frame hitch
          // happened to push decisionTimer past zero in one jump.
          decisionTimer = Math.min(decisionTimer, 0.05);
        }
      } else if (!handled) {
        cancelPlans();
        body.vx = 0;
        if (stateTimer <= 0) setState('idle');
      }

      // Plans that keep steering after the decision was made.
      if (wanderTarget !== null) {
        if (body.surface !== 'ground' || handled) wanderTarget = null;
        else stepWander();
      }
      if (roam) {
        if (body.surface !== 'air' || handled) roam = null;
        else stepRoam(dt);
      }
      if (hopWalk) {
        if (body.surface !== 'ground' || !getStyleProfile().hopper) hopWalk = null;
        else stepHopWalk(dt);
      }

      const speedScale = settings.walkSpeed || 1;

      Physics.applyGravity(body, dt, floats ? 0.2 : 1);
      if (floats && body.vy > MAX_FLOAT_FALL && body.surface === 'ground') body.vy = MAX_FLOAT_FALL;
      Physics.integrate(body, dt, speedScale);
      const landed = Physics.resolveBounds(body, bounds, footOffset);
      if (perch) settlePerch(dt);

      if (body.surface === 'air') {
        const minY = 130 * lastScale;
        body.y = clamp(body.y, Math.min(minY, bounds.height - footOffset), bounds.height - footOffset);
        if (body.y >= bounds.height - footOffset - 3 && !followingCursor && !roam && !peekPlan) {
          body.surface = 'ground';
        }
      }

      if (landed && !lastLandedTick && !floats) {
        Physics.updateSquash(body, dt, true);
      } else {
        Physics.updateSquash(body, dt, false);
      }
      lastLandedTick = landed;

      // Climbing walls/ceilings counts as walking even though vx is zero going up.
      const moving = Math.abs(body.vx) > 5 || !!climbPhase;
      if (!body.grounded) {
        setState(body.vy < 0 ? 'jump' : 'fall');
      } else if (state === 'jump' || state === 'fall') {
        setState('land', 0.15);
        decisionTimer = randomRange(1, 2);
      } else if (state === 'land' && stateTimer <= 0) {
        setState(moving ? 'walk' : 'idle');
      } else if (!NON_WALKING.has(state) && moving) {
        setState('walk');
      } else if (!moving && state === 'walk') {
        setState('idle');
      }

      return state;
    }

    // A chase (the ball game) overrides any wander plan in progress.
    function cancelPlansForChase() {
      wanderTarget = null;
      roam = null;
      peekPlan = null;
      social = null;
    }

    // Restores a saved position (multi-tab persistence). The caller supplies y
    // (ground level for 'ground'). Climb phases and the ceiling aren't
    // restored: those fall back to standing on the ground.
    function placeAt(x, y, surface) {
      hopTween = null;
      climbPhase = null;
      perch = null;
      cancelPlans();
      body.vx = 0;
      body.vy = 0;
      body.svx = 0;
      body.x = x;
      if (surface === 'air' && isHover()) {
        body.surface = 'air';
      } else {
        body.surface = 'ground';
      }
      body.y = y;
      body.grounded = true;
    }

    // Switch gait/hover mode at runtime (the "animation style" setting).
    function setStyle(style, floatsFlag) {
      movementStyle = style || (floatsFlag ? 'float' : 'walk');
      floats = !!floatsFlag;
      cancelPlans();
      if (perch && !floats) leavePerch(true);
      if ((!floats || getStyleProfile().groundBound) && body.surface === 'air') {
        body.surface = 'ground';
        body.grounded = false;
      }
    }

    return {
      id,
      name,
      body,
      get state() {
        return state;
      },
      get hopping() {
        return !!hopTween;
      },
      get perched() {
        return !!perch;
      },
      get socialInfo() {
        return social;
      },
      get isHover() {
        return isHover();
      },
      update,
      notifyInteraction,
      setDragging,
      reactOnce,
      jump,
      goTo,
      special,
      forceSleep,
      reactToScroll,
      reactToPageChange,
      welcomeBack,
      placeAt,
      setStyle,
      flee,
      invite,
      endSocial,
      startChase: startChaseOf,
      say: speakText,
      setPersonality(p) { personality = p; },
      setFloats(value) { floats = !!value; },
      setMovementStyle(value) { movementStyle = value || (floats ? 'float' : 'walk'); },
      set onSpeak(fn) {
        onSpeak = fn;
      },
      lookAt(target) {
        lookTarget = target;
      },
      get lookTarget() {
        return lookTarget;
      },
    };
  }

  PocketPal.Movement = { createBrain, SPEECH_LINES };
})(window);
