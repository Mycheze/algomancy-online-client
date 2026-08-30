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
- **relayed ruling** — an official designer answer relayed into this repo by the
  repo owner, with its date. Treated as authoritative, but not quotable verbatim
  from an export the way the two above are.
- **community (Discord)** — a player's explanation that the designer did not
  contradict. Weakest; flagged as such.

Where the exact rule is not pinned down by any of those, the entry says so
rather than guessing. Several entries that were marked UNCONFIRMED in earlier
revisions (rot's timing, the definition of trashing, the Wraith token's text,
the exact debt payment) have since been sourced and are no longer hedged — they
are still provisional only in the sense that no rulebook has shipped. Note,
though, that a SOURCED entry can still go stale when the CARD ITSELF changes:
the Wraith token's text was sourced on 2026-08-19 from one printing and then
REDESIGNED, and the entry below now describes the newer physical card (supplied
by the repo owner, 2026-08-21). Two decisions were revised on 2026-08-21 — the
Wraith's stats and both of its triggers, and whether tokens can be trashed (they
can) — each dated inside its own entry. Replace this file when the official
release ships.

Blessed: An attribute. Card text: "Damage dealt by a blessed source causes its
controller to gain that much life." So a blessed source both deals its damage
and lifegains its controller for the same amount. The life gain is SIMULTANEOUS
with the damage, not a separate trigger that uses the stack: the designer
(Discord, 2024-09-15 and again 2025-03-18) said "blessed gain and damage happen
on the same game state check" and compared it to "lifelink in mtg". Because
both land on the same game-state check, the gain is applied BEFORE the lethal
check — so a blessed source cannot kill its own controller with its own damage,
even if that damage exceeds their life total. Cards: Blessed Thing, Flzzz,
Godray, Hammer of Justice, Shib.

Afflicting: An attribute. Card text: "When an afflicting source kills one or
more units, those units' controllers gain a rot." Note it triggers once per
kill event regardless of how many units died, and the rot goes to the dead
units' controller, not to the afflicting player. "Kills" is NOT limited to
damage — it also covers killing a unit with -1/-1 counters: the designer
(Discord, 2024-09-10) explained that "we check damage and stats of units that
were interacted with during spell resolutions". That matters because the only
afflicting card, Umbral Decay, kills purely by putting -1/-1 counters on units;
if afflicting were damage-only it would never trigger. Card: Umbral Decay.

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
TIMING: rot deals its damage AT THE START OF DEPLOYMENT. Card text on the Rot
Counter card in the designer's own $card bot library (posted to Discord,
2026-01-15): "At the start of deployment, you take damage equal to the number
of rot you have. Rot does not go away." So the damage is not a one-off on the
turn you gain the rot — every rot you hold hits you again at the start of every
deployment phase, for as long as you hold it (and you always hold it). Two
supporting designer statements: rot's damage lands in the same window as
regroup triggers (Discord, 2024-04-06), and there is no priority during
deployment (Discord, 2024-10-23) — so rot damage cannot be responded to.

Debt: An accumulating cost that is paid off with mana, unlike rot. The full
rule comes from the designer's Light-element announcement (Discord,
2024-09-10): "After the resources step, for each debt you have, you must pay 1
mana and the debt is removed. If you cannot pay for all of the debt, then only
what you can pay for is removed." So: 1 debt costs exactly 1 MANA (of any
element); paying is MANDATORY, not optional; PARTIAL payment is allowed if you
cannot cover it all, and each mana you spend clears one debt; and any debt you
could not pay simply STAYS and carries over to the next turn, to be charged
again. There is NO life loss, damage, or other penalty for failing to pay —
unpaid debt just remains as debt. The designer
(Discord, 2024-12-02) refined the timing, correcting a player's "instead of refreshing a resource
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
5 or less", "13 Units Die", "One Battle Passes"). The printed reminder text
defines it: "To prophecy, cache this card during deployment by paying its
prophecy cost. You may play it for free, as if it were in your hand, if the
prophecy has been fulfilled." So a card is first PROPHESIED — paying the small
prophecy cost shown on that banner — which caches it; once the stated condition
is later fulfilled, the card may be played from cache for free. Confirmed
details: prophesying is legal ONLY DURING THE DEPLOYMENT PHASE (card text
above; designer, Discord, 2025-05-09). Fulfilment counts FORWARD from the
moment you prophesy — it does not look backwards at conditions already met, so
you cannot prophesy a card whose condition is already satisfied and play it
immediately (designer, 2024-09-22: "It needs to be prophecied beforehand…
Same way that 'Four turns pass' can't just be played on turn 5"). In 1v1, BOTH
battles in a turn tick "One Battle Passes" (designer, 2024-09-24). Playing it
"for free" means without paying its cost AND IGNORING AFFINITY (designer,
2024-10-28 — he changed his mind mid-thread, and this was his final word);
2024-10-28 is also where he settled the wording as playing it "without paying
their cost". If a unit already in play is cached (by a prophecy effect or
otherwise), ITS MODS GO TO THE BIN rather than travelling with it into cache
(designer, 2024-09-15). Community explanation (Discord, 2024-12-02, not
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

Trash / Trashed: A verb used by the Dark cards, distinct from discarding as
such, and distinct from erasing. Definition, from printed reminder text: "A
nontoken card entering a bin from anywhere other than the stack is trashed."
(This reminder text is on Void Scavenger, a February-2025 playtest card that has
since been CUT from the set, so neither the card nor its wording appears in the
current print run — but it was the designer's own wording at the time.) The
designer confirmed it the same day (Discord, 2025-02-01): trashing is "basically
when a card enters your bin but wasn't played" — note that the designer's own
paraphrase carries NO "nontoken" qualifier. Scope, confirmed as an official
finding relayed by the repo owner (2026-08-19): DISCARDING, SACRIFICING,
MILLING, and a unit DYING IN COMBAT all count as trashing, because in each case
a card reaches a bin without coming off the stack. It does NOT include a spell
going to the bin after it resolves — that card comes FROM the stack, so
resolving (or negating) a spell is not trashing it. And it does not include
erasing, because an erased card never touches a bin at all: the designer
(Discord, 2025-12-06) described erased as permanently out of the game. A card is
trashed by the OWNER OF THE BIN it enters. TOKENS CAN BE TRASHED (relayed
ruling, 2026-08-21). This REVERSES the position earlier revisions of this file
took, which excluded tokens on the strength of the word "nontoken". The
reasoning behind the reversal: (a) both rulebooks state outright that "Tokens
are temporary CARDS" (Algomancy-Manual.txt:330; and
Algomancy-Rulebook-2023-07.txt:116), so in Algomancy a token IS a card — unlike
Magic, where "token" and "card" are disjoint categories, which is where the
instinct to exclude them came from; (b) the only surviving "nontoken" qualifier
is the reminder text of Void Scavenger, a card cut from the set, while the
designer's own paraphrase of trashing has no qualifier at all; and (c) a dying
token really does reach the bin — asked whether a token entering the bin counts,
the designer answered "yes, for the purposes of triggers" (Discord, 2025-03-12)
and, on the same point for the hand, "Technically it does enter your hand and
then gets erased immediately. So it would trigger any 'enters hand' stuff"
(Discord, 2025-06-15). The token touches the zone, fires whatever triggers off
that zone, and is only then erased. CONFLICT — recorded here because no other
source in this repo notes it: the printed Manual says a unit token leaving play
is "placed back into the token pile INSTEAD of the hand or bin"
(Algomancy-Manual.txt:361-362), which is flatly contradicted by those two 2025
designer rulings. Follow the rulings (a designer ruling that contradicts an
older rulebook means the game changed), but treat BOTH this conflict and the
token-trashing decision as PROVISIONAL: no official Light & Dark rulebook or
errata exists to settle either. Many Dark cards trigger on trashing: "When I am
trashed" or "Whenever another card is trashed" (Afflicting Anima, Blightwalker,
Cerebrox, Cthyrian Culler, Cthyrian Rector, Dropslime, Maw of Despair, Muck
Rummager, and others).

Wraith: A token created by several Dark cards (Cosmic Devourer, Legion of the
Depths, Plague Ritual, Primordial Coalescence, Afflicting Anima). The token was
RENAMED — it used to be called a WIGHT — and then REDESIGNED. Current card text,
read off the physical token card supplied by the repo owner (2026-08-21): "Wraith
— 0 mana, 3/3, Blight Zombie Token Unit. [Augment] At the start of deployment,
put a -1/-1 counter on an ally. When I die, Augment a Wraith onto an ally." The
printed token card carries the CURRENT name; the retired name now survives on
exactly one card's own text, Blight's End ("Augment a Wight onto X target
units"), which is why the Wight entry below is kept as a cross-reference. NOTE
that earlier revisions of this file recorded a different card — a 4/4 reading
"When I attack or block, put a -1/-1 counter on me. When I die, augment me onto
target ally." That was a real printing, sourced on 2026-08-19, but it has been
SUPERSEDED and every line of it is now wrong: the stats, the trigger condition,
and what each trigger does. So a Wraith is a real 3/3 BODY, not merely a mod — a
0-cost 3/3 Blight Zombie token unit that carries the [Augment] symbol. Three
points on how its text works, all relayed rulings (2026-08-21): (1) BOTH lines
are live on a Wraith standing in play as a unit — a card's own [Augment] text is
live while the card is itself a unit, it is not dormant text that only switches
on once the card is attached to a host. (2) The first trigger points OUTWARD and
is a DEPLOYMENT-phase effect, not a combat one: at the start of deployment its
controller puts a -1/-1 counter on an ally. The Wraith no longer shrinks itself
by fighting, and it does not wear down as it attacks and blocks — the old
reading of this entry. (3) The death trigger does NOT move the dying Wraith. The
dying Wraith is erased like any other token; the trigger MINTS A NEW Wraith and
attaches it as an augment on an ally. It is a fresh token, not a relocation, so
nothing about the dying body (counters, mods, damage) carries across. In both
triggers "an ally" is NOT a target: it is chosen on resolution, so the choice
cannot be redirected by anything that redirects targets, and the trigger cannot
fizzle for want of a legal target. UNCONFIRMED: whether the Wraith may choose
ITSELF as the "ally" for its deployment trigger is not settled by any source
here. Because it carries the [Augment] symbol it can equally be created directly
as an augment on a unit, which is how most cards use it — Plague Ritual: "Each
player discards a card, gains a rot and Augments a Wraith on one of their
units"; Xzydris: "At the start of deployment you may Augment a Wraith onto a
unit to recall me from your bin."

Wight: The former name of the Wraith token — Wight and Wraith are the same
token, renamed. The printed token card now carries the NEW name; the retired
name survives in the printed text of exactly one card, Blight's End ("Augment a
Wight onto X target units"), which is quoted verbatim because that is what the
card says. Any card or ability naming a Wight creates the Wraith token, whose
current printed card reads: "Wraith — 0 mana, 3/3, Blight Zombie Token Unit.
[Augment] At the start of deployment, put a -1/-1 counter on an ally. When I
die, Augment a Wraith onto an ally." (Physical card supplied by the repo owner,
2026-08-21.) Earlier revisions of this file recorded a 4/4 with a
shrink-on-combat trigger under the title "Wight"; that printing is superseded. See the
Wraith entry for the full explanation.

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
official Light & Dark rules update; see also client/docs/digital-rules.md R37.
