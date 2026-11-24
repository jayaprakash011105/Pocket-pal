// Lightweight 2D (pixel-space) physics used to move the character around the
// viewport. The render camera is orthographic and mapped 1:1 to CSS pixels
// (see pet-engine.js), so "physics" here is plain kinematics, not full 3D.
(function (global) {
  const PocketPal = global.PocketPal || (global.PocketPal = {});
  const { clamp } = PocketPal.Utils;

  const GRAVITY = 2200; // px/s^2
  const TERMINAL_VELOCITY = 1800; // px/s

  function createBody(x, y) {
    return {
      x,
      y,
      vx: 0,
      svx: 0,
      vy: 0,
      facing: 1,
      grounded: true,
      surface: 'ground', // 'ground' | 'air' | 'perch' | 'ceiling' | 'wall-left' | 'wall-right'
      squashX: 1,
      squashY: 1,
      peek: 0, // 0..1: how far out from a screen edge the pet is peeking
      peekSide: 0, // -1 left edge, 1 right edge
    };
  }

  function applyGravity(body, dt, scale) {
    if (body.grounded) return;
    body.vy = Math.min(body.vy + GRAVITY * (scale || 1) * dt, TERMINAL_VELOCITY);
  }

  function integrate(body, dt, speedMultiplier) {
    body.x += body.svx * (speedMultiplier || 1) * dt;
    body.y += body.vy * dt;
  }

  // Keeps the body within the viewport, snapping it to whichever edge it is
  // closest to (ground/ceiling/left wall/right wall) so "climbing" can walk
  // along any of the four edges.
  function resolveBounds(body, bounds, footOffset) {
    const { width, height } = bounds;
    const groundY = height - footOffset;
    const ceilingY = footOffset;
    const leftX = footOffset;
    const rightX = width - footOffset;

    let landed = false;

    if (body.surface === 'ground') {
      if (body.y >= groundY) {
        if (body.vy > 0) landed = true;
        body.y = groundY;
        body.vy = 0;
        body.grounded = true;
      } else {
        body.grounded = false;
      }
      body.x = clamp(body.x, leftX, rightX);
    } else if (body.surface === 'air' || body.surface === 'perch') {
      // Hovering free of any surface (floaters dropped mid-screen, cursor
      // follow) or standing on a page element: supported, so gravity is off
      // and only the viewport bounds apply (the brain pins perch height).
      body.grounded = true;
    } else if (body.surface === 'ceiling') {
      body.y = ceilingY;
      body.grounded = true;
      body.x = clamp(body.x, leftX, rightX);
    } else if (body.surface === 'wall-left') {
      body.x = leftX;
      body.grounded = true;
      body.y = clamp(body.y, ceilingY, groundY);
    } else if (body.surface === 'wall-right') {
      body.x = rightX;
      body.grounded = true;
      body.y = clamp(body.y, ceilingY, groundY);
    }

    body.x = clamp(body.x, leftX, rightX);
    body.y = clamp(body.y, ceilingY, groundY);
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      body.x = width / 2;
      body.y = groundY;
      body.vx = 0;
      body.vy = 0;
    }

    return landed;
  }

  function jump(body, power) {
    body.vy = -power;
    body.grounded = false;
  }

  // Squash & stretch: stretch while falling fast, squash briefly on landing.
  function updateSquash(body, dt, justLanded) {
    const targetX = justLanded ? 1.28 : body.grounded ? 1 : clamp(1 - body.vy / 4000, 0.82, 1.12);
    const targetY = justLanded ? 0.72 : body.grounded ? 1 : clamp(1 + body.vy / 3200, 0.9, 1.22);
    const speed = justLanded ? 18 : 10;
    body.squashX += (targetX - body.squashX) * Math.min(1, speed * dt);
    body.squashY += (targetY - body.squashY) * Math.min(1, speed * dt);
  }

  function relaxSquash(body, dt) {
    body.squashX += (1 - body.squashX) * Math.min(1, 8 * dt);
    body.squashY += (1 - body.squashY) * Math.min(1, 8 * dt);
  }

  PocketPal.Physics = {
    GRAVITY,
    createBody,
    applyGravity,
    integrate,
    resolveBounds,
    jump,
    updateSquash,
    relaxSquash,
  };
})(window);
