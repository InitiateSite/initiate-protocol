# Contributing to Initiate

Thanks for helping. This guide covers the repository as it stands: the public website and its documents.

## Ground rules

1. **Say only what is real.** Never add a contract address, account, date or claim that the project has not published. Unpublished facts belong in `src/records.js` as `absent`.
2. **One record per fact.** External facts live in the register and nowhere else in the source.
3. **Colours come from the brand.** Colour literals belong in `src/tokens.css` only, each with a sampled-pixel comment. Do not add colours by eye.
4. **Motion is optional.** Anything animated needs a reduced-motion fallback that is instant.
5. **Write your own words.** Copy should be original. The copy check rejects phrases shared with the reference site.

## Getting started

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run build
npm run gates
```

Both must exit 0.

## Making a change

1. Open an issue first for anything larger than a fix, so we can agree the direction.
2. Keep the change focused. One concern per pull request.
3. Add or update a gate when you change behaviour. Gates use synthetic data only.
4. Describe what changed and why, and include screenshots for visible changes at phone and desktop widths.

## Style

- Plain JavaScript modules, no framework.
- Match the surrounding code: naming, comment density, idiom.
- No `ch` units in CSS. Interactive controls are at least 48 px in both dimensions.
- Third-party text is written with `textContent`, never `innerHTML`.

## Documentation changes

Documents in `docs/` must not invent supply figures, allocations, prices, dates or partners. If something is undecided, say so.

## Conduct

Be direct and kind. Critique the work, not the person. Harassment of any kind is not tolerated and will be removed.

## Security issues

Do not file a public issue. Follow the [security policy](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](../LICENSE).
