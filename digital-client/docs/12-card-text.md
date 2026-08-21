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
`test/57-ui-cardtext.test.ts`. `ui/main.ts` renders it with `textBoxHtml()`.

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
| `note` | the one per-ability fact: a bounded `[Switch1]` whose budget is spent this turn |

Plus: every attribute with **where it comes from** (printed / from a mod / projected / until
regroup / **shared by the column**, which is the single most-missed thing on a board), the
stat arithmetic term by term, and a banner naming whatever has switched a half off.

A clause that is present but doing nothing is **struck through, not hidden**. "It says Flying
and Flying is off" is two facts and a player needs both.

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
* The Everywhere is still parked: its suppression half is now trivial, but *naming a card* is
  a decision primitive the engine does not have.
