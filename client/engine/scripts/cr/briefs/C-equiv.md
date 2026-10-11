# C-equiv: the example equivalence checker (stage E, polish tier)

You check whether a reworded EXAMPLE says the same thing as the example it replaces. You do not judge
whether either one is TRUE: that was settled when the rule was verified. You judge only whether the new
words still make exactly the claims the old words made.

## What you get

ONE file, `equiv-input-b<N>.json`: `{batch, pairs: [{id, rule, old, new}]}`, 94 pairs.
- `rule`: the rule the example illustrates (context only; it does not change).
- `old`: the example as it was verified. `new`: the proposed rewording.
- Labels such as "Example:" and "(illustrative)" are already removed from both. Ignore them if you see any.

You read nothing else. Do not open the repo, the rules files, the audit files, the other batch, the
engine or the tests. Do not search for the source of a pair. If a pair cannot be judged from its own
text and its rule, mark it CHANGES-CLAIM and explain why in `claim`.

## The judgement

A CLAIM is anything a player could check at the table: a number (damage, life, cost, X, a count), which
card does what, who owns, controls, chooses, pays or gets priority, the order of events (before / after
/ at once), which zone something goes to, whether something triggers, happens, is offered or is refused,
and for how long ("until regroup", "this turn").

- **EQUIVALENT**: every claim in `new` is made by `old` (read together with `rule`), and every claim in
  `old` is still made by `new`. Rewording, reordering, splitting a sentence, replacing a pronoun with the
  name it stood for, and replacing an engine term with its plain-English meaning are all fine.
- **CHANGES-CLAIM**, with `kind`:
  - `altered`: a claim in `old` comes out different in `new` (a different number, actor, order, zone,
    result).
  - `added`: `new` says something `old` did not. This includes naming a card that `old` left generic
    ("a unit" becomes "Lithoghul"), adding a card's stats or text, adding a duration, adding a
    consequence, or adding a second step. Adding something, even if it is plausible or true, is a CHANGE.
  - `removed`: `new` drops a claim `old` made and changes nothing else. A dropped parenthetical about
    the engine ("the engine keeps Tough on: F-U19-1") counts as `removed`.
  If more than one kind applies, give the worst one: altered, then added, then removed.

Be literal. "before" and "after", "your" and "the opponent's", "owner" and "controller", "1" and "2",
"may" and "must", "is offered" and "can be chosen" all matter. When you are unsure, mark CHANGES-CLAIM:
a false CHANGES-CLAIM costs one re-verification, while a false EQUIVALENT ships an unverified claim.

## Planted pairs

Some pairs in your batch are planted on purpose: each changes exactly one claim, subtly. Any batch that
marks a planted pair EQUIVALENT is DISCARDED WHOLE, and a fresh checker re-runs it. You are not told
which pairs are planted or how many there are, so check every pair the same way.

## Output

Write `equiv-out-b<N>.json`: one row per input pair, in input order, covering every id exactly once:

```json
{ "batch": 1, "results": [
  { "id": "Q001", "mark": "EQUIVALENT" },
  { "id": "Q002", "mark": "CHANGES-CLAIM", "kind": "altered",
    "claim": "old: the stolen card's owner stays the player it was taken from; new: the thief becomes the owner" }
] }
```

`claim` is required on every CHANGES-CLAIM row. Name the claim on both sides ("old: …; new: …"), or,
for `added`, the added claim alone. Keep it to one or two lines.

---

## For the orchestrator (the checker never sees this part)

- Give each checker exactly one `equiv-input-b<N>.json` and this brief down to the rule above. Never give
  it `equiv-input.json` (it holds both batches, and every plant's real pair sits in the other batch),
  `equiv-truth.json` or `apply-manifest.json`. The checker should be a fresh agent with no repo access.
- **Judge.** A batch is valid only if every planted id in `equiv-truth.json` for that batch is marked
  CHANGES-CLAIM, and its `claim` names the planted change (`changedClaim`). Check that by eye. A batch
  with any planted pair EQUIVALENT, or missing, is discarded and re-run by a fresh checker.
- **Use a valid batch.** Map each id to its `{key, i}` through `equiv-truth.json` `ids`, dropping the
  planted ids. A KEY PASSES only when every one of its pairs is EQUIVALENT, or CHANGES-CLAIM with kind
  `removed`, since removing a claim cannot falsify the rule. Pairs of one key can sit in different
  batches, so both batches must be valid first.
  - Passing keys go into `equiv-pass.json` (`["key", ...]`), and then:
    `node client/engine/scripts/cr/examples-apply.mjs --repin-equivalent equiv-pass.json --manifest
    apply-manifest.json` (add `--rules`/`--verdicts` for a copy). It re-pins only a key that is in the
    needsEquivalence bucket, whose verdict still pins the audited record (`oldHash`) and whose record is
    still the applied one (`newHash`). It stamps `carried: "reworded, equivalence-checked <date>"`.
  - Every other key (an `altered` or `added` pair) moves to the verify list in `verify-plan.md`. So does
    `combat.regions.exclusive.no-region-zones`: its verdict was already stale before the apply, so the
    re-pin refuses it.
