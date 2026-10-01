// Everything on the page that depends on the register lives here. Nothing outside this file
// decides whether the CA, a social account or the launcher exists.

import { records, caView, hrefOf, handleOf, isStated, STATE } from '../records.js';
import { $, h, svgUse, copyText, toast } from './dom.js';
import { shortHost } from '../format.js';

// ---------- contract address ----------
export function renderCA(root = $('[data-ca]')) {
  if (!root) return;
  const view = caView(records.ca);
  const inner = h('div', { class: 'ca-in' });
  if (view.kind === 'ready') {
    const copy = h('button', { class: 'ca-copy', type: 'button', 'aria-label': `Copy the contract address ${view.address}` },
      h('span', { class: 'ca-label' }, 'CA'),
      h('code', { class: 'ca-value', 'data-ca-value': '' }, view.address),
      h('span', { class: 'ca-ico' }, svgUse('i-copy', 'i-copy'), svgUse('i-check', 'i-ok')));
    let timer = 0;
    copy.addEventListener('click', async () => {
      const ok = await copyText(view.address);
      toast(ok ? 'Address copied' : 'Copying was blocked. Select the text by hand.');
      if (!ok) return;
      copy.classList.add('copied');
      clearTimeout(timer);
      timer = setTimeout(() => copy.classList.remove('copied'), 1800);
    });
    inner.append(copy);
    root.dataset.state = 'ready';
  } else {
    const msg = view.kind === 'unconfirmed' ? 'Address not confirmed yet' : 'Not published yet';
    inner.append(
      h('span', { class: 'ca-label' }, 'CA'),
      h('span', { class: 'ca-ghost', 'data-ca-ghost': '' }, msg));
    root.dataset.state = view.kind;
  }
  root.replaceChildren(inner);
}

// ---------- socials, top right ----------
const SOCIALS = [
  { key: 'x', icon: 'i-x', name: 'X', at: true },
  { key: 'github', icon: 'i-github', name: 'GitHub', at: false },
];

export function renderSocials(root = $('[data-socials]')) {
  if (!root) return;
  root.replaceChildren(...SOCIALS.map(({ key, icon, name, at }) => {
    const rec = records[key];
    const href = hrefOf(rec);
    if (href) {
      const handle = handleOf(rec);
      const label = handle ? `${name}, ${at ? '@' : ''}${handle}` : name;
      return h('a', { class: 'icon-btn', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, 'data-social': key }, svgUse(icon));
    }
    return h('span', { class: 'icon-btn is-inert', role: 'img', 'aria-label': `${name}, not published yet`, title: `${name}: not published yet`, 'data-social': key }, svgUse(icon));
  }));
}

// ---------- launcher call to action ----------
export function renderLauncher(root = $('[data-launcher]')) {
  if (!root) return;
  const href = hrefOf(records.launcher);
  if (href) {
    const a = h('a', { class: 'btn btn-solid', href, target: '_blank', rel: 'noopener noreferrer', 'data-launcher-link': '' },
      h('span', {}, 'Go to the launcher'), svgUse('i-arrow'));
    root.replaceWith(a);
    $('.cta .btn-solid[href="#flow"]')?.classList.replace('btn-solid', 'btn-ghost');
  } else {
    root.replaceWith(h('span', { class: 'btn is-inert', 'data-launcher-inert': '' }, 'The launcher is not open yet'));
  }
}

// ---------- records list ----------
const STATE_LABEL = { [STATE.STATED]: 'Published', [STATE.ABSENT]: 'Not yet', [STATE.UNCONFIRMED]: 'Unconfirmed' };

function row({ name, detail, state, href }) {
  const chip = h('span', { class: `chip-state is-${state}` }, h('i'), STATE_LABEL[state]);
  const body = [h('span', { class: 'rec-name' }, h('b', {}, name), h('span', {}, detail)), chip];
  if (href) {
    return h('li', {}, h('a', { class: 'rec', href, target: '_blank', rel: 'noopener noreferrer' }, ...body, svgUse('i-arrow')));
  }
  return h('li', {}, h('div', { class: 'rec' }, ...body));
}

export function renderRecords(root = $('[data-records]')) {
  if (!root) return;
  const ca = caView(records.ca);
  const social = (rec, prefix) => {
    const href = hrefOf(rec);
    return href ? { state: STATE.STATED, href, detail: `${prefix}${handleOf(rec) ?? shortHost(href)}` } : { state: rec.state === STATE.UNCONFIRMED ? STATE.UNCONFIRMED : STATE.ABSENT, href: null, detail: 'Nothing announced' };
  };
  const x = social(records.x, '@'), gh = social(records.github, '');
  const launcherHref = hrefOf(records.launcher);
  const rows = [
    { name: 'Network', detail: `${records.chain.value.name} · ${records.chain.value.id}`, state: STATE.STATED },
    { name: 'Domain', detail: shortHost(records.domain.value), state: STATE.STATED },
    { name: 'Contract address', detail: ca.kind === 'ready' ? ca.address : 'Nothing announced', state: ca.kind === 'ready' ? STATE.STATED : ca.kind === 'unconfirmed' ? STATE.UNCONFIRMED : STATE.ABSENT },
    { name: 'Launcher', detail: launcherHref ? shortHost(launcherHref) : 'Nothing announced', state: launcherHref ? STATE.STATED : STATE.ABSENT, href: launcherHref },
    { name: 'X', ...x },
    { name: 'GitHub', ...gh },
  ];
  root.replaceChildren(...rows.map(row));
  root.dataset.stated = String(rows.filter((r) => r.state === STATE.STATED).length);
}

export const anyStated = () => Object.values(records).some(isStated);
