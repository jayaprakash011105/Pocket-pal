// Procedural low-poly "toy blob" character builder.
//
// There are no bundled GLB sculpts yet (see README — real model.glb assets
// are a drop-in upgrade path via CharacterManager.loadGLTF). Every creature
// below is built at runtime from Three.js primitives so the extension never
// ships fake/placeholder model files. Segment counts are kept low on purpose
// for the intended low-poly toy look and for render performance.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const THREE = global.THREE;

  function loadManifest() {
    const storage = global.PocketPal.Storage;
    return Promise.all([
      PocketPal.Utils.loadExtensionText('characters/manifest.json').then((text) => JSON.parse(text)),
      storage ? storage.get().then((s) => s.customCharacters || []) : Promise.resolve([]),
    ]).then(([data, custom]) => ({
      version: data.version,
      categories: data.categories.includes('Custom') ? data.categories : data.categories.concat('Custom'),
      characters: data.characters.concat(custom.map((c) => ({ ...c, category: 'Custom' }))),
    }));
  }

  function material(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color,
      roughness: 0.55,
      metalness: 0.05,
    }, opts || {}));
  }

  function sphere(radius, color, opts, segments) {
    const seg = segments || 14;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg * 0.7), material(color, opts));
    mesh.castShadow = true;
    return mesh;
  }

  function cone(radius, height, color, opts, radialSegments) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, radialSegments || 8), material(color, opts));
    mesh.castShadow = true;
    return mesh;
  }

  function flatCircle(radius, color, opacity) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity != null ? opacity : 0.55 })
    );
    return mesh;
  }

  // ---- Shared anatomy -----------------------------------------------------

  function buildEyes(head, style, accent) {
    const eyeStyle = style || 'organic';
    const parts = {};
    const positions = [-0.17, 0.17];
    ['eyeL', 'eyeR'].forEach((key, i) => {
      const x = positions[i];
      const group = new THREE.Group();
      group.position.set(x, 0.04, 0.78);
      if (eyeStyle === 'digital') {
        const panel = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          new THREE.MeshStandardMaterial({ color: accent || '#5ad1ff', emissive: accent || '#5ad1ff', emissiveIntensity: 0.8, roughness: 0.3 })
        );
        panel.scale.set(1, 1.3, 0.4);
        group.add(panel);
        parts[key + 'Lid'] = null;
      } else {
        const pupil = sphere(0.085, '#241f21', { roughness: 0.2, metalness: 0.2 }, 10);
        const highlight = sphere(0.03, '#ffffff', { roughness: 0.1 }, 8);
        highlight.position.set(0.025, 0.03, 0.06);
        group.add(pupil, highlight);
        const lid = new THREE.Mesh(
          new THREE.TorusGeometry(0.09, 0.025, 6, 10, Math.PI),
          material('#241f21', { roughness: 0.3 })
        );
        lid.rotation.z = Math.PI;
        lid.visible = false;
        group.add(lid);
        parts[key + 'Lid'] = lid;
      }
      head.add(group);
      parts[key] = group;
    });
    return parts;
  }

  function buildMouth(head) {
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.018, 6, 10, Math.PI),
      material('#5c2a2a', { roughness: 0.4 })
    );
    smile.position.set(0, -0.14, 0.82);
    smile.rotation.z = Math.PI;
    head.add(smile);

    const open = sphere(0.07, '#7a2f33', { roughness: 0.4 }, 10);
    open.scale.set(0.9, 1.15, 0.6);
    open.position.set(0, -0.16, 0.82);
    open.visible = false;
    head.add(open);

    return { mouthSmile: smile, mouthOpen: open };
  }

  function buildBlush(head, color) {
    const left = flatCircle(0.09, color, 0.5);
    left.position.set(-0.32, -0.05, 0.74);
    const right = left.clone();
    right.position.x = 0.32;
    head.add(left, right);
    return { blushL: left, blushR: right };
  }

  function buildArm(side, colors) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.46, 0.05, 0.05);
    const arm = sphere(0.14, colors.primary, {}, 10);
    arm.scale.set(0.8, 1.2, 0.9);
    arm.position.set(side * 0.1, -0.1, 0);
    pivot.add(arm);
    return pivot;
  }

  function buildLeg(side, colors) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.24, -0.62, 0.05);
    const foot = sphere(0.15, colors.accent, {}, 10);
    foot.scale.set(0.95, 0.75, 1.05);
    foot.position.set(0, -0.06, 0.04);
    pivot.add(foot);
    return pivot;
  }

  function addPatch(parent, color, position, scale, opts) {
    const patch = sphere(0.22, color, opts || {}, 10);
    patch.scale.set(scale[0], scale[1], scale[2]);
    patch.position.set(position[0], position[1], position[2]);
    parent.add(patch);
    return patch;
  }

  // ---- Category decorations ------------------------------------------------

  const decorators = {
    Cats(ctx) {
      ['-1', '1'].forEach((s) => {
        const sign = Number(s);
        const ear = cone(0.14, 0.22, ctx.colors.primary, {}, 4);
        ear.rotation.y = Math.PI / 4;
        ear.position.set(sign * 0.3, 0.68, 0.18);
        ctx.head.add(ear);
      });
      const tail = new THREE.Group();
      tail.position.set(0, -0.2, -0.75);
      const seg = sphere(0.1, ctx.colors.primary, {}, 8);
      seg.scale.set(0.8, 0.8, 2.2);
      seg.position.z = -0.2;
      tail.add(seg);
      ctx.body.add(tail);
    },
    Dogs(ctx) {
      ['-1', '1'].forEach((s) => {
        const sign = Number(s);
        const ear = sphere(0.16, ctx.colors.secondary, {}, 10);
        ear.scale.set(0.5, 1.1, 0.35);
        ear.position.set(sign * 0.42, 0.45, 0.3);
        ear.rotation.z = sign * 0.5;
        ctx.head.add(ear);
      });
      const tail = sphere(0.1, ctx.colors.primary, {}, 8);
      tail.scale.set(0.8, 0.8, 1.6);
      tail.position.set(0, -0.1, -0.78);
      tail.rotation.x = 0.5;
      ctx.body.add(tail);
    },
    Robots(ctx) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.025, 0.28, 6),
        material('#8fa6c7')
      );
      stalk.position.set(0, 0.78, 0.1);
      const tip = sphere(0.05, ctx.colors.accent, { emissive: ctx.colors.accent, emissiveIntensity: 0.7 }, 8);
      tip.position.set(0, 0.95, 0.1);
      ctx.head.add(stalk, tip);
      const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.02), material(ctx.colors.accent, { emissive: ctx.colors.accent, emissiveIntensity: 0.4 }));
      panelL.position.set(0, -0.3, 0.8);
      ctx.head.add(panelL);
      ctx.extras.mouthBar = panelL;
    },
    Fantasy(ctx) {
      if (ctx.def.id === 'boo') return;
      ['-1', '1'].forEach((s) => {
        const sign = Number(s);
        const wing = sphere(0.22, ctx.colors.secondary, { transparent: true, opacity: 0.75 }, 10);
        wing.scale.set(0.15, 0.6, 1);
        wing.position.set(sign * 0.55, 0.1, -0.4);
        wing.rotation.y = sign * 0.6;
        ctx.body.add(wing);
      });
      for (let i = 0; i < 3; i += 1) {
        const spike = cone(0.05, 0.14, ctx.colors.accent, {}, 4);
        spike.position.set(0, 0.55 - i * 0.18, -0.4 - i * 0.12);
        ctx.body.add(spike);
      }
      const tail = sphere(0.09, ctx.colors.primary, {}, 8);
      tail.scale.set(0.7, 0.7, 2);
      tail.position.set(0, -0.2, -0.8);
      const tailTip = cone(0.07, 0.16, ctx.colors.accent, {}, 4);
      tailTip.position.set(0, -0.2, -1.3);
      tailTip.rotation.x = Math.PI / 2;
      ctx.body.add(tail, tailTip);
    },
    Blobs(ctx) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), material(ctx.colors.accent, { emissive: ctx.colors.accent, emissiveIntensity: 0.3, roughness: 0.2 }));
      gem.position.set(0, 0.92, 0.15);
      ctx.head.add(gem);
    },
    Critters(ctx) {
      switch (ctx.def.id) {
        case 'lumi': {
          for (let i = 0; i < 9; i += 1) {
            const puff = sphere(0.16, ctx.colors.secondary, { roughness: 0.9 }, 8);
            const a = (i / 9) * Math.PI * 2;
            puff.position.set(Math.cos(a) * 0.55, 0.25 + Math.sin(a) * 0.35, Math.sin(a * 1.3) * 0.3 + 0.2);
            ctx.body.add(puff);
          }
          ['-1', '1'].forEach((s) => {
            const ear = sphere(0.09, ctx.colors.accent, {}, 8);
            ear.position.set(Number(s) * 0.4, 0.55, 0.3);
            ctx.head.add(ear);
          });
          break;
        }
        case 'panda': {
          ['-1', '1'].forEach((s) => {
            const sign = Number(s);
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), material('#2b2b2b'));
            ear.position.set(sign * 0.38, 0.62, 0.05);
            ctx.head.add(ear);
            const patch = sphere(0.14, '#2b2b2b', { roughness: 0.6 }, 8);
            patch.scale.set(1, 1.3, 0.4);
            patch.position.set(sign * 0.2, 0.08, 0.8);
            ctx.head.add(patch);
          });
          break;
        }
        case 'pip': {
          addPatch(ctx.body, ctx.colors.secondary, [0, -0.15, 0.55], [0.55, 0.75, 0.4]);
          const beak = cone(0.08, 0.18, ctx.colors.accent, {}, 6);
          beak.rotation.x = Math.PI / 2;
          beak.position.set(0, -0.02, 0.85);
          ctx.head.add(beak);
          ['-1', '1'].forEach((s) => {
            const muff = sphere(0.12, ctx.colors.accent, {}, 8);
            muff.position.set(Number(s) * 0.52, 0.42, 0.1);
            ctx.head.add(muff);
          });
          const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 14), material('#d64545'));
          scarf.rotation.x = Math.PI / 2;
          scarf.position.set(0, -0.35, 0.1);
          ctx.body.add(scarf);
          break;
        }
        case 'foxy': {
          ['-1', '1'].forEach((s) => {
            const sign = Number(s);
            const ear = cone(0.15, 0.3, ctx.colors.primary, {}, 4);
            ear.rotation.y = Math.PI / 4;
            ear.position.set(sign * 0.32, 0.72, 0.1);
            ctx.head.add(ear);
          });
          addPatch(ctx.body, ctx.colors.secondary, [0, -0.1, 0.78], [0.45, 0.45, 0.35]);
          const tail = sphere(0.22, ctx.colors.primary, {}, 10);
          tail.scale.set(1, 1, 1.6);
          tail.position.set(0, 0, -0.85);
          const tip = sphere(0.1, ctx.colors.secondary, {}, 8);
          tip.position.set(0, 0.05, -1.3);
          ctx.body.add(tail, tip);
          break;
        }
        default:
          break;
      }
    },
  };

  const ACCESSORY_BUILDERS = {
    'witch-hat': () => {
      const group = new THREE.Group();
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 14), material('#2a2340'));
      brim.rotation.x = Math.PI / 2;
      const cone1 = cone(0.22, 0.42, '#2a2340', {}, 10);
      cone1.position.y = 0.24;
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), material('#ffd93d', { emissive: '#ffd93d', emissiveIntensity: 0.4 }));
      star.position.y = 0.1;
      group.add(brim, cone1, star);
      group.position.y = 0.55;
      return group;
    },
    bowtie: () => {
      const group = new THREE.Group();
      [-1, 1].forEach((sign) => {
        const wing = cone(0.1, 0.14, '#d64545', {}, 4);
        wing.rotation.z = sign * Math.PI / 2;
        wing.position.x = sign * 0.07;
        group.add(wing);
      });
      const knot = sphere(0.05, '#a33232', {}, 8);
      group.add(knot);
      return group;
    },
    scarf: () => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.08, 8, 14), material('#d64545'));
      ring.rotation.x = Math.PI / 2;
      return ring;
    },
    bandana: () => {
      const group = new THREE.Group();
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.08), material('#3f7bd6'));
      group.add(band);
      [-1, 1].forEach((sign) => {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.02), material('#3f7bd6'));
        flap.position.set(sign * 0.3, -0.18, -0.3);
        flap.rotation.z = sign * 0.3;
        group.add(flap);
      });
      return group;
    },
  };

  function build(def, accessoryIds) {
    const colors = def.colors;
    const root = new THREE.Group();
    root.name = `pet-${def.id}`;

    const body = sphere(0.6, colors.primary, {
      transparent: def.category === 'Blobs' || def.id === 'boo',
      opacity: def.category === 'Blobs' || def.id === 'boo' ? 0.82 : 1,
    }, 18);
    body.scale.set(1, 0.92, 0.88);
    body.position.y = 0;
    root.add(body);

    const head = new THREE.Group();
    head.position.set(0, 0.42, 0.18);
    body.add(head);
    const headMesh = sphere(0.0001, colors.primary, {}, 4); // anchor-only, real head is the body blob itself
    headMesh.visible = false;
    head.add(headMesh);

    const eyes = buildEyes(head, def.id === 'robo' ? 'digital' : 'organic', colors.accent);
    const mouth = buildMouth(head);
    const blush = def.id === 'robo' ? {} : buildBlush(head, colors.accent);

    const armL = buildArm(-1, colors);
    const armR = buildArm(1, colors);
    body.add(armL, armR);

    const floats = def.id === 'boo';
    let legL = null;
    let legR = null;
    if (!floats) {
      legL = buildLeg(-1, colors);
      legR = buildLeg(1, colors);
      body.add(legL, legR);
    }

    const headAnchor = new THREE.Group();
    headAnchor.position.set(0, 0.95, 0.1);
    body.add(headAnchor);
    const neckAnchor = new THREE.Group();
    neckAnchor.position.set(0, 0.25, 0.2);
    body.add(neckAnchor);

    const ctx = { def, colors, root, body, head, extras: {} };
    const decorate = decorators[def.category];
    if (decorate) decorate(ctx);

    const accessories = {};
    (accessoryIds || []).forEach((id) => {
      const builder = ACCESSORY_BUILDERS[id];
      if (!builder) return;
      const mesh = builder();
      const anchor = id === 'scarf' || id === 'bowtie' ? neckAnchor : headAnchor;
      anchor.add(mesh);
      accessories[id] = mesh;
    });

    root.scale.setScalar(1);

    return {
      group: root,
      floats,
      parts: {
        body,
        head,
        armL,
        armR,
        legL,
        legR,
        eyeL: eyes.eyeL,
        eyeR: eyes.eyeR,
        eyeLidL: eyes.eyeLLid,
        eyeLidR: eyes.eyeRLid,
        mouthSmile: mouth.mouthSmile,
        mouthOpen: mouth.mouthOpen,
        headAnchor,
        neckAnchor,
      },
      accessories,
      setAccessories(ids) {
        Object.keys(accessories).forEach((id) => {
          if (!ids.includes(id)) {
            accessories[id].parent && accessories[id].parent.remove(accessories[id]);
            delete accessories[id];
          }
        });
        ids.forEach((id) => {
          if (accessories[id]) return;
          const builder = ACCESSORY_BUILDERS[id];
          if (!builder) return;
          const mesh = builder();
          const anchor = id === 'scarf' || id === 'bowtie' ? neckAnchor : headAnchor;
          anchor.add(mesh);
          accessories[id] = mesh;
        });
      },
    };
  }

  PocketPal.Characters = { loadManifest, build, ACCESSORY_BUILDERS };
})(window);
