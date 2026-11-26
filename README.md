# Pocket Pal — Interactive 3D Browser Companion

A Chrome (Manifest V3) extension that puts a tiny animated 3D creature on every webpage. It
walks along the bottom of the viewport, climbs the screen edges, reacts to your cursor, can be
dragged and dropped, and shows speech bubbles — without getting in the way of the page.

## Install (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open any `http(s)` page. The options page opens automatically on first install.

## What's built

| Area | Details |
| --- | --- |
| Rendering | One Three.js (r128, bundled locally) renderer per page, transparent canvas, orthographic camera mapped 1:1 to CSS pixels so movement/physics use plain pixel coordinates. |
| Isolation | Everything lives in a Shadow DOM host. The canvas is `pointer-events: none`; only a small invisible hit-box follows the pet, so page clicks, scrolling and text selection are untouched. |
| Characters | 14 built-in pals from the reference art (Mochi, Coco, Robo, Draco, Lumi, Panda, Slime, Pip, Foxy, Boo, Puff, Jelly, Rexy, Witchy); a registry (`characters/manifest.json` + `characters/registry.js`) so more can be added without touching the engine. |
| Animation states | idle, walk, run-speed scaling, jump, fall, land, sleep, wake, dance, sit, look around, react, dragged. |
| Movement | Wander with random stops, edge climbing (ground → wall → ceiling → wall → ground), jump with gravity and squash-and-stretch, follow / avoid cursor, auto-sleep timer. |
| Interactions | Click (jump + react), double-click (dance), drag and drop, hover look-at, right-click menu, long-press menu, speech bubbles. |
| Browser interactions | **Cursor follow** (floaters chase the cursor in 2D), **edge climbing**, **window hopping** between the four corners, **page awareness** (reacts to scrolling, navigation and returning to the tab), **hide/show** (menu, popup button or `Alt+Shift+P`, applies to every tab), **drag anywhere** (floaters hover where dropped, then drift back down), **multi-tab persistence** (position is saved under its own storage key and restored when you switch tabs). Window hopping, page awareness and position memory each have a toggle in Behaviour. |
| Page interaction | Pals hop onto headings, images, videos and input boxes and stand on them (riding along as the page scrolls, stepping down if the element goes away), and **peek** out from the left/right screen edge. Wandering now picks destinations across the whole window, and pals head back in rather than parking in a corner. |
| Catch game | "Play catch" (menu or popup) drops a ball you can drag and throw. Pals chase it, jump for it when it is tossed high, catch it, carry it a moment and toss it back. |
| Idle animations | Blink, wave (a little mitten), yawn and sneeze (with puffs), plus a sparkle/bubble/heart trail behind floating pals. |
| Themes | **Snow** (Santa hat plus snowfall that builds a three-layer snowbank and then stops; automatic Dec 1 – Jan 5), **Halloween** (a ghost sheet; automatic Oct 20 – Nov 2), **Christmas** (the full winter environment below) and **Classic** (no theme). Pick them from the Themes tab of the popup. |
| Christmas theme | Continuous falling snow in layers (sizes, shapes, glow, wind), a thick three-layer snowbank along the bottom that builds itself (even with falling snow switched off) and rebuilds after cleaning, Santa's sleigh with four animated reindeer (it flies by now and then; "Call the sleigh" in the 🎄 panel makes it swoop in from the top, land on the snow and trot back and forth along the bottom, turning at each edge with a smooth rising U-turn arc instead of a flip, until you send it away; click it for gifts), a playable snowman-building game (roll snowballs out of the real snowbank with the mouse, stack them, decorate; finished snowmen stay alive, slowly looking left and right, blinking and breathing, and follow your pointer while you play; in Throw mode roll fresh snowballs out of the snow and flick them to wobble, decapitate and finally smash a snowman, and the snow returns to the bank), a snowplow that actually lowers the snow it passes, snowy trees, string lights, stars, ornaments, gifts, shooting stars, and pals that react to all of it (sleigh, gifts, snowmen, flakes on their heads). Everything beyond snowfall and snow build-up is individually switchable (including whether your pals are shown at all), with density, speed, wind, build-up speed, plow speed and quality settings in Options → Christmas. A small 🎄 button at the bottom left opens quick controls. |
| Multiple pals | Up to three pals at once. Extra pals are the next unlocked ones in the roster; they chase each other (tag), say hi, and nap side by side. |
| Popup | Redesigned toolbar popup with Home (live preview of your pal, unlock progress, quick actions), Characters (category filters, unlock progress on locked pals), **Themes** (one-tap looks with live previews on your current pal: Classic, Christmas, Halloween, Little wizard, Gentleman, Royal, Party time, Cozy winter, DJ, Sweetheart, Bubbly) and Settings. Follows the system light/dark mode. |
| Jumping | Every pal can jump (click, or at random). Floaters take a slow, high-arcing hop and drift back down at a capped speed. |
| Outfits & style | Ten drawn accessories (hats, sunglasses, headphones, bow tie, scarf, bandana) fitted to every pal with hand-placed head/face/neck anchors in `characters/manifest.json`, one-tap outfits (Wizard, Gentleman, Royal, Party, Cozy, DJ), and an **animation style** picker with three options: **Floating** (default, hovers and drifts), **Walking** (the same smooth glide, kept to the bottom line of the window) and **Bouncing** (gets around purely by jumping, squashing on each landing). |
| Customization | Size, walk speed, animation speed, behaviour, shadow intensity, auto-sleep, interaction sensitivity, reduced motion, outfits, accessories, animation style. Stored in `chrome.storage.local`. |
| Progression | Some pals unlock after a number of interactions (tracked locally). |
| Custom models | Upload a `.glb`/`.gltf` on the options page; it is stored locally and rendered via `GLTFLoader`. |
| Performance | Rendering pauses when the tab is hidden; resources are disposed when the pet is removed (disable, per-site hide, page hide). |

## Honest limitations

- **Built-in characters are 2D sprites in a 3D scene.** Their artwork is cut out of the supplied
  reference images (`characters/sprites/*.png`) and drawn on a plane, animated with squash/stretch,
  hops and tilts. They are not rotating 3D models; real GLB models would be needed for that.
  The older procedural primitive builder remains in `characters/registry.js` as a fallback for
  characters without a `sprite` entry. Outfit pieces use per-pal anchors (`outfit` in
  the manifest); a pal added without them falls back to an automatic silhouette measurement,
  which fits less precisely. Witchy's art already includes a hat, so head items are hidden for it.
- Multi-tab persistence restores *where* the pal is when you switch tabs; it is not live-synced
  between two tabs that are visible at the same time.
- **Custom GLB uploads play their own animation clips** (matched by name: walk, idle, jump,
  sleep, dance…). Models without clips still move, sit and jump but have no per-limb animation,
  and the accessories feature only applies to the built-in procedural pals.
- The hit-box is a fixed rectangle, so while the pet climbs a wall or ceiling it is a little
  misaligned with the rotated model.
- The extension is completely silent: it plays no sound anywhere.
- Reduced motion (the setting, or the OS preference) stops random jumping, dancing and edge
  climbing and halves animation speed.

## Adding a character

1. Add an entry to `characters/manifest.json` (id, name, category, colors, personality).
2. Procedural: add a case in `characters/registry.js` (`decorators`). Or ship a real model:
   place `model.glb` under `characters/<id>/` and extend `CharacterManager.createInstance`
   to load it with `GLTFLoader` (the custom-upload path in `content/character-manager.js` is the
   template).

## Project layout

```
manifest.json            MV3 manifest
background.js            service worker (opens options on install, relays "open settings")
content/                 content scripts (classic scripts sharing a `PocketPal` namespace)
  christmas/             the Christmas theme: manager.js (layers + shared context + control panel), snow.js
                         (flakes, snow heightfield, renderer, snowplow), sleigh.js, snowman.js, decorations.js,
                         companions.js (reusable pal reactions)
  content.js             entry: Shadow DOM scaffold, lifecycle, menus, speech bubbles
  pet-engine.js          Three.js scene/camera/renderer + frame loop
  character-manager.js   builds instances, per-frame procedural animation, custom GLB loading
  movement.js            behaviour state machine
  physics.js             gravity / bounds / squash-and-stretch
  interactions.js        pointer events: click, drag, hover, long-press, context menu
  content.css            styles injected into the shadow root
characters/              manifest.json (roster data) + registry.js (procedural builders)
                         accessories.js (drawn outfit pieces, outfit presets, silhouette anchor measuring)
popup/  options/         extension UI
utils/                   helpers.js, storage.js
libs/three/              three.min.js and GLTFLoader.js (r128, bundled locally)
assets/icons/            extension icons
```

## Permissions and privacy

- `storage` — settings, unlock progress, custom models, all local.
- `unlimitedStorage` — requested only so user-uploaded models are not constrained by the
  default storage quota.
- Host access is `http(s)` pages so the content script can run; the Chrome Web Store is excluded.
- No analytics, no network requests (the only `fetch` calls read bundled extension files or
  local data URLs), no remote code, no browsing-history collection.
