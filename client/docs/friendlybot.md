# FriendlyBot: what Caleb's card bot accepts and what it posts back

FriendlyBot is Caleb Gannon's own Discord bot. It keeps his card database and renders card
images from it. Every card scan we use was rendered by it: `data/cards/Murkstalker.jpg` and the
image FriendlyBot posted for Murkstalker on 2026-10-23 are the same picture. This document is
what the Discord history says about it, written as the input to the card editor
(`card-editor.md`). It is research, not a spec. Where the record does not settle a point, it
says so.

Only FriendlyBot's and Caleb's own messages are quoted.

## Sources

| export | where | span | FriendlyBot | Caleb |
|---|---|---|---|---|
| `#card-changes` (channel + 6 threads), exported 2026-11-10 without media | `var/records/card-changes/text-only/`; flattened to `var/records/card-changes/analysis/events.jsonl` | 2022-09-07 → 2026-10-23 | 23,846 messages in the channel | 6,735 |
| the rulings exports (`#rules-questions` + RAQ threads) | `data/rulings/exports/` (`bot/paths.py` `RULINGS_EXPORTS`) | to 2026-10-10 | 1,572 | — |

Both are untracked (`var/` and the exports are gitignored) and stay that way. `#card-changes`
is where Caleb edits his cards: since 2024 almost every edit's command is typed in that channel.
Before then, 767 of FriendlyBot's "Modified …" posts there have no command beside them (656 in
2022), which suggests it once logged edits typed elsewhere. In the rulings channels it only
answers look-ups.

## The commands

Prefix `$`, one command per message (Caleb has never put two in one message), arguments
separated by `|`. Counts are Caleb's uses in `#card-changes`.

| command | uses | what it does | FriendlyBot's reply |
|---|---|---|---|
| `$modify <card>\|<field>\|<value>` | 10,406 | set one field | 4 messages, see below |
| `$get <card>\|<field>` | 2,570 | read one field | `"<card>'s <field>:"` then the value (pre-2023: one message, `"<card>'s text is: …"`) |
| `$card <card>` | 1,167 | show the card | one message, the image as an attachment, no text |
| `$replace <card>\|<field>\|<old>\|<new>` | 961 | find and replace inside a field | the same 4 messages as `$modify` |
| `$rename <card>\|<new name>` | 532 | rename | `Renamed <card> to <new name>` |
| `$create <JSON>` | 531 | add a card | `Added this card`, then the image |
| `$delete <card>` | 197 | remove a card | `Removed <card> from the game.` |
| `$complex <card>` / `$simple <card>` | 143 / 22 | set the Simple/Complex glyph | `Set the complexity of <card> to Complex` |
| `$count` | 38 | pool size | `I count 648 total cards in the game, with 361 unique cards`, then a per-deck count |
| `$make_instant <card>` | 14 | a text rewrite (2022) | the same 4 messages, field `text` |
| `$rule <card>\|<ruling>` | 11 | append a ruling | `Added your ruling` |
| `$hello` | 11 | liveness | `Hello!` |
| `$degraft <card>` | 6 | a text rewrite | the same 4 messages, field `Text` (capital T) |
| `$pack` | 3 | a random pack | one image, `temp.jpg` |

Players use `$card` too (about 60 people, ~1,000 times in the rulings channels; `$cards` also
works). No one but Caleb has ever sent an edit command, so we cannot tell whether FriendlyBot
would refuse one. Assume it may not.

A misspelled command (`$modfy`, `$moify`, `$update`) gets **no reply at all**, and so does a
malformed one: `$modify|the everywhere|text|…` (2026-10-23, the separator after the verb) was
ignored, and Caleb re-typed it two minutes later.

### `$modify`, the edit Caleb actually uses

```
$modify murkstalker|text|When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.
$modify murkstalker|total cost|2
$modify seer or empty spaces|total cost|2
$modify shard sprite|cost|w
$modify arbitor of armistice|toughness|2
$modify triskaidekophage|power|13
$modify rider of the tides|image|images_out/Stable/rtdd.png
$modify maw of despair|type|Creature — Bedlam Alien
$replace afflicting anima|text|Wight|Wraith
```

The fields he sets, by use: `text` 4,303 · `image` 2,875 · `total cost` 932 · `type` 762 ·
`power` 519 · `toughness` 429 · `cost` 266 · `details` 89 · `images` 58 · `backside` 24 ·
`num copies` 20 · `side` 10 · `deck` 5 · `numeral` 5. The field name is case-insensitive
(`Text`, `Type`), and a space or an underscore both work (`total cost`, `total_cost`). Nothing
escapes a `|` in a value: `$modify blank card|num|copies|9` set a field called `num`.

**The card name is matched loosely.** `$modify seer or empty spaces|total cost|2` changed Seer
of Empty Spaces, and `$modify stalward sentinel|text|…` changed Stalwart Sentinel. The reply
echoes the name **as typed**, not the card's real name.

## How a card is encoded

The record has the same keys as our oracle row: `data/cards/AlgomancyCards-OracleText.json`
began as a dump of FriendlyBot's database (the 2024-03-14 `revision_date_time` on the base set
is the dump). A record, as `$get water resource|details` printed it (2024-03-03, Python's
`repr`, cut by Discord's message limit):

```
{'name': 'Water Resource', 'power': '2', 'toughness': 0, 'cost': 'b', 'total_cost': '0', 'type': '[b] Water Resource', 'text': 'When I activate, if you have at least [b][b][b], create a Shard.', 'image': 'images_out/Stable/wars7.png', 'revision_date_time': '2023-03-04 11:45:22.127516', 'details': ''
```

`$get <card>|details` is the one read that returns the **whole record**. That held for every use
from 2023 to 2024; the field `details` itself is `''`.

And the newest `$create` (2025-11-15):

```
$create {"name": "Lifespecter", "power": 0, "toughness": "4", "cost": "w", "total_cost": "0", "type": "Creature — Spirit Token", "text": "[Augment] When I attack or block, each opponent loses 4 life and you gain 4 life.", "image": "images_out/Stable/lspec.png", "revision_date_time": "", "details": "", "factions": ["light"], "complexity": "Simple", "rulings": [], "Side": "Front"}
```

| field | encoding | ours |
|---|---|---|
| `cost` | the **affinity pips only**, one letter per pip: `e` earth, `m` metal, `r` fire, `g` wood, `b` water, **`w` light, `k` dark**; `empty` for none | the same letters, but **`l` light, `d` dark**; `p` colourless in both (his record for Stolen Card, `$get stolen card\|details`, 2023-11-25: `'cost': 'p'`) |
| `total_cost` | the whole cost as a number, in a string or not (`"2"`, `5`); `$modify` spells the field `total cost` | the same |
| `power`, `toughness` | number or string, inconsistently | strings |
| `type` | his own notation: **`Creature — Cosmic Horror`**; keywords in braces anywhere (`{Haste} Creature — Alien`, `Creature — Alien {Virus}`, `[Augment] {Afflicting}Creature — Blight Zombie`); spells print as written (`{Battle} Nature Spell`) | **the printed line**: `Cosmic Horror Unit`. The renderer turns `Creature — X` into `X Unit`: FriendlyBot's Murkstalker type is `Creature — Cosmic Horror` (`$get`, 2025-11-27), and the scan prints `Cosmic Horror Unit`. "Creature" is not an Algomancy word; it survives only inside this stored field |
| `text` | markup shared with ours: `[Augment]`, `[Switch1]`, `[once]`, `[one]`…`[eight]`, `[x]`, cost pips in brackets (`[k]`), `{i}(…)` reminder italics, `{/i}`, `{g}` gold, keywords in braces, and **`{/n}`, a line break he places by hand** (197 uses since 2025) | the same markup, except light/dark pips read `[l]`/`[d]` |
| `image` | **a path on Caleb's computer**: `images_out/Stable/rtdd.png` | the same path for the base set; a Cloudinary URL for Light & Dark |
| `complexity` | `Simple`/`Complex`, set by `$simple`/`$complex` | plus `Common` and `Glitch` for Light & Dark, from the scans |
| `factions` | a list (`["light"]`), sometimes junk (`"9"` on Debt) | a list |
| `Num_Copies`, `Side`, `Backside`, `Deck`, `Numeral`, `rulings` | print-run bookkeeping | carried as is (`Deck` is a printer artifact, never a filter) |

Recent `cost` values: `k` 32 times and `w` 26 since 2025. The light/dark letters are the one
notation difference that matters for numbers, and the type line is the one that matters for text.

The art is a file on Caleb's PC. **FriendlyBot cannot take an uploaded image**: none of his
commands carries an attachment, and every art change is `$modify <card>|image|<path>`. The
uploaded files he did post (23, all from 2022–2023) were art shown to the channel, not commands.
The library path in every attachment name (`CUsersCalebPycharmProjectscardgamebot_library…`)
says the bot runs from his PyCharm project on that machine. When the machine is off, the bot is
down: players in `#rules-questions` noticed ("the bot is down") on 2023-08-30.

## What it posts back

**No embeds, no Discord replies.** Of 23,846 FriendlyBot messages, none has an embed and none
uses Discord's reply reference. Every answer is a plain message posted after the command, so
**a reply is tied to its command only by order and by what it echoes.**

An edit (`$modify`, `$replace`, `$make_instant`, `$degraft`) answers with four messages, as
here on 2026-10-23:

```
17:48:24.053  calebgannon  $modify murkstalker|total cost|2
17:48:24.167  FriendlyBot  Modified murkstalker's total cost from this
17:48:24.518  FriendlyBot  [CUsersCalebPycharmProjectscardgamebot_libraryMurkstalker.jpg]   ← the card before
17:48:29.174  FriendlyBot  To this
17:48:29.505  FriendlyBot  [CUsersCalebPycharmProjectscardgamebot_libraryMurkstalker.jpg]   ← the card after
```

- The first line is **exactly** `Modified <card as typed>'s <field as typed> from this`: 10,308 of
  10,308 `$modify` replies matched that byte for byte.
- **The attachment name carries the card's real name**: `…_library` + the name with spaces as
  `_` and punctuation dropped (`Blights_End`, `A_Fast_Pile_of_Rocks`, `Seer_of_Empty_Spaces` for
  "seer or empty spaces"). This is the only place the reply names the card FriendlyBot actually
  changed.
- The images are 720 × 1000 JPEGs of 85–140 KB, the same size and frame as our scans.
- Timing, from command to the new image (3,569 complete edits since 2024-03-14): median
  5.3 s, 90th percentile 6.0 s, 99th 7.8 s. Rendering is the wait; the first line comes back in
  about 0.3 s.
- In 112 edits since 2024-03-14, about 3%, the four messages did not arrive in order and
  complete. Most often FriendlyBot posted the first line and the old image, and the "To this"
  pair never came, or came after Caleb had already re-sent the command. In 15 complete edits,
  Caleb typed something else before the new image arrived.
- Errors: `Something went wrong` (40 times, mostly `$delete` and `$rename`). Everything else
  that fails fails **silently**.

An edit to the same card is cumulative: each "To this" is the card with every change so far.
Caleb re-sends the same `$modify` freely (The Everywhere, four times in six minutes on
2026-10-23, each with a different `{/n}` placement), and each one gets its own four messages.

Discord attachment links expire after about a day. `media.discordapp.net/…&format=webp` is a
re-encode; the same path on `cdn.discordapp.com`, with `ex`/`is`/`hm` kept, serves the original
JPEG (`steward/fetch-file.mjs` does the rewrite).

## The banners are not in the renders

Prophecy and Ambush banners are added by hand afterwards, in Photoshop: a FriendlyBot render of
a card with a banner shows no banner. Of the 513 cards whose last render in `#card-changes`
(`var/records/card-changes/latest-images/`, 2026-11-10) we could pair with a scan, 317 match the
scan to within JPEG noise. Most of the rest differ in small regions, and six differ a lot. Eleven
renders are 719 or 735 px wide where the scan is 720.

## Does it answer other bots?

No evidence either way. In every export, no bot ever sent FriendlyBot a `$` command. The only
other bots in the exports are Scryfall (36 messages), judgebot (2) and YAGPDB (1), and none of
them typed one. FriendlyBot's code is not available. Most Discord bots built on discord.py's
command framework ignore bot authors by default. That is a guess about a library, not a fact
about this bot, and it is why the editor gives Caleb the command to paste himself.

## What the record leaves uncertain

1. **Whether FriendlyBot obeys anyone but Caleb.** Nobody else ever tried an edit.
2. **Whether it answers bots.** Never tried.
3. **Whether `$get <card>|details` still returns the whole record.** The last use was 2024-03-04.
   A record with long text or many rulings may not fit in one Discord message.
4. **What `$replace` matches**: plain text or a pattern. Every use replaced a plain word, `Wight`
   → `Wraith` on six cards in a row on 2025-12-04.
5. **Why about 3% of edits stop after the old image.** Possibly a render that failed. The
   database may or may not have changed when that happens.
6. **Whether the new image after a `$modify ...|image|` reflects the art at once.** Every
   example does, but the path must already exist on his machine.
7. **Renaming through `$modify`.** Caleb renames with `$rename`, but the one
   `$modify tidal crasher|name|Hooba-Pon` (2023-04-22) also worked. Which one is safer, given the
   loose name match, is unknown.
