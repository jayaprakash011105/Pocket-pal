// Finds things on the page a pal can stand on: headings, images, videos and
// input boxes. The brain asks for a spot (pick) and then keeps checking that
// the element is still there and where it is (rect), so the pal rides along
// when the page scrolls and steps down if the element goes away.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});

  const SELECTOR = 'h1,h2,h3,img,video,input,textarea,button,[role="search"]';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'file', 'range', 'color', 'image']);
  const MIN_WIDTH = 90;
  const MAX_SCANNED = 400;

  function kindOf(el) {
    const tag = el.tagName;
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') return 'heading';
    if (tag === 'IMG' || tag === 'VIDEO') return 'image';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el.getAttribute('role') === 'search') return 'input';
    return 'other';
  }

  function createFinder(options) {
    const host = options.host;
    const getScale = options.getScale || (() => 1);
    const claimed = new Map(); // id -> element
    let nextId = 1;

    // The visible, standable top edge of an element, or null.
    function measure(el) {
      if (!el || !el.isConnected || (host && host.contains(el))) return null;
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has((el.type || '').toLowerCase())) return null;
      const r = el.getBoundingClientRect();
      const left = Math.max(r.left, 0);
      const right = Math.min(r.right, global.innerWidth);
      if (right - left < MIN_WIDTH || r.height < 12) return null;
      if (r.top < 120 * getScale() || r.top > global.innerHeight - 90) return null;
      const style = global.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
      return { left, right, top: r.top };
    }

    function pick(fromX) {
      const nodes = global.document.querySelectorAll(SELECTOR);
      const found = [];
      for (let i = 0; i < nodes.length && i < MAX_SCANNED; i += 1) {
        const rect = measure(nodes[i]);
        if (rect) found.push({ el: nodes[i], rect });
      }
      if (!found.length) return null;
      // Favour things within a short hop but keep it random so it isn't always
      // the nearest one.
      const near = found.filter((f) => Math.abs((f.rect.left + f.rect.right) / 2 - fromX) < 700);
      const pool = near.length ? near : found;
      const choice = pool[Math.floor(Math.random() * pool.length)];
      const id = nextId;
      nextId += 1;
      claimed.set(id, choice.el);
      if (claimed.size > 12) claimed.delete(claimed.keys().next().value);
      return { id, kind: kindOf(choice.el), rect: choice.rect };
    }

    function rect(id) {
      const el = claimed.get(id);
      return el ? measure(el) : null;
    }

    return { pick, rect };
  }

  PocketPal.Perch = { createFinder };
})(window);
