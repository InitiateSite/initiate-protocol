// "Sample rows": the same six rows drawn twice. The open copy is clipped from the seam
// rightward; the sealed copy underneath keeps every cell's width but hides its content.
// The knob eases toward wherever the pointer aims, so a drag feels weighted, not jumpy.

import { $, clamp, reduced } from './dom.js';

// Invented rows for the sketch. Addresses are truncated on purpose: none of these is a real one.
const ROWS = [
  ['14:02:11', '0x3c1f…9a02', 'Bought', '12,400', 'COIN / ETH'],
  ['14:02:37', '0x8be4…17d0', 'Sold', '3,050', 'COIN / ETH'],
  ['14:03:05', '0x51aa…c3e9', 'Bought', '88,000', 'COIN / USD'],
  ['14:03:42', '0xd09c…4b71', 'Bought', '640', 'COIN / ETH'],
  ['14:04:10', '0x3c1f…9a02', 'Sold', '12,400', 'COIN / ETH'],
  ['14:04:58', '0x72f8…e105', 'Bought', '21,900', 'COIN / USD'],
];

function fill(layer, sealed) {
  const wrap = (cls, text) => {
    const cell = document.createElement('span');
    cell.className = cls;
    const inner = document.createElement('span');
    if (sealed) inner.className = 'm';
    inner.textContent = text;
    cell.append(inner);
    return cell;
  };
  layer.replaceChildren(...ROWS.map(([time, wallet, act, amt, pair]) => {
    const row = document.createElement('div');
    row.className = 'lrow';
    row.append(wrap('c-time', time), wrap('c-wallet', wallet), wrap('c-act', act), wrap('c-amt', amt), wrap('c-pair', pair));
    return row;
  }));
}

export function initVeil() {
  const root = $('[data-veil]');
  const stage = $('[data-veil-stage]', root ?? document);
  const knob = $('[data-veil-knob]', root ?? document);
  if (!root || !stage || !knob) return;
  fill($('[data-ledger="sealed"]', root), true);
  fill($('[data-ledger="open"]', root), false);
  const out = $('[data-veil-out]', root);
  const reward = $('[data-veil-reward]', root);

  let cur = 0, target = 0, raf = 0, last = 0, dragging = false, done = false;

  const apply = (p) => {
    stage.style.setProperty('--p', p.toFixed(4));
    const pct = Math.round(p * 100);
    const text = `${pct}% sealed`;
    out.textContent = text;
    knob.setAttribute('aria-valuenow', String(pct));
    knob.setAttribute('aria-valuetext', text);
    stage.dataset.sealed = String(pct);
    const full = p >= 0.985;
    if (full !== done) {
      done = full;
      reward.textContent = full ? 'Sealed. There is nothing left to read.' : '';
      reward.classList.toggle('show', full);
      if (full) navigator.vibrate?.(12);
    }
  };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const k = 1 - Math.exp(-dt / 70);
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < 0.0015) cur = target;
    apply(cur);
    if (cur !== target) raf = requestAnimationFrame(tick); else last = 0;
  };
  const aim = (p) => {
    target = clamp(p, 0, 1);
    if (target > 0.985) target = 1;
    if (reduced()) { cur = target; apply(cur); return; }
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const at = (clientX) => { const r = stage.getBoundingClientRect(); return (clientX - r.left) / r.width; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    knob.classList.remove('hint');
    aim(at(e.clientX));
  });
  stage.addEventListener('pointermove', (e) => { if (dragging) aim(at(e.clientX)); });
  const end = () => { dragging = false; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  knob.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.25 : 0.08;
    const to = { ArrowRight: target + step, ArrowUp: target + step, ArrowLeft: target - step, ArrowDown: target - step, Home: 0, End: 1, PageUp: target + 0.25, PageDown: target - 0.25 }[e.key];
    if (to == null) return;
    e.preventDefault();
    knob.classList.remove('hint');
    aim(to);
  });

  apply(0);
  // First time it scrolls into view, glide the seam in a little to show it can move.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (dragging || target > 0) return;
      aim(0.32);
      knob.classList.add('hint');
    }, { threshold: 0.6 });
    io.observe(stage);
  }
}
