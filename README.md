# Algomancy

Tools for [Algomancy](https://algomancy.io/), Caleb Gannon's card game: a rules
bot that answers questions about it, and an online client you can play it in.

Three things live here, and they are peers.

| | what it is | how big |
|---|---|---|
| **[`data/`](data/README.md)** | the shared source data — 528 card scans, the oracle JSON, the rules corpus, the icons, the designer's rulings. No code. **Both halves read it.** | ~85 MB |
| **[`bot/`](bot/README.md)** | the **rules bot** — retrieval over the rules corpus, answering in Discord and in a browser, plus card search and draft practice | ~11k lines Python |
| **[`client/`](client/README.md)** | the **digital client** — a rules-*enforcing* Algomancy you can play online, with a real engine, 492 scripted cards, accounts and decks | ~200k lines TypeScript |

The repo started as the bot in June 2026 and grew the client inside it that
July. The client is now about twenty times the size, but they are not layered:
they share `data/` and nothing else. Neither imports the other.

## Run the client

```bash
npm --prefix client/engine install
npm --prefix client/ui run build
npm --prefix client/server start        # http://localhost:8080  (PORT= to change)
```

Or, with no server at all, open `client/ui/index.html` — a hotseat rig
with the same engine, `?demo` for a scripted mid-battle.

## Run the bot

```bash
cp .env.example .env                    # fill in DISCORD_TOKEN + DEEPSEEK_API_KEY
python3 -m venv .venv && .venv/bin/pip install -r bot/requirements.txt
.venv/bin/python bot/bot.py             # the Discord bot
.venv/bin/python bot/app.py             # the web app, http://127.0.0.1:8000 (loopback)
```

Deployed, all three are systemd units: see [`deploy/`](deploy/README.md).

## The gates

```bash
npm --prefix client run check           # typecheck + the suites + bundle + the bot's tests
.venv/bin/python bot/test/run_all.py    # just the bot's eight test scripts
```

`client run check` takes about five minutes and the server suite inside it binds
a port — **run it in the background, and never two at once.** There is no CI;
deploy is a git pull and a restart.

## Where to read next

- **[`CLAUDE.md`](CLAUDE.md)** — the invariants: what is generated and must never
  be hand-edited, which directories are secretly test fixtures, and the two
  operational rules that have cost real time. Short, and worth reading before
  changing anything.
- **[`data/rules/README.md`](data/rules/README.md)** — the authority order over
  the rules sources. The manual outranks the glossary outranks the 2023
  rulebook; the dev-logs may be flatly out of date. Everything downstream, in
  both halves, depends on this ordering.
- **[`client/docs/digital-rules.md`](client/docs/digital-rules.md)** — 267
  adjudications the engine forced out of the paper rules. This is the most
  valuable document in the repo and it is not really documentation: it is a
  specification, and the engine's tests encode it.

## Links

- Card data / oracle: <https://calebgannon.com/algomancycards/>
- Rulebook PDF: <https://calebgannon.com/wp-content/uploads/Algomancy-manual-copy.pdf>
- Glossary: <https://calebgannon.com/2022/09/06/algomancy-rules-glossary/>
- Official site: <https://algomancy.io/> · Community: [Algomancy Discord](https://discord.gg/EQyyjdf4Dr)

> Algomancy is Caleb Gannon's game. This repo is fan work; the card text, art and
> rules quoted throughout are his. If you play the client, buy the game — or at
> least the print-and-play.
