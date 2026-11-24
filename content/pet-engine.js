// Three.js scene/camera/renderer wrapper. The camera is orthographic and
// mapped 1:1 to CSS pixels (world units == screen pixels, Y measured down
// from the top) so every other module can work in plain pixel coordinates
// instead of doing 3D projection math.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const THREE = global.THREE;

  function createEngine(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();

    let width = global.innerWidth;
    let height = global.innerHeight;

    const camera = new THREE.OrthographicCamera(0, width, 0, height, -1000, 1000);
    camera.position.z = 500;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd8e6, 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(120, -200, 300);
    scene.add(key);
    const fill = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(fill);

    function setSize(w, h) {
      width = w;
      height = h;
      camera.left = 0;
      camera.right = w;
      camera.top = 0;
      camera.bottom = h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    setSize(width, height);

    let running = true;
    let rafId = null;
    let lastTime = performance.now();

    function visibilityHandler() {
      running = !document.hidden;
      if (running) {
        lastTime = performance.now();
        loop();
      } else if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler);

    let onTick = null;

    function loop() {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (onTick) onTick(dt);
      renderer.render(scene, camera);
    }

    function start(tickFn) {
      onTick = tickFn;
      lastTime = performance.now();
      loop();
    }

    function resize(w, h) {
      setSize(w, h);
    }

    function makeGroundShadow() {
      const geo = new THREE.CircleGeometry(1, 20);
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = 0;
      scene.add(mesh);
      return mesh;
    }

    function dispose() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', visibilityHandler);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
    }

    return { scene, camera, renderer, start, resize, dispose, makeGroundShadow, get width() { return width; }, get height() { return height; } };
  }

  PocketPal.PetEngine = { createEngine };
})(window);
