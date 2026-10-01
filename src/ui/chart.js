// Value-locked line chart. Built at the element's real pixel size (no stretched strokes),
// drawn in when it scrolls into view, scrubbable with a pointer.

import { $, clamp } from './dom.js';
import { fmtUsd, fmtDay } from '../format.js';

const PAD = { t: 14, b: 10 };

export function createChart(card) {
  const area = $('[data-chart-area]', card);
  const svg = $('[data-chart-svg]', card);
  const line = $('[data-chart-line]', card);
  const fill = $('[data-chart-area-path]', card);
  const guide = $('[data-chart-guide]', card);
  const dot = $('[data-chart-dot]', card);
  const tip = $('[data-chart-tip]', card);
  let data = [], pts = [], drawn = false, inView = false;

  function layout() {
    const w = Math.max(1, Math.round(area.clientWidth)), hgt = Math.max(1, Math.round(area.clientHeight));
    svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    if (data.length < 2) return;
    const vals = data.map((d) => d.tvl);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    pts = data.map((d, i) => [(i / (data.length - 1)) * w, PAD.t + (1 - (d.tvl - lo) / span) * (hgt - PAD.t - PAD.b)]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    line.setAttribute('d', d);
    fill.setAttribute('d', `${d}L${w} ${hgt}L0 ${hgt}Z`);
    guide.setAttribute('y1', '0'); guide.setAttribute('y2', String(hgt));
    maybeDraw();
  }

  function maybeDraw() {
    if (drawn || !inView || data.length < 2) return;
    drawn = true;
    line.classList.add('draw');
    fill.classList.add('in');
  }

  function scrub(clientX) {
    if (pts.length < 2) return;
    const r = area.getBoundingClientRect();
    const i = clamp(Math.round(((clientX - r.left) / r.width) * (pts.length - 1)), 0, pts.length - 1);
    const [x, y] = pts[i];
    guide.setAttribute('x1', String(x)); guide.setAttribute('x2', String(x));
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
    tip.hidden = false;
    tip.replaceChildren(document.createTextNode(fmtUsd(data[i].tvl)));
    const small = document.createElement('small');
    small.textContent = fmtDay(data[i].date);
    tip.append(small);
    tip.style.left = `${clamp(x - tip.offsetWidth / 2, 0, r.width - tip.offsetWidth)}px`;
    area.classList.add('hover');
  }
  area.addEventListener('pointermove', (e) => scrub(e.clientX));
  area.addEventListener('pointerdown', (e) => scrub(e.clientX));
  const leave = () => { area.classList.remove('hover'); tip.hidden = true; };
  area.addEventListener('pointerleave', leave);
  area.addEventListener('pointercancel', leave);

  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(area);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { inView = true; io.disconnect(); maybeDraw(); } }, { threshold: 0.3 });
    io.observe(area);
  } else inView = true;

  return { set(history) { data = history; layout(); } };
}
