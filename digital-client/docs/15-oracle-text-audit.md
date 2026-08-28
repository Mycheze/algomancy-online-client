# Oracle-text audit — the whole pool, 2026-08-28 (R240)

Commissioned by the owner: *"there have been several minor issues found in our oracle
text. Can you have that all checked for typoos and minor errors?"*

## What was actually swept, and how

Two data sources, both **parsed as JSON and iterated**, never regexed as text:

| source | what it is | size (counted, not assumed) |
|---|---|---|
| `AlgomancyCards/AlgomancyCards-OracleText.json` | Caleb's transcription — the upstream source of truth | **534 cards, 534 rows** (no card has more than one row; every key matches its row's `name`) |
| `digital-client/engine/src/cards/printed.json` | generated from the above by `engine/scripts/extract-printed.mjs` | **492 cards** |
| the registered pool | `allCardNames()` **after importing `src/apply.ts`** | **495** = 492 printed + 3 synthetics (`Unit Token`, `Beyond, Codex Incarnate`, `Alluring Attribute`) |

The three synthetics have **no upstream entry at all** — they are authored in this repo
(`registry.ts`), so they are outside the "oracle text" the owner asked about, and are
listed here only so the 495 is accounted for. Nothing in printed.json is unregistered.

**Where the two channels disagree, both numbers are given.** The one place a count is
genuinely ambiguous is flagged in §2.

Where a finding could plausibly be either a transcription slip or a real printed card,
**the card art in `AlgomancyCards/*.jpg` was read directly** — that is the actual source
of truth, and it moved four findings between sections. Report #106's lesson (a complaint
routed to `printed.json` when the culprit was `ui/glossary.ts`) is why.

---

## Section 1 — Confirmed defects

Ordered most to least important. "Confidence" is against the printed card art where
that was consulted, otherwise against the pool's own derived convention.

### 1.1 Interdiction Rift — **RULED AND FIXED THIS ROUND**
- **printed:** `{Battle}AI Cosmic Spell` — **should be:** `{Battle} Cosmic Spell`
- Confidence: **certain.** The owner ruled it verbatim, and the card art confirms: the
  printed type line reads "Cosmic Spell" with the {Battle} carried by the crossed-swords
  icon in the title bar, exactly as the other 135 {Battle} cards transcribe it.
  `{Battle} Cosmic Spell` is a line **nine other cards already print**, so the corrected
  form is a well-populated shape rather than a novel one.
- **Status: corrected at source** (the oracle file already carries it), the stale override
  in `scripts/printed-overrides.mjs` is **deleted** (not rewritten), `printed.json` is
  regenerated, and `engine/test/209-interdiction-rift-type-line.test.ts` pins it from both
  sides. Nothing else on the list below has been touched.

### 1.2 Lurking Dread — a **lost line break**, not a style choice
- **printed:** `...sacrifice two non-token units...` — **should be:** `nontoken`
- Confidence: **certain.** The card art wraps the word across a line as `non-` / `token`.
  This is the **fifth instance of the R142 hyphenation artifact** (Flamebreath Initiate,
  Cinder Scuttler, Ghord, Molten Tormentor were the first four) and it slipped past that
  guard because the guard matches `letter-hyphen-SPACE-lowercase` and this one lost the
  space too. Every one of the other **25 cards in the pool** (26 in the whole file) writes `nontoken` closed.

### 1.3 Rime Wraith — two attribute markers glued together
- **printed:** `{Virus} [Augment] {Swift}{Sluggish} Spirit Anima Unit`
- **should be:** `{Virus} [Augment] {Swift} {Sluggish} Spirit Anima Unit`
- Confidence: **certain.** The card art prints "**Swift Sluggish**" with a space. This is
  the **only** glued marker pair in the pool: 21 type lines carry two markers and the
  other 20 all space them.
- The card really does have both (they look contradictory, but its own reminder text
  explains both: *"Swift units deal combat damage first. Sluggish units deal combat damage
  last."*), so this is a spacing defect only — the attributes are right.

### 1.4 Blight's End — a **retired token name**
- **printed:** `Augment a Wight onto X target units.` — the token is called **Wraith**
  on the six other cards that create it.
- Confidence: **certain that it is an inconsistency**; the fix is Caleb's call (rename on
  the card, or accept Wight as an alternate name). The card art does print "Wight", so the
  transcription is faithful — **the physical card carries the old name.**
- The client already handles it: `registerAlias('Wight', 'Wraith')` in `registry.ts`, R71.

### 1.5 Blurf — a prophecy grant written in a different format from every sibling
- **printed:** `It gains 'Prophecy: 1 turn passes'.`
- **every other granting card:** `'Prophecy — <Word> Turn(s) Pass(es)'` — em-dash, word
  form, title case (Divine Foresight, Grob, Living Vault, Prophecy Bug, Waxen Witness).
- Confidence: **certain that it differs**; **the card art prints it that way**, so again
  this is a defect *on the card*, not in the transcription. Worth a line to Caleb because
  the wording is what a rules parser and a player both key on.

### 1.6 Lurking Slimebeast — an ambush cost spelled as a compound word
- **printed:** `[Battle] Ambush [three_blue]` — **should be:** `[3b]`
- The other five ambush costs in the pool are all digits-plus-pips: `[4bb]` ×2, `[2be]`,
  `[3bb]`, `[4]`. Confidence: **high** (5 of 6 convention; the extractor already carries a
  named `COST_WORDS` expansion solely for this one card, and without it the card had **no
  Ambush mode at all** — so this one has already cost real behaviour once).

### 1.7 Nothyr — a timing marker in braces where the text box uses brackets
- **printed:** `2 [d] Discard Me. {Battle}` — **should be:** `[Battle]`
- In-text timing markers are bracketed on **9 cards** (5 Ambush lines, Shib, Grox,
  Cadaverous Cultivator, Insidious Invitation); Nothyr is the only in-text `{Battle}` in
  the file. The braces are reserved for type lines (136 uses). Confidence: **high**.
- The trailing period is transcriber punctuation — the card art prints "Discard Me ⚔"
  with no period, and the capital **M** in "Discard Me" **is on the card**, so that half
  is not a defect (Dropslime and Sacrifice Dude print "Discard me").

### 1.8 Might of the Grove — *already ruled, still uncorrected upstream*
- **printed:** `{Battle}Tree Tree Druid Spell` — **should be:** `{Battle} Tree Druid Spell`
- The owner ruled this on 2026-08-25. It is still wrong in the oracle file and is now the
  **only** type line in the whole 534-card file with a marker glued to a word. Listed here
  because the client's override is a downstream patch and the bot and the RAG corpus are
  still reading the wrong line.

### 1.9 Arbiter of Armistice — *already ruled, still uncorrected upstream*
- **printed:** `{Haste} {Switch} Holy Unit` — **should be:** `{Haste} Holy Unit`
- Ruled by the owner in R157 §25. Same situation as 1.8: overridden downstream, still
  wrong at source. It is the only `{Switch}` on a type line in the file (the other 27 are
  rules-text markers).

---

## Section 2 — Suspected, but I cannot tell a typo from a deliberate choice

### 2.1 Amount tokens: word-form vs digit-form, mixed across identical constructs
`[one]`/`[two]`/`[three]`/`[zero]` — **24 occurrences across 23 pool cards**.
`[0]`–`[8]` — **17 occurrences across 17 pool cards**.

Two sub-patterns are **100% consistent** and are almost certainly deliberate:
- activated-ability costs (`[three]: Create a Robot 2.`) — **13 of 13 use the word form**
- prophecy banner mana (`[2] Prophecy — …`) — **all 7 use the digit form**

But "you may pay [N]" is a genuine 50/50 split — `[1]`/`[2]` on Afflicting Anima,
Blightwalker, Dragnol, Rotling, Sacrifice Dude, Swarmling, Thoughtripper; `[one]`/`[two]`
on Biomass Devourer, Eminence of the Barrens, Reclaimer of Secrets, Soul Tithe, Tempest
Oracle, Xenopod Progenitor.

**What would settle it:** whether the printed cards draw a different icon for the two
(R141 already concluded they are the same thing and taught the client to render both, but
that was a rendering decision, not a data ruling). One question to Caleb: *"are `[one]`
and `[1]` the same symbol on the card?"* If yes, one of the two spellings should go.

**Do not "fix" this by sweep** — it is exactly the kind of majority-rule edit that the
`normalisePrinted` comment forbids.

### 2.2 Prophecy banner mana: 5 bracketed, 2 bare
`[1] Prophecy`, `[2] Prophecy`, `[4] Prophecy`, `[0] Prophecy` (Air Plant, Angel of
Anguish, Big Glimpse Card, The Foretold, Tithe Enforcer) vs bare `1 Prophecy` /
`2 Prophecy` (**Divine Intervention**, **Flzzz**). The extractor parses both. Probably
transcription noise; possibly the card layout differs. Settled by two card images.

### 2.3 `{Virus}` position on the type line — a set convention, with one exception
- **base set:** `{Virus}` immediately before the head word — 24 of 25 cards
- **Light & Dark:** `{Virus}` leading the line — 24 of 24 cards

The split is *exactly* along the set boundary, which makes it a transcription convention
rather than a defect. The **one** exception is **Aberrant Statweaver** (base set,
`{Virus} {Unstable} Luminary Unit`, leading). Its mirror image is **Oorblak** (L&D,
`{Unstable} Luminary Strider {Virus} Unit`, trailing) — i.e. each of the two `{Unstable}`
cards breaks its own set's convention, in opposite directions. That symmetry suggests
noise around an unusual marker rather than a typo. Nothing reads the position. **Cosmetic;
would only matter if a future guard keyed on marker order.** Settled by the two images.

### 2.4 Witness of the Crossing prints no reminder where its two siblings do
Three cards print a repeated graft marker: Amphivore `[Switch1]×3` and Lost Guardian
`[Switch1]×2` both explain it (*"Trigger three copies of this graft ability as one single
trigger"*); **Witness of the Crossing `[Switch1]×3` explains nothing.**
**The card art confirms there is no reminder on the card** — so this is a design
inconsistency for Caleb, not a transcription error, and it is the one place a player is
left to infer a rule from a symbol repeated three times. (Amphivore also puts its period
*outside* the parenthesis where Lost Guardian puts it inside — trivial.)

### 2.5 Reminder terminal punctuation
**67 of 79** pool reminders end in a period; 12 do not (Amphivore, Borrower of Forms,
Emberflame Enlightener, Life Plant, Reclaimer of Secrets, Spectrogenesis, Swirling
Shardform, and the five Ambush cards). Rime Wraith's art shows a space before the closing
paren that the transcription tidied away, so at least some of this is real card
typesetting. **Low value; listed so nobody re-derives it.**

### 2.6 `Wither and Bloom` puts `{i1}` on the far side of its "or"
Five cards write the modal marker as `{i1}or` (Burgeon, Floral Singularity, Spirit of
Nature, Transmutide Enigma, Void Memory); Wither and Bloom writes `or{i1}`. R142 already
established this is a **printed line-break artifact** (the marker sits on whichever side
the line wrap left it) and taught the renderer to preserve the space either way. Almost
certainly not a defect — noted because it is the only asymmetry in the family.

### 2.7 Double spaces, upstream
**51 of 492** pool fields carry a run of whitespace, and one type line is untrimmed
(**Slag Spewer**, `" Slag Beast {Virus} Unit"` — leading space). All invisible in HTML,
all normalised away by the extractor, all visible in logs, diffs and the Discord bot.
A single upstream `re.sub(r'\s+', ' ', s).strip()` would clear the lot. Not itemised
here because it is one mechanical pass, not 51 decisions.

---

## Section 3 — Checked and found clean (do not redo)

Each of these was computed over the parsed data, not sampled.

1. **printed.json vs the oracle file, all 492 cards, every field.** Type lines differ on
   exactly **3** cards, all of them declared overrides (§1.1, 1.8, 1.9). Text differs on
   11 cards, and **all 11 are the extractor deliberately lifting a banner / "Discard me" /
   "[Gain N debt]" line out into a structured field** — zero word drift. `power`,
   `toughness`, `mana` and `cost` disagree on **0 of 492**.
2. **Marker casing, whole file.** Every bracket/brace token was tallied case-insensitively
   and grouped: **zero tokens appear in more than one casing.** No `{battle}`, no `[Once]`,
   no `[AUGMENT]`. The `{}` vs `[]` split is real and load-bearing, and it is positional,
   not semantic: type lines use `{Battle}`/`{Haste}`/`{Virus}`, text boxes use
   `[Battle]`/`[Haste]`/`[Switch]`. The **only** crossings are the three already listed
   (Arbiter §1.9, Nothyr §1.7) plus Rook's `[Virus]`, which is prose referring to the
   mechanic, and `{g}` (keyword colour) vs `[g]` (wood pip), which are unrelated symbols
   that merely share a letter.
3. **Capitalisation after a graft marker.** All 145 `[Switch]`/`[Switch1]` occurrences are
   followed by a capitalised word or an icon. Zero exceptions.
4. **Unbalanced delimiters.** Parens, brackets and braces balance on **every** card in the
   file, in both `type` and `text`. Zero.
5. **Doubled words.** One hit in the whole file — `Tree Tree` on Might of the Grove
   (§1.8, already ruled). Nothing else.
6. **English spelling.** All 635 distinct prose words run through `aspell`; 15 unknown,
   and every one is either game vocabulary (`mana`, `despawn(s)`, `nontoken`, `nonunit`,
   `nonspell`, `prismite`, `Polyform`, `activations`) or a known R142 hyphenation fragment
   (`adja`, `cre`, `fices`, `nent`, `oppo`, `sacri`). **`Sacrifce` is gone** — the owner's
   source fix on 2026-08-24 held.
7. **Real-word typos.** `its`/`it's`, `lose`/`loose`, `then`/`than`, `affect`/`effect`,
   plural possessives — all checked in context. **Zero.**
8. **Near-miss subtypes.** All **97** subtypes across the whole file, every pair within
   edit-distance 1: **zero** hits. No misspelled creature type anywhere.
9. **Near-miss card names.** All 534 names, every pair within edit-distance 1. The only
   hits are deliberately distinct cards (Hooba-Lan/Lin/Nan, Hooba-Pon/Mon, Grob/Grox,
   Fight/Right) and the numbered Stolen Card / Trigger series. The `Counter Theif → Counter
   Thief` class of defect is **clear**.
10. **Numbers.** Every reminder's numbers were cross-checked against its own clause
    (14 flagged, **all 14 false positives** — "cache **one**", "for example, a 4/4 and a
    2/2"), and every card that names a cost was checked against its own mana. **Zero real
    numeric contradictions.**
11. **Reminder-text drift — the R190 class.** All 98 `{i}(…)` reminders were grouped by
    normalised body. Every attribute family (Blessed ×4, Flying ×5, Piercing ×2, Deadly,
    Powerful, Poisonous, Balanced, Inverted, Electric, Lethal, Modular, Pure, Afflicting,
    Swift/Sluggish, Unstable ×2) is **word-for-word identical across its cards**, and none
    contradicts its `ui/glossary.ts` row. The Glimpse family is correct: the four N>1 cards
    all print "cache one … Recycle the rest", the N=1 cards all print "cache it" and no
    recycle clause. **The only wording variance in the entire set is a missing terminal
    period on two cards** (§2.5).
12. **Card / token names referenced in text.** Every `create a <Name>` and every quoted
    name resolves, with the single exception of **Wight** (§1.4).
13. **`[Haste]` in prophecy banners** — Divine Intervention's `"Your life is 5 or less
    [Haste]"` looked like a stray token. It is not: the card art shows a `⟫` glyph, and
    Tithe Enforcer's art shows the same glyph in *both* the title bar (transcribed
    `{Haste}`) and the banner (transcribed `[Haste]`). **Both transcriptions are correct.**
14. **Divine Intervention's text** ("change the **targets** of target effect") matches the
    art exactly. Not a plural error.

---

## Section 4 — The message to Caleb

> A few small things we found while sweeping the oracle text against the card art. All of
> these are in `AlgomancyCards-OracleText.json`; the first three are transcription slips,
> the last two are on the printed cards themselves.
>
> **Transcription — the data doesn't match the card:**
> 1. **Might of the Grove** — type reads `{Battle}Tree Tree Druid Spell`; should be
>    `{Battle} Tree Druid Spell`. (Bena confirmed this on 2026-08-25 — both the missing
>    space and the duplicated "Tree".)
> 2. **Arbiter of Armistice** — type reads `{Haste} {Switch} Holy Unit`; the `{Switch}`
>    isn't on the card. Should be `{Haste} Holy Unit`. (Bena, R157: *"The card does not
>    have a [Switch] thing."*)
> 3. **Rime Wraith** — type reads `{Swift}{Sluggish}` with no space; the card prints
>    "Swift Sluggish". Should be `{Swift} {Sluggish}`.
> 4. **Lurking Dread** — text reads `two non-token units`; the card just wraps "nontoken"
>    across a line. Should be `nontoken`, like the other 26 cards that use the word (25 of them in our pool).
>    (Same class as the `sacri- fices` / `oppo- nent` ones — a soft hyphen that lost its
>    `{/n}`.)
>
> **Consistency — the card itself is the odd one out:**
> 5. **Blight's End** — prints "Augment a **Wight**"; the token is called **Wraith** on the
>    six other cards that make it.
> 6. **Blurf** — prints `'Prophecy: 1 turn passes'`; every other card that grants a
>    prophecy writes `'Prophecy — One Turn Passes'` (em-dash, word, title case).
> 7. **Witness of the Crossing** — has `[Switch1][Switch1][Switch1]` with no reminder text.
>    Amphivore and Lost Guardian both explain the same construct
>    ("Trigger N copies of this graft ability as one single trigger").
>
> **Already fixed, thank you:** Interdiction Rift (`{Battle}AI Cosmic Spell` →
> `{Battle} Cosmic Spell`) and `Sacrifce` → `Sacrifice` on Linked Extinction.
>
> **Two questions rather than fixes:**
> - Are `[one]` and `[1]` the same symbol on the card? Both spellings are used for the
>   same thing ("you may pay …") on 13 cards each, and downstream tools have to guess.
>   `[three_blue]` on Lurking Slimebeast is the same question — everywhere else that cost
>   is written `[3b]`.
> - Could the export collapse repeated spaces and strip leading/trailing ones? 51 cards
>   have a double space somewhere and Slag Spewer's type line starts with one. Invisible on
>   a card, visible everywhere text is read as text.

---

## What was changed in this repo (and what was not)

**Changed — the one card the owner has ruled on, and nothing else:**
- `engine/src/cards/printed.json` — Interdiction Rift's type line, one line. Verified
  **byte-identical** to a full re-run of `scripts/extract-printed.mjs` (the extractor is
  write-blocked in this sandbox; it was run to a temp file and the outputs compared with
  `cmp`), so the hand-edit and the generator agree exactly.
- `engine/scripts/printed-overrides.mjs` — the Interdiction Rift entry **deleted**, not
  rewritten, per that file's own rule, with the ruling recorded in its place.
- `engine/test/209-interdiction-rift-type-line.test.ts` — **new.** Pins the corrected line
  against the registered card, against the upstream file, and against the override table's
  silence; then generalises both of the defect's signatures over the pool.
- `engine/test/122-cardtext-markup.test.ts` — comment only. It named Interdiction Rift as
  a card that deliberately needed no override "because the defect is pure layout"; that
  reasoning is now known to be half wrong and the comment says so.

**Break-tested, both directions, and the break confirmed to land:**
- Reintroducing `AI` into `printed.json` fails **3** assertions — §1 (the ruling), §2
  (source parity), and §4's singleton-subtype sweep, which catches it *independently of
  the spacing*, i.e. the sweep would have found this defect on its own.
- Re-adding an override entry for the card fails **2** assertions (§3).
- Restored, `cmp`-verified, and `209`, `161` and `122` all pass (10 / 35 / 23).

**Deliberately NOT changed:** every other item in §1 and §2. They are upstream defects and
they go to Caleb in one message — patching them downstream is the practice the owner asked
to stop.
