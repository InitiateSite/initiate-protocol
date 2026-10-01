// Live data: chain RPC (block, gas), DefiLlama (chain TVL and history), DexScreener (active tokens).
// Each source polls on its own timer, backs off when it fails, and pauses while the tab is hidden.
// The UI never sees a fetch; it subscribes to `live` and reads plain state.

import { rpcUrl, chainId, parseAddress } from './records.js';

export const EVERY = Object.freeze({ rpc: 6000, tvl: 300000, tokens: 60000, giveUp: 60000 });
const TIMEOUT_MS = 9000;
const LLAMA = 'https://api.llama.fi/v2';
const LLAMA_NAME = 'Robinhood Chain';
const DEX = 'https://api.dexscreener.com';
const DEX_CHAIN = 'robinhood';
const IMAGE_HOST = 'cdn.dexscreener.com';
const PAIR_HOST = 'dexscreener.com';

async function getJson(url, init = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const hexToNumber = (hex) => (typeof hex === 'string' && /^0x[0-9a-fA-F]+$/.test(hex) ? Number(BigInt(hex)) : NaN);

export const live = {
  state: {
    rpc: { status: 'loading', block: null, gwei: null, at: 0, chainOk: null },
    tvl: { status: 'loading', value: null, change: null, history: [], at: 0 },
    tokens: { status: 'loading', list: [], at: 0 },
  },
  listeners: new Set(),
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(key) { for (const fn of this.listeners) fn(key, this.state); },
};

// ---------- RPC ----------
async function pollRpc() {
  const first = live.state.rpc.chainOk === null;
  const batch = [
    { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] },
  ];
  if (first) batch.push({ jsonrpc: '2.0', id: 3, method: 'eth_chainId', params: [] });
  const out = await getJson(rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
  const by = Object.fromEntries((Array.isArray(out) ? out : []).map((r) => [r.id, r.result]));
  const block = hexToNumber(by[1]);
  const gwei = hexToNumber(by[2]) / 1e9;
  if (!Number.isFinite(block) || !Number.isFinite(gwei)) throw new Error('bad RPC reply');
  const s = live.state.rpc;
  if (first) s.chainOk = hexToNumber(by[3]) === chainId();
  if (s.chainOk === false) throw new Error('RPC answered for a different network');
  Object.assign(s, { status: 'ok', block, gwei, at: Date.now() });
}

// ---------- DefiLlama ----------
async function pollTvl() {
  const [chains, hist] = await Promise.allSettled([
    getJson(`${LLAMA}/chains`),
    getJson(`${LLAMA}/historicalChainTvl/${encodeURIComponent(LLAMA_NAME)}`),
  ]);
  const s = live.state.tvl;
  let value = null;
  if (chains.status === 'fulfilled' && Array.isArray(chains.value)) {
    const row = chains.value.find((c) => c.chainId === chainId() || c.name === LLAMA_NAME);
    if (row && Number.isFinite(row.tvl)) value = row.tvl;
  }
  if (hist.status === 'fulfilled' && Array.isArray(hist.value)) {
    const pts = hist.value.filter((p) => Number.isFinite(p?.date) && Number.isFinite(p?.tvl) && p.tvl > 0).slice(-90);
    if (pts.length > 1) {
      s.history = pts;
      const last = pts[pts.length - 1].tvl, prev = pts[pts.length - 2].tvl;
      s.change = prev > 0 ? ((last - prev) / prev) * 100 : null;
      value ??= last;
    }
  }
  if (value == null) throw new Error('no TVL reading');
  Object.assign(s, { status: 'ok', value, at: Date.now() });
}

// ---------- DexScreener ----------
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const hostIs = (url, host) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === host; } catch { return false; } };

async function pollTokens() {
  const feeds = await Promise.allSettled([`${DEX}/token-profiles/latest/v1`, `${DEX}/token-boosts/top/v1`].map((u) => getJson(u)));
  const wanted = new Map(); // lower-case address -> address as the feed wrote it
  for (const f of feeds) {
    if (f.status !== 'fulfilled' || !Array.isArray(f.value)) continue;
    for (const row of f.value) {
      const addr = parseAddress(row?.tokenAddress);
      if (row?.chainId === DEX_CHAIN && addr) wanted.set(addr.toLowerCase(), addr);
    }
  }
  if (!wanted.size) throw new Error('no profiled tokens');
  const list = [...wanted.values()].slice(0, 30);
  const pairs = await getJson(`${DEX}/tokens/v1/${DEX_CHAIN}/${list.join(',')}`);
  if (!Array.isArray(pairs)) throw new Error('bad pair reply');
  const best = new Map();
  for (const p of pairs) {
    if (p?.chainId !== DEX_CHAIN) continue;
    const addr = parseAddress(p.baseToken?.address)?.toLowerCase();
    if (!addr || !wanted.has(addr)) continue;
    const liq = Number(p.liquidity?.usd) || 0;
    if (!best.has(addr) || liq > best.get(addr).liq) best.set(addr, { p, liq });
  }
  const tokens = [...best.values()]
    .sort((a, b) => b.liq - a.liq)
    .slice(0, 16)
    .map(({ p, liq }) => ({
      symbol: cleanText(p.baseToken.symbol, 12) || '?',
      quote: cleanText(p.quoteToken?.symbol, 8),
      image: hostIs(p.info?.imageUrl, IMAGE_HOST) ? p.info.imageUrl : null,
      url: hostIs(p.url, PAIR_HOST) ? p.url : null,
      change: Number.isFinite(Number(p.priceChange?.h24)) ? Number(p.priceChange.h24) : null,
      liq,
    }));
  Object.assign(live.state.tokens, { status: 'ok', list: tokens, at: Date.now() });
}

// ---------- scheduler ----------
function schedule(key, task, every) {
  let wait = every, failures = 0;
  const run = async () => {
    if (document.visibilityState === 'hidden') { setTimeout(run, 1000); return; }
    try {
      await task();
      failures = 0; wait = every;
    } catch {
      failures += 1;
      const s = live.state[key];
      if (s.status === 'loading' && failures >= 2) s.status = 'error';
      else if (s.status === 'ok') s.status = 'stale';
      wait = Math.min(EVERY.giveUp, every * 2 ** Math.min(failures, 4));
    }
    live.emit(key);
    setTimeout(run, wait);
  };
  run();
}

let started = false;
export function startLive() {
  if (started) return;
  started = true;
  schedule('rpc', pollRpc, EVERY.rpc);
  schedule('tvl', pollTvl, EVERY.tvl);
  schedule('tokens', pollTokens, EVERY.tokens);
}
