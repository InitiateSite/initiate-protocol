// Binds the live state to the page: stat cards, status pill, freshness line, chart, marquee.
// Every place that shows live data starts as a skeleton and leaves it only on a real reading.

import { live } from '../live.js';
import { records, chainId } from '../records.js';
import { $, $$, h, reduced } from './dom.js';
import { Ticker } from './number.js';
import { createChart } from './chart.js';
import { fmtUsd, fmtInt, fmtGwei, fmtPct, fmtAgo, shortHost } from '../format.js';

const FRESH_MS = 20000;

function statCard(key) {
  const card = $(`[data-stat="${key}"]`);
  return { card, val: $('[data-val]', card), delta: $('[data-delta]', card) };
}

function setDelta(el, text, up) {
  el.textContent = text;
  el.classList.toggle('up', Boolean(up));
}

export function initLiveView() {
  const tvl = statCard('tvl'), block = statCard('block'), gas = statCard('gas'), net = statCard('network');
  const tickers = {
    tvl: new Ticker(tvl.val, fmtUsd),
    block: new Ticker(block.val, fmtInt),
    gas: new Ticker(gas.val, fmtGwei),
    chartTvl: null,
  };
  const chartCard = $('[data-chart]');
  const chartVal = $('[data-chart-val]', chartCard);
  tickers.chartTvl = new Ticker(chartVal, fmtUsd);
  const chart = createChart(chartCard);
  const pills = $$('[data-pill]');
  const mirror = $('[data-pill-mirror]');

  // static facts from the register
  net.val.textContent = String(chainId());
  net.card.dataset.state = 'ready';
  setDelta(net.delta, 'mainnet', false);
  $('[data-fact="id"]').textContent = String(chainId());
  $('[data-fact="rpc"]').textContent = shortHost(records.chain.value.rpc);
  $('[data-fact="name"]').textContent = records.chain.value.name;

  let lastBlock = null, lastBlockAt = 0;

  function paintRpc(s) {
    if (s.status === 'error') {
      for (const c of [block, gas]) { c.card.dataset.state = 'error'; c.val.textContent = '—'; c.delta.textContent = ''; }
    } else if (s.block != null) {
      block.card.dataset.state = gas.card.dataset.state = 'ready';
      tickers.block.set(s.block);
      tickers.gas.set(s.gwei);
      if (lastBlock != null && s.block > lastBlock) {
        const secs = Math.max(1, Math.round((s.at - lastBlockAt) / 1000));
        setDelta(block.delta, `+${fmtInt(s.block - lastBlock)} in ${secs}s`, true);
      }
      lastBlock = s.block; lastBlockAt = s.at;
      setDelta(gas.delta, 'per unit', false);
    }
  }

  function paintTvl(s) {
    if (s.status === 'error') {
      tvl.card.dataset.state = 'error'; tvl.val.textContent = '—'; tvl.delta.textContent = '';
      chartCard.dataset.state = 'error';
      return;
    }
    if (s.value == null) return;
    tvl.card.dataset.state = 'ready';
    chartCard.dataset.state = 'ready';
    tickers.tvl.set(s.value);
    tickers.chartTvl.set(s.value);
    if (s.change != null) setDelta(tvl.delta, `${fmtPct(s.change)} on the day`, s.change >= 0);
    if (s.history.length > 1) {
      const vals = s.history.map((p) => p.tvl);
      $('[data-chart-sub]').textContent = `Range ${fmtUsd(Math.min(...vals))} to ${fmtUsd(Math.max(...vals))} over ${s.history.length} days`;
      chart.set(s.history);
    }
  }

  // ----- pill -----
  function pillState() {
    const s = live.state.rpc;
    if (s.status === 'ok' && Date.now() - s.at < FRESH_MS) return 'live';
    if (s.status === 'ok' || s.status === 'stale') return 'stale';
    if (s.status === 'error') return 'down';
    return 'connecting';
  }
  const WORDS = { live: 'Live', stale: 'Delayed', down: 'Unreachable', connecting: 'Connecting' };
  function paintPill() {
    const st = pillState();
    const s = live.state.rpc;
    for (const p of pills) {
      p.dataset.state = st;
      $('[data-pill-text]', p).textContent = st === 'live' && s.block != null ? `Live · ${fmtInt(s.block)}` : WORDS[st];
    }
    if (mirror) {
      mirror.dataset.state = st;
      $('[data-pill-mirror-text]', mirror).textContent = `${records.chain.value.name} · ${WORDS[st].toLowerCase()}`;
    }
  }

  // ----- freshness line -----
  const fresh = $('[data-fresh]');
  function paintFresh() {
    const at = Math.max(live.state.rpc.at, live.state.tvl.at);
    fresh.textContent = at ? `Last reading ${fmtAgo(Date.now() - at)}.` : live.state.rpc.status === 'error' ? 'No reading yet. Still trying.' : 'No reading has landed yet.';
  }

  // ----- marquee -----
  const marquee = $('[data-marquee]');
  const track = $('[data-track]', marquee);
  const skelSet = () => {
    const set = h('div', { class: 'marquee-set', 'aria-hidden': 'true' });
    for (let i = 0; i < 10; i++) set.append(h('span', { class: 'skel tok-skel' }));
    return set;
  };
  track.replaceChildren(skelSet(), skelSet());

  function token(t, inert) {
    const badge = h('span', { class: 'tok-img' }, t.symbol.slice(0, 1).toUpperCase());
    if (t.image) {
      const img = h('img', { alt: '', width: '44', height: '44', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      img.src = t.image;
      badge.append(img);
    }
    const chg = h('span', { class: `tok-chg${t.change != null && t.change >= 0 ? ' up' : ''}` }, t.change == null ? '' : fmtPct(t.change));
    const body = [badge, h('span', { class: 'tok-t' }, h('span', { class: 'tok-sym' }, t.symbol), h('span', { class: 'tok-sub' }, t.quote ? `/ ${t.quote}` : ' ')), chg];
    if (t.url && !inert) return h('a', { class: 'tok', href: t.url, target: '_blank', rel: 'noopener noreferrer' }, ...body);
    return h('span', { class: 'tok' }, ...body);
  }

  function paintTokens(s) {
    if (s.status === 'error' || (s.status === 'ok' && !s.list.length)) {
      marquee.dataset.state = 'empty';
      track.replaceChildren(h('p', { class: 'marquee-empty' }, 'No active tokens came back this time.'));
      return;
    }
    if (s.status !== 'ok' && s.status !== 'stale') return;
    if (!s.list.length) return;
    const a = h('div', { class: 'marquee-set' }, ...s.list.map((t) => token(t, false)));
    const b = h('div', { class: 'marquee-set', 'aria-hidden': 'true', inert: '' }, ...s.list.map((t) => token(t, true)));
    marquee.dataset.state = 'ready';
    marquee.style.setProperty('--marquee-dur', `${Math.max(34, s.list.length * 5)}s`);
    track.replaceChildren(a, b);
  }

  live.on((key, state) => {
    if (key === 'rpc') paintRpc(state.rpc);
    if (key === 'tvl') paintTvl(state.tvl);
    if (key === 'tokens') paintTokens(state.tokens);
    paintPill();
    paintFresh();
  });
  setInterval(() => { paintPill(); paintFresh(); }, 1000);
  paintPill();
  paintFresh();
  void reduced;
}
