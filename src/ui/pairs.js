import { $, h, svgUse } from './dom.js';

const KINDS = [
  { id: 'native', glyph: 'g-native', label: 'A native asset', chip: 'Native asset', blurb: 'Stand the token against the network’s own currency, the plainest yardstick there is for what it is worth.' },
  { id: 'stable', glyph: 'g-stable', label: 'A stablecoin', chip: 'Stablecoin', blurb: 'Quote the token in dollars, so every gain and loss reads the way it does anywhere else.' },
  { id: 'stock', glyph: 'g-stock', label: 'A tokenised stock', chip: 'Tokenised stock', blurb: 'Bind the token to the fortunes of a company that people already argue about.' },
  { id: 'community', glyph: 'g-community', label: 'Another community’s coin', chip: 'Community coin', blurb: 'Link two crowds. Each side trades against the other, and both keep an eye on the ratio.' },
  { id: 'idea', glyph: 'g-idea', label: 'An idea', chip: 'An idea', blurb: 'Not every anchor is a ticker. If enough people will trade toward a theme, it can stand opposite your token.' },
];

export function initPairs() {
  const root = $('[data-pairs]');
  if (!root) return;
  const group = $('[data-pair-choices]', root);
  const node = $('[data-pair-node]', root);
  const use = $('[data-pair-use]', root);
  const label = $('[data-pair-label]', root);
  const blurb = $('[data-pair-blurb]', root);
  const link = $('.link', root);

  let index = 0;
  const buttons = KINDS.map((k, i) => {
    const b = h('button', { class: 'pchip', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-kind': k.id }, svgUse(k.glyph), k.chip);
    b.addEventListener('click', () => select(i, true));
    return b;
  });
  group.append(...buttons);

  function select(i, user = false) {
    index = (i + KINDS.length) % KINDS.length;
    const k = KINDS[index];
    buttons.forEach((b, j) => {
      b.setAttribute('aria-checked', String(j === index));
      b.tabIndex = j === index ? 0 : -1;
    });
    use.setAttribute('href', `#${k.glyph}`);
    label.textContent = k.label;
    blurb.textContent = k.blurb;
    node.dataset.kind = k.id;
    if (user) {
      buttons[index].focus({ preventScroll: true });
      for (const el of [node, link]) el.classList.remove('swap', 'pulse');
      void node.offsetWidth;
      node.classList.add('swap');
      link.classList.add('pulse');
      setTimeout(() => link.classList.remove('pulse'), 1800);
    }
  }
  group.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); select(index + d, true); }
  });
  select(0);
}
