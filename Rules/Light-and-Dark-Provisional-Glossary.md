# Algomancy: Light & Dark — provisional glossary

Terms introduced by the Light & Dark expansion (163 cards, two new elements).

**STATUS: PROVISIONAL / UNOFFICIAL.** As of 2026-08-19 there is no official
rulebook or errata for this expansion — the Manual PDF has not changed since
2024-05, and the community card database (algomancer.cc) hosts the card images
and stats but no rules text at all. Every definition below is sourced from one
of three places, named inline in the entry:

- **card text** — italic reminder text printed on the cards themselves. This is
  the strongest evidence available and is quoted verbatim.
- **designer (Discord)** — a message from Caleb Gannon in the Algomancy Discord,
  with its date.
- **community (Discord)** — a player's explanation that the designer did not
  contradict. Weakest; flagged as such.

Where the exact rule is not pinned down by any of those, the entry says so
rather than guessing. Replace this file when the official release ships.

Blessed: An attribute. Card text: "Damage dealt by a blessed source causes its
controller to gain that much life." So a blessed source both deals its damage
and lifegains its controller for the same amount. Per the designer (Discord,
2025-03-18) "blessed gain and damage happen on the same game state check" —
i.e. the life gain is simultaneous with the damage, not a separate trigger that
uses the stack. Cards: Blessed Thing, Flzzz, Godray, Hammer of Justice, Shib.

Afflicting: An attribute. Card text: "When an afflicting source kills one or
more units, those units' controllers gain a rot." Note it triggers once per
kill event regardless of how many units died, and the rot goes to the dead
units' controller, not to the afflicting player. Card: Umbral Decay.

Lethal: An attribute. Card text: "Any combat damage from a lethal unit will
kill a player." A player struck by any amount of combat damage from a lethal
unit loses the game outright, so blocking it is not optional in practice.
Card: Gublin.

Pure: An attribute. Card text: "Pure cards and cards they are interacting with
ignore all other attributes." Pure switches off the attribute layer entirely
for both sides of an interaction — a pure blocker ignores the attacker's
Flying, Deadly, Piercing and so on, and its own other attributes are ignored
too. Card: Just a Unit.

Modular: An attribute. Card text: "You can apply mods to a modular card from
your hand and/or bin as it is played. You still pay their costs." A modular
card can arrive already carrying augments/grafts, assembled at the moment it is
played, with each mod's cost paid as normal. Card: Spellbind.

Rot: A persistent harm that accumulates on a PLAYER (not on a unit). Rot deals
damage to the player who has it — established by card text on Skittering
Blight, which reads "If rot would deal damage to you, instead put that many
+1/+1 counters on me", so the damage dealt equals the amount of rot held. Rot
is not removed once gained: the designer (Discord, 2025-03-19), asked whether
rot and debt go away or keep accumulating, answered "Rot stays debt goes
[away]". Rot can substitute for combat damage to a player — Blightsea Polyp's
card text: "Columns deal combat damage to players as 1 rot. (For example, a
column of a 4/4 unit and 2/2 unit would give the opponent 1 rot, without
changing their life total.)" Rot's source is controlled by its holder: the
designer (Discord, 2024-08-20) said "Your rot is a source you control. But if
you give an opponent rot, that won't be a source you control damaging them."
UNCONFIRMED: the exact moment in the turn when rot deals its damage. No
designer statement or card text found pins this down; do not assert a timing.

Debt: An accumulating cost that is paid off with mana, unlike rot. The designer
(Discord, 2024-12-02) corrected a player's "instead of refreshing a resource
you must remove a debt counter" with: "Debt technically doesn't replace
refresh. It happens at the end of the resource step. The difference is you
can't activate mana after paying debt." So debt is paid at the END of the
resource step, and paying it is the last thing that happens there — you cannot
activate further mana afterwards. Debt is removed as it is paid; the designer
(Discord, 2025-03-19) contrasted it with rot: "Rot stays debt goes [away]."
Cards gain you debt as a cost or drawback (Debt Blep, Deferral Drone, Greed
Angel, Hyper Beam, Covenant of the Damned, Blurf, Glutton of Absolution, Reap
the Due).

Prophecy: An alternate cost printed on a second banner beneath the card's title
bar, in the form "Prophecy — <condition>" (e.g. "Two Turns Pass", "Your life is
5 or less", "13 Units Die", "One Battle Passes"). A card is first PROPHESIED —
paying the small prophecy cost shown on that banner — which caches it; once the
stated condition is later fulfilled, the card may be played from cache for
free. The designer (Discord, 2024-10-28) settled the wording as playing it
"without paying their cost", and (2024-09-22) confirmed the card "needs to be
prophecied beforehand". Community explanation (Discord, 2024-12-02, not
contradicted by the designer): "Some times either an alternate cost or card is
Prophesized by another effect. Then once the Prophecy is fulfilled the card can
be played for free at any time that you are able to play it." Effects can also
attach a prophecy to a card you do not own (Divine Foresight, Grob). Note the
designer (Discord, 2024-12-03) confirmed that a fulfilled prophecy also lets
you "graft or augment for free", but you cannot play a cached card generally —
"You can only play cached cards that allow you to play them (like glimpse)."

Cache / Cached: A neutral holding zone, separate from hand, bin, and deck,
where cards wait to be referenced later. The designer (Discord, 2024-02-25)
described it as "basically exile with the intent to be referenced later" and "a
neutral zone like the hand and bin". A cached card stays cached if unused —
repeatedly confirmed by the designer (2025-03-11, 2025-06-20, 2026-01-11), who
noted that for the base game this is "effectively erased from the game", adding
(2025-12-06) that cache was "left open with plans for the light element", which
is exactly what Prophecy and the Light cards now use it for. Crucially, being
in cache does NOT by itself let you play a card: "You can only play cached
cards that allow you to play them (like glimpse)" (designer, 2024-12-03). You
CAN augment or graft from cache (designer, 2024-12-02: asked "Can you
Augment/Graft from cache?", answered "Yes").

Glimpse: Reveal the top card of the deck and cache it; until end of turn you
may play it as if it were in your hand, ignoring affinity. Quoted from card
text (Visionary Construct): "(Reveal the top card of the deck and cache it.
Until end of turn, you may play it as if it was in your hand, ignoring
affinity.)" Glimpse predates this expansion but is central to it. The designer
confirmed glimpse ignores affinity (Discord, 2024-10-28: "glimpse ignores
affinity") but that you still pay the card's cost (2023-08-13: "you pay the
cost for glimpse cards"), and that glimpsed cards still obey timing
restrictions (2025-12-28).

Trash / Trashed: A new verb used by the Dark cards, distinct from discarding,
dying, or erasing. Many Dark cards trigger "When I am trashed" or "Whenever
another card is trashed" (Afflicting Anima, Blightwalker, Cerebrox, Cthyrian
Culler, Cthyrian Rector, Dropslime, Maw of Despair, Muck Rummager, and others).
UNCONFIRMED: no card carries reminder text defining what trashing is, and no
designer statement was found. Do not assert its precise definition or how it
differs from discard/erase until the official rules ship.

Wraith: A token created by several Dark cards (Cosmic Devourer, Legion of the
Depths, Plague Ritual, Primordial Coalescence, Afflicting Anima). Notably a
Wraith is AUGMENTED onto a unit rather than placed as a standalone unit —
Plague Ritual: "Each player discards a card, gains a rot and Augments a Wraith
on one of their units"; Xzydris: "At the start of deployment you may Augment a
Wraith onto a unit to recall me from your bin." UNCONFIRMED: the Wraith token's
own printed text and stats are not in the card data available.

Light: One of the two new elements. Its cost pip is a cream/white yin-yang
style ball. Light cards cluster around Prophecy, cache manipulation, glimpse,
life gain, the Blessed attribute, and debt as a cost for powerful effects. The
expansion adds 54 mono-Light cards, 54 mono-Dark, and 55 hybrids (including
Light/Dark).

Dark: The other new element. Its cost pip is a grey/charcoal yin-yang style
ball, easily confused with Light's at small sizes. Dark cards cluster around
rot, trashing, the bin, -1/-1 counters, sacrifice, and the Afflicting
attribute.

Playing a card vs applying a mod: Only UNITS and SPELLS are "played". Applying
a modification — attaching a Virus, a graft, or an augment, whether it comes
from hand, bin, or cache — is NOT playing a card, so abilities that trigger on
"when(ever) you play a unit/spell/card" do NOT trigger from a mod being
applied, including a mod applied from the bin. This distinction matters most
for the Light cards that care about playing cards. Supporting designer
statement (Discord, 2024-12-03), on whether a fulfilled prophecy lets you graft
or augment rather than play the card: "Oh, no you can't do that. You can only
play cached cards that allow you to play them (like glimpse). But yes you can
graft or augment for free if the prophecy is completed" — treating grafting and
augmenting as separate from playing. PROVISIONAL LOCAL ERRATA pending Caleb's
official Light & Dark rules update; see also digital-client/docs/digital-rules.md R37.
