# `data/` — the shared source data

No code lives here. Both halves of the repo read this directory and neither owns
it: the Python rules bot (`bot/`) and the TypeScript game client (`client/`).

**Nearly everything here is Caleb Gannon's work, used with his permission and
not under the code's MIT licence.** [`NOTICE.md`](NOTICE.md) says what that
means if you fork this.

Nothing should ever spell a path into this directory by hand. Three modules name
these locations, one per runtime context, and everything else imports from them:

| | for |
|---|---|
| `bot/paths.py` | the Python side |
| `client/engine/scripts/paths.mjs` | the node build scripts and tests |
| `client/ui/assets.ts` | the browser (URLs, not filesystem paths) |

## What is here

### `cards/` — the card pool
528 scans named `Card-Name-With-Hyphens.jpg`, plus:

- **`AlgomancyCards-OracleText.json`** — **CANONICAL.** The card transcription:
  Caleb's own for the base set, ours (read off the scans) for Light & Dark, 536
  entries. It is ours to correct: a wrong field is fixed here, in place, with
  the reason in the commit message, and `npm run extract` rebuilds the derived
  files from it. It has never been re-pulled from upstream, and the eight
  corrections that used to live in a patch table landed here on 2026-09-20.
- `light-and-dark-transcription-notes.json` — **hand-written.** Notes on
  discrepancies found while transcribing the expansion. Irreplaceable.
- `mod_anchors.json` — **generated** by `bot/pipeline/build_anchors.py`. Pixel
  anchor points telling `bot/mods.py` where a grafted card should peek out from
  behind the card it is attached to. Re-run the builder whenever new art lands;
  a card missing here falls back to a guessed position.

The scans are also the client's card art, served at `/data/cards/`.

### `icons/` — the game's symbols
25 `.webp` element pips, keyword markers and cost circles. The Discord bot
uploads them as guild emojis (`bot/pipeline/upload_emojis.py`); the web app and
the game client serve them at `/data/icons/`.

`once.webp` and `cost_0`–`cost_9`, `cost_x` were drawn to match the set, using
`augment.webp` as the source hexagon — the published cards never shipped them.
They are ordinary committed icons now; the script that drew them is in git
history (`bot/pipeline/build_cost_icons.py`, removed 2026-09-20).

### `rules/` — the prose rules corpus
The manual, the glossary, the 2023 rulebook, the dev-logs. **Read
`rules/README.md` before using any of it** — it sets the authority order
(Manual > Glossary > 2023 Rulebook > web write-ups > dev-logs), which the RAG
retriever encodes as score multipliers and which is the reason two documents
that disagree do not simply cancel out.

The `.txt` files are `pdftotext` extractions of the PDFs beside them, and they
are what actually gets ingested. `rules/Algomancy-Manual.txt` is also read by
the client's test suite (`231-manual-text.test.ts`), which proves every glossary
reminder the client shows is quoted from the manual word for word.

### `corpus/algomancy_corpus.jsonl` — the retrieval corpus
**Generated** by `bot/pipeline/build_corpus.py` from `cards/`, `rules/` and
`rulings/`. 1,285 chunks, each tagged with a source, an authority tier and an
outdated-risk flag.

Committed on purpose despite being generated: its SHA-256 is one segment of the
bot's `engine_version` stamp (see `bot/pipeline/RAG-CHANGELOG.md`), so every
logged answer can be traced to the exact corpus that produced it. A rebuild
should be byte-identical; if it is not, something in the inputs or the chunker
changed and that is worth knowing before you commit it.

### `rulings/` — the designer's answers
- `seed_rulings.jsonl` — **hand-transcribed.** Small, precious.
- `generated_rulings.jsonl` — **generated:** designer Q&A curated out of the
  Discord export by a model fan-out. 764 rulings, 415 of them post-2025.
- `exports/`, `work/`, `needs_ocr.jsonl` — **untracked**, and large (~1.7 GB,
  mostly downloaded Discord media). Raw channel dumps and per-batch
  intermediates. Reproduce with `bot/pipeline/export_rulings.sh`, which needs
  the vendored DiscordChatExporter binary and a Discord user token.

  ⚠ Only *nominally* reproducible. Discord messages get edited and deleted, so a
  2023–2026 snapshot is not re-derivable once content disappears — and
  `client/docs/16-divergence-inventory.md` cites `exports/` as a source of
  record. The ~70 MB of JSON is worth archiving off-box; the ~1.6 GB of `_Files/`
  media is not.

## Canonical vs generated, at a glance

| canonical — edit by hand | generated — never hand-edit |
|---|---|
| `cards/AlgomancyCards-OracleText.json` | `cards/mod_anchors.json` |
| `cards/light-and-dark-transcription-notes.json` | `corpus/algomancy_corpus.jsonl` |
| `rules/*` | `rulings/generated_rulings.jsonl` |
| `rulings/seed_rulings.jsonl` | |

## Provenance


- **Cards**: the card-search page is a React app; its image URLs are built from each card's name
  (`…/cardsearch-images/<Name-With-Hyphens>.jpg`). Card text comes from `AlgomancyCards.json`.
- **Rules**: official PDFs downloaded directly; web pages downloaded as raw HTML, article body
  extracted (XPath + pandoc), images/HTML stripped to leave verbatim prose; PDFs → text via
  `pdftotext -layout`.

All sources are official (calebgannon.com / algomancy.io) or the designer's own writing.

