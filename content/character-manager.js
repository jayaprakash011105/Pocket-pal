// Bridges the procedural character registry (characters/registry.js) with
// per-frame procedural animation, and is the single place a future real GLB
// model + animation clips would plug in (see loadGLTF below).
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const { Characters } = PocketPal;
  const { clamp, lerp } = PocketPal.Utils;
  const THREE = global.THREE;

  const BASE_SCALE = 70;
  const FOOT_LIFT = 0.82;

  function getManifest() {
    return Characters.loadManifest();
  }

  function findCharacterDef(manifestData, id) {
    return manifestData.characters.find((c) => c.id === id) || manifestData.characters[0];
  }

  // Custom-uploaded GLB characters (options page "Custom Characters" panel)
  // are loaded here. They keep whatever animation clips they shipped with and
  // play the best-matching clip for the current behaviour state; they don't
  // get the procedural per-limb rig the built-in roster uses, since an
  // arbitrary uploaded mesh has no known bone/part names to drive.
  function loadGLTFFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.parse(PocketPal.Utils.dataUrlToArrayBuffer(dataUrl), '', resolve, reject);
    });
  }

  // Sprite characters: the artwork is a transparent PNG on a plane inside the
  // 3D scene, animated with squash/stretch, hops and tilts driven by state.
  const SPRITE_PX = 124;

  // Visual gait per animation style. `amp`/`freq` shape the walking step cycle;
  // `smooth` scales how briskly the displayed pose eases toward its target
  // (lower = floatier, higher = snappier). 'bounce' has no step cycle: the
  // physics body really jumps (see movement.js), so the sprite only squashes
  // and stretches with that motion.
  const GAITS = {
    walk: { amp: 2.2, freq: 2.4, tilt: 0.03, mode: 'hover', smooth: 0.35, posSmooth: 0.45 },
    bounce: { amp: 0, freq: 1, tilt: 0, mode: 'none', smooth: 1.3 },
    float: { amp: 2, freq: 2.2, tilt: 0.035, mode: 'hover', smooth: 0.3, posSmooth: 0.35 },
  };

  function createSpriteInstance(def, accessoryIds) {
    return PocketPal.Utils.loadSpriteBitmap(def.id).then((bitmap) => {
      const texture = new THREE.CanvasTexture(bitmap);
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.repeat.y = -1;
      texture.offset.y = 1;
      const k = SPRITE_PX / Math.max(bitmap.width, bitmap.height);
      const w = bitmap.width * k;
      const h = bitmap.height * k;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      const group = new THREE.Group();
      group.add(mesh);
      let userScale = 1;
      let t = Math.random() * 10;
      // Everyone floats until content.js applies the user's animation style.
      let floats = def.floats !== false;
      let gait = floats ? GAITS.float : GAITS.walk;

      // Outfit pieces and little animation extras ride on the sprite mesh (so
      // they squash/tilt/mirror with it) at anchors placed per pet.
      const Acc = PocketPal.Accessories;
      const FX = PocketPal.Effects;
      const anchors = Acc ? Acc.anchorsFor(def, bitmap) : null;
      const worn = {}; // accessory id -> { mesh, texture }
      const extras = []; // every other overlay, disposed with the instance
      // Local +x points the way the art faces; facingFlip art is mirrored.
      const fwdLocal = def.facingFlip ? -1 : 1;

      function makeTexture(canvas) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
      }

      // Plane of (pw x ph) bitmap pixels centred on bitmap point (cx, cy).
      function makePlane(canvas, cx, cy, pw, ph, order, z) {
        const texture = makeTexture(canvas);
        const piece = new THREE.Mesh(
          new THREE.PlaneGeometry(pw * k, ph * k),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
        );
        piece.position.set((cx - bitmap.width / 2) * k, (bitmap.height / 2 - cy) * k, z || 1);
        piece.renderOrder = order;
        return { mesh: piece, texture };
      }

      function disposePiece(piece) {
        (piece.mesh.parent || mesh).remove(piece.mesh);
        piece.mesh.geometry.dispose();
        piece.mesh.material.dispose();
        piece.texture.dispose();
      }

      function addExtra(canvas, cx, cy, pw, ph, order, parent) {
        const piece = makePlane(canvas, cx, cy, pw, ph, order, 1);
        piece.mesh.visible = false;
        (parent || mesh).add(piece.mesh);
        extras.push(piece);
        return piece.mesh;
      }

      function makeWorn(id) {
        const spec = Acc.byId[id] || Acc.SEASONAL[id];
        const canvas = Acc.draw(id);
        if (!spec || !canvas) return null;
        if (anchors.skip.includes(spec.slot)) return null;
        const spot = Acc.place(id, anchors[spec.slot]);
        const piece = makePlane(canvas, spot.cx, spot.cy, spot.w, spot.h, 2, 1);
        piece.mesh.rotation.z = -spot.rot;
        mesh.add(piece.mesh);
        return piece;
      }

      let season = 'none';
      let santa = null;
      let ghost = null;

      function applySeason() {
        if (!Acc || !anchors) return;
        const ghostOn = season === 'ghost';
        Object.keys(worn).forEach((id) => { worn[id].mesh.visible = !ghostOn; });
        const hasHeadItem = Object.keys(worn).some((id) => Acc.byId[id] && Acc.byId[id].slot === 'head');
        const wantSanta = season === 'santa' && !hasHeadItem;
        if (wantSanta && !santa) santa = makeWorn('santa-hat');
        if (!wantSanta && santa) { disposePiece(santa); santa = null; }
        if (ghostOn && !ghost && FX) {
          const gsep = anchors.face.width;
          const grot = anchors.face.rot || 0;
          const eyes = [-1, 1].map((sgn) => {
            const ex = anchors.face.x + sgn * Math.cos(grot) * gsep / 2;
            const ey = anchors.face.y + sgn * Math.sin(grot) * gsep / 2;
            return { u: (ex / bitmap.width - 0.5) / 1.1 + 0.5, v: (ey / bitmap.height - 0.5) / 1.1 + 0.5, r: (gsep / bitmap.width) * 0.17 / 1.1 };
          });
          const aspect = bitmap.height / bitmap.width;
          ghost = makePlane(FX.ghostSheet(aspect, eyes), bitmap.width / 2, bitmap.height / 2, bitmap.width * 1.1, bitmap.height * 1.1, 6, 2);
          mesh.add(ghost.mesh);
        }
        if (!ghostOn && ghost) { disposePiece(ghost); ghost = null; }
      }

      function setSeason(name) {
        season = name === 'santa' || name === 'ghost' ? name : 'none';
        applySeason();
      }

      function clearAccessory(id) {
        const piece = worn[id];
        if (!piece) return;
        disposePiece(piece);
        delete worn[id];
      }

      function setAccessories(ids) {
        if (!Acc || !anchors) return;
        const wanted = new Set(ids || []);
        Object.keys(worn).forEach((id) => { if (!wanted.has(id)) clearAccessory(id); });
        wanted.forEach((id) => {
          if (worn[id]) return;
          const piece = makeWorn(id);
          if (piece) worn[id] = piece;
        });
        applySeason();
      }

      // ---- Blink, yawn, wave and sneeze overlays -----------------------------
      let lidL = null;
      let lidR = null;
      let mouthMesh = null;
      let waveRig = null;
      const puffs = [];
      const sep = anchors ? anchors.face.width : 0;
      if (FX && anchors) {
        if (anchors.blink) {
          try {
            const sample = FX.sampler(bitmap);
            const rot = anchors.face.rot || 0;
            const lids = [-1, 1].map((sgn) => {
              const ex = anchors.face.x + sgn * Math.cos(rot) * sep / 2;
              const ey = anchors.face.y + sgn * Math.sin(rot) * sep / 2;
              const color = sample(ex, ey - sep * 0.34);
              const lw = sep * anchors.eyeW;
              const m = addExtra(FX.lid(color), ex, ey, lw, lw * 0.667, 3);
              m.rotation.z = -rot;
              return m;
            });
            lidL = lids[0];
            lidR = lids[1];
          } catch (err) {
            lidL = null;
            lidR = null;
          }
        }
        if (!anchors.noMouth) {
          mouthMesh = addExtra(FX.mouth(), anchors.mouth.x, anchors.mouth.y, anchors.mouth.width * 1.3, anchors.mouth.width * 1.3, 3);
          mouthMesh.rotation.z = -(anchors.mouth.rot || 0);
        }
        // Mitten pivots at its cuff, placed beside the neck.
        const mw = Math.min(sep * 0.95, bitmap.width * 0.2);
        const rig = new THREE.Group();
        rig.position.set((anchors.neck.x + anchors.neck.width * 0.62 - bitmap.width / 2) * k, (bitmap.height / 2 - (anchors.neck.y + sep * 0.25)) * k, 1);
        const hand = makePlane(FX.mitten((def.colors && def.colors.primary) || '#ffffff'), 0, 0, mw, mw * 1.125, 3, 1);
        hand.mesh.position.set(0, (mw * 1.125 * k) / 2 - mw * 0.1 * k, 1);
        rig.add(hand.mesh);
        rig.visible = false;
        mesh.add(rig);
        extras.push(hand);
        waveRig = rig;
        const puffCanvas = FX.puff();
        for (let i = 0; i < 4; i += 1) {
          const m = addExtra(puffCanvas, anchors.mouth.x, anchors.mouth.y, sep * 0.3, sep * 0.3, 3);
          puffs.push({ mesh: m, seed: null, delay: i * 0.035 });
        }
      }

      let blinkIn = 2.5 + Math.random() * 2.5;
      let blinkT = 0;
      let lastState = '';
      let stateAge = 0;

      function setStyle(style, floatsFlag) {
        floats = !!floatsFlag;
        gait = GAITS[style] || (floats ? GAITS.float : GAITS.walk);
      }

      setAccessories(accessoryIds);

      // Display values ease toward their targets so state changes, turns and
      // hops never snap; k is an exponential-smoothing rate per second.
      const disp = { x: null, y: null, sx: 1, sy: 1, hop: 0, tilt: 0 };
      const ease = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

      // 0 -> 1 -> 0 envelope: ramps up over `a`, holds, ramps down after `b`.
      const envelope = (p, a, b) => (p < a ? p / a : p > b ? Math.max(0, (1 - p) / (1 - b)) : 1);

      function update(dt, state, body, settings) {
        t += dt * (settings.animSpeed || 1) * (settings.reducedMotion ? 0.5 : 1);
        if (state !== lastState) {
          lastState = state;
          stateAge = 0;
        }
        stateAge += dt;
        const facingScreen = body.facing < 0 ? -1 : 1;
        // Mirroring flips rotation: a screen-space CCW angle needs this sign.
        const faceSign = facingScreen * (def.facingFlip ? -1 : 1);
        let sx = body.squashX;
        let sy = body.squashY;
        let hop = 0;
        let tilt = 0;
        let yawnOpen = 0;
        let waveAmt = 0;
        let sneezeAge = -1;
        switch (state) {
          case 'walk': {
            const f = clamp(Math.abs(body.svx) / 80, 0.5, 1.8);
            const phase = t * gait.freq * f;
            if (gait.mode === 'none') {
              // Bounce: the body itself is jumping, nothing to add.
            } else if (gait.mode === 'hover') {
              // Float: gentle continuous bob, no footstep snap.
              hop = Math.sin(phase) * gait.amp;
              tilt = Math.sin(phase * 0.5) * gait.tilt;
            } else {
              const wave = Math.sin(phase);
              hop = wave * wave * gait.amp;
              tilt = Math.sin(phase * 0.5) * gait.tilt;
            }
            break;
          }
          case 'idle':
          case 'peek':
            sy *= 1 + Math.sin(t * 2) * 0.02;
            break;
          case 'yawn': {
            yawnOpen = envelope(Math.min(1, stateAge / 2), 0.3, 0.7);
            yawnOpen = Math.sin((yawnOpen * Math.PI) / 2);
            sy *= 1 + 0.05 * yawnOpen;
            sx *= 1 - 0.02 * yawnOpen;
            hop += 3 * yawnOpen;
            break;
          }
          case 'wave': {
            waveAmt = envelope(Math.min(1, stateAge / 1.8), 0.12, 0.88);
            tilt += faceSign * Math.sin(t * 5) * 0.04 * waveAmt;
            sy *= 1 + Math.sin(t * 10) * 0.012 * waveAmt;
            break;
          }
          case 'sneeze': {
            sneezeAge = stateAge;
            let lean = 0;
            if (sneezeAge < 0.45) {
              const wind = Math.sin((sneezeAge / 0.45) * (Math.PI / 2));
              lean = 0.2 * wind;
              sy *= 1 + 0.05 * wind;
              sx *= 1 - 0.03 * wind;
              hop += 4 * wind;
            } else if (sneezeAge < 0.62) {
              const j = Math.sin(((sneezeAge - 0.45) / 0.17) * Math.PI);
              lean = -0.28 * j + 0.02;
              sy *= 0.93;
              sx *= 1.07;
            } else {
              const r = Math.min(1, (sneezeAge - 0.62) / 0.38);
              lean = -0.08 * (1 - r);
              sy *= 0.97 + 0.03 * r;
              sx *= 1.03 - 0.03 * r;
            }
            tilt += lean * facingScreen * faceSign;
            break;
          }
          case 'sit':
            if (floats) {
              // Floating characters have no legs to sit on — hover softly
              // instead of squashing, which used to look like a compress glitch.
              hop += Math.sin(t * 1.4) * 5;
            } else {
              sy *= 0.92;
              sx *= 1.04;
            }
            break;
          case 'sleep':
            if (floats) {
              sy *= 1 + Math.sin(t * 1.5) * 0.03;
              tilt = Math.sin(t * 0.8) * 0.08;
            } else {
              sy *= 0.92 + Math.sin(t * 1.5) * 0.015;
              sx *= 1.04;
              tilt = 0.1;
            }
            break;
          case 'dance': {
            const wave = Math.sin(t * 7);
            hop = wave * wave * 12;
            tilt = Math.sin(t * 3.5) * 0.2;
            break;
          }
          case 'react': {
            const p = 1 + Math.sin(t * 10) * Math.sin(t * 10) * 0.08;
            sx *= p;
            sy *= p;
            hop = Math.sin(t * 10) * Math.sin(t * 10) * 5;
            break;
          }
          case 'wake':
            hop = Math.sin(t * 6) * Math.sin(t * 6) * 7;
            break;
          case 'dragged':
            tilt = Math.sin(t * 5) * 0.14;
            break;
          case 'look':
            tilt = Math.sin(t * 2.4) * 0.04;
            break;
          case 'hop':
            // Corner hop in flight: stretch along the arc, lean into the turn.
            sy *= 1.06;
            sx *= 0.95;
            tilt = Math.sin(t * 5) * 0.05;
            break;
          case 'jump':
            if (floats) tilt = Math.sin(t * 4) * 0.05;
            break;
          default:
            break;
        }
        if (floats) hop += 12 + Math.sin(t * 1.8) * 5;

        if (disp.x === null || Math.hypot(body.x - disp.x, body.y - disp.y) > 250) {
          disp.x = body.x;
          disp.y = body.y;
        }
        // The sneeze jolt has to snap, so it ignores the floaty smoothing.
        const smooth = state === 'sneeze' ? Math.max(gait.smooth || 1, 1.4) : gait.smooth || 1;
        const posSmooth = gait.posSmooth || 1;
        disp.x = ease(disp.x, body.x, 40 * posSmooth, dt);
        disp.y = ease(disp.y, body.y, 40 * posSmooth, dt);
        disp.sx = ease(disp.sx, sx, 14 * smooth, dt);
        disp.sy = ease(disp.sy, sy, 14 * smooth, dt);
        disp.hop = ease(disp.hop, hop, 16 * smooth, dt);
        disp.tilt = ease(disp.tilt, tilt, 10 * smooth, dt);

        // Peeking out from a screen edge: shift outward, lean toward the screen.
        const peek = body.peek || 0;
        const peekSide = body.peekSide || 0;
        group.position.set(disp.x + peekSide * 0.3 * w * userScale * peek, disp.y, 0);
        // Same pixel-space/Y-down convention as the procedural characters.
        // Facing flips instantly (not eased) so the turn is a clean snap
        // instead of the sprite smearing through zero width mid-turn.
        // facingFlip corrects a handful of source sprites (lumi, foxy, puff)
        // that were cut from the reference art facing the opposite way from
        // the rest of the roster, which otherwise made them walk backwards.
        const face = (body.facing < 0 ? -1 : 1) * (def.facingFlip ? -1 : 1);
        group.scale.set(userScale * face, -userScale, userScale);
        mesh.scale.set(disp.sx, disp.sy, 1);
        mesh.position.set(0, (h * disp.sy) / 2 + disp.hop, 0);
        const surfaceTargets = { ground: 0, 'wall-left': Math.PI / 2, ceiling: Math.PI, 'wall-right': -Math.PI / 2 };
        let diff = (surfaceTargets[body.surface] || 0) - group.rotation.z;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        group.rotation.z += diff * (1 - Math.exp(-8 * dt));
        mesh.rotation.z = disp.tilt + (peek > 0 ? peekSide * 0.25 * peek * faceSign : 0);

        // Overlays: blink lids, yawn mouth, waving mitten, sneeze puffs.
        const ghostOn = season === 'ghost';
        if (lidL) {
          blinkIn -= dt;
          if (blinkIn <= 0) {
            blinkT = 0.14;
            blinkIn = 2.5 + Math.random() * 2.5;
          }
          let lidAmt = 0;
          if (state !== 'sleep' && !ghostOn) {
            if (blinkT > 0) lidAmt = Math.sin((1 - blinkT / 0.14) * Math.PI);
            lidAmt = Math.max(lidAmt, yawnOpen > 0.5 ? 1 : 0);
          }
          blinkT = Math.max(0, blinkT - dt);
          lidL.visible = lidAmt > 0.05;
          lidR.visible = lidL.visible;
          lidL.scale.set(1, Math.max(0.05, lidAmt), 1);
          lidR.scale.set(1, Math.max(0.05, lidAmt), 1);
        }
        if (mouthMesh) {
          mouthMesh.visible = yawnOpen > 0.04 && !ghostOn;
          const m = 0.15 + 0.85 * yawnOpen;
          mouthMesh.scale.set(m, m, 1);
        }
        if (waveRig) {
          waveRig.visible = waveAmt > 0.02 && !ghostOn;
          waveRig.rotation.z = -fwdLocal * (0.15 + Math.sin(t * 11) * 0.5) * waveAmt;
          waveRig.scale.set(waveAmt, waveAmt, 1);
        }
        puffs.forEach((pf) => {
          const q = sneezeAge >= 0 ? (sneezeAge - 0.45 - pf.delay) / 0.5 : -1;
          if (q < 0 || q > 1 || ghostOn || anchors.noMouth) {
            pf.mesh.visible = false;
            pf.seed = null;
            return;
          }
          if (!pf.seed) pf.seed = { vx: 70 + Math.random() * 60, vy: (Math.random() - 0.4) * 50 };
          const mx = (anchors.mouth.x - bitmap.width / 2) * k;
          const my = (bitmap.height / 2 - anchors.mouth.y) * k;
          pf.mesh.visible = true;
          pf.mesh.position.set(mx + fwdLocal * pf.seed.vx * q * 0.5, my + pf.seed.vy * q * 0.5, 3);
          const sc = 0.5 + q * 1.4;
          pf.mesh.scale.set(sc, sc, 1);
          pf.mesh.material.opacity = (1 - q) * 0.9;
        });
      }

      return {
        def,
        group,
        get floats() { return floats; },
        update,
        setAccessories,
        setStyle,
        setSeason,
        setScale(s) { userScale = s; },
        dispose() {
          Object.keys(worn).forEach(clearAccessory);
          if (santa) disposePiece(santa);
          if (ghost) disposePiece(ghost);
          extras.forEach(disposePiece);
          extras.length = 0;
          mesh.geometry.dispose();
          mesh.material.dispose();
          texture.dispose();
          if (bitmap.close) bitmap.close();
        },
      };
    });
  }

  function createInstance(def, accessoryIds) {
    if (def.custom && def.modelDataUrl) {
      return createCustomInstance(def);
    }
    if (def.sprite) {
      return createSpriteInstance(def, accessoryIds);
    }
    return Promise.resolve(createProceduralInstance(def, accessoryIds));
  }

  function createCustomInstance(def) {
    return loadGLTFFromDataUrl(def.modelDataUrl).then((gltf) => {
      const group = new THREE.Group();
      const model = gltf.scene || gltf.scenes[0];

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const targetHeight = 130;
      const scale = size.y > 0 ? targetHeight / size.y : 1;
      model.scale.setScalar(scale);
      box.setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);
      model.position.y += (size.y * scale) / 2;
      group.add(model);

      const mixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations || [];
      const clipFor = (state) => {
        const aliases = {
          walk: ['walk', 'run', 'move'],
          idle: ['idle', 'stand'],
          jump: ['jump'],
          fall: ['fall', 'jump'],
          land: ['land', 'idle'],
          sit: ['sit'],
          sleep: ['sleep', 'idle'],
          dance: ['dance'],
          react: ['react', 'hit', 'idle'],
          wake: ['wake', 'idle'],
          dragged: ['idle'],
        };
        const names = aliases[state] || ['idle'];
        for (const n of names) {
          const match = clips.find((c) => c.name.toLowerCase().includes(n));
          if (match) return match;
        }
        return clips[0] || null;
      };

      let currentAction = null;
      function playState(state) {
        const clip = clipFor(state);
        if (!clip) return;
        const action = mixer.clipAction(clip);
        if (currentAction === action) return;
        action.reset().fadeIn(0.25).play();
        if (currentAction) currentAction.fadeOut(0.25);
        currentAction = action;
      }

      function update(dt, state, body, settings) {
        group.position.set(body.x, body.y, 0);
        const s = group.userData.scale || 1;
        const face = (body.facing < 0 ? -1 : 1) * (def.facingFlip ? -1 : 1);
        group.scale.set(s * face, -s, s);
        mixer.update(dt * (settings.animSpeed || 1));
        playState(state);
      }

      function setScale(scale) {
        group.userData.scale = scale;
      }

      function dispose() {
        group.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        });
      }

      return {
        def,
        group,
        floats: false,
        custom: true,
        update,
        setAccessories() {},
        setScale,
        dispose,
      };
    });
  }

  function createProceduralInstance(def, accessoryIds) {
    const built = Characters.build(def, accessoryIds || []);
    const clock = { t: Math.random() * 10, blink: 2 + Math.random() * 3 };
    let userScale = 1;

    // Models are authored ~1 unit tall; the camera is pixel-space, and world Y
    // points down the screen, so scale up to pixels and flip Y to stand upright.
    // Facing flips instantly (not eased), so turning is a clean snap rather
    // than an animated mirror transition.
    function applyScale(group, facing) {
      const s = BASE_SCALE * userScale;
      group.scale.set(s * (facing < 0 ? -1 : 1), -s, s);
    }

    function applySurfaceRotation(group, surface) {
      const targets = {
        ground: 0,
        'wall-left': Math.PI / 2,
        ceiling: Math.PI,
        'wall-right': -Math.PI / 2,
      };
      const target = targets[surface] || 0;
      let diff = target - group.rotation.z;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      group.rotation.z += diff * 0.2;
    }

    function update(dt, state, body, settings, lookTarget) {
      const animSpeed = (settings.animSpeed || 1) * (settings.reducedMotion ? 0.5 : 1);
      clock.t += dt * animSpeed;
      const { parts } = built;

      // Camera is orthographic with top=0/bottom=height, so world Y already
      // matches CSS pixel Y top-down — no flip needed (see pet-engine.js).
      built.group.position.x = body.x;
      built.group.position.y = body.y;
      applySurfaceRotation(built.group, body.surface);
      applyScale(built.group, body.facing * (def.facingFlip ? -1 : 1));

      const bodyScaleX = body.squashX;
      const bodyScaleY = body.squashY;
      parts.body.scale.set(bodyScaleX, bodyScaleY * 0.92, 0.88);

      // Blink timer (independent of state, skipped while asleep/robotic).
      clock.blink -= dt;
      const canBlink = parts.eyeLidL && state !== 'sleep';
      if (canBlink && clock.blink <= 0) {
        clock.blink = 2.5 + Math.random() * 3;
      }
      const blinking = canBlink && clock.blink > 0 && clock.blink < 0.12;
      if (parts.eyeLidL) {
        parts.eyeLidL.visible = state === 'sleep' || blinking;
        parts.eyeLidR.visible = state === 'sleep' || blinking;
      }
      if (parts.eyeL && parts.eyeR) {
        parts.eyeL.visible = !(state === 'sleep');
        parts.eyeR.visible = !(state === 'sleep');
      }

      let armSwing = 0;
      let legSwing = 0;
      let bob = 0;
      let openMouth = false;
      let crouch = 0;

      switch (state) {
        case 'walk': {
          const speedFactor = clamp(Math.abs(body.vx) / 80, 0.4, 2.2);
          armSwing = Math.sin(clock.t * 10 * speedFactor) * 0.35;
          legSwing = Math.sin(clock.t * 10 * speedFactor + Math.PI) * 0.3;
          bob = Math.abs(Math.sin(clock.t * 10 * speedFactor)) * 4;
          break;
        }
        case 'idle':
          bob = Math.sin(clock.t * 2) * 2;
          armSwing = Math.sin(clock.t * 1.4) * 0.05;
          break;
        case 'jump':
          armSwing = -0.6;
          legSwing = 0.3;
          break;
        case 'fall':
          armSwing = 0.3;
          legSwing = -0.2;
          break;
        case 'land':
          armSwing = 0.1;
          break;
        case 'sit':
          crouch = 0.12;
          armSwing = Math.sin(clock.t * 1.2) * 0.08;
          break;
        case 'sleep':
          crouch = 0.2;
          parts.mouthSmile.visible = false;
          bob = Math.sin(clock.t * 1.5) * 1.2;
          break;
        case 'dance':
          armSwing = Math.sin(clock.t * 9) * 0.8;
          legSwing = Math.sin(clock.t * 9 + Math.PI / 2) * 0.4;
          built.group.rotation.z += Math.sin(clock.t * 9) * 0.01;
          bob = Math.abs(Math.sin(clock.t * 9)) * 6;
          break;
        case 'react':
          openMouth = true;
          armSwing = Math.sin(clock.t * 14) * 0.5;
          bob = Math.abs(Math.sin(clock.t * 14)) * 5;
          break;
        case 'wake':
          armSwing = Math.sin(clock.t * 4) * 0.4;
          break;
        case 'dragged':
          bob = Math.sin(clock.t * 6) * 3;
          armSwing = 0.5;
          legSwing = -0.2;
          break;
        default:
          break;
      }

      if (state !== 'sleep') parts.mouthSmile.visible = !openMouth;
      parts.mouthOpen.visible = openMouth;

      if (parts.armL) parts.armL.rotation.z = armSwing;
      if (parts.armR) parts.armR.rotation.z = -armSwing;
      if (parts.legL) parts.legL.rotation.z = legSwing;
      if (parts.legR) parts.legR.rotation.z = -legSwing;

      parts.body.position.y = FOOT_LIFT + bob * 0.01 - crouch;

      // Look-around / cursor tracking via subtle head (body-local) rotation.
      if (lookTarget) {
        const dx = clamp((lookTarget.x - body.x) / 400, -1, 1);
        const dy = clamp((lookTarget.y - body.y) / 400, -1, 1);
        parts.head.rotation.y = lerp(parts.head.rotation.y, dx * 0.35, 0.1);
        parts.head.rotation.x = lerp(parts.head.rotation.x, -dy * 0.2, 0.1);
      } else {
        parts.head.rotation.y = lerp(parts.head.rotation.y, Math.sin(clock.t * 0.3) * 0.15, 0.05);
        parts.head.rotation.x = lerp(parts.head.rotation.x, 0, 0.05);
      }
    }

    function setAccessories(ids) {
      built.setAccessories(ids);
    }

    function setScale(scale) {
      userScale = scale;
      applyScale(built.group, Math.sign(built.group.scale.x) || 1);
    }

    function dispose() {
      built.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }

    return {
      def,
      group: built.group,
      floats: built.floats,
      update,
      setAccessories,
      setScale,
      dispose,
    };
  }

  PocketPal.CharacterManager = { getManifest, findCharacterDef, createInstance };
})(window);
