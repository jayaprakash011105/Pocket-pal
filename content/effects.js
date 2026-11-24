// Particle trail left behind a moving floater (sparkles, bubbles, snow or
// hearts). A small pool of textured planes lives directly in the scene; the
// textures are painted by characters/effects.js.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Effects = PocketPal.Effects || (PocketPal.Effects = {});
  const THREE = global.THREE;

  const POOL_SIZE = 48;
  const LIFE = 0.9; // seconds

  // Each trail type has its own look: bubbles and hearts are painted bigger and
  // drift/sway more so they read as clearly as the sparkles do.
  const KINDS = {
    sparkles: { size: 1, every: 0.07, life: 1, rise: 1, sway: 0 },
    bubbles: { size: 2.1, every: 0.09, life: 1.35, rise: 1.5, sway: 14 },
    hearts: { size: 2.2, every: 0.1, life: 1.3, rise: 1.2, sway: 8 },
    snow: { size: 1.5, every: 0.08, life: 1.2, rise: 1, sway: 10 },
  };
  const kindOf = (kind) => KINDS[kind] || KINDS.sparkles;

  function createTrail(scene) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const textures = {};
    const particles = [];
    let spawnTimer = 0;
    let seed = Math.random() * 1000;

    function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    function textureFor(kind) {
      if (!textures[kind]) {
        const tex = new THREE.CanvasTexture(Effects.particle(kind));
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        textures[kind] = tex;
      }
      return textures[kind];
    }

    function acquire() {
      let p = particles.find((q) => !q.active);
      if (p) return p;
      if (particles.length >= POOL_SIZE) return null;
      const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      p = { mesh, material, active: false, age: 0, life: LIFE, vx: 0, vy: 0, size: 12, spin: 0, sway: 0, phase: 0, kind: 'sparkles' };
      particles.push(p);
      return p;
    }

    function spawn(body, kind, scale) {
      const p = acquire();
      if (!p) return;
      const facing = body.facing < 0 ? -1 : 1;
      const k = kindOf(kind);
      p.active = true;
      p.age = 0;
      p.kind = kind;
      p.life = LIFE * k.life * (0.8 + rand() * 0.4);
      p.material.map = textureFor(KINDS[kind] ? kind : 'sparkles');
      p.material.needsUpdate = true;
      p.size = (9 + rand() * 9) * k.size * scale;
      p.vx = -facing * (8 + rand() * 18);
      p.vy = kind === 'snow' ? 6 + rand() * 14 : -(14 + rand() * 24) * k.rise;
      p.sway = k.sway * scale;
      p.phase = rand() * 6.28;
      p.spin = kind === 'bubbles' ? 0 : (rand() - 0.5) * 2;
      p.mesh.position.set(body.x - facing * 10 * scale + (rand() - 0.5) * 14 * scale, body.y - 40 * scale + (rand() - 0.5) * 30 * scale, 1);
      p.mesh.visible = true;
    }

    function update(dt, body, opts) {
      const o = opts || {};
      const scale = o.scale || 1;
      const moving = o.moving !== undefined ? o.moving : Math.abs(body.svx || 0) > 8 || !body.grounded;
      if (o.enabled && o.floats && moving) {
        const every = kindOf(o.kind).every;
        spawnTimer += dt;
        while (spawnTimer >= every) {
          spawnTimer -= every;
          spawn(body, o.kind || 'sparkles', scale);
        }
      } else {
        spawnTimer = 0;
      }
      particles.forEach((p) => {
        if (!p.active) return;
        p.age += dt;
        const q = p.age / p.life;
        if (q >= 1) {
          p.active = false;
          p.mesh.visible = false;
          return;
        }
        p.mesh.position.x += (p.vx + Math.sin(p.age * 4 + p.phase) * p.sway) * dt;
        p.mesh.position.y += p.vy * dt;
        // The plane is mirrored in Y so the canvas stays upright (world Y is down).
        const s = p.size * (1 - q * 0.6);
        p.mesh.scale.set(s, -s, 1);
        p.mesh.rotation.z = p.spin * p.age;
        p.material.opacity = Math.min(1, (1 - q) * 1.4) * 0.9;
      });
    }

    function dispose() {
      particles.forEach((p) => {
        scene.remove(p.mesh);
        p.material.dispose();
      });
      particles.length = 0;
      Object.keys(textures).forEach((k) => textures[k].dispose());
      geometry.dispose();
    }

    return { update, dispose, get activeCount() { return particles.filter((p) => p.active).length; } };
  }

  Effects.createTrail = createTrail;
})(window);
