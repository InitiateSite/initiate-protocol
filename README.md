<div align="center">

<img src="public/mark-256.png" alt="Initiate hexagon mark" width="112" height="112">

# INITIATE

**Private when it matters.**

Where new tokens begin life on Robinhood Chain: mint one, choose what stands opposite it, then swap without an audience.

[initiate.site](https://initiate.site)

</div>

---

## At a glance

| | |
|---|---|
| **Network** | Robinhood Chain |
| **Network number** | `4663` |
| **RPC** | `https://rpc.mainnet.chain.robinhood.com` |
| **Domain** | [initiate.site](https://initiate.site) |
| **Status** | Website live. Protocol not yet published. |

## Contract address

> **Not published yet.**

No contract exists on record. Any token presenting itself as Initiate today did not originate here. This section, the website's pinned address bar and its records list all read from one register (`src/records.js`), so they change together the moment an address is announced.

## Social

| Channel | State |
|---|---|
| X | Not published yet |
| GitHub organisation | Not published yet |
| Launcher | Not published yet |

Links appear here only after they are real.

## The idea

1. **Mint the idea.** Name it, give it a ticker and a face. One pass later it exists on Robinhood Chain.
2. **Choose its other half.** Pair it with an asset, a community or a concept. The counterpart is yours to pick.
3. **Trade with the curtain drawn.** Swaps take a quieter route, so holdings stop being an announcement.

"Private" describes intent, not a guarantee. Precise protections will be documented when the product ships. See the [whitepaper](docs/whitepaper.md).

## This repository

The repository holds the public website. It reads live figures from three open sources and shows nothing it cannot back up.

- **Block height and gas** come from the chain's own RPC.
- **Value locked** and its 90-day history come from DefiLlama.
- **Active tokens** come from DexScreener. A sighting, never an endorsement.

### Run it

```bash
npm install
npm run dev        # local development
npm run build      # production bundle in dist/
npm run gates      # behaviour and hygiene checks
```

The gates drive a real browser against a synthetic network, so they never depend on live data.

### Layout

```
src/records.js     the register: every external fact, one record each
src/tokens.css     the only file allowed to hold colour literals
src/live.js        RPC, DefiLlama and DexScreener polling
src/ui/            page behaviour
gates/             automated checks
docs/              protocol and project documents
```

## Documents

| Document | Contents |
|---|---|
| [Whitepaper](docs/whitepaper.md) | Vision and protocol overview |
| [Tokenomics](docs/tokenomics.md) | What is and is not decided about supply |
| [Roadmap](docs/roadmap.md) | Phases, in order, without dates |
| [Architecture](docs/architecture.md) | How the site and the planned protocol fit together |
| [Contributing](.github/CONTRIBUTING.md) | How to help |
| [Security](.github/SECURITY.md) | How to report a problem |

## Principles

- **One record per fact.** Each external fact is stated, absent or unconfirmed. Unstated records render inert, with no link and no date.
- **Sampled, not guessed.** Every colour comes from a real brand pixel, with its source coordinate recorded.
- **Motion is optional.** Reduced-motion visitors get an instant, static page.

## License

[MIT](LICENSE)
