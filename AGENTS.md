# AGENTS.md – ha-house-climate-card

Dashboard card that sums up the indoor climate of all areas (CO₂, temperature,
humidity, airing hints), distributed through HACS as a **Dashboard** (plugin)
repository.

## Working agreement

- Work on a feature branch. Commit locally, never push. Push, tags on remotes
  and GitHub releases only on explicit request.
- Commit as the agent with the attribution trailers the session provides.
- Release = two commits: the change, then `vX.Y.Z -- <summary>` that bumps
  `VERSION` in `dist/house-climate-card.js` and moves the CHANGELOG entry from
  *Unreleased* to the new version. Annotated tag `vX.Y.Z` locally.
  The release workflow refuses a tag that does not match `VERSION`.
- Semver: feature = minor, fix = patch.
- TDD: every bug gets a regression test that fails on the old code (check it).
- Never claim "tested in Home Assistant" when only the node tests and a
  mocked browser ran.

## Project structure

```
dist/house-climate-card.js  the card (single file, no build step, no deps)
tests/card.test.mjs         node tests (vm + minimal DOM stub)
hacs.json                   HACS metadata (filename, min. HA version)
.github/workflows/          validate.yml (HACS, syntax, tests), release.yml
docs/                       preview.html + render-previews.sh -> README images
README.md, CHANGELOG.md, LICENSE
```

## Card rules

- Whole file in `(function () { … })();`, syntax ≤ ES2019 (no `?.`, `??`,
  logical assignment, `.at()`, `replaceAll`, `replaceChildren`, `#private`).
- Every `color-mix()` has a plain fallback declaration directly before it;
  no flex/grid `gap`, no `inset`.
- Registration guarded (`customElements.get`, `window.customCards` by type).
- Render errors are caught and shown in the card (`_safeUpdate`).
- DOM built with `createElement`; area names and all other server/user
  strings only via `textContent`.
- Technical temperature sensors are skipped by `TECHNICAL_RE` /
  `TECHNICAL_PLATFORMS` (temperature only, never humidity/CO₂). Each new
  keyword gets a test in "ordinary room sensors are not mistaken…" style.
- No regex lookbehind (old Safari): exceptions use a second regex
  (`INDOOR_RE`).
- The area's own `temperature_entity_id` / `humidity_entity_id` win over
  discovery (only `exclude_entities` overrides them). Otherwise sensors are
  found via `hass.entities` + `hass.devices` areas and the state's
  `device_class`, never by entity ID patterns. Diagnostic and hidden
  entities are skipped. Zero config must keep working.
- All logic (`discover`, `analyse`, `trendFromHistory`, `absoluteHumidity`)
  is DOM-free and exported through the test hook.
- No silent empty card: without sensors the card shows a hint.
- Editor: load `ha-form` via `loadCardHelpers()` before use; it drops empty
  values and the default `show_trend: true` from the config.

## Tests

`node --test tests/*.mjs` (on this Mac: VS Code's Node, see below) covers
syntax limits, discovery rules, aggregation, units, outdoor detection,
rendering and hints, more-info, errors, trend via `callWS`, and the editor.

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --test tests/*.mjs
```

Visual check: `docs/preview.html` with mocked `ha-card`/`ha-icon`, light and
dark, section and phone width.
