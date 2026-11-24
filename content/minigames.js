// "Catch my ball": a ball you can drag and throw. Pals chase it (jumping up
// for it when it is tossed high), catch it, carry it for a moment and toss it
// back. The ball lives in the same pixel space as the pals.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const { clamp, pick } = PocketPal.Utils;

  const GRAVITY = 1500;
  const BOUNCE = 0.62;
  const CARRY_SECONDS = 1.1;
  const IDLE_END_SECONDS = 150;
  const MAX_THROW = 1900;

  function drawBall() {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(36, 32, 6, 48, 48, 46);
    grad.addColorStop(0, '#ff8a80');
    grad.addColorStop(1, '#d32f2f');
    ctx.beginPath();
    ctx.arc(48, 48, 44, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#7f1d1d';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(48, 48, 44, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(34, 28, 12, 7, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    return canvas;
  }

  // options: { THREE, scene, stage, getScale(), getBounds(), onScore(score, pal) }
  function createBallGame(options) {
    const THREE = options.THREE;
    const { scene, stage, getScale, getBounds } = options;

    let mesh = null;
    let hit = null;
    let texture = null;
    let active = false;
    let score = 0;
    let idleFor = 0;
    let dragging = false;
    let samples = [];
    let carriedBy = null;
    let carryTimer = 0;
    const ball = { x: 0, y: 0, vx: 0, vy: 0 };

    const radius = () => 15 * getScale();

    function build() {
      texture = new THREE.CanvasTexture(drawBall());
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      mesh.scale.set(1, -1, 1);
      mesh.renderOrder = 3;
      scene.add(mesh);

      hit = document.createElement('div');
      hit.className = 'pp-ball-hit';
      stage.appendChild(hit);
      hit.addEventListener('pointerdown', onDown);
      hit.addEventListener('pointermove', onMove);
      hit.addEventListener('pointerup', onUp);
      hit.addEventListener('pointercancel', onUp);
    }

    function onDown(evt) {
      if (carriedBy) return;
      evt.preventDefault();
      hit.setPointerCapture?.(evt.pointerId);
      dragging = true;
      idleFor = 0;
      samples = [{ t: performance.now(), x: evt.clientX, y: evt.clientY }];
      ball.vx = 0;
      ball.vy = 0;
    }

    function onMove(evt) {
      if (!dragging) return;
      const b = getBounds();
      ball.x = clamp(evt.clientX, radius(), b.width - radius());
      ball.y = clamp(evt.clientY, radius(), b.height - radius());
      const now = performance.now();
      samples.push({ t: now, x: ball.x, y: ball.y });
      while (samples.length > 2 && now - samples[0].t > 120) samples.shift();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      idleFor = 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const span = Math.max((last.t - first.t) / 1000, 0.016);
      let vx = (last.x - first.x) / span;
      let vy = (last.y - first.y) / span;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_THROW) {
        vx = (vx / speed) * MAX_THROW;
        vy = (vy / speed) * MAX_THROW;
      }
      ball.vx = vx;
      ball.vy = vy;
    }

    function start() {
      if (active) return;
      if (!mesh) build();
      const b = getBounds();
      ball.x = b.width * (0.25 + Math.random() * 0.5);
      ball.y = b.height * 0.35;
      ball.vx = (Math.random() - 0.5) * 300;
      ball.vy = 0;
      score = 0;
      idleFor = 0;
      carriedBy = null;
      active = true;
      mesh.visible = true;
      hit.style.display = 'block';
    }

    function stop() {
      if (!active) return;
      active = false;
      dragging = false;
      carriedBy = null;
      if (mesh) mesh.visible = false;
      if (hit) hit.style.display = 'none';
    }

    function step(dt) {
      const b = getBounds();
      const r = radius();
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.x < r) { ball.x = r; ball.vx = Math.abs(ball.vx) * BOUNCE; }
      if (ball.x > b.width - r) { ball.x = b.width - r; ball.vx = -Math.abs(ball.vx) * BOUNCE; }
      if (ball.y < r) { ball.y = r; ball.vy = Math.abs(ball.vy) * BOUNCE; }
      if (ball.y > b.height - r) {
        ball.y = b.height - r;
        ball.vy = -Math.abs(ball.vy) * BOUNCE;
        if (Math.abs(ball.vy) < 60) ball.vy = 0;
        ball.vx *= Math.exp(-1.4 * dt);
        if (Math.abs(ball.vx) < 4) ball.vx = 0;
      }
    }

    // pals: [{ brain }]. Returns where pals should run to, or null.
    function update(dt, pals) {
      if (!active) return null;
      const r = radius();
      const scale = getScale();

      if (carriedBy) {
        const body = carriedBy.brain.body;
        // Held out to the side, in front of the pet's face, so the speech bubble
        // above its head never hides it.
        ball.x = body.x + (body.facing < 0 ? -1 : 1) * 46 * scale;
        ball.y = body.y - 58 * scale;
        carryTimer -= dt;
        if (carryTimer <= 0) {
          ball.vx = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 140);
          ball.vy = -520;
          carriedBy = null;
        }
      } else if (!dragging) {
        step(dt);
        idleFor += dt;
        const bx = ball.x;
        const by = ball.y;
        for (const pal of pals) {
          const body = pal.brain.body;
          if (pal.brain.state === 'dragged' || pal.brain.state === 'sleep') continue;
          if (Math.hypot(body.x - bx, body.y - 50 * scale - by) < 55 * scale + r) {
            carriedBy = pal;
            carryTimer = CARRY_SECONDS;
            score += 1;
            pal.brain.say(`${pick(PocketPal.Movement.SPEECH_LINES.catch)}${score > 1 ? ` (${score})` : ''}`);
            if (options.onScore) options.onScore(score, pal);
            break;
          }
        }
        if (idleFor > IDLE_END_SECONDS) {
          const last = pals[0];
          if (last) last.brain.say(`Fun game! I caught ${score}!`);
          stop();
          return null;
        }
      }

      mesh.position.set(ball.x, ball.y, 2);
      mesh.scale.set(r * 2, -r * 2, 1);
      hit.style.display = carriedBy ? 'none' : 'block';
      hit.style.left = `${ball.x - r * 1.35}px`;
      hit.style.top = `${ball.y - r * 1.35}px`;
      hit.style.width = `${r * 2.7}px`;
      hit.style.height = `${r * 2.7}px`;

      return carriedBy ? null : { x: ball.x, y: ball.y };
    }

    function dispose() {
      stop();
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        texture.dispose();
        mesh = null;
      }
      if (hit) {
        hit.remove();
        hit = null;
      }
    }

    return {
      get active() { return active; },
      get score() { return score; },
      start,
      stop,
      update,
      dispose,
    };
  }

  PocketPal.Minigames = { createBallGame };
})(window);
