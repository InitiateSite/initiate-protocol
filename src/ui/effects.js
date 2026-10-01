import { $, $$, clamp, reduced } from './dom.js';

// ---------- scroll reveal ----------
export function initReveal() {
  const items = $$('[data-reveal]');
  if (!items.length) return;
  if (reduced() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((el) => io.observe(el));
}

// ---------- scroll progress + parallax depth ----------
export function initScroll() {
  const bar = $('[data-progress]');
  const depth = $$('[data-depth]').map((el) => ({ el, k: Number(el.dataset.depth) || 0 }));
  let queued = false;
  const paint = () => {
    queued = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0})`;
    if (!reduced() && y < 1400) for (const { el, k } of depth) el.style.transform = `translate3d(0, ${(-y * k).toFixed(1)}px, 0)`;
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  paint();
}

// ---------- coin tilt toward the pointer ----------
export function initTilt(onMove) {
  const art = $('[data-tilt]');
  const hero = $('.hero');
  const tilt = $('.coin-tilt');
  if (!art || !hero || !tilt || reduced() || !matchMedia('(pointer: fine)').matches) return;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    const ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    tilt.style.setProperty('--ry', `${(nx * 9).toFixed(2)}deg`);
    tilt.style.setProperty('--rx', `${(-ny * 7).toFixed(2)}deg`);
    onMove?.(nx, ny);
  });
  hero.addEventListener('pointerleave', () => {
    tilt.style.setProperty('--ry', '0deg');
    tilt.style.setProperty('--rx', '0deg');
    onMove?.(0, 0);
  });
}

// ---------- measure the sticky top so anchors land below it ----------
export function initTopHeight() {
  const top = $('[data-top]');
  if (!top) return;
  const set = () => document.documentElement.style.setProperty('--top-h', `${Math.round(top.getBoundingClientRect().height)}px`);
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(top);
}

// ---------- highlight the section in view ----------
export function initSpy() {
  const links = new Map($$('.nav a').map((a) => [a.getAttribute('href')?.slice(1), a]));
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      links.forEach((a) => a.classList.remove('on'));
      links.get(e.target.id)?.classList.add('on');
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  for (const id of links.keys()) { const s = id && document.getElementById(id); if (s) io.observe(s); }
}

// ---------- menu sheet ----------
export function initMenu() {
  const dlg = $('[data-menu]');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  $('[data-menu-open]')?.addEventListener('click', () => dlg.showModal());
  $('[data-menu-close]')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target.closest('a')) dlg.close(); });
  matchMedia('(min-width: 960px)').addEventListener('change', (e) => { if (e.matches && dlg.open) dlg.close(); });
}
