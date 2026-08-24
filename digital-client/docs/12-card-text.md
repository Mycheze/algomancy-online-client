# 12 — The card-text engine

*Built 2026-08-21, playtest round 9.*

> "Cards have their oracle text changed all the time. Mods, grafts, counters, other cards
> adding or removing rules text. The printed card is hardly ever correct. […] We need a
> whole improved box under the image that shows the current text box of each unit, as the
> game sees it. […] You may need to relook at the card text calculation engine entirely
> since I'm pretty sure removing abilities from cards isn't working right."
> — Bena

Two things, and the second one is why the first was impossible.

**The scan on the table is the card's history.** It is how you recognise a card and nothing
else. What a unit actually does right now is the printed clause *plus* every mod slid under
it, *minus* whatever the board has switched off, *plus* whatever somebody granted it — and
until this round the client showed the first of those and hinted at the second.

**Removing abilities genuinely was not working.** It was not working at all: five printed
cards take something away and every one of them was parked with the same note, because the
engine could add to a card forever and subtract from it never. So the text engine came in
two halves — a real suppression layer underneath (R62), plus granting (R63) to close the
mirror-image gap, and then a box that can afford to be believed.

## Half one: the engine can take things away now

[R62](digital-rules.md#r62--the-suppression-layer-loses-all-attributes-and-abilities) is the
layer. It is a **veto, not a sum**: one suppressor switches a half off and nothing switches
it back on, and it sits *under* every other layer, so "loses all attributes" takes the
mod-granted and column-shared ones too. Two forms — an until-regroup flag a spell stamps on
the entity, and a continuous `StaticMod` flag that lives and dies with its projector —
unioned by `E.suppressionOf()`, which also answers *who to blame*, because a box that says
a unit has lost its abilities and cannot say why is not much better than one that lies.

"Abilities" means everything the card does by itself: triggers (its own, its `[Augment]`
text, its mods' donated text, granted text), activated abilities, the statics and cost
modifiers it radiates, and both replacement hooks. Stats are not abilities.

[R63](digital-rules.md#r63--granting-rules-text) is the other direction. A grant is a
**reference, not a copy** — `{ card, via, index, text, from }` pointing at an authored
ability — so it stays serializable, replays bit-identically, and composes for free through
the `viaCard` parameter `fireEvent` already had.

Between them they un-parked **Suppression Field** (all three of its clauses), **Monke**,
**Transmogrifant**, **Formless**'s second clause and **Reforge the Dead**.

## Half two: the box

`ui/cardtext.ts` is pure and DOM-free (the `ui/inspect.ts` convention), tested in
`test/57-ui-cardtext.test.ts` (the composition) and `test/122-cardtext-markup.test.ts` (the
markup, and what the box must not repeat). `ui/main.ts` renders it with `textBoxHtml()`.

Nothing in it re-derives a rule. Every line comes from a public engine query, and the stat
arithmetic is `E.effStats` / `E.ownAttrs` / `E.projections` themselves — so **a box cannot
disagree with the board it is describing**, which is the only property that makes it worth
putting on screen at all.

A live box is composed of:

| origin | what it is |
|---|---|
| `printed` | the card's own text box |
| `augment` | a clause donated by an augment mod slid under it (R55) |
| `graft` | the host's cause + every grafted `[Switch]` clause, as the **one** ability they are (Manual p.33) |
| `granted` | text handed to it until regroup (R63) |
| `static` | a continuous projection radiating onto it from elsewhere, attributed to the card that authored it — not to the unit wearing it |
| `note` | the one per-ability fact: a once-per-turn budget already spent this turn |

Plus: every attribute with **where it comes from** (printed / from a mod / projected / until
regroup / **shared by the column**, which is the single most-missed thing on a board), the
stat arithmetic term by term, a banner naming whatever has switched a half off, and a
`state` row for what happens to this card when it **leaves** play — token, sent to
counterattack, and **{Unstable}**.

### A line never repeats what its own tag already says (R135)

Every line is rendered under a tag for its origin, and that tag is an **icon**: the augment
symbol for an `augment`, ⇄ for a `graft`. A donated clause is sliced *from* its printed
marker (that is where the donation starts), so the same symbol used to arrive twice — once
on the tag, once at the head of the text. `dropOriginMarker()` takes the **leading** one
off. Only the leading one: a `[Switch]` mid-sentence separates a graft's cause from its
effect and is the printed card's own punctuation, which is why the composed graft line
never goes through it.

The spent-budget `note` is tagged **`[Once]`**, always — not the ability's printed marker.
The note is not quoting the card (the printed line directly above it already does that);
it is about the *budget*, and `[Switch1]`'s icon is the bounded-**graft** symbol, which
badges a plain bounded trigger as though something had been grafted onto it. For the same
reason the note does not restate `ab.label`: that is a paraphrase of the clause above it,
and no card in the pool has two bounded abilities, so there is nothing to disambiguate.
`[Switch1]` in **printed** text is untouched — 118 cards print one.

### {Unstable} (R135)

Unstable is a bin *replacement*, not a combat attribute — deliberately absent from the
`Attr` union — so it was never going to show up in the attribute row, and for a long time
it showed up nowhere. Two cards print `{Unstable}` on their type line (Oorblak, Aberrant
Statweaver, from report #89) and the type line renders it; every *other* way in was
invisible, including the common one, the Manual p.35 blanket rule that a **modded card is
Unstable**. It rides in `state` now, beside "token — erased when it leaves play", which is
the same class of fact, and it names *which* of `E.isUnstable`'s four ways in applies —
they expire differently (a mod can be removed, an R96 stamp lapses at regroup, a printed
marker never does). Read through `E.isUnstable`; never re-derived here.

A clause that is present but doing nothing is **struck through, not hidden**. "It says Flying
and Flying is off" is two facts and a player needs both.

### A cost written as bare digits (R141)

The pool spells the same amount two ways — `[two]` on 24 cards and `[2]` on 12
— and until R141 only the first one drew an icon. `COST_TOKEN_RE` demands at
least one pip letter (it exists for the `[4bb]` compound form), so a bare-digit
body matched nothing and fell through to the formatter's last branch, *"unknown
`[token]`: untouched"*. The player read a literal `[2]` on twelve cards
(Afflicting Anima, Blightwalker, Dragnol, Rotling, Sacrifice Dude, Shib, Wake
the Dead and five more) while `Icons/cost_0..9` and `cost_x` sat unused for that
spelling — they were reachable the whole time, just never from this one.

Found by the owner, 2026-08-24: *"an icon we're NOT using anywhere is the [1] or
[2] icon for paying costs on cards."* Half right, and the wrong half is the
instructive one: the icons **were** in use, so grepping for `cost_` in the UI
finds a live call site and says the feature works. Only one of two spellings
ever reached it.

Digits resolve per character, exactly as `[4bb]` does, so a hypothetical `[10]`
would draw a 1 then a 0. No card in the pool goes past `[8]`.

This is the same shape as R134's `{g}`: **a token nobody taught the formatter
about does not announce itself — it renders as its own source text.** Both
branches now end in a whole-pool sweep so the next unknown spelling fails a test
instead of reaching a player.


### None of the formatting markup may ever reach a player (R142)

> "UI thing: All the text on cards still includes things that are only for the engine to see
> (like {i} or / or some other 'markup' notes)." […] "It's pure engine markup used by some
> system Caleb uses to format cards better. {i} makes the next word italic, {g} puts it into
> gold colored text, etc. I'm not sure what the / does, tho."
> — Bena, room SMVJ 2026-08-24 (report #102)

That second sentence is the rule, and it is stronger than the three fixes it produced: the
markers are a **presentation layer, not card content**. So R142 stops fixing them one at a
time and states the invariant, then guards it over the whole pool.

**Three families of brace token, and only one of them is markup.** Getting this wrong in
either direction is a bug, and both directions have shipped before:

| family | examples | what must happen |
|---|---|---|
| **formatting** | `{i}` 80, `{/n}` 73, `{g}` 8, `{i1}` 6, `{/i}` 5, `{p}` 2, and `/[…]` 13 | **never** visible |
| **keyword** | `{Battle}` 136, `{Virus}` 63, `{Haste}` 21, `{Flying}` 9, … ~30 | **always** visible — an icon where one exists, the bare word where none does |
| **stat notation** | `X/X`, `+1/+1`, `-1/-1` | not a token at all, and must not move |

Only six things have icon assets (`virus, battle, haste, augment, graft, bounded_graft,
once`). The other two dozen keywords correctly bare their word; that is **not** a gap to
close by inventing icons, and the sweep asserts they still print.

#### `/[…]` — the last marker, and what it actually is

`/[` marks a bracket the **printed card draws as its own boxed panel**. Thirteen cards print
one, in two jobs: a *cost* (`[Switch1] /[Sacrifice a unit]: Draw a card.` — Immolate) and a
*modal body* (`double its /[power {i1}or defense]` — Burgeon). Before R142 the slash and both
brackets reached the table verbatim.

**The census that came with the report was wrong about where it appears**, and the wrong
version is the one worth writing down: it said `/[` only ever follows a `[Switch]`/`[Switch1]`
marker. Six of the thirteen have no Switch in front of them — Burgeon, Void Memory, Spirit of
Nature, Transmutide Enigma, Floral Singularity, Malevolent Machinations — and two of those
*open* their text box with it. Had it been implemented as a suffix of the Switch token it
would have fixed seven cards and left six, which is exactly the failure mode R134 and R141
each hit: fix the instance you were shown, ship the family. It is handled generically, in the
icon pass, where every other bracket is handled.

**It renders as `<span class="costbox">`, not as bare `[…]` and not as nothing.** Three
options were live. Printing `[…]` and dropping only the slash swaps one engine-looking
character for two more, when the complaint *is* that card text reads like source. Dropping
the delimiters entirely loses real information — on Wither and Bloom the box is what says the
whole "or" clause is one alternative rather than a second sentence; on Immolate it is what
separates the cost from the effect. The span keeps the printed card's grouping, prints no
punctuation of its own, nests a `{/n}` or `{i1}` inside itself unharmed, and is a one-line
stylesheet change if it should look different later.

⚠ **The trap: `/` is also stat notation**, on far more cards than print `/[`. The markup rule
is anchored to the slash being *glued* to a `[`, and a test renders `X/X`, `+1/+1` and `-1/-1`
unchanged alongside Discharge, which prints both on one line.

#### `{i1}` was eating the space next to the word it italicised

`{i1}` italicises exactly one word, and it sits on whichever side of that word the printed
line break happened to leave it: `units {i1}or your` has its space before, `each enemy or{i1}
put a` has it after. The replacement consumed `\s*` and put nothing back, so the second form's
only separator vanished and Wither and Bloom read *"each enemy orput a"*. The whitespace is
captured and re-emitted now. **A marker that disappears but takes a space with it is as
visible as one that prints** — which is why the pool sweep for this one is *positive* ("are
these two words still separated?") rather than hunting for the jammed digraph: `power {i1}or`
looks for `ro`, and "regroup" has one.

#### R134's global-formatting claim: verified, not assumed

R134 said formatting markers are resolved *globally*, before the icon pass, so a marker nested
inside a bracket the icon pass does not recognise is still reached. The claim held — a `{/n}`
inside `/[…]` was already a `<br>` — and it is now a test rather than a comment, because the
`costbox` span was in a position to quietly break it. The one place `{/n}` deliberately is
**not** a break is the composed text box, where `clean()` collapses it to a space: it is a
mid-*word* wrap in the scans ("be- {/n}comes"), never a clause separator, and the box reflows.

#### One function, ~25 call sites

`ui/main.ts` calls `iconizeText` from about twenty-five places — ability labels, glossary and
help rows, decision hints, the log, the menu, the token rows — plus `ui/markdown.ts` and the
full/compact/printed text boxes. They all funnel through the one function, which is why the
fix is one function and why "a fix that only covers the big card box" was never a risk here.
The sweep walks both the raw card data *and* the composed box, so the slicing that
`clean()`/`switchClause`/`dropOriginMarker` do cannot reassemble something the formatter then
fails to consume.

### Layout artifacts are scrubbed in the EXTRACTOR (R142)

Two things that reach a player are not markup at all — they are accidents of the printed
card's typesetting that the transcription carried through — and they belong in
`scripts/extract-printed.mjs`, not the renderer. `printed.json` is **generated**; a hand edit
there is silently wiped by the next regeneration.

* **Hyphenation.** A word broken across a printed line normally keeps its break —
  "sacri- {/n}fices" — and `clean()` joins hyphen and marker together. Four cards lost the
  `{/n}` in transcription and were left holding a bare "adja- **cent**" (Flamebreath Initiate)
  and "oppo- **nent**" (Cinder Scuttler, Ghord, Molten Tormentor).
* **Whitespace runs**, on 49 card texts and one type line (Slag Spewer's leads with a space).
  Invisible in HTML, visible everywhere else: logs, the Discord bot, a diff, a failure message.

The join is anchored to letter + `-` + space + **lowercase** letter, which misses every
`-1/-1` (the hyphen follows a space and precedes a digit), every closed compound
(`Self-Assembly`), and the prophecy banner's em-dash. It deliberately also misses
"sacri- {/n}fices": a `{/n}` is a real printed line break and the separator the banner parser
splits on, so joining those away would destroy the text box's line structure to fix something
`clean()` already handles. Regenerating produced 55 changed lines — 4 joins, 51 whitespace —
and nothing else.

⚠ **It does not fix spelling.** `Linked Extinction` reads *"Sacrifce a unit"*. That is a typo
in the **designer's** source data, not a layout artifact, and the extractor does not rewrite a
designer's words behind their back — that is the quiet lie the card ledger exists to stop. It
is reported upward and left, and a test records the decision so that a future fuzzy spellfix
trips an alarm instead of shipping.

### What is deliberately not split

A card's own printed text stays **one line** rather than being cut into one clause per
scripted ability. Printed text is prose written for humans; `abilities[]` is an
implementation of it, and the two do not line up 1:1 — a sentence can be two abilities, an
ability can span two sentences, and reminder text belongs to no ability at all. Guessing a
mapping would make the box confidently wrong, which is worse than the printed card.

It costs nothing, because everything that varies per clause is already per **card**: a mod is
its own card, a grant carries its own text, and suppression is all-or-nothing by rule —
"loses all abilities", never "loses its second ability".

(`{/n}` in the scans is a mid-*word* line break — "be- {/n}comes" — never a clause separator.
`clean()` joins it, hyphen included.)

## Where it shows

Three surfaces, one renderer, so they cannot drift apart:

* **The focus viewer** (side rail) — the composed modded card art, then the box under it.
  The picture is how you recognise the card; the box is how you play it correctly.
* **A long-hover box** — dwell on any card for 550 ms and the box comes to the cursor
  instead of making you look away from the board mid-battle. On a *dwell*, never a sweep;
  inert to pointer events, so it can never eat the click it is sitting on; and dropped on
  any re-render, because a floating box describing a unit that has since died is worse than
  no box.
* **The inspector** (right-click) — leads with the box, and gives every attribute on it a
  reminder-text row, the switched-off ones included. That is exactly when you go looking.

Cards not in play (hand, bin, cache, a token being explained) render the same markup from
`printedTextBox()`, so a card does not change shape as it hits the table.

## Known limits

* Static-vs-static suppression resolves in one pass (R62) — two mutual suppressors both keep
  radiating and both go quiet.
* The Everywhere SHIPPED (2026-08-23). Both halves it was parked on had already landed and
  the note above outlived them: *naming a card* is R91's `ctx.choose` with `DecisionOption.card`,
  and the CONTINUOUS silence is R62's `StaticMod.suppressAbilities`, whose `staticsFor` walk is
  already region-scoped — which is exactly what "(as long as I am in their region)" means. All
  that was actually missing was somewhere to keep the name: `Entity.named`, a string, because
  `budgets` is numeric-only. Read it through `E.nameOf()`, the single hook a future copy-NAME
  layer has to touch.
