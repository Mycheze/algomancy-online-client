# The card editor: Caleb edits his cards from the client

**Status: DESIGN, for the owner's review. Nothing here is built.**
The research it rests on is `friendlybot.md`; read that first.

## In short

Caleb opens a card in the client, changes its numbers, text or art in his own notation, and
presses one button. The client gives him the exact FriendlyBot command(s) to paste into
`#card-changes`. Our Discord bot sees him post them, catches FriendlyBot's new picture of the
card, and hands it to the game server. From there the card takes one of two roads, and the
server picks the road, not Caleb:

- **Numbers or art only → the fast path.** The steward's runner on the home box applies it
  without a model, as one deterministic job: the oracle row, the scan, the scan readers,
  `npm run extract`, the corpus, an update line, and the full gate. On green it lands and deploys
  like any other steward ship. On red it drops to the steward path, with the red log attached.
- **Anything else → the steward path.** The card goes into the steward's inbox, with the before
  and after record and FriendlyBot's new scan, and the steward re-implements it by the card-update
  recipe (skill §14).

Caleb sees one status per edit on the editor page: **submitted → waiting for FriendlyBot →
applying → live**, or **queued for the steward**. "Live" is read off the running build, not
reported by anyone.

Nothing in this design deploys by hand, and nothing is committed from the VPS.

```
 Caleb (browser)          game server (VPS)            our bot (VPS)          FriendlyBot      runner (home box)
 ───────────────          ─────────────────            ─────────────          ───────────      ─────────────────
 edit, Submit ──────────▶ diff, classify, commands
 ◀── commands to copy ─── var/card-edits/<id>.json
 pastes into #card-changes ─────────────────────────────────────────────────▶ re-renders
                                                       sees the command ◀──── 4 messages
                          ◀── /api/bot/cardedit/* ──── before + after JPEG
                          status: applying | steward
                                                                                              fetch key: request + scan
                                                                                              fast: apply → gate → land → deploy
                                                                                              steward: state/inbox/card-<id>.md
                          ◀──────────────────────────────────────── ssh: status row ────────
 sees "live" ◀─────────── the running build carries the edit's commit
```

## 1. Who may use it

**A new account flag, `designer`, next to `admin`, with the same machinery.**

What exists today (`server/admin.ts`, `server/accounts.ts`):

- `Account.admin` is the permission, deliberately separate from the badge
  (`badge.owner`, `badge.judge`), which is a trust mark shown beside a name. One question,
  `adminFor(req)`, answers it, and every admin route asks it.
- Every refused route answers **404, never 403, before reading the body**, so a stranger cannot
  even tell the page exists.
- It is granted two ways only: the tester-token bootstrap (`deploy/admin.sh`) and an admin, from
  the dashboard's Accounts tab. The flag shows on the account's own view (`admin: true`), and that
  is what draws the profile's "Admin" button.

The editor copies that exactly:

- `Account.designer?: true`, granted and revoked by an admin from the dashboard's Accounts tab
  (one more toggle beside admin), and by `deploy/admin.sh designer <name>` for the bootstrap.
- `designerFor(req)` in a new `server/cardedit.ts` returns the account when it holds `designer`
  **or** `admin`, so the owner can test without granting himself anything. It is the one place
  the question is asked.
- Every `/api/cardedit/*` route asks it first and answers 404 otherwise.
- A designer gets no other admin power, and an admin needs no designer flag.

Not the badge. A badge is what other players see; a permission is not. (A "designer" badge
beside Caleb's name is a nice idea, but it is a separate decision: see the open questions.)

Adding a field to `Account` trips ui test 267 (the privacy page lists every stored field). The
privacy page gains one line: "whether the account may edit cards".

## 2. The page

`client/ui/pages/cardeditor.ts` (`cardEditorView` → pure `cardEditorHtml` → `paintCardEditor`),
with its state, fetches and clicks in `client/ui/cardeditor.ts`, by the page contract in
`pages/README.md`. It is drawn in the app frame with `fill: true` and no page scroll, built from
the `ui-` components only, and gets an Html test and a Storybook story (tests 962, 992, 993, 995).
It also gets a line in `FRAME_PAGES` for ui-shots.

**How you get there**, since every page needs a button:

- the profile's staff row: **Card editor**, beside Admin (`nav-cardeditor`), for an account
  holding `designer` or `admin`;
- the card browser's detail panel: **Edit** (`cards-edit`), beside Find similar · Rulings · Copy
  link, for the same accounts. It opens the editor on that card.

**Two tabs** in the toolbar's centre: **Edit** and **My edits**.

```
┌ ◀ Cards        Card editor          [ Edit | My edits ]                         Rules  Alerts  Report ┐
│ ┌──────────────┐  Murkstalker                                    (search another card…)              │
│ │              │  Cost        [ 3 ]  affinity [ wk ]   ●◐  ← pips drawn as they print               │
│ │   the scan   │  Power       [ 2 ]  Toughness [ 2 ]                                                  │
│ │  as it is    │  Type        [ Unit — Cosmic Horror              ]                                    │
│ │    now       │  Text        ┌───────────────────────────────────────────┐                         │
│ │              │              │When you trash another card, [Switch1] Each│                         │
│ │              │              │opponent loses 3 life and you gain 3 life. │                         │
│ └──────────────┘              └───────────────────────────────────────────┘                         │
│                  Preview      When you trash another card, ⟳ Each opponent loses 3 life …           │
│                  Art          [ images_out/Stable/murk3.png  ]                                        │
│                  Complexity   ( Simple | Complex )                                                   │
│                  ─────────────────────────────────────────────────────────────────────              │
│                  Numbers only: live after the tests pass.               [ Make the commands ]        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The fields are **his** fields, in **his** notation: `cost` is the affinity letters with `w`/`k`
  for light and dark, `total cost` is the number, the text keeps his markup (`[Switch1]`, `{i}`,
  `{/n}`), and `art` is the path on his machine. Power and toughness appear only on units.
- **The type line reads `Unit — Cosmic Horror`.** "Creature" is not a word in Algomancy and never
  appears on screen. (FriendlyBot itself still stores `Creature — Cosmic Horror`, so the command
  says that; see §5.)
- **The form opens on the card's current wording at once**, from the running build's oracle row.
  He never needs `$get` to see the exact text before editing: it is already in the box. If our
  copy has drifted from FriendlyBot's, the drift check (§6) catches it, so an edit can't silently
  land on top of a stale card.
- **Preview** draws the text through `ui/cardtext.ts`, the renderer the game uses, so he sees the
  icons as players will. It is our renderer, not his. The real picture is FriendlyBot's.
- **The road line** under the form runs the same classifier the server runs (§5), live, so he
  sees which road the edit will take before he presses anything. He never chooses it.
- **Make the commands** submits. The form gives way to the commands, one block per command with
  a **Copy** button each (and **Copy all**, one command per line, for him to post one at a time),
  over the status track:

```
  Post these in #card-changes, one message each:
  ┌────────────────────────────────────────────────┐
  │ $modify murkstalker|total cost|2               │ [Copy]
  └────────────────────────────────────────────────┘
  ● Submitted  ─  ○ Waiting for FriendlyBot  ─  ○ Applying  ─  ○ Live
                                        [ Cancel this edit ]
```

**My edits** is one `.framelist`: card · what changed ("cost 3 → 2", "text") · status chip · when.
A row opens its detail: FriendlyBot's before and after pictures side by side, the commands as
posted, and, for the steward road, why (one sentence: "the text changed", "the gate went red: a
test pins its cost"). The owner, as an admin, sees everyone's edits there, with the author's name.

The words follow the copy rules (few words on screen, no tooltip restating a label). No test
numbers, file names or ids reach Caleb.

## 3. The request

One file per edit, `var/card-edits/<id>.json`, written by the game server and nobody else, plus
its pictures in `var/card-edits/<id>/`. Its location is added to `server/statepaths.ts`
(`cardEditsDir()`, `ALGO_CARD_EDITS_DIR` for tests), like every other runtime path. `var/` is
gitignored and backed up nightly, so none of it is ever committed.

```jsonc
{
  "v": 1,
  "id": "ce-20261127-murkstalker-7f3a",          // date + card slug + 4 random hex: readable and unique
  "card": "Murkstalker",                          // our oracle key
  "by": { "account": "<id>", "name": "Caleb", "discord": "<user id>" },
  "createdAt": "2026-11-27T18:02:11Z",
  "base": { "rowHash": "<sha1 of the oracle row the form loaded>", "row": { /* that row, whole */ } },
  "edit":  { "total cost": "2" },                 // his fields, as he left them: only the changed ones
  "after": { "total_cost": "2" },                 // the same change in OUR row's notation
  "diff":  [{ "field": "total_cost", "from": "3", "to": "2" }],
  "road":  "fast",                                // or "steward"
  "why":   [],                                    // the classifier's reasons, for "steward"
  "commands": [
    { "text": "$modify murkstalker|total cost|2", "field": "total cost",
      "posted": null, "reply": null }             // filled in by the bot (§4)
  ],
  "events": [{ "at": "…", "what": "submitted" }] // the server's own record, append-only
}
```

A second file, `var/card-edits/<id>.runner.jsonl`, is written **only by the runner** over its ssh
(§6): one row per step (`picked`, `gate-red`, `landed`, `deployed`, `to-steward`). The two writers
never share a file, so neither has to lock against the other. The status is a pure function of
both files and the running build (§7).

Rules the server enforces at submit:

- **One open edit per card.** A second edit to a card whose last edit is not live or in the
  steward's hands is refused: "Murkstalker has an edit in progress". He can cancel an edit until
  the first command is seen posted.
- **The base must be current.** If `base.rowHash` is not the running build's row (someone landed a
  change since he opened the form), the submit is refused and the form reloads.
- **A value cannot contain `|`**: nothing in FriendlyBot escapes it. No command may pass Discord's
  2,000-character limit (his longest was 667).
- **Something must change.**

## 4. The Discord side

### What our bot watches

A new cog, `bot/cogs/cardedits.py`. Its own `@commands.Cog.listener()` `on_message`, because the
bot's main `on_message` returns at once for any bot author, and FriendlyBot is a bot.
The message-content intent is already on (`bot.py _intents`), and its docstring gains one line
saying the intent now has two jobs.

Configuration, in `.env` / `.env.example`, unset means the feature is absent:

| | |
|---|---|
| `ALGO_CARDEDIT_CHANNELS` | the channel id(s) to watch: `#card-changes` in Caleb's server, and a test channel in the owner's |
| `ALGO_FRIENDLYBOT_ID` | FriendlyBot's user id. In the owner's server, for testing, the stand-in's id (§10) |

Our bot needs to be **in Caleb's server with View Channel and Read Message History** on
`#card-changes`. It never posts there.

### Matching a command

The bot polls `GET /api/bot/cardedit/pending` (every 5 s while any edit is pending, every 60 s
otherwise). For each command still waiting, it gets the command text, the card, and the Discord
id of the account that submitted it. Then, for every message in a watched channel:

1. **A command.** The author is the submitter's linked Discord id (`Account.linked.discord`, which
   `/link` already sets; an unlinked designer is told to link first). The message parses as
   `$modify <name>|<field>|<value>`, and its field matches a pending command's (case and
   space/underscore folded, as FriendlyBot folds them). The name must match the pending command's,
   or loosely match the card. The bot reports it with `POST /api/bot/cardedit/seen` {edit id,
   message id, content **as posted**, at}.
   *If he changed the value before posting* (he will: The Everywhere went through four versions
   in six minutes), the posted value is what FriendlyBot applied. So the server re-derives
   `after`, re-runs the classifier, and the road can change.
2. **FriendlyBot's answer.** After a matched command, the bot collects FriendlyBot's next
   messages in that channel: `Modified <name as typed>'s <field as typed> from this` (exact, as it
   has been 10,308 times out of 10,308), an image, `To this`, an image. It downloads **both images
   at once** from `cdn.discordapp.com`, because links expire within a day and `media.` is a
   re-encode. Then it posts them, base64 in JSON, to `POST /api/bot/cardedit/reply`.
   The attachment name (`…_libraryMurkstalker.jpg`) gives the card FriendlyBot actually changed,
   and **the server refuses the reply if that is not the edit's card**: the loose name match can
   land on a different card, and this is the one place that would show it.
3. **No answer.** No `Modified` within 60 s, or no `To this` within 120 s, is reported as such.
   The editor says "FriendlyBot hasn't answered: is it running? Post the command again." This is
   not a failure state: FriendlyBot runs on Caleb's PC and goes down with it, and a re-post simply
   matches again. `Something went wrong` is reported as an error, word for word.

The edit's new picture is the **last** "To this" of its **last** command: each render carries
every change so far. Its "before" is the **first** command's "from this", FriendlyBot's card
before the edit.

**Missed messages.** When the bot starts, or a watched channel's last-seen message id falls behind,
it reads the channel's history since the oldest pending edit's `createdAt` and matches it the
same way. A restart in the middle of an edit loses nothing.

**Ordering.** FriendlyBot answers one command at a time, in order. A re-posted identical command
before the reply came back produces two answers, and the bot takes the last complete one. Two
designers editing at once is not a case: there is one.

### The game-server routes the bot uses

All under `/api/bot/`, so they inherit `botAllowed()`: `ALGO_BOT_TOKEN` in a header, from loopback,
404 otherwise (`server/api-bot.ts`'s rules, unchanged).

| route | |
|---|---|
| `GET /api/bot/cardedit/pending` | `[{ id, card, discord, since, commands: [{ i, text, field }] }]` for edits still waiting |
| `POST /api/bot/cardedit/seen` | `{ id, i, messageId, channelId, content, at }` |
| `POST /api/bot/cardedit/reply` | `{ id, i, echo, fileCard, before: <b64 jpeg>, after: <b64 jpeg>, at }` or `{ id, i, error }` |

## 5. The classifier

One pure module, `client/ui/cardnotation.ts`. The server imports it, as it already imports
`ui/customrules.ts` and `ui/deckformat.ts`, so the road line on the page and the server's
decision are the same code. It holds three things:

**His notation ↔ ours**, both directions, one table each, so no rule is spelled twice:

| | on screen | in the command (FriendlyBot) | in our oracle |
|---|---|---|---|
| affinity letters | `w` `k` and `e m r g b p` | the same | `l` `d` and `e m r g b p` |
| `[w]`, `[k]`, `[1wk]` pips in text | his letters | the same | the same letter swap, inside cost brackets only |
| unit type line | `Unit — Cosmic Horror` | `Creature — Cosmic Horror` | `Cosmic Horror Unit` (as printed) |
| spell type line | `{Battle} Nature Spell` | the same | the same |

The command keeps `Creature —` because that is what FriendlyBot stores and turns into the printed
line: Caleb typed `Creature — Bedlam Alien` himself as late as December 2025, and the scan prints
"Bedlam Alien Unit". Whether FriendlyBot also accepts `Unit — Bedlam Alien` and prints it the same
way is unknown. It is one command to try on the real bot; if it does, the translation goes and
"Creature" disappears everywhere. Only a type change ever puts a type in a command, and that takes
the steward road anyway.
| field names | `total cost` ↔ `total_cost`, `num copies` ↔ `Num_Copies` … |

It ships with a property test: for every row in the oracle, `ours(his(row)) === row` on the
fields the editor shows. A row it cannot round-trip is listed by the test, and the editor opens
that card read-only ("this card's notation isn't understood yet").

**The diff**, on **our** notation after conversion, so notation alone never counts as a change.

**The road**, decided field by field, as the owner set it:

| what changed | road |
|---|---|
| `power`, `toughness`, `total_cost`, `cost` (affinity) and nothing else | **fast** |
| `image` (the art path) and nothing else, or with numbers | **fast** |
| `text`, `type`, `name`, `complexity` | **steward**, with the reason |

Three checks can still send a fast-path edit to the steward. The classifier doesn't make them:
they are measurements the apply job takes from FriendlyBot's pictures (§6):

- **drift**: FriendlyBot's "before" picture is not our current scan, so his card and ours had
  already parted, and a numbers-only command would land a card whose text we don't have;
- **a stray change**: the "after" picture differs from the "before" outside the regions the
  changed fields print in;
- **a banner card**: the card has a hand-added Prophecy or Ambush banner, which the render drops
  (`card-faces.json` knows which cards; eleven today).

An affinity change also moves the card's colours. The oracle keeps them beside the cost, in
`factions` and in `Deck` ("Light & Dark (Light/Dark)"). The card audit (ui test 211,
`faction-pip-disagreement`) fails when they disagree with the pips, and draft pools read `factions`.
So the fast path rewrites both from the new pips. A `Deck` it cannot derive (the base set's
"Hybrid") sends the edit to the steward.

## 6. The fast path: the apply job

**Where it runs.** On the home box, as a new deterministic step of the steward runner
(`steward/run-once.sh`), beside "land approved branches". It is not a Claude run: the runner
owns every side effect, and this job is a script. Every ship goes through the runner, so it lands
on master by the same road (decision 6).

**How it gets the edit.** The read-only fetch key, which today can read games, challenge runs and
the report journals (`deploy/steward-fetch.sh`, mirrored in `steward/vps-fetch.sh`). Its allow-list
gains `var/card-edits/index.json` (a list of open edit ids the server rewrites on every change),
`var/card-edits/<id>.json` and `var/card-edits/<id>/(before|after).jpg`. `deploy/` and `steward/`
are protected paths, so this change is staged for the owner's **approve protected**, and the
VPS's root-owned copy of the fetch script is reinstalled by hand once, as the README says.

**How it reports.** The runner's own ssh to the VPS (`vps` in `run-once.sh`, the one it deploys
with) runs `node client/server/scripts/cardedit-runner-row.mjs <id> <step> [why]`. That script
appends one row to `<id>.runner.jsonl`. The agent never has that ssh, and the fetch key cannot
write.

**The job**, one edit per tick, oldest first, on a fresh branch `steward/card-<id>`:

1. **Picture checks** (`bot/pipeline/apply_card_edit.py`, Python like the other scan readers):
   - the name in FriendlyBot's attachment is the edit's card (the server checked once; this is
     the second line);
   - **drift**: after scaling both to 720 × 1000, the "before" render and our scan differ by more
     than 24 grey levels on at most 0.5% of pixels, the banner strip excluded. The thresholds come
     from `friendlybot.md`: 317 of 513 recent renders were under 0.2% against the scan, and a real
     text difference moves several percent;
   - **regions**: "after" differs from "before" only inside the regions of the changed fields:
     the cost orb (`cost`, `total_cost`), the stat box (`power`, `toughness`), the art window
     (`image`). The type bar and the text box start at the card's `textTop` from
     `data/cards/text-boxes.json`, so the line is the card's own, not a guess;
   - not a banner card.
   Any failure → the steward path, with the measurement in the reason.
2. **The oracle row, in place.** Only the changed fields of `data/cards/AlgomancyCards-OracleText.json`
   (and `factions`/`Deck` on an affinity change), with `revision_date_time` set to the edit's date.
   It is canonical, there is no patch layer, and the commit message carries the reason. An art
   change also writes his new path into `image`, for the record; no code reads that field (scans
   are found by name, `extract-printed.mjs`).
3. **The scan.** FriendlyBot's "after" picture replaces `data/cards/<Card-Name>.jpg`, converted to
   RGB and **resized to 720 × 1000** at quality 92, as skill §14 step 1 does. Renders come 719 or
   735 wide, and a scan of any other size is skipped **silently** by `read_card_faces.py` while
   test 1159 still passes, so the job asserts the size itself. Every fast-path edit changes the
   scan, because the numbers are printed on it, so **all four** scan readers run, in §14's order:
   `build_anchors.py`, `classify_complexity.py`, `read_text_boxes.py`, `read_card_faces.py`, then
   `read_card_faces.py --report`. (`build_anchors.py` is the fourth reader: it feeds the catalogue's
   `modPeek` and the bot's mod stacks, and test 1159 fails naming any reader that has not read
   today's scan.) After that:
   - `card-faces.json` must report **no contradiction** for this card. That checks the **pips**
     on the new orb against the cost we wrote, and the timing glyph and banner against the type
     and text;
   - `complexity-overrides.json` and the card's `textTop` must not change. If they do, that is a
     stray change.
   **The cost numeral and power/toughness are not read off any scan.** No reader does it today.
   For those, the evidence is FriendlyBot's echo of the command plus the region check in step 1.
   A numeral and P/T reader is possible (`read_card_faces.py` already calibrates numeral templates
   against `total_cost`); see the open questions.
4. `npm --prefix client/engine run extract` (printed.json, catalogue.json). It runs **after** the
   readers, or `textTop` and `modPeek` stay old. It fails only on a stale complexity entry or a
   pool name missing from the oracle, and it does not validate numbers: a non-numeric value
   silently becomes 0. So the server validates at submit: `power`/`toughness`/`total cost` are
   digits or `X`, and pips are his letters.
5. **The card's face comment.** About 257 `card()` definitions quote their own face above them
   (`— e/4 5/6 …`, `batch-earth-a.ts`). The mechanics never read it, because `card()` spreads
   printed.json into every definition (`dsl.ts`) and no behaviour carries a stat. But it is a
   comment that would now lie. The format is fixed, so the job rewrites the numbers in it. A
   comment it cannot parse is left alone, and the new lock test below catches it.
6. `bot/pipeline/build_corpus.py`, because the corpus's hash is part of the bot's engine version
   and its card chunks quote the numbers. It needs the gitignored rulings export on the box
   (already synced there for the steward). `policy.mjs` refuses a rebuild that loses rows.
7. **The update line**, generated at the top of `UPDATES` in `client/ui/updates.ts`:
   `{ date, kind: 'change', text: 'Murkstalker now costs 2 (was 3).' }`, or "is now 3/2", or
   "has new art". The text comes from a template, so test 323's rules (no ids, ≤ 240 characters,
   date order) hold by construction.
8. **Commit**, with the reason and a trailer: `Card-Edit: ce-20261127-murkstalker-7f3a`. The
   trailer is how "live" is known (§7).
9. **The full gate** and **policy.mjs**, exactly as for any steward ship. Green → land on master
   and deploy. `policy.mjs` already restarts the game server for any `data/` change and the web
   app and bot for `data/cards`, and the deploy rebuilds the UI bundle. All of that is needed:
   catalogue.json and printed.json are compiled into `bundle.js`, the game server loads the card
   index once at start, and the bot and web app read the oracle once at start. The deploy waits
   for a quiet server, as every deploy does: no restart during a live game.
   **Red** → the branch is archived, not staged. The edit goes to the steward path with the red
   log, and the status says "queued for the steward: a test pins this card's cost" (the first red
   suite's name, in words).

### 6a. What the job reaches, and what it would miss

Audited 2026-11-27 across the engine, UI, server, bot, rules, challenges and tests.

**Reached by the steps above.** Every rule the engine plays, since printed.json is the only source
of a card's stats and cost (the four cards with hand-written stats, Unit Token, Beyond, Training
Construct and Alluring Attribute, have no oracle row and cannot be edited here). Also reached:

- the card browser, inspector, deck builder, deck stats, card pages, home art, lessons that read
  live stats, the Single Card Duel picker: all through `catalogue.json` → `ui/cardindex.ts`;
- the server's `/api/cardsearch`, link previews and deck pictures, which read the same index;
- the bot's `/api/card`, `/api/search`, embeds and P/T search (the oracle, read at start);
- the corpus and the judge's card chunks;
- the art version hash (`art-versions.ts` re-hashes on size or mtime, so browsers fetch the new
  scan);
- the mod anchors and bot stacks, through `build_anchors.py`.

**Missed by those steps. The gate catches some, and the rest need a change before this is built:**

| what | today | in this design |
|---|---|---|
| **Comprehensive-rules examples** quoting stats (~300 hits: Dune Drifter 2/1, Good Whale 7/5, "Rampart Guardian costs 2", Tides of the Cosmos "total cost 8"…) | `cr:check` verifies `card:` quotes against the text and type line only, never stats | **a new check in `cr:check`**: a stat or cost quoted beside a card's name must match printed.json. The gate then goes red on a stale example, and the steward fixes the record, re-verifies and re-renders it. Derived, never a list |
| **Face comments** above `card()` (~257) | nothing checks them | the job rewrites them (step 5), plus **a new lock test** that every parseable face comment agrees with printed.json |
| **Tests pinning a card's numbers** (~1,000 name-plus-stats hits in 179 test files; Good Whale alone 130) | they go red | correct as is: red → steward path. A card that tests lean on will usually take the steward road, by design |
| **The Weekly Challenge goldens** (506 reference runs, 800 drift guard, whose fuzz sample walks random decks from the whole pool) | a cost change to **any** deck-legal card can move a fuzz walk with no challenge naming the card. 800 says never re-bless to pass, and was re-blessed for eleven entries on 2026-11-10 for the designer's printings, after measurement | red → steward path. A cost change will often go red here. See the open questions: whether a fuzz-only re-bless, measured the way 800's header describes, may be part of the steward's card recipe |
| **Prose that names a card's numbers**: `ui/lessons.ts` (Malformed Monstrosity 10/9, 3/2), scenario prose in `server/scenarios-*.ts`, `data/rulings/generated_rulings.jsonl` (built into the corpus unchanged), `bot/eval/gold.jsonl`, `light-and-dark-transcription-notes.json` | nothing reads them against the oracle | the job greps the card's name across them. A hit does not stop the fast path, because the engine is right. It writes a **follow-up** inbox item, "prose names Murkstalker: check it", listing the hits. The generated rulings are the one that matters to players (the judge bot cites them) |
| **Cached pictures**: `var/og-cache/deck-<key>.jpg` (keyed by scan **filenames**, kept forever), the committed `client/ui/og-image.jpg` and `og/*.jpg` (built by `ui/site-icons.py` from a fixed list of cards), the bot's `/stack` composites (one-day cache) | an art change serves the old picture | the deck-picture key gains the scans' art hashes (a small server change in this round). A card on `site-icons.py`'s list goes to the steward on an art change. `/stack` ages out in a day, which is acceptable |
| `/api/cardinfo`'s in-memory cache on the game server | cleared only on restart | the deploy restarts it |

Found along the way, not part of this design: `server/main.ts:430` reads the pip letters as the
deck picture's cost (`Number(r.cost) || 0`, always 0), so the cost tiebreak in
`linkpreview.ts` never fires. It should read `mana`. It is worth a ticket.

## 7. The status, and where each word comes from

| status | true when | written by |
|---|---|---|
| **submitted** | the edit exists and no command has been seen posted | the server, at submit |
| **waiting for FriendlyBot** | a command was seen, and the last command's new picture has not been caught | the bot, through `/seen` and `/reply` |
| **applying** | every picture is caught, the road is fast, and the runner has not handed it to the steward | the server; the runner's `picked` row turns "waiting for the home box" into "testing" |
| **queued for the steward** | the road is steward, from the classifier, a picture check or a red gate | the server, or the runner's `to-steward` row |
| **live** | the running build carries a commit with this edit's `Card-Edit:` trailer | **derived**, never written |

"Live" is computed once per process: the server reads the trailers of its own history at boot
(`git log --format=%(trailers:key=Card-Edit,valueonly)`, as `engine-version.ts` already reads
`HEAD`). It cannot change under a running process, so it is cached for the process's life. This
is the admin dashboard's rule again: the status shown is the status **of the build players are
playing**. A steward-path edit goes live the same way, because the skill's card-update recipe
gains one step: put the edit's `Card-Edit:` trailer on the landing commit.

The page polls `GET /api/cardedit/edits/<id>` every 5 s while an edit is open on screen, and
stops when it is not.

## 8. The steward path: the inbox item

The steward's queue already has the right slot: **inbox** items (`state/inbox/<slug>.md`, offered
right after triage, worked through the skill, answered in a `#steward` thread). The runner, not a
model, writes `state/inbox/card-<id>.md` when an edit takes this road:

```markdown
# Card edit from Caleb: Murkstalker (ce-20261127-murkstalker-7f3a)

Caleb changed Murkstalker with FriendlyBot on 2026-11-27. Re-implement it by the card-update
recipe (skill §14). The scan is the authority. Put `Card-Edit: ce-20261127-murkstalker-7f3a`
on the landing commit.

Why this is not the fast path: the text changed.

| field | before | after |
|---|---|---|
| text | When you trash another card, [Switch1] Each opponent loses 3 life … | … loses 1 life … |

Commands as posted:
    $modify murkstalker|text|When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.

Files: card-ce-…/before.jpg (FriendlyBot, before) · card-ce-…/after.jpg (FriendlyBot, after:
the new scan) · card-ce-…/request.json (the whole edit) · card-ce-…/gate.log (only if the
gate went red)
```

The files sit beside it, as an inbox item's screenshots already do. The queue needs no change:
it offers every `.md` in `state/inbox/`. `discord.mjs` opens the `#steward` thread for it, as it
does for the owner's own asks, so the owner sees every steward-path edit and can answer in that
thread. Caleb's page shows "queued for the steward" and the one-sentence reason, then "live"
when the trailer arrives.

The steward rewrites the card from scratch when it has to. The recipe already treats the scan as
the authority, and Caleb has rewritten cards completely before.

## 9. Replays and challenges recorded before a change

**What happens today.** A saved game is stamped with the commit it was played on
(`room.versions[].sha`, from `engineVersion()`). The replay viewer replays it with **today's**
engine in the browser, then compares the recorded per-action fingerprints (`api-replay.ts`): the
verdict is `as-recorded` or `reconstruction` from the first fingerprint that differs.

**The gap.** The fingerprint (`replay-probe.ts signature`) holds card names, damage, counters,
temporary buffs, life, hands and bins. It does **not** hold a card's printed power, toughness or
cost. So:

- a **text or ability** change almost always changes what happens, and the replay honestly says
  `reconstruction` from where it parts;
- a **numbers** change that never altered an outcome (a 3/3 that became 3/2 and was never hit)
  replays `as-recorded` **while the board draws the new numbers**. That is the silent case;
- a **rename** parts at action 0, and `replay-probe.ts` already keeps a rename map for it;
- a **room saved mid-game** and restored after the deploy reads base stats live
  (`engine.ts baseStatsOf`), so its units take the new numbers mid-game. The deploy's "quiet
  server" rule keeps this rare. The room's `versions` already records the change of engine.

Weekly Challenges have the same gap in Watch. The board's "older rules" mark
(`challenge-resim.ts`) already flags a run whose score or goal no longer reproduces. A cosmetic
difference is not marked, by design.

**The fix: name the changed cards, derived from git, never from a list.** A new
`server/card-history.ts`: given a recorded sha, `git show <sha>:data/cards/AlgomancyCards-OracleText.json`,
diffed against the running build's rows. That gives `[{ card, fields }]` for every card whose
row changed since. It is cached per sha for the process's life (the running build cannot
change). An `unknown` stamp gives "can't tell", never a guess. Then:

- `/api/replay/<code>` adds `cardsChanged`: the changed cards that appear in that game (decks,
  pools, tokens). The viewer shows a band above the board: "Played before Murkstalker changed
  (cost). This replay uses today's card." The verdict stays what the fingerprints say: they are
  honest about the board, the band is honest about the numbers.
- Watch adds the same band for a challenge run, from the run's `engine` stamp.
- `replay-room.ts --as-recorded` already gives the true answer on demand, and stays the CLI it is.

The edit history is the git history itself, so it covers every road a card change can take:
this editor, a steward card update, a hand edit. Nothing has to remember to write to a log.

## 10. Test plan

**Fixtures from the record.** `bot/test/fixtures/friendlybot/`: real message sequences from the
export, Caleb's and FriendlyBot's messages only, as JSON. A clean edit (Murkstalker 2026-10-23), a
re-post of the same command (The Everywhere ×4), a misspelled card name (`seer or empty spaces`),
a reply missing its "To this", `Something went wrong`, and a malformed command that got no reply
(`$modify|the everywhere|…`). Images stay out of the repo: the fixtures name stand-in JPEGs the
test makes.

| where | what |
|---|---|
| `client/ui/test/` | `cardnotation`: the round-trip over **every** oracle row; the classifier table, one case per row of §5; the command generator (no `\|`, length, field spelling). `cardEditorHtml`: made-up views, `data-btn`s asserted, no colour literal, components only. The road line and the server agree (same function). |
| `client/server/test/` | the routes: 404 for a stranger, a player, a logged-out caller and an expired token, before the body is read; a designer and an admin get in. Submit: stale base refused, a second open edit on one card refused, `\|` refused. Status: each status from a hand-built request + runner rows, "live" from a stand-in trailer list. `/api/bot/cardedit/*`: token and loopback, a reply for the wrong card refused, a posted value differing from the generated one re-classifies. Replay `cardsChanged`: a game stamped at a commit before an oracle change names the card; an `unknown` stamp says "can't tell". |
| `bot/test/test_cardedits.py` (reached by `run_all.py`, so the gate runs it) | the cog against the fixtures with a fake channel: it matches, collects the four messages, downloads both images, posts the right body. It ignores another author, an unwatched channel and an edit nobody submitted. It catches up from history after a "restart". It times out a silent FriendlyBot. |
| `bot/test/test_apply_card_edit.py` | the picture checks on synthetic cards: a numbers-only change passes; drift, a change in the text box, a banner card and a wrong card name each fail with their reason. A 719-wide render comes out 720 × 1000. The oracle edit touches only the changed fields (plus `factions`/`Deck` on an affinity change). The face-comment rewrite on real set files. The update-line template passes test 323's rules. |
| new lock tests | `cr:check`: a stat or cost quoted beside a card name agrees with printed.json, proved red by changing one card's toughness in a scratch copy. Face comments: every parseable `— <pips>/<n> <p>/<t>` comment agrees with printed.json, proved red the same way. Both must be green on today's tree first; whatever they find on day one is fixed before the editor ships. |
| `steward/test-discord.mjs` + `test-runner.sh` | the runner step against a fake VPS directory. Fast green → lands with the trailer, a `landed` row. Fast red → `to-steward`, an inbox file with the gate log. Steward road → inbox file, no branch. The fetch key's new paths are allowed, and `accounts.json` is still refused. |
| end to end, in the owner's test Discord server | everything is built and proved there; Caleb's server comes later. **One test bot token** (the owner's throwaway bot, already in that server) runs our bot locally with a **simulated FriendlyBot**: a dev-only cog, `bot/cogs/fakefriendlybot.py`, loaded only when `ALGO_FAKE_FRIENDLYBOT=1`, that answers `$modify` in a test channel in FriendlyBot's exact four-message shape (the exact first line, the old picture, "To this", the new picture, ~5 s apart). Its "after" picture is the current scan with the changed number painted over the right region. The watcher is pointed at the test bot's own user id (`ALGO_FRIENDLYBOT_ID`), so it treats those messages as FriendlyBot's, and one token is enough. The simulator can also misbehave on request (no answer, a missing "To this", `Something went wrong`, the wrong card), so every failure path is walked live. The owner, signed in as a designer on a local game server, posts the commands. A numbers edit is walked to "applying" against a scratch runner state, and a text edit to "queued for the steward". The test token and server ids live in a gitignored `test-discord.env` at the repo root (`*.env` is ignored), loaded ahead of `.env`. Before Caleb uses it, one try against the real FriendlyBot, with his agreement. |

**Proved by breaking, not by passing.** Each check gets one deliberate break that must turn it
red: a reply for the wrong card, a "before" picture from another card, a text-box change smuggled
into a numbers edit, a gate test that pins a card's cost, an admin-only route opened to a player.

## 11. What gets built, in order

0. The two lock tests from §6a (CR stat quotes, face comments) and whatever they find on today's
   tree, plus the deck-picture cache key. These are worth having even if the editor were dropped.
1. `ui/cardnotation.ts` + its tests (the round-trip says how much of the pool the editor can open).
2. The `designer` flag, `designerFor`, the dashboard toggle, the privacy line.
3. `server/cardedit.ts`, its routes, `var/card-edits/`, the status function.
4. The page and its entry buttons.
5. The bot cog, its routes, the fixtures; the simulated FriendlyBot for the test server.
6. `server/card-history.ts` and the replay/Watch band.
7. The runner step, `apply_card_edit.py`, the fetch-key paths, the inbox writer, and the skill's
   one extra step (all protected: staged for the owner's approval).

The update line for the round says what a player will notice: "Caleb can now change his cards
directly from the client; you'll see the new versions as soon as they pass testing." Nothing else
in this list is visible to players.

## 12. Open questions

**For the owner.** Settled 2026-11-27: the bot joins Caleb's server later; until then everything is built and tested on the owner's test server. The editor shows the current wording at once, with no `$get`. A unit's type line reads `Unit — X`. Old replays get the note, never a refusal (§9). When a numbers edit turns a test red, the steward finds out why and fixes the code or the test, including re-recording the drift guard's practice games when the edit is the measured reason they moved; the challenge reference solutions are never re-recorded to make a test pass. The test server is `778331995297808438`.

1. **Banner cards** (eleven, Prophecy/Ambush). Their render loses the hand-made banner. This
   design sends every edit to them down the steward path. Should the fast path composite the
   old banner onto the new render instead (the steward already does it by hand)?
2. **Renames.** Out of the editor for now: a rename touches decks, replays, the rename map and
   registration order. Should the editor offer it, as a steward-path edit?
3. **New cards** (`$create`). Out of scope here. Same question.
4. **A "designer" badge** beside Caleb's name in games and on his profile, separate from the
   permission. Yes or no?
5. **Who sees steward-path threads.** They go to your private `#steward` forum like every inbox
   item. Should Caleb hear anything there, or only on his page?
6. **A numeral and power/toughness reader** for the scans, so the number on FriendlyBot's
    picture is checked against the number in the row, as the pips already are. It is worth
    building if you want a second witness beyond FriendlyBot's echo; otherwise it is not needed.

**Left open by the research** (`friendlybot.md`, "What the record leaves uncertain")

7. Whether FriendlyBot obeys an edit from anyone but Caleb, and whether it answers bots. Nobody
    ever tried either. The copy-and-paste default doesn't depend on the answer.
8. What `$replace` matches. The editor never generates it; it uses `$modify` on the whole field.
9. Why about 3% of edits stop after the old picture, and whether FriendlyBot's database changed
    when they do. The editor treats them as "no answer: post again". A re-post is harmless, since
    `$modify` sets a value rather than adding to one.
10. Whether an art path must already exist on his PC. The editor can't check it. The "after"
    picture shows the result, and a wrong path will show as unchanged art.
11. Whether FriendlyBot accepts `Unit — X` in the type field and prints it as `X Unit`. If it does,
    the commands stop saying "Creature" too.
