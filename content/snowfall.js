// Christmas ambience for the Santa theme: snow drifting down across the whole
// window while a snowbank builds up along the bottom edge in three layers.
// Once the third layer has formed the snowfall stops and the snowbank stays;
// it melts away when the theme ends.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const THREE = global.THREE;

  // Far flakes are small, slow and faint; near ones are big, fast and bright.
  const LAYERS = [
    { share: 0.5, size: 3.4, opacity: 0.55, speed: [22, 42], sway: 10, wind: 0.5, z: -2 },
    { share: 0.35, size: 5.6, opacity: 0.8, speed: [42, 72], sway: 16, wind: 0.8, z: -1 },
    { share: 0.15, size: 9, opacity: 0.95, speed: [72, 115], sway: 24, wind: 1.2, z: 1 },
  ];
  const MAX_FLAKES = 360;
  const LAYER_SECONDS = 12; // each of the three snowbank layers takes this long to form
  const DRIFT_LAYERS = [
    // height is the plane height (the crest sits ~40% down from the top of it)
    { height: 20, z: -3.4, tint: 0xcfe0f4, offset: 2.1 },
    { height: 33, z: -3.2, tint: 0xe6effa, offset: 0 },
    { height: 47, z: -3, tint: 0xffffff, offset: 4.3 },
  ];
  const SETTLED_DEPTH = 28; // px of snow once all three layers are down

  function paintFlake() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    // White core with a faint cool halo so flakes still read on light pages.
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.62, 'rgba(165,190,228,0.5)');
    g.addColorStop(1, 'rgba(165,190,228,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  // A long, bumpy snowbank: bright top edge, soft blue-grey shading beneath.
  // `offset` shifts the bumps so the three layers don't line up.
  function paintDrift(offset) {
    const w = 1024;
    const h = 64;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const edge = (x) => 26 + 6 * Math.sin(x * 0.011 + 1 + offset) + 4 * Math.sin(x * 0.027 + 2 + offset) + 2.5 * Math.sin(x * 0.061 + 0.5 + offset);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, edge(x));
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 18, 0, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#f3f8ff');
    g.addColorStop(1, '#cfdef0');
    ctx.shadowColor = 'rgba(150,180,220,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Gentle shading under the crest of each mound, then a bright rim on top.
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = edge(x) + 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(160,190,230,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = edge(x);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // A scatter of glinting crystals.
    let seed = 7 + Math.round(offset * 10);
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 90; i += 1) {
      const x = rand() * w;
      const y = edge(x) + 6 + rand() * (h - edge(x) - 8);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + rand() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  function createSnowfall(scene) {
    const flakeTex = new THREE.CanvasTexture(paintFlake());
    flakeTex.minFilter = THREE.LinearFilter;
    flakeTex.generateMipmaps = false;
    const driftTexes = DRIFT_LAYERS.map((cfg) => {
      const tex = new THREE.CanvasTexture(paintDrift(cfg.offset));
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      return tex;
    });

    let seed = Math.random() * 1000;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const layers = LAYERS.map((cfg) => {
      const max = Math.ceil(MAX_FLAKES * cfg.share);
      const positions = new Float32Array(max * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        map: flakeTex,
        size: cfg.size,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.position.z = cfg.z;
      points.visible = false;
      scene.add(points);
      const flakes = [];
      for (let i = 0; i < max; i += 1) {
        flakes.push({ bx: 0, y: 0, vy: 0, phase: rand() * 6.28, freq: 0.6 + rand() * 1.2, landY: 0, placed: false });
      }
      return { cfg, max, positions, geometry, material, points, flakes };
    });

    // Three snowbank layers, back to front; each grows during its own third.
    const drifts = DRIFT_LAYERS.map((cfg, i) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: driftTexes[i], color: cfg.tint, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      mesh.renderOrder = 0;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });

    let clock = 0;
    let intensity = 0; // flake opacity, eases 0..1
    let depth = 0; // 0..1 across all three layers (each layer is a third)
    let wasWidth = 0;

    function respawn(layer, f, width, height, anywhere) {
      f.bx = rand() * width;
      f.y = anywhere ? rand() * height : -rand() * 60 - 4;
      f.vy = layer.cfg.speed[0] + rand() * (layer.cfg.speed[1] - layer.cfg.speed[0]);
      // Each flake settles somewhere within the bank instead of all stopping at one line.
      f.landY = height - rand() * Math.max(4, depth * SETTLED_DEPTH * 0.8 + 3);
      f.placed = true;
    }

    // opts: { enabled, width, height }
    function update(dt, opts) {
      const o = opts || {};
      const width = o.width || global.innerWidth;
      const height = o.height || global.innerHeight;
      clock += dt;

      // Snow falls while the bank is still building; once the third layer is
      // down the flakes fade out and only the snowbank remains.
      const snowing = !!o.enabled && depth < 1;
      intensity += ((snowing ? 1 : 0) - intensity) * Math.min(1, dt * 1.6);
      if (!snowing && intensity < 0.01) intensity = 0;

      if (o.enabled) depth = Math.min(1, depth + dt / (LAYER_SECONDS * DRIFT_LAYERS.length));
      else depth = Math.max(0, depth - dt / 8);

      drifts.forEach((mesh, i) => {
        const progress = Math.min(1, Math.max(0, depth * DRIFT_LAYERS.length - i));
        const eased = progress * progress * (3 - 2 * progress);
        mesh.visible = eased > 0.01;
        if (!mesh.visible) return;
        const h = Math.max(4, DRIFT_LAYERS[i].height * eased);
        mesh.scale.set(width, -h, 1);
        mesh.position.set(width / 2, height - h / 2 + 2, DRIFT_LAYERS[i].z);
        mesh.material.opacity = Math.min(1, 0.4 + eased);
      });

      const total = Math.max(90, Math.min(MAX_FLAKES, Math.round(width / 4.5)));
      const wind = Math.sin(clock * 0.15) * 10 + Math.sin(clock * 0.43 + 1.3) * 6;
      layers.forEach((layer) => {
        const live = intensity > 0;
        layer.points.visible = live;
        if (!live) return;
        const count = Math.min(layer.max, Math.ceil(total * layer.cfg.share));
        layer.material.opacity = layer.cfg.opacity * intensity;
        layer.geometry.setDrawRange(0, count);
        const pos = layer.positions;
        for (let i = 0; i < count; i += 1) {
          const f = layer.flakes[i];
          if (!f.placed || wasWidth !== width) respawn(layer, f, width, height, true);
          f.y += f.vy * dt;
          f.bx += wind * layer.cfg.wind * dt;
          if (f.bx < -30) f.bx += width + 60;
          else if (f.bx > width + 30) f.bx -= width + 60;
          // While the bank is still building, landed flakes start again at the
          // top; once it is complete they just finish falling and fade away.
          if (f.y >= f.landY) {
            if (snowing) respawn(layer, f, width, height, false);
            else f.y = height + 20;
          }
          pos[i * 3] = f.bx + Math.sin(clock * f.freq + f.phase) * layer.cfg.sway;
          pos[i * 3 + 1] = f.y;
          pos[i * 3 + 2] = 0;
        }
        layer.geometry.attributes.position.needsUpdate = true;
      });
      wasWidth = width;
    }

    function dispose() {
      layers.forEach((layer) => {
        scene.remove(layer.points);
        layer.geometry.dispose();
        layer.material.dispose();
      });
      drifts.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      flakeTex.dispose();
      driftTexes.forEach((t) => t.dispose());
    }

    return {
      update,
      dispose,
      get intensity() { return intensity; },
      get depth() { return depth; },
      get snowing() { return intensity > 0; },
    };
  }

  PocketPal.Snowfall = { createSnowfall };
})(window);
