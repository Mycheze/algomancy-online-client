# `bot/` — the Algomancy rules bot

Retrieval over the rules corpus, answering rules questions in Discord and in a
browser, plus card search, grafted-card composition, colour-combo suggestions
and draft practice. Retrieval is lexical and local; the one external call is
the language model that writes the answer.

The data it reads, the card scans, the oracle JSON, the rules corpus, the
icons, is **not** in here. It lives in [`../data/`](../data/README.md), shared
with the game client, and every path to it is named once in `paths.py`.

```
bot/
  paths.py        every location, named once; the runtime-state paths are functions of ALGO_VAR_DIR
  core.py         the brain: retrieval, the verified primer, the prompt, the DeepSeek call, citations
  retriever.py    BM25 over data/corpus/, with the authority tiers as score multipliers
  oracle.py       the one loader for the card transcription
  cards.py        the card index: fuzzy name match, description search, art resolution
  mods.py         graft / augment composition, and the stacked art
  combos.py       three-colour deck suggestions from what you have played
  draft.py        p1p1 / p1p6 practice packs, seeded and reproducible
  rulings.py      the curated designer rulings, by card
  store.py        append-only logging of answers, feedback and games under var/
  discordui.py    every embed and formatter, no Discord client in it, testable offline
  bot.py          the Discord front-end
  cogs/           the slash commands, one module per area
  app.py          the FastAPI web front-end; web/index.html is its one page
  ask.py          a dependency-free CLI for querying the corpus
  gameserver.py   the client for the game server on :5000
  pushserver.py   the loopback listener the game server pushes queue events to
  watchers.py     the queue announcer's channel list and cooldowns
  test/           eight standalone test scripts and run_all.py
  pipeline/       the scripts that BUILD ../data/, run by hand
  docs/           test_questions.md, the evaluation question sheet
```

## Run it

```bash
cp ../.env.example ../.env          # DISCORD_TOKEN, DEEPSEEK_API_KEY; everything else has a default
python3 -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt
../.venv/bin/python app.py          # the web app, http://127.0.0.1:8000, loopback
../.venv/bin/python bot.py          # the Discord bot
```

Both read the repo-root `.env`. Secrets never go on the command line, which
would put them in `ps` for every user on the box. `--model <id>` overrides the
model, which defaults to `deepseek-v4-flash`. The Discord application needs
the Message Content Intent, and the bot must be invited with
`scope=bot%20applications.commands`: with `scope=bot` alone the command sync
returns 200 and no command appears anywhere.

Deployed, `app.py` and `bot.py` are the `algomancy-web` and `algomancy-bot`
systemd units in [`../deploy/`](../deploy/README.md).

## Test it

Eight standalone scripts, not pytest. Each prints its own pass line and exits
non-zero on failure; `run_all.py` runs them all with one exit code, and
`npm --prefix ../client run check` ends by calling it:

```bash
../.venv/bin/python test/run_all.py          # all eight
../.venv/bin/python test/run_all.py slash    # one of them
```

`test_draft` and `test_search` boot the real FastAPI app through
`fastapi.testclient`; `test_slash`, `test_components` and `test_queuewatch`
construct the real Discord views and click them. Every script points
`ALGO_VAR_DIR` at a throwaway directory first (`test/_scratch_var.py`), so a
test run can never write to a deployment's logs.

`docs/test_questions.md` is a sheet of realistic player questions, typos
included, grouped by what they probe. It is for judging answer quality by
hand; nothing runs it.

## How a question is answered

```
/ask, or POST /api/ask
  → Retriever.search(): BM25 over the committed corpus (hand-rolled, no embeddings),
    typos repaired against the corpus vocabulary, an authority tier per chunk
    turned into a score multiplier so a designer ruling outranks a dev-log,
    and a floor that keeps the rulebook in every slate
  → the prompt: system prompt + the verified primer + prior turns with their
    citations stripped + the top passages, with the question LAST
  → one DeepSeek call, reasoning switched on by a router when the question looks like it needs it
  → the answer, with [source:tag] citations rendered as a Sources legend
  → var/logs/responses.jsonl: the answer, every retrieved chunk in full, the history,
    and an engine_version stamp naming the prompt, the corpus hash and the retrieval parameters
```

`core.py` owns all of that and knows nothing about Discord or HTTP. Both
front-ends import it, so there is one brain and one primer. Every answer gets
three rating buttons, 👍 / 🤔 / 👎, and a click appends to
`var/logs/feedback.jsonl`, joinable by `response_id`. Card lookups involve no
model and are not logged.

The corpus is `data/corpus/algomancy_corpus.jsonl`: one chunk per card, one
per glossary term, heading-aware splits of the markdown sources, and the two
rulebook PDFs re-extracted in reading order and packed on word boundaries.
Each chunk carries `source`, `source_type`, `authority` (1 is the Manual, 5 is
a design blog) and an `outdated_risk` flag. The tiers mirror
`data/rules/README.md`.

`ask.py` queries the corpus with no model at all, for checking retrieval on
its own:

```bash
../.venv/bin/python ask.py "can I target opponents during deployment" -k 8
../.venv/bin/python ask.py "graft timing" --type rulebook,glossary --full
```

## The commands

Everything is a slash command; the `&` prefix was retired on 2026-09-02.

| Discord | web | what |
|---|---|---|
| `/ask <question>` | the chat box, `POST /api/ask` | a cited rules answer, and a thread for follow-ups |
| `/card <name>` | `/card <name>`, `GET /api/card?name=` | fuzzy-matched card lookup: art, cost, stats, oracle text, rulings. Several at once with commas |
| `/card name: A with: B` | `/card A + B` | a grafted or augmented card: what it reads as, and the art stacked |
| `/find <description>` | `/search`, `GET /api/search?q=` | the card you cannot name, by what it does |
| `/search <query>` | | the client's query language (`client/ui/cardsearch.ts`), run on the game server |
| `/colors suggest` · `stats` · `log` | `/colors`, `GET /api/colors` | three colours to play next, your coverage, and recording a game |
| `/rulings <card>` | | the designer's curated rulings on a card |
| `/draft mode:p1p1|p1p6` | `/p1p1`, `/p1p6`, `GET /api/draft` | a practice pack with tap-to-pick, reproducible by its seed code |
| `/profile` · `/rating` · `/queue` · `/leaderboard` · `/link` | | the game server's accounts and ladder, from Discord |
| `/queuewatch` | | announce matchmaking-queue events in this channel |
| `/help` · `/feedback` | | what the bot does, and a note to the owner |

**Card search** (`cards.py`) is BM25 over each card's fields with three
additions that do the real work: the player's vocabulary is expanded to the
game's (*destroy* → **delete**, *counter a spell* → **negate**, *creature* →
**unit**), each card is indexed with the *definitions* of its attributes so
"draws a card when it hits the player" finds the one `{Thieving}` card, and
half-remembered details (an element, `2/1`, `costs 3`) lift the cards that fit
rather than filtering out the rest. `test/test_search.py` asserts the rank of
the expected card for each of these, so a changed weight says what it cost.

**Grafts and augments** (`mods.py`) work out which of the two rules applies
from the second card alone (no card carries both symbols), whether it is
legal, and what the result reads as: an augment transfers only its `(+)`
paragraph; a graft adds the mod's *effect* onto the host's *cause*. The image
is the two cards overlapped, the mod sliding out from under the host far
enough to show the ability it contributes. Where that is on each card is
found once by `pipeline/build_anchors.py` and read from
`data/cards/mod_anchors.json`.

**Colour combos** (`combos.py`) steer a playgroup through all 35 three-colour
trios before repeating one, preferring the colours you have used least
recently. Nothing is recorded until you confirm you played it.

**Draft practice** (`draft.py`) follows the Manual's live-draft deal: a
ten-card pack, or the turn-one sixteen-card pile you keep six from, built
from three elements and their hybrids. A pack's code (`p1p6-7GK2QX`) always
reproduces it, on either front-end.

## The pipeline: what builds `data/`

Run by hand, never on a request path. Each script has one output, which is
committed and never hand-edited. `pipeline/requirements.txt` has the extra
dependencies (numpy, Pillow).

| script | reads | writes |
|---|---|---|
| `export_rulings.sh` | the community Discord, through the vendored DiscordChatExporter and a user token | `data/rulings/exports/`, untracked, ~1.7 GB |
| `build_rulings.py` | the export | `data/rulings/generated_rulings.jsonl`: the designer's Q&A, tiered by author role, curated once by a model fan-out |
| `build_corpus.py` | `data/cards/`, `data/rules/`, `data/rulings/` | `data/corpus/algomancy_corpus.jsonl`. Its SHA-256 is part of `engine_version`, which is why a generated file is committed |
| `build_anchors.py` | the scans and `data/icons/` | `data/cards/mod_anchors.json`: where the graft glyph sits on each card |
| `classify_complexity.py` | the scans | `data/cards/complexity-overrides.json`: the Simple/Complex glyph, for the cards whose oracle row says `Common`. The one generated file the client consumes |
| `upload_emojis.py` | `data/icons/` | the guild's emoji set |

A rebuild is expected to be byte-identical. If it is not, an input changed,
and that is worth knowing before committing it. The Discord export and the
per-batch work files are gitignored and exist only where the export was run;
`build_corpus.py` run without them builds a smaller corpus and does not
complain, so read the diffstat before committing a regenerated file.
`RAG-CHANGELOG.md` records what each `engine_version` prefix means.

## Talking to the game server

The two halves of the repo share `data/` and, on a deployed box, loopback
HTTP both ways. All of it is off unless `ALGO_BOT_TOKEN` is set on **both**
sides; unset means the integration is absent, not broken.

- **Bot → game server (:5000)**, `gameserver.py`. `/search` runs the
  browser's query language through `GET /api/cardsearch`; `/profile`,
  `/rating`, `/queue` and `/link` use the token-gated `/api/bot/*`;
  `/leaderboard` reads the public `/api/players`. The bot holds no copy of
  anything the server owns. When :5000 is down, every command that needs it
  says so, names the game server rather than the bot, and says what still
  works.
- **Game server → bot (:8765)**, `pushserver.py`. The server pushes queue
  events; `/queuewatch` turns them into channel announcements. A replay ring
  (`/api/bot/events?since=`) lets a restarted bot catch up.
- **The older half, which must not break**: the game server proxies
  `/api/cardinfo` and `/api/judge` to `app.py` on :8000. That is the in-game
  card inspector and the "ask the judge" box. Those two response shapes and
  that port are a contract.

The token lives in two files, the repo-root `.env` here and
`client/server/tester.env` for the game server's unit. A mismatch is not an
error: the server's gate answers 404 to everything, which looks exactly like
the feature not existing.

## Configuration

Everything is in [`../.env.example`](../.env.example), with a comment per
variable. The ones that matter: `DEEPSEEK_API_KEY` and `DISCORD_TOKEN`;
`DEEPSEEK_MODEL`, `DEEPSEEK_REASONING` (`auto` / `always` / `never`) and
`DEEPSEEK_TIMEOUT`; `ALGO_BOT_TOKEN`, `ALGO_GAME_SERVER` and `ALGO_BOT_LISTEN`
for the integration; `ALGO_VAR_DIR` to move the runtime state, which the
tests use and a deployment does not.

Answer generation is the only paid part. At the default model a question
costs a fraction of a cent.

---

Algomancy is Caleb Gannon's game; the card text and rules this bot quotes are
his, used with permission. See [`../data/NOTICE.md`](../data/NOTICE.md).
