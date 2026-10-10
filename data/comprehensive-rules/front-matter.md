## Introduction

**This document is UNOFFICIAL.** It describes this digital client's
implementation of Algomancy, not Caleb Gannon's game. Where it and the
published Manual disagree, the Manual is the game and this document is our
client. The card text and rules text it quotes are Caleb Gannon's, used with
permission on the terms in `data/NOTICE.md`.

Edition: {{EDITION}}. Effective {{EFFECTIVE}}. Engine at commit {{ENGINE_COMMIT}}.

### How to read a rule

Every rule carries its provenance: the sources that state it. In the HTML
edition it is folded under the rule; in this edition it is the small line
beneath it. Each rule also carries a **basis**, the strongest kind of source
that actually states it. A {chip:printed} rule is stated by the Manual, the
2023 Rulebook or a card's printed text, read literally; a {chip:designer} rule
by Caleb Gannon's own answer in the rules-questions threads; a {chip:mixed}
rule by more than one kind of source together. An {chip:owner} rule is a
ruling by this project's owner, with no designer source: it is the client's
law, and it may not be the game's. An {chip:engine} rule is stated by no
source; it is what the engine does, and it is listed in Annex P to await the
owner's sign-off.

Our own glossary is quoted where it helps, and is never counted as a source.

Where a ruling and the engine disagree, the rule states the ruling and says
"engine differs", with a link to the finding. The engine is the one that is
wrong, and the finding is filed as a bug.

Each rule also shows what an independent verifier found when it checked the
rule against the engine and its tests: {chip:confirmed}, or {chip:partial}
when it could not confirm all of it, with the verifier's note beneath. Beside
the verdict are the round it was verified in, how many tests the verifier ran,
and how many gate test files are bound to the rule through its examples or its
sources. A gate test is part of the client's test suite and runs on every
check, so it keeps demonstrating the rule after verification is over. A rule
that no executed test demonstrates is marked {chip:untested}.

### Examples are not rules

An example illustrates the rule above it. It is never a rule in its own
right, and where it seems to say more than the rule, the rule wins. Most
examples are bound to a test that was run and asserts them.

### How numbering works

Rules are numbered in three levels: section 608, rule 608.2, subrule 608.2b.
Subrule letters skip l and o. A number, once published, never moves and is
never reused. A new rule goes to the end of its section, even when it would
read better earlier. A removed rule keeps its number and reads
"[Removed: …]". Section 802 has one rule per attribute, in the engine's own
order.
