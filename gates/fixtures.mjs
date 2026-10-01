// Synthetic network for the browser gates. Nothing here is real chain data.
// Every outside host the page may touch is answered from this file; anything else is refused and logged.

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const hex40 = (n) => `0x${n.toString(16).padStart(2, '0').repeat(20)}`;

export const FIXTURE = {
  block0: 0x4a00000,
  gasSeq: [0x14ede90, 0x0f00000, 0x14ede90], // wei: rises and falls so both flashes can be seen
  tvl: 1234567890,
  history: Array.from({ length: 120 }, (_, i) => ({ date: 1780000000 + i * 86400, tvl: 900000000 + i * 3000000 })),
  tokens: [
    { addr: hex40(0x11), symbol: 'ALFA', quote: 'ETH', liq: 90000, change: 12.5, img: true },
    { addr: hex40(0x22), symbol: 'BRAVO', quote: 'USDG', liq: 70000, change: -3.25, img: false },
    // hostile symbol: must render as text, never as markup
    { addr: hex40(0x33), symbol: '<img src=x onerror=window.__pwned=1>', quote: 'ETH', liq: 50000, change: 0, img: false },
    { addr: hex40(0x44), symbol: 'DELTA', quote: 'ETH', liq: 30000, change: null, img: true },
  ],
};

export function installNetwork(context, opts = {}) {
  const state = { rpcCalls: 0, refused: [], hosts: new Set(), failRpc: false, release: null, held: null };
  state.hold = () => { state.held = new Promise((r) => { state.release = r; }); };
  state.unhold = () => { state.release?.(); state.held = null; };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const req = route.request();
    state.hosts.add(url.hostname);
    if (url.hostname === '127.0.0.1') return route.continue();
    if (state.held) await state.held;

    if (url.hostname === 'rpc.mainnet.chain.robinhood.com') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
      if (state.failRpc) return route.abort();
      const n = state.rpcCalls++;
      const batch = JSON.parse(req.postData() || '[]');
      const out = batch.map((r) => ({
        jsonrpc: '2.0', id: r.id,
        result: r.method === 'eth_blockNumber' ? `0x${(FIXTURE.block0 + n * 25).toString(16)}` : r.method === 'eth_gasPrice' ? `0x${FIXTURE.gasSeq[n % FIXTURE.gasSeq.length].toString(16)}` : r.method === 'eth_chainId' ? '0x1237' : null,
      }));
      return json(route, out);
    }
    if (url.hostname === 'api.llama.fi') {
      if (url.pathname === '/v2/chains') return json(route, [{ name: 'Robinhood Chain', chainId: 4663, tvl: FIXTURE.tvl }, { name: 'Other', chainId: 1, tvl: 5 }]);
      if (url.pathname.startsWith('/v2/historicalChainTvl/')) return json(route, FIXTURE.history);
    }
    if (url.hostname === 'api.dexscreener.com') {
      if (url.pathname === '/token-profiles/latest/v1') return json(route, FIXTURE.tokens.slice(0, 3).map((t) => ({ chainId: 'robinhood', tokenAddress: t.addr })).concat([{ chainId: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112' }]));
      if (url.pathname === '/token-boosts/top/v1') return json(route, FIXTURE.tokens.slice(2).map((t) => ({ chainId: 'robinhood', tokenAddress: t.addr })));
      if (url.pathname.startsWith('/tokens/v1/robinhood/')) {
        return json(route, FIXTURE.tokens.map((t) => ({
          chainId: 'robinhood',
          url: `https://dexscreener.com/robinhood/${t.addr}`,
          baseToken: { address: t.addr, symbol: t.symbol, name: t.symbol },
          quoteToken: { symbol: t.quote },
          priceChange: { h24: t.change },
          liquidity: { usd: t.liq },
          info: t.img ? { imageUrl: 'https://cdn.dexscreener.com/cms/images/fixture' } : undefined,
        })));
      }
    }
    if (url.hostname === 'cdn.dexscreener.com') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    state.refused.push(url.href);
    return route.abort();
  });
  return state;
}
