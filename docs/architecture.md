# Architecture

Two parts: the **website**, which exists and is described precisely, and the **protocol**, which is planned and described only as design intent.

## 1. Website (implemented)

A static single-page site built with Vite and plain JavaScript modules. No framework, no runtime dependencies in the shipped bundle beyond the site's own code.

```
index.html ──▶ src/main.js
                 ├─ src/records.js      register of external facts
                 ├─ src/ui/slots.js     contract bar, socials, launcher, records list
                 ├─ src/live.js         pollers: RPC, DefiLlama, DexScreener
                 ├─ src/ui/liveview.js  binds live state to the page
                 ├─ src/ui/effects.js   reveal, progress, parallax, menu
                 ├─ src/ui/grid.js      hero canvas
                 ├─ src/ui/veil.js      sealed-ledger sketch
                 └─ src/ui/pairs.js     counterpart picker
```

### 1.1 The register

`src/records.js` holds every external fact as `{ state, value }`, where state is `stated`, `absent` or `unconfirmed`.

- Only `stated` records may be rendered as values or links.
- Links store the full URL; the visible handle is derived from it.
- Contract addresses are validated as `0x` plus 40 hex digits in any case. There is deliberately no checksum or deny-list rejection, so a real address is never turned away.
- Links must be `https`, with no credentials or custom port.

### 1.2 Live data

| Source | Data | Cadence | Failure behaviour |
|---|---|---|---|
| Chain RPC | block height, gas price, network check | every 6 s | backs off; status pill shows *Delayed* then *Unreachable* |
| DefiLlama | chain value locked, 90-day history | every 5 min | card shows a dash, chart shows a message |
| DexScreener | profiled tokens with active pools | every 60 s | marquee shows an empty notice |

Every pane of live data starts as a skeleton and leaves it only on a real reading. Polling pauses while the tab is hidden. All third-party text is written with `textContent`; images are accepted only from one allow-listed host.

### 1.3 Colour and assets

`src/tokens.css` is the only file permitted to contain colour literals. Each value is a real pixel from the brand assets, snapped from a k-means centroid, with its source file and coordinate in a comment. The brand mark is a transparent RGBA PNG whose empty pixels are stored as black, so all resizing is premultiplied.

### 1.4 Motion

Reveals, count-ups, value flashes and the hero canvas all honour `prefers-reduced-motion`, falling back to instant, static output. The canvas pauses when off screen or when the tab is hidden.

### 1.5 Delivery

The built page ships a strict Content-Security-Policy: scripts and styles from the same origin only, connections limited to the three data hosts. The site stores nothing in cookies or browser storage.

### 1.6 Checks

`npm run gates` builds a second copy of the site with a fixture register so the *stated* paths can be tested, then drives a real browser against a synthetic network on a fake clock. It covers layout at five widths, tap-target size, the contract bar, live-data states, motion preferences, accessibility basics, network hygiene and copy hygiene.

## 2. Protocol (planned)

Nothing in this section is deployed. It names the intended components so reviewers can argue with them early.

```
creator ──▶ Launcher ──▶ Factory ──▶ Token
                              └──▶ Pair (token ⇄ counterpart)
trader  ──▶ Private route ──▶ Pair
```

| Component | Intent |
|---|---|
| **Factory** | Creates a token and its first pair in one transaction |
| **Token** | Standard fungible token; no hidden mint or transfer hooks |
| **Pair** | Holds liquidity between the token and a chosen counterpart |
| **Counterpart registry** | The set of assets a pair may be built against, and how each is priced |
| **Private route** | Lets a swap execute without automatically exposing the trader's holdings |
| **Launcher** | The user interface over the above |

### Design constraints

- Immutable where possible; any admin power is documented, minimal and time-limited.
- Users hold their own keys.
- The private route states its guarantees and its limits in writing before release.
- Every value-holding contract is independently reviewed before its address is published.

### Open questions

Fee model, counterpart admission rules, the mechanism behind the private route, and upgrade policy are all undecided. See [tokenomics](tokenomics.md).
