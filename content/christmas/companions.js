// The Christmas event system for pals. It only talks to pals through the
// generic brain API (say, special, goTo, jump, state, body), so any character,
// including ones added later, joins in without a line of Christmas code of its
// own: they greet the sleigh, run to gifts and new snowmen, hop away from the
// snow plow, sneeze when snowflakes land on their heads and now and then wish
// everyone a Merry Christmas.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const Christmas = PocketPal.Christmas || (PocketPal.Christmas = {});

  const LINES = {
    sleigh: ["Look, it's Santa!", 'Merry Christmas!', 'Ho ho ho!', 'Is that Rudolph?!', 'Wow, reindeer!'],
    sleighEcho: ['Wheee!', 'Hello up there!', 'Santa!'],
    gift: ['A present!', 'For me?!', 'Yay, a gift!', 'Ooh, shiny!'],
    snowman: ['What a great snowman!', 'Hello, Frosty!', 'Best snowman ever!', 'So cute!'],
    visit: ['Hi, snowman!', 'Still looking good!', 'Stay cool, Frosty!'],
    plow: ['Whoa, the plow!', 'Beep beep!', 'Coming through!'],
    flake: ['Brr! So cold!', 'Snowflake on my nose!', 'Ooh, snow tickles!'],
    festive: ['Merry Christmas!', 'Happy holidays!'],
    dance: ['Jingle bells!', 'Dashing through the snow!'],
  };

  // Outfits the manager or the settings page can ask for by name.
  const OUTFITS = {
    santa: { season: 'santa', items: [] },
    reindeer: { season: 'none', items: ['antlers', 'candy-scarf'] },
    elf: { season: 'none', items: ['elf-hat', 'bowtie'] },
    none: { season: 'none', items: [] },
  };

  const BUSY_STATES = new Set(['sleep', 'dragged', 'hop', 'wake', 'fall']);

  function create(ctx) {
    let enabled = true;
    let disposed = false;
    let clock = 0;
    let pollTimer = 0;
    let festiveAt = 0;
    let visitAt = 0;
    const queue = []; // { at, fn }
    const cooldown = {}; // `${petId}:${kind}` -> clock time it may react again
    const flakeHits = {};
    const snowmen = new Map(); // id -> { x, y }
    const hatted = new WeakSet(); // instances we put a Santa hat on
    let offs = [];

    const rand = () => (ctx.rand ? ctx.rand() : Math.random());
    const settings = () => (ctx.settings ? ctx.settings() : {}) || {};
    const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
    const reduced = () => (ctx.reducedMotion ? !!ctx.reducedMotion() : false);
    const scale = () => (ctx.scale ? ctx.scale() || 1 : 1);
    const pals = () => (ctx.pets ? ctx.pets() || [] : []);
    const bodyOf = (p) => (p && p.brain && p.brain.body) || null;

    function schedule(delay, fn) {
      queue.push({ at: clock + delay, fn });
    }

    function free(pal) {
      const brain = pal && pal.brain;
      if (!brain || BUSY_STATES.has(brain.state) || brain.hopping) return false;
      return true;
    }

    function ready(pal, kind, minGap) {
      const key = `${pal.id}:${kind}`;
      if (cooldown[key] !== undefined && clock < cooldown[key]) return false;
      cooldown[key] = clock + minGap + rand() * minGap * 0.4;
      return true;
    }

    function say(pal, lines) {
      if (pal.brain && typeof pal.brain.say === 'function') pal.brain.say(pick(lines));
    }

    function special(pal, name) {
      if (pal.brain && typeof pal.brain.special === 'function') pal.brain.special(name);
    }

    function nearest(x, filter) {
      let best = null;
      let bestD = Infinity;
      pals().forEach((p) => {
        const b = bodyOf(p);
        if (!b || (filter && !filter(p))) return;
        const d = Math.abs(b.x - x);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      });
      return best;
    }

    // Walks a pal over to x (if it can) and runs `then` on arrival, or right
    // away when it cannot walk.
    function visit(pal, x, then) {
      const brain = pal.brain;
      const side = (bodyOf(pal).x < x ? -1 : 1) * (48 + rand() * 24) * scale();
      if (typeof brain.goTo === 'function' && brain.goTo(x + side, then)) return true;
      return false;
    }

    // ---- Event reactions ---------------------------------------------------------

    function onSleighPass() {
      if (!enabled) return;
      const list = pals().filter(free);
      if (!list.length) return;
      const max = reduced() ? 1 : list.length;
      let delay = 0.4 + rand() * 1.2;
      list.slice(0, max).forEach((pal, i) => {
        if (!ready(pal, 'sleigh', 14)) return;
        schedule(delay, () => {
          if (!enabled || !free(pal)) return;
          if (i === 0 && !reduced()) {
            special(pal, 'wave');
            say(pal, LINES.sleigh);
          } else {
            say(pal, i === 0 ? LINES.sleigh : LINES.sleighEcho);
          }
        });
        delay += 0.5 + rand() * 0.9;
      });
    }

    function onGift(data) {
      if (!enabled || !data || typeof data.x !== 'number') return;
      const pal = nearest(data.x, (p) => free(p) && Math.abs(bodyOf(p).x - data.x) < 420 * scale());
      if (!pal || rand() > (reduced() ? 0.25 : 0.5) || !ready(pal, 'gift', 10)) return;
      // The gift is still falling on 'sleigh:gift', so give it a moment to land.
      schedule(0.6 + rand() * 0.8, () => {
        if (!enabled || !free(pal)) return;
        visit(pal, data.x, () => {
          say(pal, LINES.gift);
          if (!reduced()) special(pal, 'dance');
        });
      });
    }

    function onSnowmanBuilt(data) {
      if (!data) return;
      snowmen.set(data.id, { x: data.x, y: data.y });
      if (!enabled || typeof data.x !== 'number') return;
      const pal = nearest(data.x, free);
      if (!pal || !ready(pal, 'snowman', 8)) return;
      schedule(0.5 + rand() * 0.8, () => {
        if (!enabled || !free(pal)) return;
        const cheer = () => {
          say(pal, LINES.snowman);
          special(pal, reduced() ? 'wave' : 'dance');
        };
        if (!visit(pal, data.x, cheer)) cheer();
      });
    }

    function onSnowmanRemoved(data) {
      if (data) snowmen.delete(data.id);
    }

    function onCleanerPass(data) {
      if (!enabled || !data || typeof data.x !== 'number') return;
      pals().forEach((pal) => {
        const b = bodyOf(pal);
        if (!b || !free(pal) || !b.grounded) return;
        if (Math.abs(b.x - data.x) > 130 * scale() || rand() > (reduced() ? 0.15 : 0.4)) return;
        if (!ready(pal, 'plow', 15)) return;
        if (pal.brain && typeof pal.brain.jump === 'function') pal.brain.jump();
        say(pal, LINES.plow);
      });
    }

    // ---- Snowflakes landing on heads --------------------------------------------------

    function pollFlakes() {
      if (!ctx.flakes || typeof ctx.flakes.countIn !== 'function') return;
      const s = scale();
      pals().forEach((pal) => {
        const b = bodyOf(pal);
        if (!b) return;
        const rect = { x: b.x - 30 * s, y: b.y - 124 * s - 8, w: 60 * s, h: 30 * s };
        const seen = ctx.flakes.countIn(rect) || 0;
        const prev = flakeHits[pal.id] || 0;
        flakeHits[pal.id] = Math.max(0, prev - 0.6 * 0.25) + seen * 0.5;
        if (flakeHits[pal.id] < 3 || !free(pal) || rand() > (reduced() ? 0.1 : 0.35)) return;
        if (!ready(pal, 'flake', 14)) return;
        flakeHits[pal.id] = 0;
        if (!reduced() && rand() < 0.55) {
          special(pal, 'sneeze');
        } else {
          say(pal, LINES.flake);
        }
        if (ctx.events) ctx.events.emit('flake:hit', { petId: pal.id });
      });
    }

    // ---- Occasional festive behaviour -------------------------------------------------

    function nextFestive() {
      return clock + (reduced() ? 120 + rand() * 80 : 40 + rand() * 50);
    }

    function festive() {
      const candidates = pals().filter(free);
      if (!candidates.length) return;
      const pal = pick(candidates);
      if (!ready(pal, 'festive', 20)) return;
      if (rand() < 0.55 || reduced()) {
        special(pal, 'wave');
        say(pal, LINES.festive);
      } else {
        special(pal, 'dance');
        say(pal, LINES.dance);
      }
    }

    function visitSnowman() {
      if (!snowmen.size) return;
      const list = Array.from(snowmen.values());
      const target = pick(list);
      const pal = nearest(target.x, free);
      if (!pal || !ready(pal, 'visit', 30)) return;
      visit(pal, target.x, () => {
        say(pal, LINES.visit);
        special(pal, 'wave');
      });
    }

    // ---- Outfits -----------------------------------------------------------------------

    function syncHats() {
      const wantHat = enabled && settings().hat !== false;
      pals().forEach((pal) => {
        const inst = pal.instance;
        if (!inst || typeof inst.setSeason !== 'function') return;
        if (wantHat && !hatted.has(inst)) {
          inst.setSeason('santa');
          hatted.add(inst);
        } else if (!wantHat && hatted.has(inst)) {
          inst.setSeason('none');
          hatted.delete(inst);
        }
      });
    }

    function applyOutfit(name) {
      const outfit = OUTFITS[name] || OUTFITS.none;
      pals().forEach((pal) => {
        const inst = pal.instance;
        if (!inst) return;
        if (typeof inst.setSeason === 'function') inst.setSeason(outfit.season);
        if (typeof inst.setAccessories === 'function') inst.setAccessories(outfit.items);
        if (inst && outfit.season === 'santa') hatted.add(inst);
      });
    }

    // ---- Lifecycle ---------------------------------------------------------------------

    if (ctx.events) {
      offs = [
        ctx.events.on('sleigh:pass', onSleighPass),
        ctx.events.on('sleigh:gift', onGift),
        ctx.events.on('gift:land', onGift),
        ctx.events.on('snowman:built', onSnowmanBuilt),
        ctx.events.on('snowman:removed', onSnowmanRemoved),
        ctx.events.on('cleaner:pass', onCleanerPass),
      ];
    }
    festiveAt = nextFestive();
    visitAt = 60 + rand() * 60;

    function update(dt) {
      if (disposed) return;
      clock += dt;
      syncHats();
      if (!enabled) return;

      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (clock >= queue[i].at) {
          const job = queue.splice(i, 1)[0];
          job.fn();
        }
      }

      pollTimer += dt;
      if (pollTimer >= 0.25) {
        pollTimer = 0;
        pollFlakes();
      }
      if (clock >= festiveAt) {
        festive();
        festiveAt = nextFestive();
      }
      if (clock >= visitAt) {
        visitSnowman();
        visitAt = clock + 70 + rand() * 90;
      }
    }

    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) queue.length = 0;
      syncHats();
    }

    function dispose() {
      if (disposed) return;
      enabled = false;
      syncHats();
      disposed = true;
      offs.forEach((off) => { if (typeof off === 'function') off(); });
      offs = [];
      queue.length = 0;
      snowmen.clear();
    }

    return { update, setEnabled, applySettings: syncHats, applyOutfit, dispose };
  }

  Christmas.Companions = { create, OUTFITS, LINES };
})(window);
