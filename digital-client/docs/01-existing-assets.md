# 01 — What we already have (reuse map)

The bot project is a much bigger head start than it looks. Despite `ENGINE_CHANGELOG.md` and
`core.py` sounding engine-ish, they're the RAG bot's retrieval engine — **there is no rules
engine in the repo**. But almost everything *around* a rules engine already exists.

## Reuse directly

### Card database — `data/cards/AlgomancyCards-OracleText.json`
- 370 cards, keyed by name, each a list of faces (all single-faced today, format supports more).
- Fields: `name, power, toughness, cost, total_cost, type, text, factions, complexity, rulings, Deck, Num_Copies, …`
- Cost strings are element letters (`r`=fire, `b`=water, `e`=earth, `m`=metal, `g`=wood,
  `p`=colorless) — see `core.py:474` `RESOURCE_NAMES`. `total_cost` can be `"X"`.
- Type line is free-form: optional `{Attribute}` tokens and `[Augment]` marker, subtypes, then a
  category (`Unit`, `Spell`, `Spell Unit`, `Resource`, `Help Card`).
- Text markup: `{/n}` newline, `{i}…{/i}` reminder text, `[Switch]`/`[Switch1]` graft symbols,
  `[Augment]`, inline costs like `[4bb]`. Canonical decoder: `cards.py:274` `plain_text()`.
- Art: one JPEG per card, `<Name-With-Hyphens>.jpg`, resolved by `cards.py:552` `art_path()`.
- Loader with fuzzy lookup + BM25 search: `cards.py` `CardIndex`.

**Implication:** the engine's card registry keys off this file; we never hand-copy card text.

### Game-state model — `wtp.py`
The puzzle system is a deliberately game-accurate board model with JSON (de)serialization:
- `Puzzle` → `phase` (Planning/Battle/Regroup/Deployment), `turn`, `initiative`, two `Side`s.
- `Side` → `life`, `resources: [Resource]`, `columns: [[Unit,…]]`, `hand`, `bin`, `hand_count`.
- `Unit` → card ref, temporary power/toughness mods, permanent `counters` (signed, since +1/+1
  and -1/-1 cancel), `damage`, `role` (attacking/blocking), `mods` (grafted/augmented cards
  underneath, max 4), token size `x`.
- `Resource` → `kind` (element or shard/prismite) + `state` (open/expended/dormant). This IS
  the tapped/untapped model — resources are cards, not a number.
- Board geometry already encoded: max 8 columns, 2 deep (front/back), opposing columns face
  each other, column damage = combined power (`wtp.py:74`, docs at `wtp.py:11-30`).
- `payload()` (`wtp.py:777`) produces the front-end JSON shape.

**Implication:** the live-game state format should be an *extension* of this model, not a new
invention. The puzzle JSON becomes "a saved game state" almost for free — and puzzles later
become loadable scenarios in the client.

### Board renderer — `static/board.js` + `static/board.css`
- Framework-free, no build step. `WtpBoard.render(el, puzzle, opts)` renders both formations,
  hands, bins, resources, counters (as a die), card zoom on hold, lightbox.
- Facing-column grid layout is already solved in CSS (`--cw` card width var).
- The puzzle editor (`editor.html`) is effectively a board-state builder GUI.

**Implication:** the prototype client can fork this renderer rather than starting from zero.

### Icons + text rendering
- `data/icons/*.webp`: factions, keywords (augment, graft, bounded_graft, haste, battle, virus…),
  generated cost digits (`build_cost_icons.py`).
- `app.py:156-206`: `render_card_text_html`, `render_cost_html`, `_icon_img` — token → `<img>`
  with graceful text fallback. Token vocabulary lives in `core.py:463-528`.

### Partial rules logic that already exists
- **`mods.py`** — graft/augment legality + combined card computation (`mod_kind`, `is_bounded`,
  `combined_text/type`, `Combo.build`, `MAX_MODS = 4`). Real rules code, directly portable.
- **`wtp.py` stat math** — effective power/toughness from base + counters + temp mods + token X,
  `dead()`, token X-as-counters vs X-as-body distinction (`x_is_counters()`, `wtp.py:134`).
- **`draft.py`** — deterministic seeded pack generation (`p1p1`, `p1p6` modes), the definition
  of the draftable set (320 cards: 54×5 mono + 50 hybrid), pool building. A draft lobby reuses
  this wholesale.

### Executable spec
`test_wtp.py`, `test_mods.py`, `test_draft.py` — the rules that ARE implemented have tests.
The engine should keep this property: every rules question the Discord bot has answered wrong
once becomes a test case.

## Must be built new
- Turn/phase loop and simultaneous-turn coordination.
- Priority / response windows / the stack (or Algomancy's equivalent).
- Combat resolution (damage assignment, deaths, triggers).
- The card-behavior registry (what each of 370 cards *does*, not just says).
- Server + networking (rooms, per-player redacted views, reconnect).
- Client interaction layer (legal-action highlighting, targeting, prompts) — `board.js` renders
  state but has no notion of *acting* on it.
