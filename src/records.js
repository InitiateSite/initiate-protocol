// The register. Every fact this site states about the outside world is one record here,
// and nothing else in src/ may hard-code it.
//
//   state 'stated'      -> the project has said it; the page may show it and link to it
//   state 'absent'      -> not published; the page shows the slot as inert, with no link and no date
//   state 'unconfirmed' -> a value exists but has not been confirmed; shown inert, never linked
//
// Flipping a record to 'stated' is the only edit needed for it to go live everywhere.
// For links we store the URL and derive the handle from it (see handleOf).

export const STATE = Object.freeze({ STATED: 'stated', ABSENT: 'absent', UNCONFIRMED: 'unconfirmed' });

// The build may swap records wholesale for the test build (see vite.config.js); a normal
// build and direct Node imports see an empty override.
// eslint-disable-next-line no-undef
const override = typeof __RECORDS_OVERRIDE__ !== 'undefined' ? __RECORDS_OVERRIDE__ : {};

export const records = Object.freeze({
  domain: { state: STATE.STATED, value: 'https://initiate.site' },
  chain: {
    state: STATE.STATED,
    value: { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com' },
  },
  // Contract address. Any well-formed 0x + 40 hex digits is accepted; see parseAddress.
  ca: { state: STATE.ABSENT, value: null },
  // Kept ready for the day it is stated. While absent, the URL is never rendered or linked.
  x: { state: STATE.ABSENT, value: 'https://x.com/Initiate_Site' },
  github: { state: STATE.ABSENT, value: null },
  // Where the product itself opens. Nothing has been announced.
  launcher: { state: STATE.ABSENT, value: null },
  ...override,
});

// 0x followed by exactly 40 hex digits, any case. Deliberately no checksum test and no
// deny-list: a real address must never be turned away because of how it is written.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const parseAddress = (v) => (typeof v === 'string' && ADDRESS.test(v.trim()) ? v.trim() : null);

export const isStated = (rec) => rec?.state === STATE.STATED && rec.value != null;

// https only, no credentials, no odd ports: whatever the register holds must be a plain public link.
export function safeUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u.href : null;
  } catch {
    return null;
  }
}

// The href for a record, or null when it must not be a link.
export const hrefOf = (rec) => (isStated(rec) ? safeUrl(rec.value) : null);

// Derive the visible handle from the stored URL: first path segment, no leading @.
export function handleOf(rec) {
  const href = hrefOf(rec);
  if (!href) return null;
  const seg = new URL(href).pathname.split('/').filter(Boolean)[0];
  return seg ? seg.replace(/^@/, '') : null;
}

// What the CA slot should render right now.
export function caView(rec = records.ca) {
  if (rec.state === STATE.STATED) {
    const address = parseAddress(rec.value);
    if (address) return { kind: 'ready', address };
    return { kind: 'unconfirmed' }; // stated but malformed: show nothing copyable
  }
  return { kind: rec.state === STATE.UNCONFIRMED ? 'unconfirmed' : 'absent' };
}

export const rpcUrl = () => records.chain.value.rpc;
export const chainId = () => records.chain.value.id;
