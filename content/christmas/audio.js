// ChristmasAudioManager: every Christmas sound is synthesised with WebAudio
// (no files, no network). Sounds are soft and short, and each name is rate
// limited so a burst of events never turns into noise.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const DEFAULT_GAP_MS = 80;
  const GAP_MS = { sleighbells: 700, jingle: 300, plow: 260, whoosh: 350, chime: 150, horn: 250, build: 400 };
  const MASTER_SCALE = 0.55;

  function create(ctx) {
    let ac = null;
    let master = null;
    let noiseBuffer = null;
    let enabled = true;
    let disposed = false;
    let lastVolume = -1;
    const lastPlayed = {};
    const nowMs = () => (ctx && typeof ctx.now === 'function' ? ctx.now() : global.performance.now());
    const settings = () => (ctx && ctx.settings ? ctx.settings() : {}) || {};

    function volume() {
      const v = settings().volume;
      return Math.min(1, Math.max(0, typeof v === 'number' ? v : 0.5));
    }

    function ensure() {
      if (ac || disposed) return ac;
      try {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        const comp = ac.createDynamicsCompressor();
        master = ac.createGain();
        master.gain.value = volume() * MASTER_SCALE;
        master.connect(comp);
        comp.connect(ac.destination);
      } catch (e) {
        ac = null;
        master = null;
      }
      return ac;
    }

    // Browsers keep audio locked until the page has had a user gesture. A
    // passive listener unlocks it the first time the user touches the page.
    function unlock() {
      const a = ensure();
      if (a && a.state === 'suspended' && a.resume) {
        try {
          a.resume().catch(() => undefined);
        } catch (e) {
          // blocked: stay silent
        }
      }
    }
    const gestureEvents = ['pointerdown', 'keydown', 'touchstart'];
    gestureEvents.forEach((name) => global.addEventListener(name, unlock, { capture: true, passive: true }));

    function applyVolume() {
      if (!ac || !master) return;
      lastVolume = volume();
      const target = lastVolume * MASTER_SCALE;
      try {
        master.gain.setTargetAtTime(target, ac.currentTime, 0.05);
      } catch (e) {
        master.gain.value = target;
      }
    }

    function noise() {
      if (noiseBuffer) return noiseBuffer;
      const length = Math.floor(ac.sampleRate * 1);
      noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return noiseBuffer;
    }

    // One pitched voice with a soft attack and an exponential release.
    function tone(freq, start, dur, o) {
      const opt = o || {};
      const t0 = ac.currentTime + start;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opt.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.glideTo), t0 + dur);
      const peak = Math.max(0.0002, (opt.gain || 0.2) * (opt.volume || 1));
      const attack = opt.attack || 0.005;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let out = osc;
      if (opt.lowpass) {
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = opt.lowpass;
        osc.connect(f);
        out = f;
      }
      out.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    function burst(start, dur, o) {
      const opt = o || {};
      const t0 = ac.currentTime + start;
      const src = ac.createBufferSource();
      src.buffer = noise();
      const filter = ac.createBiquadFilter();
      filter.type = opt.type || 'bandpass';
      filter.frequency.setValueAtTime(opt.freq || 2000, t0);
      if (opt.sweepTo) filter.frequency.exponentialRampToValueAtTime(opt.sweepTo, t0 + dur);
      filter.Q.value = opt.q || 1;
      const gain = ac.createGain();
      const peak = Math.max(0.0002, (opt.gain || 0.15) * (opt.volume || 1));
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + (opt.attack || 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0, Math.random() * 0.5, dur + 0.05);
    }

    // A glassy bell: a fundamental plus a quiet inharmonic partial.
    function bell(freq, start, dur, vol) {
      tone(freq, start, dur, { type: 'sine', gain: 0.16 * vol, attack: 0.004 });
      tone(freq * 2.76, start, dur * 0.55, { type: 'sine', gain: 0.05 * vol, attack: 0.004 });
    }

    const RECIPES = {
      jingle(v, r) {
        [880, 1108.7, 1318.5, 1760].forEach((f, i) => bell(f * r, i * 0.09 / r, 0.55, v));
      },
      sleighbells(v, r) {
        for (let i = 0; i < 11; i += 1) {
          const at = (i * 0.1 + Math.random() * 0.04) / r;
          const fade = 1 - i / 14;
          burst(at, 0.09, { type: 'highpass', freq: 5200, q: 0.8, gain: 0.07 * v * fade });
          tone((3300 + Math.random() * 2600) * r, at, 0.18, { gain: 0.035 * v * fade, attack: 0.002 });
        }
      },
      pop(v, r) {
        tone(620 * r, 0, 0.09, { glideTo: 150 * r, gain: 0.22 * v });
        burst(0, 0.04, { type: 'highpass', freq: 2500, gain: 0.08 * v });
      },
      plow(v, r) {
        tone(72 * r, 0, 0.4, { type: 'sawtooth', glideTo: 52 * r, gain: 0.07 * v, lowpass: 220, attack: 0.04 });
        burst(0, 0.4, { type: 'lowpass', freq: 420, gain: 0.08 * v, attack: 0.05 });
      },
      horn(v, r) {
        tone(392 * r, 0, 0.13, { type: 'square', gain: 0.06 * v, lowpass: 1500, attack: 0.012 });
        tone(523.3 * r, 0.16, 0.2, { type: 'square', gain: 0.06 * v, lowpass: 1500, attack: 0.012 });
      },
      gift(v, r) {
        tone(170 * r, 0, 0.14, { glideTo: 62, gain: 0.2 * v });
        [1760, 2217, 2637].forEach((f, i) => tone(f * r, 0.05 + i * 0.05, 0.22, { gain: 0.06 * v }));
      },
      thud(v, r) {
        tone(115 * r, 0, 0.16, { glideTo: 44, gain: 0.26 * v });
        burst(0, 0.06, { type: 'lowpass', freq: 320, gain: 0.1 * v });
      },
      chime(v, r) {
        bell(1046.5 * r, 0, 1.0, v);
        bell(1568 * r, 0.06, 0.8, v * 0.7);
      },
      whoosh(v, r) {
        burst(0, 0.5 / r, { type: 'bandpass', freq: 380, sweepTo: 2600, q: 0.9, gain: 0.13 * v, attack: 0.18 });
      },
      sparkle(v, r) {
        for (let i = 0; i < 5; i += 1) {
          tone((2000 + Math.random() * 2200) * r, i * 0.05 + Math.random() * 0.03, 0.14, { gain: 0.05 * v, attack: 0.002 });
        }
      },
      build(v, r) {
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => bell(f * r, i * 0.07, 0.6, v));
      },
      click(v, r) {
        burst(0, 0.025, { type: 'highpass', freq: 3000, gain: 0.07 * v });
        tone(1200 * r, 0, 0.04, { gain: 0.07 * v });
      },
    };

    // opts: { volume (multiplier), rate (pitch/speed multiplier) }. Returns true
    // if a sound was actually started.
    function play(name, opts) {
      if (!enabled || disposed || !RECIPES[name]) return false;
      const s = settings();
      if (s.sound === false) return false;
      const now = nowMs();
      const gap = GAP_MS[name] || DEFAULT_GAP_MS;
      if (lastPlayed[name] !== undefined && now - lastPlayed[name] < gap) return false;
      const a = ensure();
      if (!a) return false;
      if (a.state === 'suspended') {
        unlock();
        // Still locked: skip it rather than queueing sounds that all fire at once later.
        if (a.state !== 'running') return false;
      }
      lastPlayed[name] = now;
      applyVolume();
      const o = opts || {};
      try {
        RECIPES[name](Math.max(0, o.volume === undefined ? 1 : o.volume), o.rate > 0 ? o.rate : 1);
      } catch (e) {
        return false;
      }
      return true;
    }

    function setEnabled(on) {
      enabled = !!on;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      gestureEvents.forEach((name) => global.removeEventListener(name, unlock, { capture: true }));
      if (ac && ac.close) {
        try {
          ac.close().catch(() => undefined);
        } catch (e) {
          // already closed
        }
      }
      ac = null;
      master = null;
      noiseBuffer = null;
    }

    return {
      play,
      setEnabled,
      update() {
        if (ac && volume() !== lastVolume) applyVolume();
      },
      applySettings: applyVolume,
      dispose,
      get unlocked() { return !!ac && ac.state === 'running'; },
    };
  }

  Christmas.Audio = { create, SOUNDS: ['jingle', 'sleighbells', 'pop', 'plow', 'horn', 'gift', 'thud', 'chime', 'whoosh', 'sparkle', 'build', 'click'] };
})(window);
