// Pointer-driven interactions on the character's invisible hit-box element:
// click/jump, double-click specials, drag, hover-look, right-click menu and
// long-press. Uses Pointer Events so it keeps working through mouse, pen and
// touch without extra branching.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const { clamp } = PocketPal.Utils;

  const CLICK_DELAY = 260;
  const LONG_PRESS_MS = 550;
  const DRAG_THRESHOLD = 6;

  function createInteractions(hitbox, brain, callbacks, getSensitivity) {
    const sensitivity = () => clamp(getSensitivity ? getSensitivity() : 1, 0.5, 2);
    let pendingClickTimer = null;
    let clickCount = 0;
    let downAt = null;
    let downX = 0;
    let downY = 0;
    let isDragging = false;
    let longPressTimer = null;
    let hovering = false;

    function clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function onPointerDown(evt) {
      if (evt.button === 2) return; // handled by contextmenu
      hitbox.setPointerCapture?.(evt.pointerId);
      downAt = performance.now();
      downX = evt.clientX;
      downY = evt.clientY;
      isDragging = false;
      brain.notifyInteraction();

      longPressTimer = setTimeout(() => {
        if (!isDragging) {
          callbacks.onLongPress?.(evt.clientX, evt.clientY);
          downAt = null; // swallow the resulting click
        }
      }, LONG_PRESS_MS / sensitivity());
    }

    function onPointerMove(evt) {
      if (downAt == null) {
        if (hovering) callbacks.onHoverMove?.(evt.clientX, evt.clientY);
        return;
      }
      const dx = evt.clientX - downX;
      const dy = evt.clientY - downY;
      if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD / sensitivity()) {
        isDragging = true;
        clearLongPress();
        callbacks.onDragStart?.(evt.clientX, evt.clientY);
      }
      if (isDragging) {
        callbacks.onDragMove?.(evt.clientX, evt.clientY);
      }
    }

    function onPointerUp(evt) {
      clearLongPress();
      const wasDragging = isDragging;
      isDragging = false;
      const started = downAt;
      downAt = null;
      if (wasDragging) {
        callbacks.onDragEnd?.(evt.clientX, evt.clientY);
        return;
      }
      if (started == null) return; // swallowed by long-press

      clickCount += 1;
      if (clickCount === 1) {
        pendingClickTimer = setTimeout(() => {
          brain.reactOnce('play');
          callbacks.onSingleClick?.();
          clickCount = 0;
        }, CLICK_DELAY);
      } else if (clickCount >= 2) {
        clearTimeout(pendingClickTimer);
        clickCount = 0;
        callbacks.onDoubleClick?.();
      }
    }

    function onPointerEnter(evt) {
      hovering = true;
      callbacks.onHoverChange?.(true, evt.clientX, evt.clientY);
    }

    function onPointerLeave() {
      hovering = false;
      clearLongPress();
      callbacks.onHoverChange?.(false);
    }

    function onContextMenu(evt) {
      evt.preventDefault();
      clearLongPress();
      callbacks.onContextMenu?.(evt.clientX, evt.clientY);
    }

    hitbox.addEventListener('pointerdown', onPointerDown);
    hitbox.addEventListener('pointermove', onPointerMove);
    hitbox.addEventListener('pointerup', onPointerUp);
    hitbox.addEventListener('pointercancel', onPointerUp);
    hitbox.addEventListener('pointerenter', onPointerEnter);
    hitbox.addEventListener('pointerleave', onPointerLeave);
    hitbox.addEventListener('contextmenu', onContextMenu);

    // Drag can continue past the small hit-box, so track pointer globally too.
    function onWindowPointerMove(evt) {
      if (isDragging) callbacks.onDragMove?.(evt.clientX, evt.clientY);
    }
    function onWindowPointerUp(evt) {
      if (isDragging) onPointerUp(evt);
    }
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);

    return {
      destroy() {
        hitbox.removeEventListener('pointerdown', onPointerDown);
        hitbox.removeEventListener('pointermove', onPointerMove);
        hitbox.removeEventListener('pointerup', onPointerUp);
        hitbox.removeEventListener('pointercancel', onPointerUp);
        hitbox.removeEventListener('pointerenter', onPointerEnter);
        hitbox.removeEventListener('pointerleave', onPointerLeave);
        hitbox.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        clearLongPress();
        clearTimeout(pendingClickTimer);
      },
    };
  }

  PocketPal.Interactions = { createInteractions };
})(window);
