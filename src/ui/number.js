import { reduced } from './dom.js';

const DURATION = 900;
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

// A figure that counts to its value, then flashes whenever a later reading differs.
// The first reading climbs from zero; later ones glide from the previous value.
export class Ticker {
  constructor(el, format) {
    this.el = el;
    this.format = format;
    this.value = null;
    this.raf = 0;
    this.flashTimer = 0;
  }

  set(next) {
    if (!Number.isFinite(next)) return;
    const prev = this.value;
    if (prev === next) return;
    this.value = next;
    this.el.dataset.value = String(next);
    cancelAnimationFrame(this.raf);
    if (reduced()) {
      this.el.textContent = this.format(next);
      if (prev !== null) this.flash(next > prev);
      return;
    }
    const from = prev ?? 0;
    const started = performance.now();
    const span = prev === null ? DURATION * 1.3 : DURATION * 0.7;
    const frame = (now) => {
      const t = Math.min(1, (now - started) / span);
      this.el.textContent = this.format(from + (next - from) * easeOutExpo(t));
      if (t < 1) this.raf = requestAnimationFrame(frame);
      else this.el.textContent = this.format(next);
    };
    this.raf = requestAnimationFrame(frame);
    if (prev !== null) this.flash(next > prev);
  }

  flash(up) {
    const cls = up ? 'flash-up' : 'flash-down';
    this.el.classList.remove('flash-up', 'flash-down');
    void this.el.offsetWidth; // restart the animation when readings land back to back
    this.el.classList.add(cls);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.el.classList.remove(cls), 1200);
  }
}
