// The hero floor: a receding grid with a few raised slabs, drawn on a canvas with colours read
// from the tokens. It creeps forward slowly, leans toward the pointer, and stops entirely when
// the hero is off screen, the tab is hidden, or motion is reduced (then it is drawn once).

import { reduced, onReducedChange } from './dom.js';

// world units: x across, z away from the camera, height up. Camera height is 1.
const SLABS = [
  { x: -5.2, z: 4.2, w: 1.5, d: 1.1, hgt: 0.34, ph: 0.0 },
  { x: -2.6, z: 7.5, w: 1.2, d: 1.2, hgt: 0.5, ph: 1.7 },
  { x: -7.4, z: 8.8, w: 2.0, d: 1.4, hgt: 0.42, ph: 3.1 },
  { x: 3.4, z: 5.0, w: 1.6, d: 1.0, hgt: 0.3, ph: 2.2 },
  { x: 6.2, z: 8.0, w: 1.8, d: 1.3, hgt: 0.55, ph: 0.9 },
  { x: 1.4, z: 10.5, w: 1.4, d: 1.4, hgt: 0.6, ph: 4.0 },
];

export function initGrid(canvas) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const tone = (name) => css.getPropertyValue(name).trim();
  const colors = { line: tone('--c-rule-hi'), glow: tone('--c-accent'), face: tone('--c-page'), top: tone('--c-panel') };

  let W = 0, H = 0, dpr = 1;
  let lean = { x: 0, y: 0 }, leanTo = { x: 0, y: 0 };
  let running = false, visible = true, raf = 0, last = 0, clock = 0;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const horizon = H * (0.3 + lean.y * 0.02);
    const cx = W / 2 + lean.x * W * 0.035;
    const f = (H - horizon) * 1.05;
    const spread = Math.max(W / 9, 60);
    const proj = (x, z, y = 0) => [cx + (x * spread) / z * 1.0, horizon + (f * (1 - y)) / z];

    // ground: rungs sweep toward the viewer, rails converge on the horizon
    const step = 0.62, shift = (clock * 0.045) % step;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line;
    for (let z = 14 - shift; z > 1.02; z -= step) {
      const near = 1 - z / 14;
      ctx.globalAlpha = 0.1 + near * 0.55;
      const [, y] = proj(0, z);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = -16; i <= 16; i++) {
      ctx.globalAlpha = 0.42 - Math.abs(i) * 0.014;
      const [x0, y0] = proj(i * 1.1, 14), [x1, y1] = proj(i * 1.1, 1.02);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // slabs, far to near
    for (const s of [...SLABS].sort((a, b) => b.z - a.z)) {
      const pulse = 0.55 + 0.45 * Math.sin(clock * 0.0011 + s.ph);
      const zf = s.z + s.d, zn = s.z;
      const gl = proj(s.x, zn), gr = proj(s.x + s.w, zn);
      const tl = proj(s.x, zn, s.hgt), tr = proj(s.x + s.w, zn, s.hgt);
      const tlf = proj(s.x, zf, s.hgt), trf = proj(s.x + s.w, zf, s.hgt);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = colors.top;
      ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...trf); ctx.lineTo(...tlf); ctx.closePath(); ctx.fill();
      ctx.fillStyle = colors.face;
      ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...gr); ctx.lineTo(...gl); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = colors.glow;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.25 + pulse * 0.55;
      // glow without shadowBlur: a wide faint stroke under a thin bright one (far cheaper to raster)
      ctx.lineWidth = 5; ctx.globalAlpha = 0.05 + pulse * 0.1;
      ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.globalAlpha = 0.25 + pulse * 0.55;
      ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.stroke();
      ctx.globalAlpha = 0.2 + pulse * 0.25;
      ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tlf); ctx.lineTo(...trf); ctx.lineTo(...tr); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    if (last && now - last < 32) { raf = requestAnimationFrame(frame); return; } // 30 fps is plenty for a slow drift
    const dt = last ? Math.min(64, now - last) : 16;
    last = now; clock += dt;
    lean.x += (leanTo.x - lean.x) * 0.06;
    lean.y += (leanTo.y - lean.y) * 0.06;
    draw();
    raf = requestAnimationFrame(frame);
  }
  const sync = () => {
    const should = visible && document.visibilityState === 'visible' && !reduced();
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
    if (!should) draw();
  };

  if ('ResizeObserver' in window) new ResizeObserver(size).observe(canvas); else addEventListener('resize', size);
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  onReducedChange(sync);
  size();
  sync();

  return { lean: (x, y) => { leanTo = { x, y }; } };
}
