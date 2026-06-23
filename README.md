# Algomancy Data Project

Data collection for a **RAG rules bot** for the card game **Algomancy** (by Caleb Gannon).
The goal: assemble high-quality card data + rules text the bot can retrieve over.

Last updated **2026-06-20**.

## What's here

```
Algomancy/
├── AlgomancyCards/   → card images + per-card oracle text (the "what each card does" data)
├── Rules/            → rulebooks, glossary, and gameplay docs (the "how the game works" data)
├── build_corpus.py   → builds the embeddings-ready chunk corpus from the two dirs above
├── retriever.py      → shared TF-IDF retrieval core (used by ask.py and the bot)
├── ask.py            → keyword search over the corpus (test data quality / ask rules Qs)
├── cards.py          → card index: fuzzy name matching + art resolution
├── bot.py            → Discord bot (&ask RAG + &card lookup, DeepSeek-powered)
└── corpus/           → generated: algomancy_corpus.jsonl (run build_corpus.py to (re)build)
```

### `AlgomancyCards/` — card data (363 files)
- **361 card images** (`*.jpg`, ~34 MB) — every Algomancy card that has art.
- **`AlgomancyCards-OracleText.json`** — the canonical card database (370 cards) powering Caleb
  Gannon's official card search. Structured fields per card: name, cost, total cost, type line,
  power/toughness, factions, complexity, deck, rules text, and rulings. Revision-dated 2024-03-14.
- **`AlgomancyCards-OracleText.txt`** — human-readable dump of the same data.

Note: 9 `KSX …` cards exist in the data but have no art and empty rules text.

### `Rules/` — gameplay rules corpus (~41k words)
See `Rules/README.md` for the full index and an **authority/recency ranking**. Highlights:
- **`Algomancy-Manual.pdf` / `.txt`** — the polished, complete official rulebook (primary source).
- **`Algomancy-Rules-Glossary.md`** — keyword/term definitions (Augment, Graft, Conjure, etc.).
- **`Algomancy-Rulebook-2023-07.pdf` / `.txt`** — earlier full rulebook (secondary).
- **`The-Rules-of-Algomancy.md`**, **`Mastering-Initiative-Strategy-Guide.md`** — web rules write-ups.
- **Dev-logs + `The-Making-of-Algomancy.md`** — designer background (⚠ may contain outdated rules).

## How the data was gathered

- **Cards**: the card-search page is a React app; its image URLs are built from each card's name
  (`…/cardsearch-images/<Name-With-Hyphens>.jpg`). Card text comes from `AlgomancyCards.json`.
- **Rules**: official PDFs downloaded directly; web pages downloaded as raw HTML, article body
  extracted (XPath + pandoc), images/HTML stripped to leave verbatim prose; PDFs → text via
  `pdftotext -layout`.

All sources are official (calebgannon.com / algomancy.io) or the designer's own writing.

## RAG quick-start (the core idea)

Two complementary corpora to index:
1. **Card oracle text** (`AlgomancyCards-OracleText.json`) — one chunk per card, with structured
   metadata (cost/type/factions/etc.) for filtering. Answers "what does card X do?"
2. **Rules text** (`Rules/`) — chunk the Manual + Glossary first; tag each chunk with its source
   and authority level so the bot prefers the Manual/Glossary when sources conflict.

## The chunk corpus (`corpus/algomancy_corpus.jsonl`)

Run `python3 build_corpus.py` to (re)generate. One JSON object per chunk with fields:
`id`, `text`, `source`, `source_type` (`card`/`rulebook`/`glossary`/`article`/`devlog`),
`authority` (1 = most authoritative … 5 = design blog), `authority_label`, `outdated_risk`,
`title`, `metadata`, `char_count`, `approx_tokens`.

Chunking strategy: **one chunk per card** (with structured stats in `metadata`), **one chunk per
glossary term**, heading-aware splitting for the markdown docs, and a clean reading-order
re-extraction of the Manual/2023-Rulebook PDFs (better paragraph flow than the stored `-layout`
`.txt`) packed into ~1600-char chunks on word boundaries. Authority tiers mirror
`Rules/README.md`. Current build: **610 chunks, ~85k tokens** (370 cards, 13 glossary terms,
76 rulebook, 57 article, 94 dev-log). The builder also strips web-extraction noise (spurious
"An error occurred." headings, "Subscribe" footer links) from the markdown sources.

### Querying the corpus (`ask.py`)

A dependency-free keyword search for testing data quality before a real embedding model exists.
TF-IDF scoring with an authority boost (Manual/glossary/cards float to the top on ties).

```
python3 ask.py "what does flame juggle do"
python3 ask.py "can I target opponents during deployment" -k 8
python3 ask.py "graft timing" --type rulebook,glossary --full
```

## Discord bot (`bot.py`)

A Discord rules bot that pairs the TF-IDF retriever with **DeepSeek** (cheap,
OpenAI-compatible API) for generation.

- **`&ask <question>`** — retrieves the top rules chunks, asks DeepSeek to answer
  *only* from them with `[source:tag]` citations, posts the answer as an embed with
  a **Sources** legend, then **opens a thread**. Follow-up messages in that thread
  keep the conversation context.
- **`&card <name>`** — fuzzy-matched card lookup (`difflib`; tolerates typos like
  `sproter` → Sprouter) showing art, cost, P/T, factions, oracle text, and rulings,
  with a "Did you mean…" hint when the match is ambiguous. (No AI → no logging.)
  Look up several at once with commas — `&card Sprouter, Overbloom, Plodding Pebble`
  — up to 10 per message (no card name contains a comma, so it's a safe separator).

**Training data + feedback.** Every AI answer (`&ask` and thread follow-ups) is
logged append-only to `logs/responses.jsonl` — self-contained for offline training:
question, answer, model, conversation history, and the **full retrieved chunks**
(text + scores + authority). Each answer carries three rating buttons — 👍 **Good** /
🤔 **Fine, but odd** (correct but poorly written: too long, off-topic tangents, etc.) /
👎 **Inaccurate**; clicks append to `logs/feedback.jsonl`, joinable by `response_id`.
No click = neutral. Buttons use `DynamicItem`, so they keep working after a bot
restart. `&card` lookups involve no AI, so they're not logged.

**Cited card art.** When an answer cites specific cards, their images are posted
into the thread (not the main channel, to save space) for easy reference.

```
pip install -r requirements.txt

# Pass both credentials on the command line:
python3 bot.py <DEEPSEEK_API_KEY> <DISCORD_TOKEN>

# …or omit either/both and they're read from env vars / a .env file:
python3 bot.py
```

Both credentials are positional arguments; either can instead come from the
`DEEPSEEK_API_KEY` / `DISCORD_TOKEN` env vars (or a `.env` file). `--model <id>`
overrides the model, which defaults to `deepseek-v4-flash` (cheapest).
Requires the **Message Content Intent** enabled on the Discord application.
Generation is the only networked/paid part — retrieval and card lookup are local.

## TODO / next steps (picking back up tomorrow)

- [x] Decide chunking strategy; build a single embeddings-ready JSONL with `source` + `authority`
      metadata per chunk (cards + rules). → `build_corpus.py` → `corpus/algomancy_corpus.jsonl`
- [ ] Add community rulings/FAQ: **BoardGameGeek** (blocked our automated fetch — HTTP 403) and the
      official **Discord** rulings channel (not web-scrapable). Richest source of edge-case rulings.
- [ ] Consider the paid Print-and-Play PDF (74 pp) and transcribing the video tutorials.
- [ ] Pick embedding model + vector store; wire up retrieval and test against the glossary terms.

## Key links

- Card search / oracle data: https://calebgannon.com/algomancycards/
- Rulebook PDF: https://calebgannon.com/wp-content/uploads/Algomancy-manual-copy.pdf
- Glossary: https://calebgannon.com/2022/09/06/algomancy-rules-glossary/
- Official site: https://algomancy.io/  •  Community: Algomancy Discord (https://discord.gg/EQyyjdf4Dr)
