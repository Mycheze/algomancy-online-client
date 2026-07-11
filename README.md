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
├── cards.py          → card index: fuzzy name matching, description search, art
├── combos.py         → which 3-colour decks you've played + what to play next
├── bot.py            → Discord bot (&ask RAG + &card/&search lookup, DeepSeek-powered)
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

## Front-ends share one brain (`core.py`)

The RAG core — retrieval, the verified rules **primer**, the system prompt, the
DeepSeek call with the "math-mode" reasoning router, and citation rendering —
lives in **`core.py`** and knows nothing about Discord or HTTP. Two front-ends
import it, so there is a single brain behind both and edits to the primer/prompt
apply everywhere:

- **`bot.py`** — the Discord bot.
- **`app.py`** — the web app (use it without Discord; share a link).

Both also reuse **`store.py`**, so every answer and 👍/🤔/👎 rating is logged to
the same `logs/` files for training, no matter which front-end produced it.

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
- **`&search <description>`** — the same lookup for when you *can't* name the card
  (see below). `&search wood unit that draws a card when it dies` → the best match
  as a full card embed, runners-up in a dropdown. (No AI → no logging.)
- **`&colors`** — suggests three colours to play next (see below). `&colors stats`
  shows your coverage; `&played fire earth wood` records a game directly.
- **`&p1p1` / `&p1p6`** — pack-1-pick-X draft practice (see below). Posts a
  reproducible pack as one numbered image with tap-to-pick buttons and a
  discussion thread. `&p1p6 <seed>` replays or shares an exact pack.

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

## Card search (`cards.py` → `&search` / `/search`)

`&card` needs the name. `&search` is for the much more common situation — you
remember what a card *did*, not what it was called:

```
&search wood unit that draws a card when it dies
&search counter a spell
&search 2/1 fire unit with haste
&search unit with trample
```

It ends where `&card` ends: the best match rendered as a full card (art, stats,
oracle text, rulings), with the runners-up one tap away — a Discord dropdown, or a
tap-to-swap list on the web. The ranking lives in `cards.CardIndex.search`, so both
front-ends get the same results from one implementation. No AI and no network: 370
cards is small enough to score the whole set on every query, in memory.

It's BM25 over each card's fields, but the ranking is only half the problem. Three
things do the actual work:

- **The game's vocabulary, not the player's.** No Algomancy card says *destroy*
  (they say **delete**), *counter a spell* (**negate**), *return to hand*
  (**recall**), *enters play* (**spawn**), *creature* (**unit**), or *graveyard*
  (**bin**). Those queries retrieve nothing however well they're ranked, so the
  typed word is expanded to the printed one — while keeping the typed one, since
  "discard" is both a synonym for the bin and a thing two cards literally do.
  Idioms are matched as phrases, because *"counter a spell"* means negate while a
  bare *"counter"* means a +1/+1 counter and must be left alone.
- **What keywords mean, not just what they're called.** Each card is indexed with
  the *definitions* of its attributes. `Slink` is the only `{Thieving}` card in the
  game and the word "draw" appears nowhere on it — "unit that draws a card when it
  hits the player" can only find it because the index knows Thieving **is** that
  sentence. Same trick maps trample → `{Piercing}`, deathtouch → `{Deadly}`,
  "can't be blocked" → `{Sneaky}`.
- **The details you half-remember.** An element (`green`, or `red` → fire), a stat
  line (`2/1`), a cost (`costs 3`), spell-vs-unit. These *lift* the cards that fit
  rather than filtering out the ones that don't, so a wrong guess re-ranks the
  field instead of emptying it — and a cue can be the whole query (`2/1` alone is a
  perfectly good search). Typos are repaired against the card vocabulary, so
  `flyng` and `poisonus` still land.

Ranking is a tuning problem, so the tuning has a regression net: `test_search.py`
asserts the *rank* of the expected card for each of these cases
(`.venv/bin/python test_search.py`, 28 checks, offline). Change a weight and the
checks that break tell you what it cost.

## Colour-combo suggestions (`combos.py`)

A deck is three of the game's colours mixed together. With the base five that's
**10 distinct combos** — few enough that a playgroup drifts back to the same
handful without noticing. This tracks what you've played and steers you toward
what you haven't.

The rule has two layers. **Coverage** decides which combos are eligible;
**freshness** decides which eligible one you actually get.

- **Coverage.** While you have never-played combos left, only those are eligible —
  so you always see all of them before repeating any. Once they're all played,
  the **stalest third** (longest untouched) becomes eligible instead.
- **Freshness.** Among the eligible combos, it picks the one whose *colours* you've
  used least recently, breaking ties at random. Coverage alone doesn't keep things
  fresh: Fire·Earth·Metal followed by Fire·Earth·Wood is a brand-new trio, but it's
  the same game two nights running. Freshness pushes the pick away from the colours
  in your recent games (`FRESHNESS_HORIZON` = how many games back that looks).

With 5 colours and 3 per deck, consecutive games *must* share at least one colour
(3 + 3 > 5), so the goal is minimising overlap, not eliminating it. Over a full
10-game cycle this takes the average overlap from **1.67 colours down to 1.06**
(the floor is 1.00) and the longest run of one colour from **6 games down to 3**.
Under the expansion's 7 colours a fully disjoint follow-up becomes possible, and
it finds one: average overlap drops to **0.10**.

**Nothing is recorded until you confirm.** `&colors` (Discord) or `/colors` (web)
only *suggests*; the combo is logged when you hit ✅ **We played this**, so
re-rolling a suggestion you don't fancy never pollutes your history. Re-rolling
also avoids handing you back the combo you just declined. A repeat confirm within
six hours is treated as a double-click, not a second game.

History is **per person**, appended to `logs/games.jsonl` and keyed by Discord
user id or — on the web — the same stable per-browser id already used for feedback,
so nobody needs an account. Both front-ends read the one file, so a game logged in
Discord shows up on the website immediately.

```
&colors                     → 🎲 Fire · Earth · Wood, "you've never played this one",
                              a 3/10 progress bar, and the list of untouched combos
&colors stats               → your full history: counts, last-played dates, what's left
&played fire earth wood     → record a game directly (aliases work: `&played r e g`)
```

On the web, `/colors`, `/colors stats`, and `/colors fire earth wood` do the same.

### When the expansion lands

Light and Dark take this from 10 combos to **35** (`C(7,3)`). The only change
needed is appending them to `COLORS` in `combos.py` — the combo list, coverage,
progress bar, parsing, and both UIs all derive from that tuple. Existing history
stays valid. (New icons for the two colours would need adding to `Icons/` and the
Discord guild separately; a missing icon degrades to the colour's name as text.)

## Pack-1-pick-X draft practice (`draft.py`)

Draft practice that follows Algomancy's real live-draft rules, on both front-ends.
Framework-agnostic like `combos.py`; the pure engine has no third-party deps and
image rendering (Pillow) is imported lazily.

- **`&p1p1` / `/p1p1`** — a standard **10-card pack, pick 1**, from the whole
  draftable set (the 5 elements + all 10 two-colour hybrid pairs). The classic
  "what's the best card here?" exercise.
- **`&p1p6` / `/p1p6`** — a **turn-1 live-draft scenario**. The Manual deals each
  player 16 cards on turn 1 (4 opening hand + 10 pack + 2 first draw), combined
  into a pile of 16 to draft, keeping 6. So this is a **16-card pack you pick 6
  from**, built from **3 randomly chosen elements** plus the 3 hybrid pairs among
  them (live draft for 2-3 players uses 3 elements).

The **draftable pool** is filtered to exactly the real drafted deck — **54 cards
per element** (matching the Manual) + 50 hybrids = 320 cards. Colourless Prismite/
Shard resources, Kickstarter Glitch cards, tokens, help cards, and card backs are
excluded.

**Seeds.** Every pack has a short **code** like `p1p6-7GK2QX`. The same code
always reproduces the same three elements and same cards, so you can save a pack,
replay it, paste it into the other front-end, or send it to a friend. A bare
command mints a fresh random code; `&p1p6 <seed>` (any string) forces one. On the
web, packs also carry a **deep-link URL** (`/?draft=p1p6-7GK2QX`) that loads the
exact pack, and a copy-seed / copy-link button.

**Discord.** The pack is one composite image with numbered slots and a row of
tap-to-pick **buttons** (per-user, tracked privately). The moment someone
completes their picks, their chosen cards are rendered as an image into an
auto-opened **discussion thread** ("what would you keep, and why?"). Buttons carry
the pack code in their `custom_id`, so they survive restarts.

**Web.** The pack renders as an interactive **tap-to-highlight grid** with a live
`n/6` counter, a corner 🔍 zoom on each card, and dimming of the un-picked cards
once you've chosen your set — no server round trip, all client-side.

Endpoint: `GET /api/draft?mode=p1p1|p1p6&seed=` → the pack as JSON (slots with art
URLs, elements, code). Offline-tested end to end in `test_draft.py`
(`.venv/bin/python test_draft.py`) — pool counts, seeded determinism, preset
rules, codes, image rendering, and the endpoint.

## Web app (`app.py`)

A small **FastAPI** chat website over the same `core.py` brain — for using the
bot at the table without Discord, and for handing a plain link to people you're
teaching (no "join a server"). It's actually a nicer surface than Discord: inline
card art, real game icons, markdown answers, and conversation follow-ups kept in
the browser. Same 👍/🤔/👎 feedback and training-data logging as the bot.

Endpoints: `GET /` (the chat UI), `POST /api/ask`, `POST /api/feedback`,
`GET /api/card?name=`, `GET /api/search?q=`, `GET /api/colors`, `POST /api/colors/played`,
`GET /api/draft?mode=&seed=`, `GET /art/{name}`, and `/icons/...`. The page is a single static file
(`static/index.html`, vanilla JS — no build step).

```
pip install -r requirements.txt

# DeepSeek key on the command line, or from DEEPSEEK_API_KEY env / .env:
python3 app.py <DEEPSEEK_API_KEY>
# → serves on http://0.0.0.0:8000  (--host/--port to change; --model to override)
```

In the UI, ask a rules question normally, type `/card <name>` to look one up,
`/search <description>` to find a card you can't name (tap any result to swap the
card shown), or `/colors` for a fresh 3-colour deck suggestion.

### Share it publicly (Cloudflare Tunnel)

The app binds to `0.0.0.0`, so anyone on your home Wi-Fi can already reach it at
`http://192.168.100.5:8000`. To hand a link to people **anywhere** — no
port-forwarding, no exposing your IP, free — put a Cloudflare Tunnel in front:

```
# one-time install (Debian/Ubuntu); see Cloudflare docs for other distros
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared --version

# quick, throwaway public URL (prints a https://<random>.trycloudflare.com link):
cloudflared tunnel --url http://localhost:8000

# …or a stable named tunnel on your own domain (survives restarts):
#   cloudflared tunnel login
#   cloudflared tunnel create algomancy
#   cloudflared tunnel route dns algomancy rules.yourdomain.com
#   cloudflared tunnel run --url http://localhost:8000 algomancy
```

Run `app.py` and `cloudflared` side by side on the server (the same box the
Discord bot runs on). The quick `trycloudflare.com` URL is perfect for a game
night; the named tunnel gives a memorable address you can reuse.

> ⚠️ A public link means anyone with it can spend your DeepSeek credits. The
> trycloudflare URL is random and unlisted, but for a long-lived public deploy
> consider a simple access gate (Cloudflare Access, or a shared passphrase).

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
