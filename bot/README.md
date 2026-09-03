# `bot/` — the Algomancy rules bot

Retrieval over the rules corpus, answering rules questions in Discord and in a
browser, plus card search, grafted-card composition, colour-combo suggestions,
and draft practice.

The data it reads — the card scans, the oracle JSON, the rules corpus, the
icons — is **not** in here. It lives in [`../data/`](../data/README.md), shared
with the game client, and every path to it is named in `paths.py`.

```
bot/
  paths.py        every location, named once
  core.py         the RAG brain: retrieval, prompt, the DeepSeek call
  retriever.py    BM25 over data/corpus/
  cards.py        the card index (fuzzy name match, art resolution)
  mods.py         graft/augment composition + stacked art
  combos.py       3-colour deck suggestions
  draft.py        p1p1 / p1p6 practice packs
  store.py        append-only logging of answers and feedback
  bot.py          the Discord front-end
  app.py          the FastAPI web front-end
  ask.py          a dependency-free CLI for querying the corpus
  web/            the web app's front-end (served at /static)
  test/           four standalone test scripts (not pytest)
  pipeline/       the scripts that BUILD ../data/ — run by hand
```

## Run it

```bash
cp ../.env.example ../.env          # DISCORD_TOKEN + DEEPSEEK_API_KEY
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python bot.py          # Discord
../.venv/bin/python app.py          # web, http://localhost:8000
```

## Test it

Four standalone scripts — **not pytest**. Each prints its own pass line and
exits non-zero on failure:

```bash
../.venv/bin/python test/test_search.py   #  49
../.venv/bin/python test/test_draft.py    #  48
../.venv/bin/python test/test_mods.py
```

`test_draft` and `test_search` boot the real FastAPI app through
`fastapi.testclient`, so they cover the web routes too.

---

## RAG quick-start (the core idea)

Two complementary corpora to index:
1. **Card oracle text** (`AlgomancyCards-OracleText.json`) — one chunk per card, with structured
   metadata (cost/type/factions/etc.) for filtering. Answers "what does card X do?"
2. **Rules text** (`data/rules/`) — chunk the Manual + Glossary first; tag each chunk with its source
   and authority level so the bot prefers the Manual/Glossary when sources conflict.

## The chunk corpus (`data/corpus/algomancy_corpus.jsonl`)

Run `python3 pipeline/build_corpus.py` to (re)generate. One JSON object per chunk with fields:
`id`, `text`, `source`, `source_type` (`card`/`rulebook`/`glossary`/`article`/`devlog`),
`authority` (1 = most authoritative … 5 = design blog), `authority_label`, `outdated_risk`,
`title`, `metadata`, `char_count`, `approx_tokens`.

Chunking strategy: **one chunk per card** (with structured stats in `metadata`), **one chunk per
glossary term**, heading-aware splitting for the markdown docs, and a clean reading-order
re-extraction of the Manual/2023-Rulebook PDFs (better paragraph flow than the stored `-layout`
`.txt`) packed into ~1600-char chunks on word boundaries. Authority tiers mirror
`data/rules/README.md`. Current build: **610 chunks, ~85k tokens** (370 cards, 13 glossary terms,
76 rulebook, 57 article, 94 dev-log). The builder also strips web-extraction noise (spurious
"An error occurred." headings, "Subscribe" footer links) from the markdown sources.

### Querying the corpus (`ask.py`)

A dependency-free keyword search for testing data quality before a real embedding model exists.
TF-IDF scoring with an authority boost (Manual/glossary/cards float to the top on ties).

```
../.venv/bin/python ask.py "what does flame juggle do"
../.venv/bin/python ask.py "can I target opponents during deployment" -k 8
../.venv/bin/python ask.py "graft timing" --type rulebook,glossary --full
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

A Discord rules bot that pairs the BM25 retriever with **DeepSeek** (cheap,
OpenAI-compatible API) for generation.

> **The `&` prefix was retired on 2026-09-02.** Everything is a slash command
> now: they autocomplete, they work in DMs, and the bot no longer has to read
> every message in a server to find them. Typing an old `&` command gets one
> reply pointing at its replacement (`bot.LEGACY`), and that shim is meant to be
> deleted a month later.
>
> ⚠ **The bot must be invited with `scope=bot%20applications.commands`.** With
> `scope=bot` alone `tree.sync()` returns 200 and *no command appears anywhere* —
> which is the most likely "it deployed and nothing happened" outcome.

- **`/ask <question>`** — retrieves the top rules chunks, asks DeepSeek to answer
  *only* from them with `[source:tag]` citations, posts the answer as an embed with
  a **Sources** legend, then **opens a thread**. Follow-up messages in that thread
  keep the conversation context.
- **`/card <name>`** — fuzzy-matched card lookup (`difflib`; tolerates typos like
  `sproter` → Sprouter) showing art, cost, P/T, factions, oracle text, and rulings,
  with a "Did you mean…" hint when the match is ambiguous. (No AI → no logging.)
  Look up several at once with commas — `/card Sprouter, Overbloom, Plodding Pebble`
  — up to 10 per message (no card name contains a comma, so it's a safe separator).
- **`/card <host> + <mod>`** — a **grafted or augmented** card: what the stack
  actually reads as, with the art stacked (see below). `/card General Smof +
  Spectrogenesis`.
- **`/search <description>`** — the same lookup for when you *can't* name the card
  (see below). `/search wood unit that draws a card when it dies` → the best match
  as a full card embed, runners-up in a dropdown. (No AI → no logging.)
- **`/colors`** — suggests three colours to play next (see below). `/colors stats`
  shows your coverage; `/played fire earth wood` records a game directly.
- **`/p1p1` / `/p1p6`** — pack-1-pick-X draft practice (see below). Posts a
  reproducible pack as one numbered image with tap-to-pick buttons and a
  discussion thread. `/p1p6 <seed>` replays or shares an exact pack.

**Training data + feedback.** Every AI answer (`/ask` and thread follow-ups) is
logged append-only to `logs/responses.jsonl` — self-contained for offline training:
question, answer, model, conversation history, and the **full retrieved chunks**
(text + scores + authority). Each answer carries three rating buttons — 👍 **Good** /
🤔 **Fine, but odd** (correct but poorly written: too long, off-topic tangents, etc.) /
👎 **Inaccurate**; clicks append to `logs/feedback.jsonl`, joinable by `response_id`.
No click = neutral. Buttons use `DynamicItem`, so they keep working after a bot
restart. `/card` lookups involve no AI, so they're not logged.

**Cited card art.** When an answer cites specific cards, their images are posted
into the thread (not the main channel, to save space) for easy reference.

```
pip install -r requirements.txt
cp ../.env.example ../.env     # fill in DEEPSEEK_API_KEY and DISCORD_TOKEN
../.venv/bin/python bot.py
```

Both credentials come from the environment or the repo-root `.env` — never
the command line, which would put them in `ps` for every user on the box.
`--model <id>` overrides the model, which defaults to `deepseek-v4-flash`
(cheapest).
Requires the **Message Content Intent** enabled on the Discord application.
Generation is the only networked/paid part — retrieval and card lookup are local.

## Card search (`cards.py` → `/find` on Discord, `/search` on the web)

`/card` needs the name. `/find` is for the much more common situation — you
remember what a card *did*, not what it was called:

```
/find wood unit that draws a card when it dies
/find counter a spell
/find 2/1 fire unit with haste
/find unit with trample
```

It ends where `/card` ends: the best match rendered as a full card (art, stats,
oracle text, rulings), with the runners-up one tap away — a Discord dropdown, or a
tap-to-swap list on the web. The ranking lives in `cards.CardIndex.search`, so both
front-ends get the same results from one implementation. No AI and no network: 370
cards is small enough to score the whole set on every query, in memory.

## Grafted / augmented cards (`mods.py` → `/card name: A with: B`)

Modifications are the fun part of Algomancy and the hard part to talk about: "I
put Spectrogenesis under General Smof" makes everyone go and look up two cards and
assemble the result in their head. So `/card` takes a `with:` (and still a `+`):

```
/card name: General Smof  with: Spectrogenesis     → the graft
/card name: Aetherflux Golem  with: A Pile of Rubbish  → the augment
/card name: Amphivore + Spectrogenesis + Accelerated Germination   → up to 4 mods
```

The first card is the **host** (the one in play); the rest go under it. No card
name contains a `+`, so the separator needs no escaping.

**What it works out for you.** Which of the two rules applies, whether it's legal,
and what the result reads as:

- **Augment (+)** — pay B's cost, put B under any unit. The host is then treated as
  if it had the text in B's `(+)` paragraph. *Only that paragraph* transfers, so a
  card like Stellarspore Harvester contributes its augment line and leaves its
  first paragraph behind.
- **Graft (switch)** — **both** cards need the graft symbol. Graft abilities are
  templated *Cause → Effect*, and grafting adds B's **effect** onto A's cause, so
  the result reads "Cause → effect1 AND effect2". B's own cause is dropped — the
  host's is the one that fires. Graft Plodding Pebble onto something and it
  contributes "Put a +1/+1 counter on me", *not* "When I am dealt damage".

No card carries both symbols, so the second card alone says which rule is in play —
you never have to tell it which you meant. Illegal combinations explain themselves
("Aetherflux Golem has no graft symbol, so nothing can be grafted onto it"), and if
you name the cards the wrong way round it does the legal one and says so, rather
than bouncing you.

Both icons are kept in the combined text instead of being flattened into "and":
the symbol is what tells you an effect is *bounded* (once per turn), and a bounded
effect stays bounded after it's grafted on.

### Stacking the art

The image is the two cards overlapped, the modification sliding out from under its
host far enough to show the ability it contributes — the way it looks on the table.
The catch is that "far enough" is different on every card: the ability sits on a
different line depending on how much other text the card has.

So `build_anchors.py` finds it. Every graft/augment ability is printed next to its
icon, and we already ship those icons (`data/icons/*.webp`), so it template-matches the
glyph against each card's own art (normalized cross-correlation, `numpy`) and
records where it landed in `data/cards/mod_anchors.json` — 217 cards, run once
at build time, so the bot just reads an offset. Two details earned their keep:

- The template is **luminance premultiplied by alpha**. The augment glyph is a white
  hexagon with a black plus *cut into it*, and that plus lives in the RGB channel,
  not the alpha — match on alpha alone and you're matching a blank hexagon.
- The correlation is **not masked** to the glyph, so the template's transparent
  border still demands a dark surround. Without it, the white complexity diamond in
  the type bar is a perfectly good match for a white arrow.

The peek then cuts at the **blank gap above the icon's line**, not a fixed offset:
cards' text lines sit close together, and a blind offset leaves a readable sliver of
the line above — which on Stellarspore Harvester is its *non-augment* paragraph.
Showing it would claim text transfers that doesn't.

Run `python3 pipeline/build_anchors.py` if the card art is ever re-exported.

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
(`../.venv/bin/python test/test_search.py`, 28 checks, offline). Change a weight and the
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

**Nothing is recorded until you confirm.** `/colors suggest` (Discord) or `/colors` (web)
only *suggests*; the combo is logged when you hit ✅ **We played this**, so
re-rolling a suggestion you don't fancy never pollutes your history. Re-rolling
also avoids handing you back the combo you just declined. A repeat confirm within
six hours is treated as a double-click, not a second game.

History is **per person**, appended to `logs/games.jsonl` and keyed by Discord
user id or — on the web — the same stable per-browser id already used for feedback,
so nobody needs an account. Both front-ends read the one file, so a game logged in
Discord shows up on the website immediately.

```
/colors suggest             → 🎲 Fire · Earth · Wood, "you've never played this one",
                              a 3/10 progress bar, and the list of untouched combos
/colors stats               → your full history: counts, last-played dates, what's left
/colors log fire earth wood → record a game directly (aliases work: `r e g`)
```

On the web, `/colors`, `/colors stats`, and `/colors fire earth wood` do the same.

### When the expansion lands

Light and Dark take this from 10 combos to **35** (`C(7,3)`). The only change
needed is appending them to `COLORS` in `combos.py` — the combo list, coverage,
progress bar, parsing, and both UIs all derive from that tuple. Existing history
stays valid. (New icons for the two colours would need adding to `data/icons/` and the
Discord guild separately; a missing icon degrades to the colour's name as text.)

## Pack-1-pick-X draft practice (`draft.py`)

Draft practice that follows Algomancy's real live-draft rules, on both front-ends.
Framework-agnostic like `combos.py`; the pure engine has no third-party deps and
image rendering (Pillow) is imported lazily.

- **`/draft mode:p1p1`** (Discord) / **`/p1p1`** (web) — a standard **10-card pack, pick 1**, from the whole
  draftable set (the 5 elements + all 10 two-colour hybrid pairs). The classic
  "what's the best card here?" exercise.
- **`/draft mode:p1p6`** (Discord) / **`/p1p6`** (web) — a **turn-1 live-draft scenario**. The Manual deals each
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
command mints a fresh random code; `seed:` (any string) forces one. On the
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
(`../.venv/bin/python test/test_draft.py`) — pool counts, seeded determinism, preset
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
../.venv/bin/python app.py <DEEPSEEK_API_KEY>
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

---

## Talking to the digital client (`gameserver.py`, `pushserver.py`)

The two halves of this repo used to share `data/` and nothing else. They now
talk over loopback, both ways, and all of it is off unless `ALGO_BOT_TOKEN` is
set on **both** sides.

**Bot → game server (:5000).** `/search` runs the browser's query language
(`client/ui/cardsearch.ts`) through `GET /api/cardsearch`; `/profile`,
`/rating`, `/queue` and `/link` use the token-gated `/api/bot/*`;
`/leaderboard` reads the public `/api/players`.

⚠ **The bot holds no copy of anything the server owns.** A second query grammar
in Python would drift, and nothing would notice until the two disagreed in
front of somebody. When :5000 is down every command that needs it says so, says
it is the *game server* rather than the bot, and says what still works.

**Game server → bot (:8765).** `client/server/hooks.ts` pushes queue events to
`pushserver.py`, and `/queuewatch` turns them into channel announcements. There
is also a replay ring (`/api/bot/events?since=`) so a bot that restarts catches
up rather than silently missing joins.

⚠ **`ALGO_BOT_TOKEN` lives in two files.** Here it comes from the repo-root
`.env`; the game server reads `client/server/tester.env` through its systemd
unit (`deploy/algomancy-game.service`). A mismatch is not an error — the server's
gate answers 404 to everything, which looks exactly like the feature not
existing.

**The one-way half that predates all this and must not break:**
`client/server/main.ts` proxies `/api/cardinfo` and `/api/judge` to `app.py` on
**:8000** — the in-game card inspector and the "ask the judge" box. Those two
response shapes and that port are a contract.
