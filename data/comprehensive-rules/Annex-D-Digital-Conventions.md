# Annex D — Digital Play Conventions

*Algomancy Comprehensive Rules. Unofficial. Generated from this project's digital client.*

## Precedence

These are the conventions of this digital client: how it times, shows and confirms the game, where a table of players would simply agree. They are not rules of Algomancy. Where a convention here and a rule in the main document both speak to the game itself, the main document governs. Where they concern only how the client presents, times or confirms play, this annex governs.

<a id="rD1"></a>
### D1. General and Precedence

<a id="rD1.1"></a>**D1.1.** The pacing and concurrency conventions in this annex are not rules changes: none of them changes what is legal. See rules D3, D3.3, D3.4b.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: partial in round 3; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.not-rules — the pacing conventions change no legality: a standing pass, a playback hold and full control leave the offered actions equal to the engine, and an action offered during the opponent decision is legal by the engine once it closes · Key: annexd.general.not-rules</sub>

<sub>Discrepancies: D-U23-20 (discrepancies.md)</sub>

<a id="rD1.1a"></a>**D1.1a** A warning or a confirmation never removes a legal option. Where a choice looks like a misclick, the client may ask the player; it does not refuse the choice. See rule D2.8.

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; no gate test · Key: annexd.general.not-rules.warn-not-refuse</sub>

<a id="rD1.2"></a>**D1.2.** The client never makes a choice that belongs to a player. A real choice is always put to the player who makes it.

<sub>Basis: Owner ruling, adopted 2026-08-24 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides — every action answered for a player is the only move either seat has, so no real choice is ever taken · Key: annexd.general.player-decides</sub>

<a id="rD1.2a"></a>**D1.2a** An option the rules would refuse is not offered. The client shows only legal options; it does not show an option and then refuse it. See rule D1.3.

<sub>Basis: Owner ruling, adopted 2026-08-24 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.unoffered — every option the engine offers is accepted when taken; none is shown and then refused · Key: annexd.general.player-decides.unoffered</sub>

<a id="rD1.2b"></a>**D1.2b** The game takes an action for a player only where the battle leaves them nothing to decide: an attacker with no unit able to attack has the empty attack declared for them; a lone counterattacker has its one-unit formation declared, its sent spell tokens riding (see rule D1.2c); and a defender with no unit in the battle region, or facing an attack with no attacking unit left and unable to send a counterattacker, has the empty block declared for them. These forced actions are logged like any other. A player holding full control is not forced: the window is left to them. See rules 610, D1.2c, D1.2f, D1.2e, D2.7.

> *Example: In round 2 the lone counterattacker is destroyed before blocks: the initiative player's empty block is declared for them, though they have a unit in the region.*

<sub>Basis: Mixed · Verified: confirmed in round 4; verifier ran 7 tests, all passed; 4 gate test files · Owner call · adopted 2026-10-16; Owner ruling, adopted 2026-08-18, 2026-09-01 (quoted from the retired ruling register) · Engine: apply.ts:forcedAction · Tests: 21-fixes.test.ts, 273-full-control-both-seats.test.ts, 434-cr-digital-1.test.ts, 479-empty-attack-and-committed-counterattack.test.ts · Example test: 479-empty-attack-and-committed-counterattack.test.ts::CT-297 an emptied counterattack in round 2 leaves the defender nothing to declare · Demonstrated by tests: 21-fixes.test.ts::a whole empty-board battle drains through forced actions to deployment, 21-fixes.test.ts::forcedAction is null whenever a real choice exists, 273-full-control-both-seats.test.ts::BL-18 §2 with full control ON the drain stops and the player is left the window · Key: annexd.general.player-decides.forced</sub>

<sub>Discrepancies: D-U23-21 (discrepancies.md)</sub>

<a id="rD1.2c"></a>**D1.2c** In round 2, a counterattack pool that holds exactly one unit able to attack declares the one-unit formation by itself, with every spell token sent with it riding along: the unit and its tokens must attack, and one unit has only one shape. See rule 610.

> *Example: A player who sent one unit to counterattack, and no spell token, is not asked to form it: the one-unit formation is declared for them.*

> *Example: A unit sent with a spell token is formed for the player with the token riding, and a formation that drops the token is refused.*

<sub>Basis: Owner call · adopted 2026-10-16; Owner ruling, adopted 2026-08-18 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 3 gate test files · Engine: apply.ts:forcedAction · Tests: 434-cr-digital-1.test.ts, 32-cast-costs.test.ts, 479-empty-attack-and-committed-counterattack.test.ts · Example tests: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.forced.lone-counterattacker — a lone sent counterattacker with no token is formed for the player, 479-empty-attack-and-committed-counterattack.test.ts::CT-251 a lone counterattacker with a sent token is formed with the token riding and cannot drop it · Key: annexd.general.player-decides.forced.lone-counterattacker</sub>

<sub>Discrepancies: D-U13-3 (discrepancies.md)</sub>

<a id="rD1.2d"></a>**D1.2d** When all of one player's simultaneously queued triggers are identical (the same card, the same ability and the same composed parts), the player is not asked to order them. They go on in the order they fired. Triggers from different cards or abilities, or composites whose parts differ, are still ordered by the player. See rule 706.

> *Example: Three allies spawn at once beside Flourishing Flora: its three identical triggers go on the stack without the player being asked to order them.*

<sub>Basis: Owner ruling, adopted 2026-08-18 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 3 tests (a probe it wrote), all passed; no gate test · Key: annexd.general.player-decides.identical-triggers</sub>

<a id="rD1.2e"></a>**D1.2e** A non-target choice that an ability makes as it begins to resolve (such as the ally a Wraith's start-of-deployment trigger chooses) is recorded without asking when there is only one candidate. With two or more candidates the player is asked. See rules 507, 706.

> *Example: A lone Wraith aims at its only ally without asking; with a second ally the player is asked.*

<sub>Basis: Owner call · adopted 2026-10-16; Owner ruling, adopted 2026-08-24 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 2 tests, all passed; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Example test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.one-subject — a lone Wraith aims at its only ally without asking; with a second ally the player is asked · Key: annexd.general.player-decides.one-subject</sub>

<a id="rD1.2f"></a>**D1.2f** A target is asked for even when exactly one candidate is legal. A forced target is still a click. See rule 110.

> *Example: Divine Foresight ("target opponent") cast in battle still asks its caster to choose the target, though the opponent is the only choice.*

<sub>Basis: Owner ruling, adopted 2026-08-21 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Example test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.forced-target — a target with exactly one legal candidate is still a decision put to the caster · Key: annexd.general.player-decides.forced-target</sub>

<a id="rD1.2g"></a>**D1.2g** Where a choice has a usual answer, the client may offer it as the first option, but it never picks it. The elective combat-damage split leads with "default — share front-to-back", and no automatic action answers that question. See rule 608.

<sub>Basis: Owner ruling, adopted 2026-08-24 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.default-first — the elective damage split leads with the default share, and nothing picks it for the player · Key: annexd.general.player-decides.default-first</sub>

<a id="rD1.2h"></a>**D1.2h** The caster always chooses the order of a Burst group, one token at a time; the client offers no automatic order. A lone token is not asked to be ordered. See rule 803.

<sub>Basis: Owner ruling, adopted 2026-10-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 358-burst-order.test.ts · Demonstrated by test: 358-burst-order.test.ts::CR 803.5d: a lone token is not asked to be ordered · Key: annexd.general.player-decides.burst-order</sub>

<a id="rD1.2i"></a>**D1.2i** When a player chooses the order of replacement effects (see rule 708.4a), each choice is the unit whose effect it is: the player answers by clicking that unit on the board, the choices are not also buttons in the prompt bar, and the prompt says what is being chosen. A question raised by combat damage or by rot is asked before any of that damage or rot is dealt. The other player sees that a question is open, but not the question; while the rot question is open at the start of deployment, the other player cannot deploy.

> *Example: Two Oorblaks: the prompt asks which Oorblak takes the damage first, and clicking the second Oorblak chooses it.*

> *Example: The attacker sees that the defender is being asked, but not the question.*

> *Example: Two Skittering Blights at the start of deployment: the rot question is answered on the board, and the other player can deploy only once it is answered.*

> *Example: A Poisonous blocker and two Counter Thieves: the question comes before any of the combat damage is dealt.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 5 tests, all passed; 3 gate test files · Tests: 473-replacement-order-on-the-board.test.ts, 471-oorblak-order-and-polyp.test.ts, 472-counter-thief-and-rot-order.test.ts · Example tests: 473-replacement-order-on-the-board.test.ts::two Oorblaks: the question is drawn on the board, says what it asks, and a click on an Oorblak answers it, 473-replacement-order-on-the-board.test.ts::two Oorblaks: the attacker sees that a question is open, and not the question, 473-replacement-order-on-the-board.test.ts::two Skittering Blights at the rot step: drawn on the board, and the other player waits, 472-counter-thief-and-rot-order.test.ts::CR 708.4a: Poisonous combat damage and two Counter Thieves — asked before the damage · Key: annexd.general.player-decides.replacement-order</sub>

<a id="rD1.3"></a>**D1.3.** The client holds no opinion of its own about legality. Wherever the client decides something the engine also decides, the client's answer is derived from the engine's, in one place. *(Untested: no executed test demonstrates it.)*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; no gate test · Key: annexd.general.one-opinion</sub>

<a id="rD1.3a"></a>**D1.3a** A highlighted card, a clickable unit, a drop target or a one-click shortcut claims that the engine will take the action. The client draws one only where the engine would accept it.

> *Example: A unit that cannot be sent to counterattack is not highlighted, and clicking it does nothing.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 223-client-legality.test.ts · Example test: 223-client-legality.test.ts::[127] a unit the engine would refuse is not ringed and does not pick up on a click · Key: annexd.general.one-opinion.affordances</sub>

<a id="rD1.4"></a>**D1.4.** A hidden simultaneous segment is a part of the turn in which both players act at once and neither sees what the other does until both are done. The resource step, the haste step and deployment are hidden simultaneous segments. See rules 501, 504, 507, D6.

<sub>Basis: Owner ruling, adopted 2026-08-18, 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment — the resource step, the haste step and deployment are hidden simultaneous segments; battle is not · Key: annexd.general.hidden-segment</sub>

<a id="rD1.4a"></a>**D1.4a** The hiding is done by the server's view of the game, the same way hands are hidden. The rules engine itself hides nothing.

<sub>Basis: Owner ruling, adopted 2026-08-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.redaction — the engine state holds the hidden play; only the server per-seat view leaves it out · Key: annexd.general.hidden-segment.redaction</sub>

<a id="rD1.4b"></a>**D1.4b** A segment ends at a barrier, when every player is done. At the barrier each player is shown what the other did, in the recap. See rules D5, D6.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.barrier — the step ends only when every player is done, and then each is played back what the other did · Key: annexd.general.hidden-segment.barrier</sub>

<a id="rD1.4c"></a>**D1.4c** Battle is not a hidden segment. Nothing that happens in battle is held back from either player.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.battle-open — in battle nothing is held: a cast is on the opponent view and in their events at once · Key: annexd.general.hidden-segment.battle-open</sub>

<a id="rD1.5"></a>**D1.5.** Where the printed rules have the initiative player take the resource step and the haste step first, and the initiative team deploy first (rules 501.4 and rule 507.3), this client runs those steps for both players at once, each hidden from the other (rule D1.4). The non-initiative player neither waits for the initiative player nor sees what they did before acting. This is a house rule of the client. See rules 501, 507, D1.4.

> *Example: The non-initiative player is offered plays at once in deployment, and can finish deploying while the initiative player is still acting.*

<sub>Basis: Owner call · adopted 2026-10-22; Owner ruling, adopted 2026-10-11 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 1 test, passed; 1 gate test file · Tests: 21-fixes.test.ts · Example test: 21-fixes.test.ts::both seats deploy at once: NIT may act and finish before IT · Key: annexd.general.initiative-order</sub>

<a id="rD1.6"></a>**D1.6.** In a draft, a player who has made their pick may begin the resource step, activating and recycling, while the other player is still drafting. The printed turn ends each step for every player together (rule 501.4a); this client does not hold the faster player back, because the resource step is hidden and the other player cannot see the head start. See rules 501.4a, D1.4.

> *Example: A player who has committed their draft pick may activate a resource while the opponent is still drafting.*

<sub>Basis: Owner call · adopted 2026-10-22 · Verified: confirmed in round 4; verifier ran 2 tests (a probe it wrote), all passed; 1 gate test file · Tests: 20-draft.test.ts · Example test: 20-draft.test.ts::planning is gated until you commit; open again after (opponent still drafting) · Key: annexd.general.early-resource-step</sub>

<a id="rD2"></a>
### D2. Priority and Auto-Pass

<a id="rD2.1"></a>**D2.1.** While a decision is open for a player (a question the game is waiting on them to answer), that player must answer it, or concede, before taking any other action. See rule 104.4a.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 130-seat-aware-gate.test.ts · Demonstrated by test: 130-seat-aware-gate.test.ts::CR D2.1: your own question still gates your own input · Key: annexd.auto-pass.open-decision</sub>

<a id="rD2.1a"></a>**D2.1a** In battle, a decision open for one player stops the other player too: nobody may act until it is answered. See rule 703.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 130-seat-aware-gate.test.ts · Demonstrated by test: 130-seat-aware-gate.test.ts::CR D2.1a: a REAL battle decision blocks the other seat · Key: annexd.auto-pass.open-decision.battle</sub>

<a id="rD2.1b"></a>**D2.1b** Inside a hidden simultaneous segment, a decision open for one player does not stop the other player, who keeps every action they had, except as described in the next sub-rule. See rule D1.4.

> *Example: While one player answers their Wraith triggers at the start of deployment, the other player goes on deploying.*

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 130-seat-aware-gate.test.ts · Example test: 130-seat-aware-gate.test.ts::CR D2.1b: every kind of action seat 0 had is still theirs · Key: annexd.auto-pass.open-decision.segment</sub>

<a id="rD2.1c"></a>**D2.1c** Exception: when answering the open decision would rewind the game to before the other player acted (a resolution that stopped halfway), the other player is stopped as in battle. Online, an action they send meanwhile waits and is applied when the decision closes; they are told it is waiting, not that it is illegal.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 130-seat-aware-gate.test.ts · Demonstrated by test: 130-seat-aware-gate.test.ts::CR D2.1c: a mid-resolution suspension still blocks the other seat · Key: annexd.auto-pass.open-decision.rewind</sub>

<a id="rD2.1d"></a>**D2.1d** Only one decision can be open at a time. An action that would change what the other player's open decision reads when it is answered is refused, and the game stays as it was before the action.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 2 gate test files · Tests: 130-seat-aware-gate.test.ts, 144-both-seats-decision-gate.test.ts · Demonstrated by test: 130-seat-aware-gate.test.ts::CR D2.1d: seat 0 may not overwrite seat 1's open decision · Key: annexd.auto-pass.open-decision.no-disturb</sub>

<a id="rD2.1e"></a>**D2.1e** Conceding is never blocked by an open decision, whichever player it belongs to. See rule 104.4a.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 130-seat-aware-gate.test.ts · Demonstrated by test: 130-seat-aware-gate.test.ts::CR D2.1e: concede is always reachable, from either seat · Key: annexd.auto-pass.open-decision.concede</sub>

<a id="rD2.1f"></a>**D2.1f** Each player's screen shows only that player's own open question: the other player's question and its options are never sent to it. The player being asked has only the question.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 3 tests (a probe it wrote), all passed; no gate test · Key: annexd.auto-pass.open-decision.both-seats</sub>

<a id="rD2.2"></a>**D2.2.** When a player holds priority, the client offers up to three ways to pass: Pass, Pass through stack and Pass all. Pass through stack and Pass all are standing passes: promises the client keeps on the player's behalf in later windows. See rule 703.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons</sub>

<sub>Discrepancies: D-U23-14 (discrepancies.md)</sub>

<a id="rD2.2a"></a>**D2.2a** Pass passes priority once. It sets up nothing for later windows.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.pass-buttons.pass — Pass sends one pass and arms nothing: the next window the seat holds is left to them · Key: annexd.auto-pass.pass-buttons.pass</sub>

<a id="rD2.2b"></a>**D2.2b** Pass through stack passes for the player until the stack items that were there when it was clicked have resolved, and then ends. It hands priority back sooner if a stack item outside that set appears, or if the player is offered an option they did not have when they clicked.

> *Example: A player clicks Pass through stack; the opponent answers with a new spell, so priority comes back to the player.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Example test: 230-pass-modes.test.ts::[123] a stack item outside the armed scope hands priority back · Demonstrated by test: 230-pass-modes.test.ts::[123] pass through stack finishes when the stack it was armed on has resolved · Key: annexd.auto-pass.pass-buttons.through-stack</sub>

<a id="rD2.2c"></a>**D2.2c** Pass through stack is offered only while there is a stack to pass through.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Demonstrated by test: 230-pass-modes.test.ts::[123] the battle bar offers pass through stack only while there is a stack · Key: annexd.auto-pass.pass-buttons.through-stack.offered</sub>

<a id="rD2.2d"></a>**D2.2d** Pass all passes for the player until the phase it was clicked in ends. A new stack item or a new option does not hand priority back.

> *Example: The opponent casting a spell does not stop Pass all.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Example test: 230-pass-modes.test.ts::[123] pass all does not hand priority back for a new item or a new option · Key: annexd.auto-pass.pass-buttons.all</sub>

<a id="rD2.2e"></a>**D2.2e** Both standing passes still stop before the one pass that would end the battle phase while the player holds spell tokens they could cast, so that that pass is the player's own click. See rules D2.6, 506.

> *Example: A player clicks Pass all while holding a castable Fireball token: it passes through the battle but hands back the last pass, the one that would end the battle phase.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 230-pass-modes.test.ts, 77-playtest-round17.test.ts · Example test: 230-pass-modes.test.ts::[123] pass all still stops on the one pass that would erase castable spell tokens · Key: annexd.auto-pass.pass-buttons.token-stop</sub>

<a id="rD2.2f"></a>**D2.2f** What counts as new for a standing pass is measured against the moment it was clicked. An option the player already had then is not new when it comes back later.

> *Example: An activated ability the player could use when they clicked Pass all becomes unusable for a window and then usable again: the pass does not stop for it.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Example test: 230-pass-modes.test.ts::[123] an option that was on offer at the arm is not news several windows later · Key: annexd.auto-pass.pass-buttons.baseline</sub>

<a id="rD2.2g"></a>**D2.2g** A standing pass is set up only by a click and can be cancelled at any time: one stop control drops whichever is running. The client shows which promise is running and how it ends.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 230-pass-modes.test.ts · Demonstrated by test: 230-pass-modes.test.ts::[123] each pass button arms a chip that names its own promise, and one stop drops it · Key: annexd.auto-pass.pass-buttons.revocable</sub>

<a id="rD2.3"></a>**D2.3.** A player may turn on auto-pass. With it on, the client passes priority for the player only in a window where passing is the only thing they could do. Auto-pass never passes through an open decision.

> *Example: With a castable card in hand the window is put to the player even with auto-pass on.*

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 70-playtest-round15.test.ts · Example test: 70-playtest-round15.test.ts::[59] the C4 toggle passes only when passing is the ONLY thing I could do · Demonstrated by test: 70-playtest-round15.test.ts::[59] a pending decision is never passed through, by any of the three · Key: annexd.auto-pass.preference</sub>

<sub>Discrepancies: D-U23-9 (discrepancies.md)</sub>

<a id="rD2.4"></a>**D2.4.** An answer the client sends without a click (an automatic pass, or the automatic haste-step ready) is sent once for each time it is owed. It is latched by being unanswered, not by counting game updates, so updates that arrive while it is outstanding do not send it again. Engine differs, see F-U23-2. *(Engine differs, see F-U23-2.)*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 223-client-legality.test.ts, 70-playtest-round15.test.ts · Demonstrated by test: 223-client-legality.test.ts::[122] one automatic doneHaste per unanswered send, however many states arrive · Key: annexd.auto-pass.automatic-answers</sub>

<sub>Discrepancies: D-U23-13, D-U23-6 (discrepancies.md)</sub>

<a id="rD2.4a"></a>**D2.4a** If the server refuses an action the client sent on its own, the refusal is not shown as the player's error. It goes to the log and to a plain notice that says the client sent it.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 223-client-legality.test.ts · Demonstrated by test: 223-client-legality.test.ts::[122] a refusal of an action the CLIENT chose to send is not the player refusal · Key: annexd.auto-pass.automatic-answers.refusal</sub>

<a id="rD2.5"></a>**D2.5.** When the haste step opens and the only legal action a player has in it is to finish the step, the client finishes it for them at once, unless they have turned on bluff haste. See rules 504.5, 504.5a.

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 205-haste-auto-ready.test.ts · Demonstrated by test: 205-haste-auto-ready.test.ts::CR D2.5: with the preference OFF and nothing hasteable, the client sends doneHaste by itself · Key: annexd.auto-pass.haste-ready</sub>

<sub>Discrepancies: D-U23-12, D-U23-15 (discrepancies.md)</sub>

<a id="rD2.5a"></a>**D2.5a** If the player has any legal play in the haste step, the client never finishes the step for them.

> *Example: A playable haste card in hand keeps the player in the step, bluff haste on or off.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 205-haste-auto-ready.test.ts · Example test: 205-haste-auto-ready.test.ts::CR D2.5a: with something playable the client never answers, preference or not · Key: annexd.auto-pass.haste-ready.any-play</sub>

<a id="rD2.5b"></a>**D2.5b** Bluff haste is a preference, off by default and remembered by the browser. With it on, the client never finishes the haste step for the player; they stay in the step until they finish it themselves, whether or not they hold anything to play. See rule 504.5a.

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 205-haste-auto-ready.test.ts, 200-haste-step-is-unconditional.test.ts · Demonstrated by test: 205-haste-auto-ready.test.ts::CR D2.5b: with the preference ON the client sits in the step and offers the button · Key: annexd.auto-pass.haste-ready.bluff</sub>

<a id="rD2.5c"></a>**D2.5c** The server never finishes the haste step for a player. The automatic ready, when there is one, comes from the player's own client. See rule 504.5a.

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 200-haste-step-is-unconditional.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 200-haste-step-is-unconditional.test.ts::CR 504.5a: no seat is auto-done, and BOTH have to close the step · Key: annexd.auto-pass.haste-ready.server-never</sub>

<a id="rD2.5d"></a>**D2.5d** While the haste step is open, neither player is shown whether the other has finished it. Each player sees their own readiness, and the end of the step is shown to both.

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 205-haste-auto-ready.test.ts · Demonstrated by tests: 205-haste-auto-ready.test.ts::CR D2.5d: the opponent is not served my haste readiness while the step is open, 205-haste-auto-ready.test.ts::CR D2.5d: the step's END is still public · Key: annexd.auto-pass.haste-ready.readiness-hidden</sub>

<a id="rD2.5e"></a>**D2.5e** The game's action counter is still sent to both players and rises on every action, in every hidden segment, so a modified client can tell that its opponent acted and when. The shipped client shows nothing from it. See rule D1.4.

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 205-haste-auto-ready.test.ts · Demonstrated by test: 205-haste-auto-ready.test.ts::CR D2.5e: the residual, named and measured · Key: annexd.auto-pass.haste-ready.residual</sub>

<sub>Discrepancies: D-U23-5 (discrepancies.md)</sub>

<a id="rD2.6"></a>**D2.6.** When passing would end the battle phase while the player still holds spell tokens they could cast, the client asks before sending the pass, because moving to regroup erases them. It asks on that pass only, not in the battle's other windows. See rule 506.

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 77-playtest-round17.test.ts, 165-token-loss-warning.test.ts · Demonstrated by test: 77-playtest-round17.test.ts::[66] the Pass button asks before the pass that reaches Regroup, and only that one · Key: annexd.auto-pass.regroup-confirm</sub>

<a id="rD2.6a"></a>**D2.6a** When the battle phase ends with no pass to ask on (an attack declined with no window left, or a whole battle declined), the loss is announced instead: as regroup starts, each player who loses unused spell tokens is told which. Nothing is announced when nothing is lost.

> *Example: A battle both players decline opens no priority window, and the token loss is still announced.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 165-token-loss-warning.test.ts · Example test: 165-token-loss-warning.test.ts::[CT-55] a battle both players decline opens no priority window at all, and the loss is still announced · Demonstrated by test: 165-token-loss-warning.test.ts::[CT-55] the announcement is per seat, in a fixed order, and silent when there is nothing to lose · Key: annexd.auto-pass.regroup-confirm.announced</sub>

<a id="rD2.6b"></a>**D2.6b** A battle ended by a card while it resolves (Temporal Rift) cannot be warned about before the pass, since that cannot be known when the pass is made. The announcement covers it, as it covers every way a battle ends.

> *Example: Under Temporal Rift, a pass does not look like it will end the battle, so the client does not ask; when the Rift ends the battle, the lost spell tokens are still announced as regroup starts.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 1 test, passed; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Example test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.regroup-confirm.card-ended — the pass under Temporal Rift does not read as ending the battle, yet the regroup announcement still fires when the Rift ends it · Key: annexd.auto-pass.regroup-confirm.card-ended</sub>

<a id="rD2.7"></a>**D2.7.** Full control is held, not set. While a player holds the Control key, the client gives them every stop: auto-pass, standing passes, auto-yields and the automatic haste-step ready all stand down. In battle, an action taken while holding it also keeps priority (rule D2.9). When they let go, everything returns to how it was.

> *Example: Holding the Control key as a player acts asks to keep priority; letting go stops asking.*

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 6 tests (a probe it wrote), all passed; 2 gate test files · Tests: 272-full-control.test.ts, 569-hold-priority-toggle.test.ts · Example test: 569-hold-priority-toggle.test.ts::CR 703.2a / CT-253: holding Ctrl asks too, and letting go stops asking · Demonstrated by tests: 272-full-control.test.ts::BL-18 §2 with full control ON, the auto-pass preference sends nothing, 272-full-control.test.ts::CT-183 §6 letting go goes right back to the way it was · Key: annexd.auto-pass.full-control</sub>

<a id="rD2.7a"></a>**D2.7a** Full control changes nothing in deployment. No player holds priority there (rule 703.7), so holding the Control key asks for nothing, and each deployment stack still resolves on its own. See rule 507.

> *Example: In deployment there is no Hold priority toggle, and holding the Control key adds no ask.*

<sub>Basis: Owner call · adopted 2026-10-22 · Verified: confirmed in round 4; verifier ran 2 tests, all passed; 2 gate test files · Tests: 569-hold-priority-toggle.test.ts, 568-hold-priority.test.ts · Example test: 569-hold-priority-toggle.test.ts::CR 507.5 / CT-253: in deployment nothing asks to hold · Key: annexd.auto-pass.full-control.deployment</sub>

<sub>Discrepancies: D-U23-4 (discrepancies.md)</sub>

<a id="rD2.7b"></a>**D2.7b** The client's own automatic actions stop at once when Control is pressed. The server's automatic actions stop only once the message reaches it, and an automatic action already sent is not recalled, so full control should be held before acting, not after.

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 272-full-control.test.ts · Demonstrated by test: 272-full-control.test.ts::BL-18 §3 the switch reaches the SERVER, on the join and on every change · Key: annexd.auto-pass.full-control.latency</sub>

<a id="rD2.7c"></a>**D2.7c** Leaving the window (switching away, hiding the page) releases full control, as if the key had been let go.

> *Example: Alt-tabbing away is letting go.*

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 272-full-control.test.ts · Example test: 272-full-control.test.ts::CT-183 §6 (b) alt-tabbing away is letting go · Key: annexd.auto-pass.full-control.release</sub>

<a id="rD2.7d"></a>**D2.7d** Pressing another key while Control is down (Ctrl+Z, or a browser shortcut) makes a chord, not full control: it drops the hold until Control is released. See rule D4.

> *Example: Ctrl+Z is undo, not full control.*

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 272-full-control.test.ts · Example test: 272-full-control.test.ts::CT-183 §6 (c) Ctrl+Z is undo, not full control · Key: annexd.auto-pass.full-control.chord</sub>

<a id="rD2.7e"></a>**D2.7e** Full control is not remembered between sessions. The client shows whether it is being held.

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 272-full-control.test.ts · Demonstrated by test: 272-full-control.test.ts::CT-183 §6 the hold is not written to the browser · Key: annexd.auto-pass.full-control.not-persisted</sub>

<a id="rD2.8"></a>**D2.8.** When a spell has one target slot that must be an ally and another that may be any unit, and the player picks an ally for the second slot, the client asks whether they meant to target their own unit. It also asks when a single "up to one target unit" slot, other than a "you may" one, can reach only the player's own units: each of them asks, and when an enemy is in reach nothing asks. It never refuses: yes resolves exactly as chosen, and no returns to the same target pick with nothing sent. The option to pick nothing is still offered, and asks nothing. See rules D7, D1.1a.

> *Example: A player casts Fight and picks two of their own units: the client asks once before the cast goes out.*

> *Example: Minor Kraken attacks beside Curio Drifter with no enemy in reach: picking Curio Drifter to recall asks first.*

> *Example: With an enemy unit in reach, the same pick asks nothing.*

<sub>Basis: Mixed · Verified: confirmed in round 4; verifier ran 8 tests, all passed; 1 gate test file · Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Engine: collectPartTargets · Tests: 620-own-unit-question-up-to-one.test.ts · Example tests: 620-own-unit-question-up-to-one.test.ts::CR D2.8 / CT-289: an up to one recall whose every candidate is your own asks on each of them, 620-own-unit-question-up-to-one.test.ts::CR D2.8 / CT-289: with an enemy in reach the pick is a choice, and nothing asks · Demonstrated by test: 620-own-unit-question-up-to-one.test.ts::CR D1.1a / CT-289: the question narrows nothing, the stop is still offered and asks nothing · Key: annexd.auto-pass.misclick-confirm</sub>

<a id="rD2.8a"></a>**D2.8a** The cards that ask are found from their target slots, not listed by name. Of the two-slot shape, today they are Fight and Squish; Organic Exchange, which targets two units with no ally slot, does not ask. The up-to-one shape is found the same way, from a slot that takes at most one unit and may take none, and is not a "you may" slot.

<sub>Basis: Mixed · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 2 gate test files · Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Engine: collectPartTargets · Tests: 434-cr-digital-1.test.ts, 620-own-unit-question-up-to-one.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.misclick-confirm.family — the family derived from target slots over the whole pool is exactly Fight and Squish · Key: annexd.auto-pass.misclick-confirm.family</sub>

<sub>Discrepancies: D-U23-10 (discrepancies.md)</sub>

<a id="rD2.9"></a>**D2.9.** This client does not keep priority for a player who acts unless they ask: in battle, once their action is on the stack, priority goes to the opponent. A player asks to keep it by acting while holding the Control key (rule D2.7) or with the Hold priority toggle beside Pass turned on; then they keep priority and may act again (rule 703.2a). A pass never asks. A player who did not keep priority can still respond to their own spell once priority comes back to them with it on the stack. See rules 703, D2.7.

> *Example: With the toggle off and no Control key held, a play goes out as it always did, and priority passes to the opponent.*

> *Example: The Hold priority toggle sits beside Pass; a tap turns it on.*

> *Example: Holding the Control key asks too; letting go stops asking.*

> *Example: A pass never carries the ask.*

> *Example: The defender casts a spell, the attacker passes, and the defender casts a second spell on top of the first.*

<sub>Basis: Owner call · adopted 2026-10-22 · Verified: confirmed in round 4; verifier ran 6 tests, all passed; 3 gate test files · Tests: 272-full-control.test.ts, 569-hold-priority-toggle.test.ts, 568-hold-priority.test.ts · Example tests: 569-hold-priority-toggle.test.ts::CR 703.2a / CT-253: with the toggle off and no Ctrl, a play goes out as it always did, 569-hold-priority-toggle.test.ts::CR 703.2a / CT-253: the hold toggle sits beside Pass and a tap turns it on, 569-hold-priority-toggle.test.ts::CR 703.2a / CT-253: holding Ctrl asks too, and letting go stops asking, 569-hold-priority-toggle.test.ts::CR 703.2a / CT-253: a pass never carries the ask, 272-full-control.test.ts::BL-18 §4 you can respond to your own spell with the first still on the stack · Key: annexd.auto-pass.no-retain</sub>

<sub>Discrepancies: D-U23-16 (discrepancies.md)</sub>

<a id="rD3"></a>
### D3. Clocks

<a id="rD3.1"></a>**D3.1.** A game may be played with a chess clock, in which each player has a bank of time. The home screen offers three settings: no clock, 45 minutes and 60 minutes.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 271-clock-picker-and-warning.test.ts · Demonstrated by test: 271-clock-picker-and-warning.test.ts::BL-26 §4 the home screen offers the owner's three banks, including no clock at all · Key: annexd.clocks.banks</sub>

<sub>Discrepancies: D-U23-1 (discrepancies.md)</sub>

<a id="rD3.1a"></a>**D3.1a** Unless the player chooses otherwise, the bank is 45 minutes for a constructed game and 60 minutes for a live draft.

<sub>Basis: Engine only · Verified: confirmed in round 2; verifier ran 1 test, passed; 1 gate test file · Tests: 271-clock-picker-and-warning.test.ts · Demonstrated by test: 271-clock-picker-and-warning.test.ts::BL-26 §4 the default follows the MODE · Key: annexd.clocks.banks.default</sub>

<a id="rD3.1b"></a>**D3.1b** A game with no clock shows no clocks.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 271-clock-picker-and-warning.test.ts · Demonstrated by test: 271-clock-picker-and-warning.test.ts::BL-26 §1 a client that was never sent a clock draws no clocks at all · Key: annexd.clocks.banks.off</sub>

<a id="rD3.1c"></a>**D3.1c** Choosing a clock setting does not make a game a custom game.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 366-clock-in-options.test.ts · Demonstrated by test: 366-clock-in-options.test.ts::366 changing the clock does not make the game custom · Key: annexd.clocks.banks.not-custom</sub>

<a id="rD3.1d"></a>**D3.1d** A player's clock is shown as critical when it is down to a tenth of the game's bank or to one minute, whichever is less.

> *Example: On a ninety-second bank the warning comes at nine seconds; on a ten-hour bank five minutes left is not yet critical, because the threshold stops at one minute.*

> *Example: On the 45- and 60-minute banks the clock turns critical at one minute.*

<sub>Basis: Engine only · Verified: confirmed in round 2; verifier ran 1 test, passed; 1 gate test file · Tests: 271-clock-picker-and-warning.test.ts · Example test: 271-clock-picker-and-warning.test.ts::BL-27 §2 the threshold is a tenth of the ROOM'S bank, not a constant · Key: annexd.clocks.banks.critical</sub>

<sub>Discrepancies: D-U23-19 (discrepancies.md)</sub>

<a id="rD3.2"></a>**D3.2.** A player's clock runs only while the game is waiting on that player, and only while both players are connected. Neither clock runs while a proposed fix waits for its answer (see rule D4.5e).

> *Example: A player proposes a fix: both clocks stop, and they run again once the proposal lapses.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 4 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts, 485-agreed-fix-rooms.test.ts, 486-agreed-fix-over-the-wire.test.ts · Example test: 485-agreed-fix-rooms.test.ts::§5 a proposal stops both clocks, lapses after a minute, and ends on any action · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running — a clock runs only for a seat the game is waiting on, and only while both players are connected · Key: annexd.clocks.running</sub>

<sub>Discrepancies: D-U23-2 (discrepancies.md)</sub>

<a id="rD3.2a"></a>**D3.2a** In a step both players take at once, both clocks run; a player's clock stops when that player finishes the step. See rule D1.4.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running.simultaneous — in planning and the haste step both seats are waited on, and a seat that has finished has no legal action left · Key: annexd.clocks.running.simultaneous</sub>

<a id="rD3.2b"></a>**D3.2b** A player's clock does not run in a priority window that their standing pass is answering, and the other player, who has nothing to do there, is not billed either. A real choice is billed even while a standing pass is set. If the client's pass has not arrived within a short backstop, the server passes for the player, and that pass is logged like any other. While a proposed fix waits for its answer, the server does not pass for a standing pass. See rule D2.2.

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running.standing-pass — the armed seat is not billed in the window its pass answers, the other seat neither, and the backstop pass after the delay goes in the log · Key: annexd.clocks.running.standing-pass</sub>

<sub>Discrepancies: D-U23-3 (discrepancies.md)</sub>

<a id="rD3.2c"></a>**D3.2c** A player watching a recap is off the clock until the playback ends or the server's hold on it lapses. Acting ends the hold. See rule D5.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 3 gate test files · Tests: 360-playback-frames.test.ts, 372-recap-end-pause.test.ts, 434-cr-digital-1.test.ts · Demonstrated by tests: 360-playback-frames.test.ts::§8 a seat watching a playback is off the clock until it is done, or the hold lapses, 360-playback-frames.test.ts::§8b the server holds the clock when it sends a playback · Key: annexd.clocks.running.playback</sub>

<a id="rD3.3"></a>**D3.3.** A player whose clock runs out loses the game, and the log says they ran out of time. This happens even if neither player acts. See rule 104.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.clocks.out-of-time — a seat whose clock runs out loses with no move made, and the log says they ran out of time · Key: annexd.clocks.out-of-time</sub>

<a id="rD3.4"></a>**D3.4.** A game is closed when nobody has moved in it for an hour, if fewer than five actions have been taken, or for twelve hours otherwise, and nobody (no player and no watcher) has been connected to it for the five-minute reconnect grace. An open tab keeps an idle game open.

<sub>Basis: Engine only · Verified: confirmed in round 3; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Demonstrated by tests: 367-idle-rooms-close.test.ts::367 §1 a room with fewer than five actions closes after an hour without a move, not before, 367-idle-rooms-close.test.ts::367 §2 a room with five or more actions closes after twelve hours without a move, not before, 367-idle-rooms-close.test.ts::367 §3 a connected seat or a watcher keeps an idle room open, and an empty one gets a grace to reconnect · Key: annexd.clocks.idle-rooms</sub>

<a id="rD3.4a"></a>**D3.4a** A connected player or a watcher keeps an idle game open, and an empty game is given a grace period for a player to reconnect.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 367-idle-rooms-close.test.ts::367 §3 a connected seat or a watcher keeps an idle room open · Key: annexd.clocks.idle-rooms.kept-open</sub>

<a id="rD3.4b"></a>**D3.4b** A game closed for being idle has no winner, is not rated, and is recorded as unfinished.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 367-idle-rooms-close.test.ts::367 §6 a closed game has no winner, is not rated and reads as unfinished · Key: annexd.clocks.idle-rooms.no-result</sub>

<a id="rD4"></a>
### D4. Undo

<a id="rD4.1"></a>**D4.1.** Inside a hidden simultaneous segment, a player may undo their own actions, one at a time, back toward the start of the step, within the limits of the rules below. See rule D1.4.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 3 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, suite.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 374-undo-locks-on-reveal.test.ts::CR D4.1: an undo of an earlier play BEFORE any glimpse still works · Key: annexd.undo.hidden-step</sub>

<sub>Discrepancies: D-U23-7 (discrepancies.md)</sub>

<a id="rD4.1a"></a>**D4.1a** The opponent acting in the same step does not stop a player's undo.

> *Example: A player undoes a unit they spawned in deployment after the opponent cached a card off the shared deck.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 3 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts, 617-undo-spawn-under-cache.test.ts · Example test: 617-undo-spawn-under-cache.test.ts::CR D4.1a / CT-199: undoing your spawn is allowed after the opponent cached a card off the shared deck · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.undo.hidden-step.opponent — the opponent acting in the same step does not stop my undo · Key: annexd.undo.hidden-step.opponent</sub>

<a id="rD4.1b"></a>**D4.1b** An undo cannot go back past what the step itself did as it began, such as a payment or an ability that happens at the start of the step. A player's own undo, in any step, never takes back an agreed edit (see rule D4.5), and takes back an action from before one only if the edit would mean exactly the same afterwards. It never goes back past the point an agreed rewind returned the game to: only another agreed rewind can.

> *Example: An undo stops at what the step did as it began: the answer to a start-of-deployment trigger cannot be taken back.*

> *Example: After an agreed rewind of one action in planning, the player cannot undo, alone, the action before it.*

> *Example: After an agreed fix in planning names a card by its place in the hand, the player cannot undo the earlier recycle that would put a different card there, while the other player may still undo a move the fix does not depend on.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 3 gate test files · Tests: suite.test.ts, 434-cr-digital-1.test.ts, 485-agreed-fix-rooms.test.ts · Example tests: 434-cr-digital-1.test.ts::cr:annexd.undo.hidden-step.floor — an undo stops at what the step did as it began: the answer to a start-of-deployment trigger cannot be taken back, 485-agreed-fix-rooms.test.ts::§2 the per-seat undo cannot walk back past an agreed fix, 485-agreed-fix-rooms.test.ts::§7 in the step, an undo passes a fix only when the fix would mean the same · Key: annexd.undo.hidden-step.floor</sub>

<a id="rD4.1c"></a>**D4.1c** One player cannot undo actions taken in battle, except the steps of a cast that has not yet gone on the stack (see rule D4.2); both players together may take them back with an agreed rewind (see rule D4.5d). For that reason, in battle, an activated ability whose cost spends life, debt or the unit itself, with no choice to make before that cost is paid, asks for confirmation. While it asks, only a second click on the same unit, the Yes button or Enter confirms; No and Escape cancel; every other input does nothing. An ability whose cost asks which card to discard or which other unit to sacrifice does not ask for confirmation: choosing what to pay is the question. In deployment such an ability activates on the click, and undo is the safety net. See rule D7.

> *Example: Cadaverous Cultivator ("[Battle] Discard a card: …") raises no confirmation: the click activates it, and the game asks which card to discard.*

> *Example: While the confirmation is up, clicking a card in hand plays nothing.*

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 11 tests (a probe it wrote), all passed; 3 gate test files · Tests: 373-no-confirm-where-undo-works.test.ts, 456-activate-confirm-is-modal.test.ts, 485-agreed-fix-rooms.test.ts · Example tests: 456-activate-confirm-is-modal.test.ts::D2 §1 the reported card raises no bar, 456-activate-confirm-is-modal.test.ts::D2 §2 with the bar up a hand click sends nothing · Demonstrated by tests: 373-no-confirm-where-undo-works.test.ts::in deployment, an irreversible ability activates on the click, 373-no-confirm-where-undo-works.test.ts::in battle, the same ability still asks, 456-activate-confirm-is-modal.test.ts::D2 §2 clicking the same unit again says yes, 456-activate-confirm-is-modal.test.ts::D2 §2 Enter says yes · Key: annexd.undo.hidden-step.battle</sub>

<sub>Discrepancies: D-U23-11 (discrepancies.md)</sub>

<a id="rD4.2"></a>**D4.2.** A cast that has not yet gone on the stack, while its X, costs or targets are still being chosen, may be cancelled, in battle as well. A Burst group is cancelled whole, with Start over. See rules 702, 803.

<sub>Basis: Owner ruling, adopted 2026-10-01, 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 3 gate test files · Tests: 434-cr-digital-1.test.ts, 358-burst-order-ui.test.ts, 483-burst-undo-one-step.test.ts · Demonstrated by tests: 434-cr-digital-1.test.ts::cr:annexd.undo.cast-cancel — a cast still choosing its targets is cancelled: the card is back in hand and nothing went on the stack, 358-burst-order-ui.test.ts::§4 Undo last pick sends one undo, only once a token is picked, and Cancel reads Start over · Key: annexd.undo.cast-cancel</sub>

<a id="rD4.2a"></a>**D4.2a** While the order of a Burst group is being chosen, its caster may also take back one step at a time with Undo last pick: the last token picked, or the last aim chosen. The earlier picks stand. Undo last pick is offered once a token has been picked, and only the caster can take a step back. See rule 803.

> *Example: The caster picks which Fireball resolves first, then takes the pick back: the question "which resolves first?" returns with nothing picked, and nothing is on the stack.*

> *Example: After picking and aiming the first Fireball, one step back returns to aiming it; the pick stands.*

> *Example: The opponent's undo cannot reach into the burst.*

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 2 gate test files · Tests: 483-burst-undo-one-step.test.ts, 358-burst-order-ui.test.ts · Example tests: 483-burst-undo-one-step.test.ts::BL-47 one undo takes back the last pick of an ordered burst, and only that, 483-burst-undo-one-step.test.ts::BL-47 one undo takes back the last aim, leaving the earlier pick standing, 483-burst-undo-one-step.test.ts::BL-47 the opponent cannot reach into the burst with an undo · Demonstrated by test: 358-burst-order-ui.test.ts::§4 Undo last pick sends one undo, only once a token is picked, and Cancel reads Start over · Key: annexd.undo.cast-cancel.burst-step</sub>

<a id="rD4.3"></a>**D4.3.** An action that showed a player hidden cards cannot be undone, and neither can anything that player did before it.

> *Example: A Glimpse in deployment cannot be undone.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Example test: 374-undo-locks-on-reveal.test.ts::CR D4.3: a Glimpse in deployment cannot be undone · Key: annexd.undo.seen-cards</sub>

<a id="rD4.3a"></a>**D4.3a** Actions the player took after that one can still be undone, back to just after it.

> *Example: A unit played after the glimpse can be undone, back to just after the glimpse, and not past it.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 2 tests, all passed; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Example test: 374-undo-locks-on-reveal.test.ts::CR D4.3a: a plain spawn after the glimpse is undoable back to the glimpse · Key: annexd.undo.seen-cards.after</sub>

<a id="rD4.3b"></a>**D4.3b** The refusal reads "you've seen those cards — that can't be taken back".

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.undo.seen-cards.message — the refusal reads: you have seen those cards and that cannot be taken back · Key: annexd.undo.seen-cards.message</sub>

<a id="rD4.3c"></a>**D4.3c** Only the player who saw the cards is locked. The opponent looking at a shared deck does not lock a player's undo, since inside a hidden step it shows that player nothing.

> *Example: The opponent glimpsing from the shared deck does not lock the player's undo.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 1 test (a probe it wrote), passed; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Example test: 374-undo-locks-on-reveal.test.ts::CR D4.3c: the opponent's glimpse of the SHARED deck does not lock your undo · Key: annexd.undo.seen-cards.only-seer</sub>

<a id="rD4.3d"></a>**D4.3d** An undo is refused if it would change cards the opponent has already been shown.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.undo.seen-cards.opponent-shown — my undo is refused when it would change the cards the opponent has since been shown · Key: annexd.undo.seen-cards.opponent-shown</sub>

<a id="rD4.3e"></a>**D4.3e** Whether an action showed a player hidden cards is measured, not listed: an action counts if what it shows the player depends on the order of hidden cards. A glimpse, a draw, a reveal or a look at a hand counts. Playing a card from hand, recycling, or putting a card on the bottom of a deck does not. In a Single Card Duel nothing locks, since every card in the deck is the same. See rule D8.

> *Example: A unit's spawn trigger that glimpses 1 in the haste step locks undo too.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Example test: 374-undo-locks-on-reveal.test.ts::CR D4.3e: measured, not listed · Key: annexd.undo.seen-cards.measured</sub>

<a id="rD4.3f"></a>**D4.3f** The lock survives a server restart and an undo.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 374-undo-locks-on-reveal.test.ts::CR D4.3f: the lock survives a restart · Key: annexd.undo.seen-cards.restart</sub>

<a id="rD4.3g"></a>**D4.3g** The lock binds one player's own undo. An agreed rewind (see rule D4.5d) may take the game back past an action that showed a player hidden cards: the other player's agreement waives the lock.

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 485-agreed-fix-rooms.test.ts · Key: annexd.undo.seen-cards.agreed-rewind</sub>

<a id="rD4.4"></a>**D4.4.** In Learn to Play, undo works in every phase, under the same lock: a turn's draw, a glimpse or a look at the Bot's hand ends the undo of whatever came before it. Starting a turn again after a loss is a fresh attempt, not an undo. See rule D8.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 3 gate test files · Tests: 374-undo-locks-on-reveal.test.ts, 306-solo-backend.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 374-undo-locks-on-reveal.test.ts::CR D4.4: Learn to Play applies the same floor · Key: annexd.undo.learn-to-play</sub>

<a id="rD4.5"></a>**D4.5.** In a game between two players, either player may propose a fix, and the fix happens only if the other player agrees. A fix is an edit or a rewind. Test mode, a scenario, and a game that has not started or is over take no fixes. A fix sent as an ordinary action is refused: only an agreed proposal makes one. See rule D4.

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 5 tests (a probe it wrote), all passed; 4 gate test files · Tests: 484-agreed-fix-action.test.ts, 485-agreed-fix-rooms.test.ts, 486-agreed-fix-over-the-wire.test.ts, 487-propose-a-fix-ui.test.ts · Demonstrated by tests: 486-agreed-fix-over-the-wire.test.ts::§1 an amend sent as an action is refused, whoever it names as agreeing, 486-agreed-fix-over-the-wire.test.ts::§3 the proposer cannot accept their own fix; a decline cools them down, 485-agreed-fix-rooms.test.ts::§5 edits and rewinds both work in a hidden step; some rooms take no fixes · Key: annexd.undo.agreed-fix</sub>

<a id="rD4.5a"></a>**D4.5a** An edit is one of: setting a player's life total, to a whole number from 1 to 999; a player drawing from 1 to 10 cards off the top of their deck; moving one of the proposer's own cards from their hand, bin or cache to their hand, bin or cache, or to the top or bottom of their deck; or taking a unit off the board to its controller's hand, bin or the bottom of their deck. A token taken off the board is simply gone.

> *Example: A fix cannot set a life total to 0, nor move a card that is no longer where the proposer saw it.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 7 tests (2 probes it wrote), all passed; 1 gate test file · Tests: 484-agreed-fix-action.test.ts · Example test: 484-agreed-fix-action.test.ts::§4 refused: a card that is no longer where the proposer saw it, and life 0 · Demonstrated by tests: 484-agreed-fix-action.test.ts::§2 life: the target life total is SET, and the log says so publicly, 484-agreed-fix-action.test.ts::§2 draw: the target draws N off the top of their deck, 484-agreed-fix-action.test.ts::§2 move: one of your cards between hand, bin, cache and the deck, 484-agreed-fix-action.test.ts::§2 unit: taken off the board to its controller hand, bin or deck bottom · Key: annexd.undo.agreed-fix.edits</sub>

<a id="rD4.5b"></a>**D4.5b** An edit is quiet: nothing triggers on it. A unit it takes off the board neither dies nor despawns, a card it puts into a bin is not trashed, a card it takes out of a bin does not count as leaving the bin, and the cards it draws are not a draw for anything that listens for one. See rule 405.4.

> *Example: Afflicting Anima does not hear a card that a fix puts into the bin.*

> *Example: Rotling does not hear a card that a fix takes out of the bin.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 1 gate test file · Tests: 484-agreed-fix-action.test.ts · Example tests: 484-agreed-fix-action.test.ts::§3 quiet: a fix into the bin is not a trash (Afflicting Anima stays silent), 484-agreed-fix-action.test.ts::§3 quiet: a card leaving the bin by a fix does not fire leftBin (Rotling stays silent) · Demonstrated by tests: 484-agreed-fix-action.test.ts::§3 quiet: a unit taken off the board neither dies nor despawns, 484-agreed-fix-action.test.ts::§3 quiet: a fix draw is not a draw for anything listening · Key: annexd.undo.agreed-fix.quiet</sub>

<a id="rD4.5c"></a>**D4.5c** An agreed edit may be made in any step, the hidden planning, haste and deploy steps included, except while a decision is open for either player; it is shown to both players at once. A rewind may be proposed at any time. See rule D1.4.

> *Example: An edit is accepted inside the hidden planning step and inside the hidden deploy step.*

> *Example: An edit is refused while either player is being asked something.*

> *Example: A fix made in the hidden planning step reaches both players at once, and the other player's frozen view of the board shows it.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 9 tests (3 probes it wrote), all passed; 4 gate test files · Tests: 484-agreed-fix-action.test.ts, 485-agreed-fix-rooms.test.ts, 487-propose-a-fix-ui.test.ts, 486-agreed-fix-over-the-wire.test.ts · Example tests: 484-agreed-fix-action.test.ts::§4 accepted inside the hidden planning and deploy steps (owner, 2026-10-16), 484-agreed-fix-action.test.ts::§4 refused: agreed by the proposer, or with a question open for either seat, 485-agreed-fix-rooms.test.ts::§7 a fix in the hidden planning step reaches both seats at once and shows on the frozen half · Demonstrated by tests: 486-agreed-fix-over-the-wire.test.ts::§4b fixes inside the hidden planning and deploy steps reach the other seat at once, 487-propose-a-fix-ui.test.ts::§6 in a hidden step every fix is live, from the table menu; only an open decision leaves Rewind alone · Key: annexd.undo.agreed-fix.timing</sub>

<a id="rD4.5d"></a>**D4.5d** A rewind takes the game back to one of: just before the proposing player's own last action, even when more than five actions came after it; just before any of the last five actions, counting only actions a player took (an action the game took for a player is neither counted nor a place to stop); the start of the current step; or the start of the step before. Each option names, in the proposing player's words, what it takes back. Inside a hidden step, a point within the step is offered only if it takes back none of the other player's hidden actions there (their public ones, such as finishing planning or deployment, may be taken back); the start of the step may take back the other player's hidden actions too. The actions taken back are removed from the game, as if they had not been taken. See rule D1.2b.

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 6 tests (a probe it wrote), all passed; 3 gate test files · Tests: 485-agreed-fix-rooms.test.ts, 486-agreed-fix-over-the-wire.test.ts, 523-rewind-options-name-their-cut.test.ts · Demonstrated by tests: 485-agreed-fix-rooms.test.ts::§4 rewind options: never a cut at a forced step, at most five actions, and the start of the step, and of the step before, 523-rewind-options-name-their-cut.test.ts::§1 every rewind option names whose action it goes back before, and your last action is offered, 523-rewind-options-name-their-cut.test.ts::§2 inside a hidden step no option cuts what the asking seat has not seen, and nothing counts the log, 485-agreed-fix-rooms.test.ts::§3 a rewind cuts the log and every claim about the cut actions, 486-agreed-fix-over-the-wire.test.ts::§4 a rewind: both seats get a fresh view, and the file archives what was taken back · Key: annexd.undo.agreed-fix.rewind</sub>

<a id="rD4.5e"></a>**D4.5e** A proposal states the fix and the proposer's reason, which is required. It lapses after 60 seconds, or as soon as any action lands, and the proposer may withdraw it. Only the other player can accept it; after a decline the proposer must wait 15 seconds before proposing again. The proposer's reason is filed as a bug report. Fixes made one after another, with no game action between them, are one run and file one report, with every fix's reason in order; the run is filed when it ends, for instance when the next game action lands, and a server restart before then does not lose it. See rule D3.2.

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 7 tests, all passed; 4 gate test files · Tests: 485-agreed-fix-rooms.test.ts, 486-agreed-fix-over-the-wire.test.ts, 487-propose-a-fix-ui.test.ts, 614-restart-keeps-rooms-honest.test.ts · Demonstrated by tests: 485-agreed-fix-rooms.test.ts::§5 a proposal stops both clocks, lapses after a minute, and ends on any action, 485-agreed-fix-rooms.test.ts::§5 a decline cools the proposer down; a withdraw does not, 486-agreed-fix-over-the-wire.test.ts::§2 propose then accept: the edit lands for both, the clocks stop meanwhile, a report is filed, 487-propose-a-fix-ui.test.ts::§4 the other seat agrees or declines on a bar, by the proposal id, 486-agreed-fix-over-the-wire.test.ts::§6 two fixes in a row file one report, and a restart in between does not lose it, 614-restart-keeps-rooms-honest.test.ts::CR D4.5 / CT-335: a run of agreed fixes in a game too old or closed to restore is filed at boot and leaves the file · Key: annexd.undo.agreed-fix.proposal</sub>

<a id="rD4.5f"></a>**D4.5f** A game with a fix in it counts like any other game: its result, rating, league result, achievements and card statistics. It is only tagged as fixed where the game is listed.

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 4 tests (a probe it wrote), all passed; 1 gate test file · Tests: 488-a-fixed-game-counts.test.ts · Demonstrated by tests: 488-a-fixed-game-counts.test.ts::§2 a fixed game counts: the profile, the rating gate, the card-stats gate, 488-a-fixed-game-counts.test.ts::§3 the match history and the admin games list show the tag, 488-a-fixed-game-counts.test.ts::§4 the league result carries the tag, and a fixed room reports it · Key: annexd.undo.agreed-fix.counts</sub>

<a id="rD5"></a>
### D5. Recap and Playback

<a id="rD5.1"></a>**D5.1.** When the haste step or deployment ends, each player is shown what the other did there as a playback (the recap): one frame per move, in the order the moves were made. See rule D1.4b.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§7 a haste step closes into frames the same way · Key: annexd.recap.what</sub>

<a id="rD5.1a"></a>**D5.1a** The recap changes nothing in the game. A game played with recap frames is the same game, action for action, as one without them.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§1 a game with frames is the same game without them · Key: annexd.recap.what.no-effect</sub>

<a id="rD5.1b"></a>**D5.1b** A frame of the opponent's move shows that move on their side, their hand still face down, and the player's own side as the player left it.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§3 an opponent frame · Key: annexd.recap.what.opponent-frame</sub>

<a id="rD5.1c"></a>**D5.1c** A move with nothing to show is not given a frame, but its log line is kept.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§4 a move with nothing to show is not a step · Key: annexd.recap.what.nothing-to-show</sub>

<a id="rD5.1d"></a>**D5.1d** The end of turn is played as one frame per trigger, in order.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§2 the end of turn is a frame per trigger · Key: annexd.recap.what.end-of-turn</sub>

<a id="rD5.1e"></a>**D5.1e** The resource step is not played back: its close arrives whole, in one update. See rule 502.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 434-cr-digital-1.test.ts · Demonstrated by test: 434-cr-digital-1.test.ts::cr:annexd.recap.what.resource-step — the resource step close is sent whole in one update, with no playback · Key: annexd.recap.what.resource-step</sub>

<a id="rD5.1f"></a>**D5.1f** Undoing a move inside the step removes that move's frame and keeps the others. See rule D4.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 360-playback-frames.test.ts::§6 undoing a move inside the step takes its frame with it · Key: annexd.recap.what.undo</sub>

<a id="rD5.2"></a>**D5.2.** A Glimpse made in a hidden step is shown to the opponent in the recap, exactly once, in the frame of the action that made it, with its card notice. The player who glimpsed sees their own reveal at once. A Glimpse in battle reaches the opponent at once. See rules D6, 801.

> *Example: A player plays Oracle of Foretelling in deployment: the opponent sees its glimpse in the recap frame of that play, and nowhere else.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 6 tests, all passed; 2 gate test files · Tests: 371-glimpse-in-the-recap.test.ts, 203-reveal-waits-for-the-barrier.test.ts · Example test: 203-reveal-waits-for-the-barrier.test.ts::CR D5.2: the reveal plays in the recap · Demonstrated by test: 371-glimpse-in-the-recap.test.ts::CR D5.2: the opponent's glimpse notice pops when its recap frame plays, not before · Key: annexd.recap.glimpse</sub>

<a id="rD5.3"></a>**D5.3.** The deployment recap pauses after the opponent's moves and again after the end of turn; the haste step's recap pauses the same way. Skip jumps to the next pause, never past it. A quiet end of turn does not pause twice.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 383-recap-stops.test.ts · Demonstrated by tests: 383-recap-stops.test.ts::report #198: the deployment recap stops after their moves, 383-recap-stops.test.ts::report #198: Skip jumps to the next stop, never past it · Key: annexd.recap.stops</sub>

<sub>Discrepancies: D-U23-8 (discrepancies.md)</sub>

<a id="rD5.3a"></a>**D5.3a** A recap can be watched again. Watching again pauses at the same places, shows the glimpse notices again, and hands back the board.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 383-recap-stops.test.ts · Demonstrated by test: 383-recap-stops.test.ts::report #198: "watch again" stops at the same places · Key: annexd.recap.stops.watch-again</sub>

<a id="rD5.3b"></a>**D5.3b** The hand-over to the next turn at the end of a recap pauses longer than a frame. Every recap, live, watched again or in Learn to Play, is paced by the same rule.

<sub>Basis: Engine only · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 372-recap-end-pause.test.ts · Demonstrated by tests: 372-recap-end-pause.test.ts::the hand-over to the next turn waits PLAYBACK_END_MS, longer than a frame, 372-recap-end-pause.test.ts::every playback goes through the one gap rule · Key: annexd.recap.stops.end-pause</sub>

<a id="rD5.4"></a>**D5.4.** The client shows play no faster than one step per second. This one tempo paces both the updates the client receives and the steps within a single update.

<sub>Basis: Owner ruling, adopted 2026-08-25, 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 218-one-tempo.test.ts, 128-ui-pace.test.ts · Demonstrated by test: 218-one-tempo.test.ts::§1a the beat tempo IS the client-wide ceiling · Key: annexd.recap.tempo</sub>

<a id="rD5.4a"></a>**D5.4a** Items that happen at the same time under the rules arrive on screen together, then leave one at a time, in resolution order, one tempo step apart. The next group waits until this one has finished.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 218-one-tempo.test.ts · Demonstrated by tests: 218-one-tempo.test.ts::§2a "all at once": a simultaneous batch shares ONE arrival, 218-one-tempo.test.ts::§2c they leave in RESOLUTION order · Key: annexd.recap.tempo.cascade</sub>

<a id="rD5.4b"></a>**D5.4b** Only an update the player cannot act on is held back to keep the tempo. A decision for the player, the echo of the player's own action and the end of the game are never held, and an update with legal actions is never held unless auto-pass will answer it. See rule D2.3.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 128-ui-pace.test.ts · Demonstrated by tests: 128-ui-pace.test.ts::CR D5.4b #94: a decision of MINE is never held, 128-ui-pace.test.ts::CR D5.4b #94: the game ending is never held · Key: annexd.recap.tempo.held</sub>

<a id="rD5.4c"></a>**D5.4c** When an update the player can act on arrives, everything held before it is released with it, in order, so the player is never asked a question over an old board.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 128-ui-pace.test.ts · Demonstrated by test: 128-ui-pace.test.ts::CR D5.4c #94: an urgent arrival FLUSHES the backlog rather than jumping it · Key: annexd.recap.tempo.flush</sub>

<a id="rD5.4d"></a>**D5.4d** The player's own input is never delayed by the tempo.

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 128-ui-pace.test.ts · Demonstrated by test: 128-ui-pace.test.ts::CR D5.4d #94: my OWN action's echo is never held · Key: annexd.recap.tempo.input</sub>

<a id="rD5.4e"></a>**D5.4e** The screen never falls more than a fixed number of tempo steps behind the live game.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 128-ui-pace.test.ts, 218-one-tempo.test.ts · Demonstrated by test: 128-ui-pace.test.ts::CR D5.4e #94: the queue never falls further than PACE_MAX_HELD intervals behind · Key: annexd.recap.tempo.lag-bound</sub>

<a id="rD5.5"></a>**D5.5.** Outside a recap playback, while play is being held back, the S key jumps to the live state. Skipping drops pending animations but still delivers the held log lines. No skip control is drawn for this. See rules D5.5c, D5.3.

<sub>Basis: Owner ruling, adopted 2026-08-25, 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 3; verifier ran 3 tests, all passed; 2 gate test files · Tests: 237-live-while-held.test.ts, 218-one-tempo.test.ts · Demonstrated by tests: 237-live-while-held.test.ts::CR D5.5 several held arrivals still draw nothing, and S releases them all, 218-one-tempo.test.ts::§4b skipping RELEASES the beats rather than dropping them · Key: annexd.recap.skip</sub>

<sub>Discrepancies: D-U23-18 (discrepancies.md)</sub>

<a id="rD5.5a"></a>**D5.5a** While play is held, whether the opponent is connected, and the clocks, stay current; nothing else on the board changes until the held updates are released.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 2 tests, all passed; 1 gate test file · Tests: 237-live-while-held.test.ts · Demonstrated by tests: 237-live-while-held.test.ts::CR D5.5b a disconnect that arrives while the throttle is holding is on screen at once, 237-live-while-held.test.ts::CR D5.5a a held update moves the live slots and NOTHING else on the board · Key: annexd.recap.skip.live</sub>

<a id="rD5.5b"></a>**D5.5b** A disconnect is shown at once, not queued behind held updates, and showing it does not release them.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 237-live-while-held.test.ts · Demonstrated by test: 237-live-while-held.test.ts::CR D5.5b a disconnect that arrives while the throttle is holding is on screen at once · Key: annexd.recap.skip.disconnect</sub>

<a id="rD5.5c"></a>**D5.5c** During a recap playback, skipping does not jump to the live state. Skip (the S key, Space, or the Skip button drawn on the play bar) jumps to the next stop, and on a stop it continues the playback. See rules D5.3, D5.5.

<sub>Basis: Engine only · Verified: confirmed in round 3; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 383-recap-stops.test.ts, 434-cr-digital-1.test.ts · Demonstrated by test: 383-recap-stops.test.ts::report #198: Skip jumps to the next stop, never past it · Key: annexd.recap.skip.in-playback</sub>

<sub>Discrepancies: D-U23-22 (discrepancies.md)</sub>

<a id="rD6"></a>
### D6. Reveal Timing of Simultaneous Steps

<a id="rD6.1"></a>**D6.1.** The resource step, the haste step and deployment are hidden simultaneous steps. Inside one, both players act at the same time, and neither is shown what the other does until the step ends. The end of the step is the reveal: everything the other player did in the step is shown then. At the end of the haste step and of deployment it is played back in the recap. See rule D6.2.

> *Example: During deployment, nothing a player does in their region reaches the other player until deployment ends.*

<sub>Basis: Owner ruling, adopted 2026-08-22, 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Example test: 203-reveal-waits-for-the-barrier.test.ts::CR D6.1: of everything a hidden step emits, nothing reaches the other seat before the barrier · Key: annexd.reveal.hidden-steps</sub>

<a id="rD6.1a"></a>**D6.1a** Inside a hidden step, the other player's side of the game is shown as it stood when the step opened. The events the other player's actions produce are held and delivered at the end of the step. Whether the other player has finished the step is not frozen: it is shown live, except in the haste step, where the other player's readiness is hidden while the step is open.

> *Example: In Learn to Play, a unit the Tutorial Bot casts during deployment is not shown to the learner until deployment closes.*

> *Example: In a hidden step, the count of actions each player is shown moves for their own actions and not for the other player's.*

<sub>Basis: Owner ruling, adopted 2026-08-22, 2026-08-28, 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 8 tests, all passed; 4 gate test files · Tests: 306-solo-backend.test.ts, 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts, 615-hidden-step-action-count.test.ts · Example tests: 306-solo-backend.test.ts::§2 inside deployment the bot's cast is frozen out, and revealed when the step closes, 615-hidden-step-action-count.test.ts::CR D6.1a / CT-334: in a hidden step each seat is served a count that moves for its own actions and not for the other seat · Key: annexd.reveal.hidden-steps.frozen</sub>

<a id="rD6.1b"></a>**D6.1b** In the haste step and in deployment, the shared deck count and the shared recycle count are shown to both players as they were when the step opened. A player's own play that moves cards into or out of those piles shows on the counts only at the reveal.

> *Example: A player glimpses during deployment. The shared deck count does not drop for either player until deployment ends.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Example test: 203-reveal-waits-for-the-barrier.test.ts::CR D6.1b: the shared deck and recycle counts do not move under a hidden Glimpse · Key: annexd.reveal.hidden-steps.counts</sub>

<a id="rD6.1c"></a>**D6.1c** Nothing is held during the battle phase. What happens in battle is shown to every player as it happens.

> *Example: Premonition is cast in battle. Its Glimpse reveal reaches the opponent at once.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 159-glimpse-reveal-visibility.test.ts, 435-cr-digital-2.test.ts · Example test: 159-glimpse-reveal-visibility.test.ts::Premonition: the Glimpse X reveal is public to the opponent (CR D6.2c, 801.9) · Key: annexd.reveal.hidden-steps.battle</sub>

<a id="rD6.1d"></a>**D6.1d** While the haste step is open, a player is not shown whether the other player has finished it. Each player sees their own readiness. The end of the step is shown to both players.

> *Example: One player finishes the haste step while the other is still choosing. The other player is not told that the first has finished.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 205-haste-auto-ready.test.ts · Example test: 205-haste-auto-ready.test.ts::CR D2.5d: the opponent is not served my haste readiness while the step is open · Key: annexd.reveal.hidden-steps.haste-ready</sub>

<a id="rD6.2"></a>**D6.2.** A glimpse that happens inside a hidden step is shown to the other player at the reveal, not when it happens. At the end of the haste step or deployment it plays in the recap, at the moment it happened. See rule D6.1.

> *Example: Oracle of Foretelling is played during deployment and glimpses 5. The opponent learns the five cards when deployment ends, in the recap.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 4 gate test files · Tests: 203-reveal-waits-for-the-barrier.test.ts, 159-glimpse-reveal-visibility.test.ts, 371-glimpse-in-the-recap.test.ts, 435-cr-digital-2.test.ts · Example test: 159-glimpse-reveal-visibility.test.ts::Oracle of Foretelling: its reveal is inside the hidden deployment segment, and waits for the barrier (CR D6.2) · Key: annexd.reveal.glimpse</sub>

<a id="rD6.2a"></a>**D6.2a** The player who glimpses sees their own revealed cards when they glimpse.

> *Example: A player plays Oracle of Foretelling during deployment and sees the revealed cards at once; the opponent sees nothing of them until the step ends.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Example test: 203-reveal-waits-for-the-barrier.test.ts::CR D6.2: inside deployment the opponent is sent nothing of a Glimpse — live or on a resync · Key: annexd.reveal.glimpse.own</sub>

<a id="rD6.2b"></a>**D6.2b** At the reveal the other player is shown the glimpse exactly once, with its card notice, and the finished game log holds it once.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests (a probe it wrote), all passed; 3 gate test files · Tests: 203-reveal-waits-for-the-barrier.test.ts, 371-glimpse-in-the-recap.test.ts, 435-cr-digital-2.test.ts · Demonstrated by tests: 371-glimpse-in-the-recap.test.ts::CR D5.2: the opponent's glimpse notice pops when its recap frame plays, not before, 203-reveal-waits-for-the-barrier.test.ts::CR D6.2b: the barrier delivers the reveal exactly once, and the finished log holds it once · Key: annexd.reveal.glimpse.once</sub>

<a id="rD6.2c"></a>**D6.2c** Holding a glimpse until the reveal only delays it. The revealed cards are public, and every player sees them. See rule D6.1c.

> *Example: Foretell is played in battle. The card it reveals is shown to the opponent.*

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 159-glimpse-reveal-visibility.test.ts, 435-cr-digital-2.test.ts · Example test: 159-glimpse-reveal-visibility.test.ts::Foretell: the Glimpse 1 reveal is public to the opponent (CR D6.2c, 801.9) · Key: annexd.reveal.glimpse.public</sub>

<a id="rD6.2d"></a>**D6.2d** The same holds in Learn to Play: a glimpse by the Tutorial Bot inside a hidden step is shown to the learner in the recap. See rule D8.1.

<sub>Basis: Owner ruling, adopted 2026-10-04 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 371-glimpse-in-the-recap.test.ts · Demonstrated by test: 371-glimpse-in-the-recap.test.ts::CR D6.2d: Learn to Play holds the bot's glimpse for the recap, and the recap pops it · Key: annexd.reveal.glimpse.learn-to-play</sub>

<a id="rD6.2e"></a>**D6.2e** A card that reveals cards from the deck without the Glimpse keyword, such as Tides of the Cosmos or Big Glimpse Card, shows the revealed cards to every player as cards, in the notice a glimpse uses. A player whose own open question already shows those cards is not shown the notice. Inside a hidden step the reveal is held for the reveal at the end of the step, as a glimpse is. See rules D6.2c, 402.2a.

> *Example: Tides of the Cosmos resolves for one player: the other player is shown all eight revealed cards.*

> *Example: Big Glimpse Card: while the opponent splits the seven cards into piles, its caster is shown all seven.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 6 tests, all passed; 1 gate test file · Tests: 481-public-deck-reveal.test.ts · Example tests: 481-public-deck-reveal.test.ts::Tides of the Cosmos for one seat shows the other seat all 8 cards in the notice, 481-public-deck-reveal.test.ts::Big Glimpse Card shows the caster all 7 in the notice while the opponent splits · Demonstrated by test: 481-public-deck-reveal.test.ts::no hidden-step runner treats a glimpse or a reveal specially · Key: annexd.reveal.glimpse.deck-reveal</sub>

<a id="rD6.3"></a>**D6.3.** During the battle phase, when an item has begun to resolve and is waiting on a choice from its controller, every player is shown that the item is resolving and whose it is. The item has left the stack, and no player can respond to it (see 703.6). See rule 703.6.

<sub>Basis: Owner ruling, adopted 2026-08-22 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 67-resolving-and-stack-viruses.test.ts · Demonstrated by test: 67-resolving-and-stack-viruses.test.ts::CR D6.3: a resolving item cannot be responded to, negated or targeted · Key: annexd.reveal.resolving</sub>

<sub>Discrepancies: D-U24-3 (discrepancies.md)</sub>

<a id="rD6.3a"></a>**D6.3a** Outside the battle phase the other player is shown nothing of an item resolving. Its controller still sees the question.

> *Example: Oracle of Foretelling, played in deployment, asks its controller which card to cache; the other player is shown nothing of it. The same kind of question from Premonition in battle is shown to them.*

<sub>Basis: Owner ruling, adopted 2026-08-22 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.reveal.resolving.battle-only — outside battle the other player is served nothing of an item resolving while its controller is asked; in battle they are · Key: annexd.reveal.resolving.battle-only</sub>

<a id="rD6.3b"></a>**D6.3b** While a resolution waits on a player's answer, every player is shown the board as it is partway through the resolution: whatever the effect has already done is on the table, including what its controller played and paid.

> *Example: Insidious Invitation lets the caster play a unit first, then asks the opponent. When the opponent is asked, the caster's unit and spent mana are already on the table.*

<sub>Basis: Owner ruling, adopted 2026-08-22 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 72-resolution-window.test.ts · Example test: 72-resolution-window.test.ts::CR D6.3b Insidious Invitation: at the OPPONENT’s prompt, the caster’s play is already on the table · Key: annexd.reveal.resolving.partial</sub>

<a id="rD6.3c"></a>**D6.3c** On a board partway through a resolution, the only actions any player may take are answering the open question and conceding. See rule 104.4a.

<sub>Basis: Owner ruling, adopted 2026-08-22 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 72-resolution-window.test.ts · Demonstrated by test: 72-resolution-window.test.ts::CR D6.3c the mid-resolution board is a PREVIEW: only decide and concede are legal on it · Key: annexd.reveal.resolving.only-answer</sub>

<a id="rD6.4"></a>**D6.4.** Outside a hidden simultaneous step, that a player owes an answer to a question is public, and so is the card it comes from when that card is already in view. What the question is is not: its prompt, its options, its candidate targets and its kind are shown only to the player who must answer. Inside a hidden simultaneous step, not even the fact that the other player owes an answer is shown.

> *Example: The attacker's Tempest Wrangler makes them choose an {Alluring} target. The defender's bar reads "Waiting for Rashi (Tempest Wrangler)" and names neither the prompt nor the candidate.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 3; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 50-ui-inspect.test.ts, 435-cr-digital-2.test.ts · Example test: 50-ui-inspect.test.ts::CR D6.4: the pause bar names the effect an opponent is answering, off the server stub · Key: annexd.reveal.pending-choice</sub>

<a id="rD6.4a"></a>**D6.4a** The waiting player may be told which card the question comes from, but only when that card is already visible to them. Inside a hidden step, it is not named.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 50-ui-inspect.test.ts · Demonstrated by test: 50-ui-inspect.test.ts::CR D6.4: the pause bar names the effect an opponent is answering, off the server stub · Key: annexd.reveal.pending-choice.source</sub>

<a id="rD6.5"></a>**D6.5.** No message the client receives names a card in a zone hidden from that player. When cards enter another player's hand, the player is told how many entered, not which. See rule 402.2.

> *Example: The opponent draws two cards. The player sees the opponent's hand grow by two card backs and is not sent their names.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 172-event-channel-secrecy.test.ts, 435-cr-digital-2.test.ts · Example test: 172-event-channel-secrecy.test.ts::CR D6.5: no event names a card in a zone the state channel hides — the invariant, not the instance · Key: annexd.reveal.hidden-names</sub>

<a id="rD6.5a"></a>**D6.5a** When an effect lets a player look at another player's hand, the cards are shown to the looker only: the client keeps them in the looker's note-taking strip, and no log line names them to anyone else (where a card's log line names them, it goes to the looker alone). The other players' log says only that the hand was looked at, and names no card. This holds when a player looks at their own hand too: the other player's log says that they looked at their own hand, and names nothing. See rule 402.2a.

> *Example: Thought Extraction is aimed at a player's own hand. The opponent is not shown the cards in it.*

> *Example: Thought Extraction is aimed at its caster's own hand. The opponent's log says a hand was looked at, and names no card.*

> *Example: Aimed at the opponent's hand, the public line names the hand looked at.*

> *Example: Hand Peeper looks at the opponent's hand: no log line names the cards, and the look still works.*

> *Example: Hand Peeper used on its player's own hand: the look is logged for everyone, and nothing is kept in the strip.*

<sub>Basis: Owner call · adopted 2026-10-22; Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 4 tests (a probe it wrote), all passed; 3 gate test files · Tests: 173-look-at-a-hand.test.ts, 435-cr-digital-2.test.ts, 550-look-at-own-hand-logged.test.ts · Example tests: 173-look-at-a-hand.test.ts::CR 402.2a Thought Extraction: aimed at YOUR OWN hand, the opponent is the one seat it leaked to, 550-look-at-own-hand-logged.test.ts::CR D6.5a / CT-263: Thought Extraction aimed at the caster own hand tells the opponent a hand was looked at, naming nothing, 550-look-at-own-hand-logged.test.ts::CR D6.5a / CT-263 control: aimed at the opponent, the public line still names the hand looked at, 173-look-at-a-hand.test.ts::CR 402.2a control — Hand Peeper: the same printed verb with NO naming line at all, and it still works, 550-look-at-own-hand-logged.test.ts::CR D6.5a / CT-263: Hand Peeper on your own hand logs the look and takes no snapshot · Key: annexd.reveal.hidden-names.look-at</sub>

<a id="rD6.5b"></a>**D6.5b** A card that an effect moves out of a hidden hand into another hidden zone, without the effect saying "reveal", is named only to the player who chose it. The other players are told that a card moved, not which.

> *Example: Bripp recycles a card from the looked-at hand. The table is told a card was recycled; only Bripp's controller sees its name.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 173-look-at-a-hand.test.ts, 435-cr-digital-2.test.ts · Example test: 173-look-at-a-hand.test.ts::CR D6.5b Bripp: "Look at target player's hand" — and the card it recycles is not named to the table either · Key: annexd.reveal.hidden-names.moved-card</sub>

<a id="rD6.6"></a>**D6.6.** Both players' caches are shown to both players in full: every cached card, and any prophecy attached to it (see 403.2). See rule 403.2.

<sub>Basis: Owner ruling, adopted 2026-08-19 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 36-cache-prophecy.test.ts · Demonstrated by test: 36-cache-prophecy.test.ts::CR 403.2: the cache is PUBLIC — both seats read the same zone, unredacted · Key: annexd.reveal.public-zones</sub>

<a id="rD6.6a"></a>**D6.6a** A cached card whose prophecy condition counts toward a number shows its progress on the board, on its owner's cache, to every player. The count shown is the one for the cache's owner.

> *Example: The opponent has prophesied Vengeance ("13 Units Die"). The player can see on the opponent's cache how many of the 13 deaths have been counted.*

<sub>Basis: Owner ruling, adopted 2026-09-20 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 294-prophecy-meter.test.ts · Example test: 294-prophecy-meter.test.ts::§4 it meters the OPPONENT's cache too — the zone is public (CR D6.6) · Key: annexd.reveal.public-zones.prophecy-meter</sub>

<a id="rD6.6b"></a>**D6.6b** A prophecy whose condition is a state rather than a count shows no meter. A fulfilled prophecy shows as fulfilled instead of a meter.

> *Example: A cached card whose prophecy reads "Your life is 5 or less" puts no meter on the board.*

<sub>Basis: Owner ruling, adopted 2026-09-20 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 294-prophecy-meter.test.ts · Example test: 294-prophecy-meter.test.ts::§4 a state condition puts no meter on the board — there is nothing to count · Key: annexd.reveal.public-zones.prophecy-state</sub>

<a id="rD6.6c"></a>**D6.6c** Any player may open either player's erased pile, from the menu of the bare table (see 407.1a). See rules 407.1a, D6.15.

> *Example: A player right-clicks the empty table and opens the opponent's erased pile.*

<sub>Basis: Owner ruling, adopted 2026-08-21, 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 216-menu-scoping.test.ts · Example test: 216-menu-scoping.test.ts::§2 both field entries are still reachable — from bare table · Key: annexd.reveal.public-zones.erased</sub>

<a id="rD6.6d"></a>**D6.6d** Either player may open either player's bin. When something on the stack targets a card in a bin, that card is brought to the top of the bin on the board, for both players.

> *Example: A Hooba-Mon trigger on the stack targets a card six deep in a bin. That card is drawn on top of the bin for both players.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 260-cost-ramp-and-bin-targets.test.ts · Example test: 260-cost-ramp-and-bin-targets.test.ts::CR D6.6d the opponent sees the target too, which is the half the report is really about · Key: annexd.reveal.public-zones.bin</sub>

<a id="rD6.6e"></a>**D6.6e** In constructed, the elements a player's deck contains are sent to both players. Whether they should be public at the start of the game is an open question for the owner (see the discrepancy report).

> *Example: A fire deck plays a water deck in constructed. Each player is sent that one deck is fire and the other water.*

<sub>Basis: Owner ruling, adopted 2026-08-23 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.reveal.public-zones.deck-elements — in constructed, the deck elements of both players are in the view each player is sent · Key: annexd.reveal.public-zones.deck-elements</sub>

<sub>Discrepancies: D-U24-2 (discrepancies.md)</sub>

<a id="rD6.7"></a>**D6.7.** Things that happen at the same time in the rules are shown at the same time, and things that happen one after another are shown one after another.

> *Example: Combat kills several units at once and their death triggers are queued together. All of them appear on the stack strip in one beat.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 160-simultaneous-trigger-beats.test.ts · Example test: 160-simultaneous-trigger-beats.test.ts::CR D6.7 THE REPORT: a trigger sweep puts every trigger on the strip in ONE frame · Key: annexd.reveal.beats</sub>

<a id="rD6.7a"></a>**D6.7a** This pacing only explains what happened. It never delays the game: the board under it is already final.

> *Example: While the beats of a death sweep are still playing, the units are already gone from the board state.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 160-simultaneous-trigger-beats.test.ts · Example test: 160-simultaneous-trigger-beats.test.ts::CR D6.7 a beat explains and never gates: the board under it is already final · Key: annexd.reveal.beats.never-gates</sub>

<a id="rD6.7b"></a>**D6.7b** Cards that make the same move in one update, from the same place to the same place, move together. Moves between different places are shown one after another. A move whose start or end the client cannot name, such as a card being erased, is shown on its own.

> *Example: Four units die in one update and their four triggers go to the stack together. They all fly to the stack at once.*

> *Example: A card going from hand to the stack, one going from the stack to the field and one going to the bin are three moves, one after another.*

> *Example: Two cards erased from the field, with nowhere named to go, are not grouped.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 1 test, passed; 1 gate test file · Tests: 176-nested-affordance-and-serialiser.test.ts · Example tests: 176-nested-affordance-and-serialiser.test.ts::CR D6.7b: flights that made the same journey in one render share a beat, 176-nested-affordance-and-serialiser.test.ts::CR D6.7b: a sequence still looks sequential — different journeys are spaced, 176-nested-affordance-and-serialiser.test.ts::CR D6.7b: POSITIVE EVIDENCE ONLY — a flight with an unnamed end keeps its own step · Key: annexd.reveal.beats.journeys</sub>

<a id="rD6.8"></a>**D6.8.** A unit that has become a copy of another card is drawn with the art of the card it copied, and stays marked as a copy. See rule 710.

> *Example: Borrower of Forms copies Sporebloom Siren. It is drawn with Sporebloom Siren's art and a copy mark.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 198-copy-art.test.ts · Example test: 198-copy-art.test.ts::CR D6.8: a Borrower of Forms is DRAWN as the card it borrowed · Key: annexd.display.copies</sub>

<sub>Discrepancies: D-U24-1 (discrepancies.md)</sub>

<a id="rD6.8a"></a>**D6.8a** A copy is marked even when its numbers match the card it copied. The bin shows the physical card, not the copied face.

> *Example: Borrower of Forms (2/2) copies a 2/2. It still wears the copy mark.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 198-copy-art.test.ts · Example test: 198-copy-art.test.ts::CR D6.8: a copy is marked even when the borrowed body matches its own · Key: annexd.display.copies.marked</sub>

<a id="rD6.8b"></a>**D6.8b** A card that only borrows abilities from another, without taking its name, keeps its own art.

> *Example: Ancient One shares the text box of an adjacent ally but keeps its own portrait.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 198-copy-art.test.ts · Example test: 198-copy-art.test.ts::CR D6.8: an Ancient One keeps its OWN art — a projection is not an identity · Key: annexd.display.copies.projection</sub>

<a id="rD6.9"></a>**D6.9.** Where a card's printed text uses a bare X, or names a card, and this copy of the card has a value for it, the text box shows that value in its place. Stat notation (X/X, +X/+X, -X/-X), the [x] cost pip and reminder text are never changed, even when X has a value. A board-read X on the stack is not written into the text box; it is shown as a forecast (see rule D6.9c). See rules D6.9c, D6.9a.

> *Example: A Poison created with X = 5 reads "Put 5 -1/-1 counters on target unit".*

<sub>Basis: Owner ruling, adopted 2026-08-25, 2026-08-29, 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests, all passed; 2 gate test files · Tests: 127-token-x-and-dormant.test.ts, 259-card-text-surface.test.ts · Example test: 127-token-x-and-dormant.test.ts::CR D6.9/CT-33: a Poison created with X=5 says "Put 5 -1/-1 counters", from the engine · Key: annexd.display.live-values</sub>

<a id="rD6.9a"></a>**D6.9a** A token's text box shows its actual X in place of X. Stat notation such as X/X, +X/+X and -X/-X is never changed, and neither is reminder text.

> *Example: A Robot reads its X off its counters, so its text changes when they change.*

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 127-token-x-and-dormant.test.ts · Example test: 127-token-x-and-dormant.test.ts::CR D6.9a/CT-33: a Robot reads its X off its COUNTERS, so it stays true as they change · Demonstrated by test: 127-token-x-and-dormant.test.ts::CR D6.9/CT-33: a Poison created with X=5 says "Put 5 -1/-1 counters", from the engine · Key: annexd.display.live-values.token-x</sub>

<sub>Discrepancies: D-U24-4 (discrepancies.md)</sub>

<a id="rD6.9b"></a>**D6.9b** A card that names a card shows the named card in its text box, and so does a host carrying that text as a mod. With no card named, the printed text stands.

> *Example: The Everywhere has named Triskaidekaphage. Its text box reads "Triskaidekaphage loses all abilities."*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 259-card-text-surface.test.ts · Example test: 259-card-text-surface.test.ts::CT-163: the box of the card that named says WHICH card it named · Key: annexd.display.live-values.named-card</sub>

<a id="rD6.9c"></a>**D6.9c** When a card on the stack reads its X from the board at resolution, and the card itself declares how to forecast that X, the stack shows what X would be right now, worded as a forecast. A declared mode narrows the forecast to that mode. If X was paid, the paid X is shown and no forecast is. A board-read X with no declared forecast shows none (see rule D6.9e). See rule D6.9e.

> *Example: Retribution Thing is on the stack. It shows the X it would deal now.*

> *Example: Retribution Thing was cast in the life-lost mode. The stack shows only that mode's forecast.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests, all passed; 1 gate test file · Tests: 225-stack-readout.test.ts · Example tests: 225-stack-readout.test.ts::§1a Retribution Thing wears its X on the stack, and it is the number it will deal, 225-stack-readout.test.ts::§1b the declared mode narrows the forecast to the half that was chosen · Demonstrated by test: 225-stack-readout.test.ts::§1c a paid X still wins — the forecast never doubles it · Key: annexd.display.live-values.x-forecast</sub>

<a id="rD6.9d"></a>**D6.9d** Spell tokens in play are counted by name, with the X of each, because casting one burst token casts every token of that name (see 803). Each spell token shows its X as a large die face. See rule 803.

> *Example: A player holds Fireball 1, Fireball 1 and Fireball 3. The strip shows one Fireball row: three of them, two at X = 1 and one at X = 3.*

> *Example: A Fireball with X = 3 shows a die face with three pips.*

<sub>Basis: Owner ruling, adopted 2026-08-29, 2026-10-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 2 gate test files · Tests: 233-burst-count-and-size.test.ts, 358-burst-order-ui.test.ts · Example tests: 233-burst-count-and-size.test.ts::§1b a group of one name at different sizes prints every size — the report verbatim, 358-burst-order-ui.test.ts::§3 a token wears its X as a die face, not "X=n" in the stat corner · Key: annexd.display.live-values.burst</sub>

<a id="rD6.9e"></a>**D6.9e** A card whose X is read from the board at resolution, but which declares no forecast for it, shows no forecast on the stack. See rule D6.9c.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: partial in round 3; verifier ran 1 test, passed; 1 gate test file · Tests: 225-stack-readout.test.ts · Key: annexd.display.live-values.x-not-forecast</sub>

<sub>Discrepancies: D-U24-8 (discrepancies.md)</sub>

<a id="rD6.9f"></a>**D6.9f** A prediction made with Prediction Prophet is shown on that card to both players, as a chip on the card and a line in its text box, from when it is made until the start of deployment reads it. A prediction left from an earlier turn is not shown.

> *Example: The opponent sees the Prophet's predicted life on the card and in its text box.*

> *Example: A prediction of 0 is shown like any other.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 1 gate test file · Tests: 467-prediction-is-public.test.ts · Example tests: 467-prediction-is-public.test.ts::Prediction Prophet - the opponent sees the prediction on the card, 467-prediction-is-public.test.ts::Prediction Prophet - a prediction of 0 is a prediction and shows · Demonstrated by test: 467-prediction-is-public.test.ts::Prediction Prophet - the prediction is read once at deployment, and an old one never counts · Key: annexd.display.live-values.public-choice</sub>

<a id="rD6.9g"></a>**D6.9g** A triggered ability whose amount is its own column's share of combat damage (Vroot: "When my column deals combat damage, each opponent gains that much life.") shows that share on the stack as its X, the same amount it resolves with, not the total every column dealt.

> *Example: Vroot (4/4) and a 1/1 attack in two columns and are not blocked: the stack shows X=4, and the opponent gains 4.*

> *Example: Vroot's text carried by a host: the stack shows the host's column share.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 2 tests, all passed; 1 gate test file · Tests: 464-trigger-x-is-what-it-resolves.test.ts · Example tests: 464-trigger-x-is-what-it-resolves.test.ts::report 215 - Vroot beside a 1/1 shows X=4 on the stack and the opponent gains 4, 464-trigger-x-is-what-it-resolves.test.ts::report 215 - Vroot as a virus reads its HOST column share · Key: annexd.display.live-values.event-x</sub>

<a id="rD6.10"></a>**D6.10.** A card whose printed text box is empty, but whose type line carries attributes, shows those attributes and their reminders in its text box instead of "no rules text". A card with no text and no attributes still says it has no rules text. See rule 204.

> *Example: Whispering Mantid has no ability text and {Sneaky} on its type line. Its text box shows {Sneaky} and its reminder.*

> *Example: Tidal Menace has no text and no attributes, and still says it has no rules text.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 262-type-line-attributes.test.ts · Example tests: 262-type-line-attributes.test.ts::CR D6.10: a card whose only rules content is a type-line attribute stops saying no rules text, 262-type-line-attributes.test.ts::CR D6.10: a card with no attribute and no text still says nothing, and the guard does not reach it · Key: annexd.display.text-box</sub>

<a id="rD6.10a"></a>**D6.10a** A printed bracket that offers two modes is drawn as two boxes, one around each mode, with the "or" outside them. On the stack, the mode that was not chosen is no longer shown. See rule 111.

> *Example: Void Memory's "[unit or spell]" is drawn as a unit box and a spell box with "or" between them.*

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 122-cardtext-markup.test.ts · Example test: 122-cardtext-markup.test.ts::CR D6.10a: a MODAL bracket draws two boxes with the "or" outside them · Demonstrated by test: 122-cardtext-markup.test.ts::CR D6.10a: a COST bracket still draws exactly one box · Key: annexd.display.text-box.modal</sub>

<a id="rD6.10b"></a>**D6.10b** When a once-per-turn ability has been used, its note wears the marker printed on that ability: [Switch1] or [once]. A card that spells the limit out in words, with no marker, gets [Once].

> *Example: A spent bounded graft ability shows [Switch1], as its card prints.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 228-spent-marker.test.ts · Example test: 228-spent-marker.test.ts::CR D6.10b: a spent bounded GRAFT ability wears the [Switch1] its own card prints · Demonstrated by test: 228-spent-marker.test.ts::CR D6.10b: a spent [once] ability wears [Once] — the same code, the other card · Key: annexd.display.text-box.spent</sub>

<a id="rD6.10c"></a>**D6.10c** A card that is {Unstable}, whether printed or acquired, shows {Unstable} on its attribute line, with how it became Unstable.

> *Example: A modded unit shows {Unstable} on its attribute line, marked as coming from a mod.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 251-fizzle-label-and-mod-strips.test.ts · Example test: 251-fizzle-label-and-mod-strips.test.ts::CR D6.10c the acquired kind says WHICH way in, on the same line · Key: annexd.display.text-box.unstable</sub>

<a id="rD6.10d"></a>**D6.10d** A card with a prophecy banner shows the banner in its text box, as printed, and carries the Prophecy reminder.

> *Example: The Foretold, whose whole printed text box is its banner, shows the banner instead of "no rules text".*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 259-card-text-surface.test.ts · Example test: 259-card-text-surface.test.ts::CT-165: the printed prophecy banner is IN the box, on every card that prints one · Key: annexd.display.text-box.prophecy</sub>

<a id="rD6.10e"></a>**D6.10e** A card that can transform shows, in its details, what it transforms into, before the transform's cost is paid. A card that has already transformed shows no such row.

> *Example: Scholar of the Void's details say it transforms into Beyond, Codex Incarnate, before its hand-discard cost is paid.*

<sub>Basis: Owner ruling, adopted 2026-08-23 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 50-ui-inspect.test.ts · Example test: 50-ui-inspect.test.ts::the inspector says what Scholar of the Void transforms into, before the hand is discarded · Key: annexd.display.text-box.transform</sub>

<a id="rD6.10f"></a>**D6.10f** In the card zoom, a unit whose attributes are off has only its type bar greyed; a unit whose abilities are off has its text box below the type bar greyed; a unit with both off has both greyed.

> *Example: A unit Formless has stamped (attributes off) greys its type bar and not its text box.*

> *Example: A unit The Everywhere names (abilities off) greys below the type bar and leaves the bar.*

> *Example: A unit Monke switches off in battle (both off) greys the bar and the box.*

<sub>Basis: Engine only · Verified: confirmed in round 4; verifier ran 3 tests, all passed; 1 gate test file · Tests: 465-attributes-off-is-not-abilities-off.test.ts · Example tests: 465-attributes-off-is-not-abilities-off.test.ts::report 208 - a Formless-stamped unit greys its type bar and not its text box, 465-attributes-off-is-not-abilities-off.test.ts::report 208 - The Everywhere silencing a unit greys below the type bar, 465-attributes-off-is-not-abilities-off.test.ts::report 208 - Monke switching off both greys the bar and the box · Key: annexd.display.text-box.suppression-band</sub>

<a id="rD6.11"></a>**D6.11.** The reminder shown for a keyword is the game's own words wherever the game has them, in this order of preference: a reminder printed on a card in the pool; the Manual's sentence under a heading that names the term; a dated quote of a designer-posted card; and only then this client's own sentence.

> *Example: {Piercing} reads "Excess damage from piercing sources is dealt to the recipient's controller." — the sentence Protective Adaptations prints.*

> *Example: The card-library sentence for {Rot} is used only because neither a card nor the Manual states one.*

<sub>Basis: Owner ruling, adopted 2026-08-29, 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 3 gate test files · Tests: 245-printed-reminder-reach.test.ts, 231-manual-text.test.ts, 177-glossary-conformance.test.ts · Example tests: 177-glossary-conformance.test.ts::CR D6.11: a row the pool prints a reminder for SHOWS that reminder, verbatim, 245-printed-reminder-reach.test.ts::CR D6.11: the card library is consulted LAST, never over the pool or the manual · Key: annexd.display.reminders</sub>

<a id="rD6.11a"></a>**D6.11a** No reminder, label or rules text shown to a player cites this client's ruling numbers.

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 227-reminder-text.test.ts · Demonstrated by test: 227-reminder-text.test.ts::CR D6.11: rendering every card in the pool leaks no R-number · Key: annexd.display.reminders.no-numbers</sub>

<a id="rD6.11b"></a>**D6.11b** Where the game's reminder is shorter than the rule this client enforces, the client's fuller statement is kept and shown under the game's reminder in the card browser. Shortening what a player reads never deletes a rule.

> *Example: {Piercing} shows the printed sentence, and the card browser also keeps the client's fuller rule beneath it.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 227-reminder-text.test.ts · Example test: 227-reminder-text.test.ts::CR D6.11: Piercing shows the sentence the card prints and keeps the one it does not · Key: annexd.display.reminders.fuller-rule</sub>

<a id="rD6.11c"></a>**D6.11c** The card browser explains every keyword a card names, on its type line or in its text box, and never explains less about a card than the in-game inspector does.

> *Example: Brough grants {Balanced} from its text box. The browser explains {Balanced} on Brough.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 236-browser-glossary-reach.test.ts · Example test: 236-browser-glossary-reach.test.ts::CT-129: an attribute a card grants from its text box gets a reminder row · Key: annexd.display.reminders.browser</sub>

<a id="rD6.12"></a>**D6.12.** Each item on the stack strip is shown in exactly one state: waiting, resolving, answered (negated), fizzled, or resolved. An item that fizzles is shown as fizzled, never as resolved. See rule 704.

> *Example: A spell resolves with no legal target. The strip labels it fizzled.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 251-fizzle-label-and-mod-strips.test.ts · Example test: 251-fizzle-label-and-mod-strips.test.ts::CR D6.12 THE REPORT: the strip says the spell fizzled, not that it resolved · Key: annexd.display.stack-states</sub>

<a id="rD6.12a"></a>**D6.12a** A card on the stack carrying mods is drawn the same way as a unit carrying mods: its mods show beneath it.

> *Example: A {Modular} spell with a mod is drawn on the stack with the mod peeking out beneath it, as it would be on a unit.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 251-fizzle-label-and-mod-strips.test.ts · Example test: 251-fizzle-label-and-mod-strips.test.ts::CR D6.12a a modded stack item composes the same picture as a modded unit · Key: annexd.display.stack-states.mods</sub>

<a id="rD6.13"></a>**D6.13.** While the other player is building an attack or a block, the live view of it is drawn in the same orientation as the declared one. It differs only in being marked as not yet committed. See rules 604, 606.

> *Example: When the opponent confirms their attack, no unit changes side or column on the watching player's screen.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 253-combat-orientation.test.ts · Example test: 253-combat-orientation.test.ts::the live attack and the declared attack put the same units in the same halves · Key: annexd.display.declarations</sub>

<a id="rD6.14"></a>**D6.14.** A card in hand is marked by what can be done with it now. A card that can be cast is drawn plainly; a card that can only be used another way, such as grafted, augmented or recycled, is drawn differently and says how.

> *Example: During deployment a {Battle} spell can only be grafted. It is not drawn like a castable deployment card.*

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 155-hand-affordances.test.ts · Example test: 155-hand-affordances.test.ts::CR D6.14: a {Battle} spell in deployment is NOT drawn like a castable deployment card · Key: annexd.display.hand</sub>

<a id="rD6.14a"></a>**D6.14a** A cached card that can be played right now is also shown at the right of the hand. It stays in the cache as well; clicking either copy plays the same card.

> *Example: A card glimpsed this turn is drawn beside the hand and in the cache row.*

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 155-hand-affordances.test.ts · Example test: 155-hand-affordances.test.ts::CR D6.14: a playable cached card is drawn at the right of the hand AND left in the cache row · Key: annexd.display.hand.cached</sub>

<a id="rD6.14b"></a>**D6.14b** In constructed, the menu for recycling a card for a resource lists the elements in the player's own deck first, then Prismite. Every other element of the game, and the Shard, are behind an expander. The menu changes nothing about what is legal: a resource of any element of the game may still be made. See rules 105.9a, 106.6a.

> *Example: A mono-Fire constructed deck still has all seven elements legal for recycling; the menu just lists Fire first.*

<sub>Basis: Owner ruling, adopted 2026-08-23, 2026-09-19 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 34-constructed.test.ts, 308-recycle-for-prismite.test.ts · Example test: 34-constructed.test.ts::deckElements: it is a PRESENTATION default — all seven stay legal · Key: annexd.display.hand.resource-menu</sub>

<a id="rD6.15"></a>**D6.15.** Right-clicking a card the player can read shows only things about that card. The erased piles, concede and the game log are on the menu of the bare table. Right-clicking a card back opens the bare-table menu. See rule 104.4.

> *Example: Right-clicking a unit offers its details and the judge, not concede.*

> *Example: Right-clicking a card in the opponent's hand opens the table menu.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 2 gate test files · Tests: 216-menu-scoping.test.ts, 232-log-modal.test.ts · Example tests: 216-menu-scoping.test.ts::§1 right-clicking a CARD shows card things, and nothing about the field, 216-menu-scoping.test.ts::§3 a card BACK is not a dead click: an unreadable card gets the table menu · Key: annexd.display.menus</sub>

<sub>Discrepancies: D-U24-7 (discrepancies.md)</sub>

<a id="rD6.15a"></a>**D6.15a** The game log opens from the bare-table menu and shows the whole log.

> *Example: A log longer than 80 lines is shown in full.*

<sub>Basis: Owner ruling, adopted 2026-08-29, 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 232-log-modal.test.ts, 252-viewport-and-log.test.ts · Example test: 252-viewport-and-log.test.ts::CR D6.15a a log longer than the old 80-line window is shown WHOLE · Key: annexd.display.menus.log</sub>

<a id="rD6.16"></a>**D6.16.** The board shows each player's cache and bin as a small panel. Clicking a panel opens the full cache or bin. A card in the panel that the player can use right now is the exception: one click on it uses the card, as clicking it in the full cache or bin would. Clicking any other card in the panel opens the full cache or bin.

> *Example: A cached card that can be played now is played by one click on it in the region's cache panel.*

> *Example: A cached {Battle} card during deployment cannot be played now, so clicking it opens the full cache.*

> *Example: A mod in the bin that can be applied now is one click from the bin panel: the click starts applying it.*

> *Example: A bin card that cannot be used now opens the full bin when clicked.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 2 tests, all passed; 2 gate test files · Tests: 163-cache-affordance-and-badges.test.ts, 176-nested-affordance-and-serialiser.test.ts · Example tests: 163-cache-affordance-and-badges.test.ts::CR D6.16: a playable cached card plays on the FIRST click of its region-cache thumb, 163-cache-affordance-and-badges.test.ts::CR D6.16: an unplayable cache thumb carries no affordance, so the click still opens the zone, 176-nested-affordance-and-serialiser.test.ts::CR D6.16: a bin card usable RIGHT NOW is one click from the region panel, 176-nested-affordance-and-serialiser.test.ts::CR D6.16: an unusable bin thumb keeps the old route — the click opens the zone · Key: annexd.display.panels</sub>

<a id="rD6.16a"></a>**D6.16a** While an open decision stops a player from acting (see rule D2.1), no card in that player's cache panel is used by one click: clicking one opens the full cache. A cached card that is one of the decision's choices is not picked from the panel. A player whom another player's decision does not stop, inside a hidden simultaneous segment (see rule D2.1b), still uses their cached cards from the panel on one click.

> *Example: In deployment, a Wraith's start-of-deployment choice is open for one player. That player's castable cached card is not one click from the panel; the other player's castable cached card still is, and playing it leaves the decision open.*

<sub>Basis: Mixed · Verified: confirmed in round 4; verifier ran 3 tests (a probe it wrote), all passed; 2 gate test files · Owner ruling, adopted 2026-08-25, 2026-08-26 (quoted from the retired ruling register) · Engine: apply.ts:decisionBlocks, apply.ts:legalActions · Tests: 440-cr-uncovered-rulings.test.ts, 163-cache-affordance-and-badges.test.ts · Example test: 440-cr-uncovered-rulings.test.ts::cr:annexd.display.panels.cache-dialog-only — in deployment, the deciding seat gets no one-click cache card; the other seat still does · Key: annexd.display.panels.cache-dialog-only</sub>

<a id="rD6.17"></a>**D6.17.** A scroll hides a card's long-hover tooltip only if the scroll could have moved that card: a scroll of the whole page, or of a panel the card is inside. A scroll of anything else, such as the side rail, leaves the tooltip shown. When no card is hovered, any scroll hides the tooltip.

> *Example: The side rail scrolls while the pointer rests on a unit on the board. The unit's tooltip stays.*

> *Example: The page scrolls while the pointer rests on a unit. The tooltip is hidden.*

> *Example: A panel holding a different card scrolls. The hovered card's tooltip stays.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 1 test, passed; 1 gate test file · Tests: 199-hover-scroll.test.ts · Example tests: 199-hover-scroll.test.ts::CR D6.17: the focus rail scrolling does NOT hide the tip — this is #110, 199-hover-scroll.test.ts::CR D6.17: a scroll that could have MOVED the card still hides the tip, 199-hover-scroll.test.ts::CR D6.17: a scroller holding some OTHER card does not hide this one · Key: annexd.display.hover-tip</sub>

<a id="rD6.18"></a>**D6.18.** An arrow from an effect to its target is aimed at the exact centre of the target. Where the target shows text near its centre (a player's life total, the name on a card drawn without its picture, the label of a stack item with no picture), the arrowhead stops just short of that text, so the text can still be read. On a card whose picture has loaded, the arrowhead is not moved. If the text cannot be cleared without the head stopping more than a head's length outside the target, the head stops where it otherwise would.

> *Example: An effect targets a player. The arrow points at their life total, and its head stops short of the number.*

> *Example: An arrow to a unit whose picture has loaded ends in the usual place.*

> *Example: A target whose label is too big to clear keeps the usual stopping point.*

<sub>Basis: Owner ruling, adopted 2026-08-29 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 1 test, passed; 1 gate test file · Tests: 234-arrowhead-clears-text.test.ts · Example tests: 234-arrowhead-clears-text.test.ts::[CR D6.18] every measured endpoint has an arrowhead that clears its text, 234-arrowhead-clears-text.test.ts::[CR D6.18] an endpoint with nothing legible in the middle is not moved at all, 234-arrowhead-clears-text.test.ts::[CR D6.18] a label too big to clear keeps the old inset rather than parking outside · Key: annexd.display.arrows</sub>

<a id="rD7"></a>
### D7. Confirmations and Misclicks

<a id="rD7.1"></a>**D7.1.** A warning or a confirmation never makes a legal play illegal. The option stays offered, and going ahead does exactly what the play would have done without the warning.

> *Example: Fight aimed at two of the player's own units is still offered and, if confirmed, resolves exactly as it would have.*

<sub>Basis: Owner ruling, adopted 2026-08-22, 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 278-ally-misclick.test.ts · Example test: 278-ally-misclick.test.ts::CR D2.8 the question changes no legality: same candidates, same outcome · Key: annexd.confirm.never-refuse</sub>

<a id="rD7.1a"></a>**D7.1a** When choosing X = 0 makes an effect certain to do nothing, the option to stop at X = 0 carries a warning saying so. It stays legal (see 107.2b). See rule 107.2b.

> *Example: Necromantic Rebuke's option to stop at X = 0 is offered with a warning that it negates nothing.*

<sub>Basis: Owner ruling, adopted 2026-08-22 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 42-dark-b.test.ts · Example test: 42-dark-b.test.ts::Necromantic Rebuke: stopping at X = 0 is offered WITH a warning, and stays legal (CR D7.1a) · Key: annexd.confirm.never-refuse.x-zero</sub>

<a id="rD7.1b"></a>**D7.1b** When a spell has one target that must be an ally and another that may be any unit, and the player picks one of their own units for the second, the client asks whether they meant to. Yes sends the pick. No sends nothing and leaves the same pick open.

> *Example: Fight's first target is the player's ally; the player then picks another of their own units. The client asks whether they meant to target an ally.*

<sub>Basis: Owner ruling, adopted 2026-09-01 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 278-ally-misclick.test.ts · Example test: 278-ally-misclick.test.ts::CR D2.8 Fight aimed at a second unit of your own asks whether you meant it · Demonstrated by test: 278-ally-misclick.test.ts::CR D7.1b "no" sends nothing and leaves the same pick open · Key: annexd.confirm.never-refuse.ally</sub>

<sub>Discrepancies: D-U24-6 (discrepancies.md)</sub>

<a id="rD7.1c"></a>**D7.1c** A pass that would end the battle phase, and with it erase the player's unused spell tokens at regroup, first asks the player to confirm. It asks on that pass and on no other window of the battle.

> *Example: A player holding unused spell tokens passes in the last window of the battle. They are asked to confirm before Regroup erases the tokens.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 165-token-loss-warning.test.ts · Example test: 165-token-loss-warning.test.ts::[66] control: the Regroup confirm still fires on the pass that reaches Regroup · Key: annexd.confirm.never-refuse.regroup</sub>

<a id="rD7.2"></a>**D7.2.** A dial, a stepper or an "All" button only sets an amount. It never sends an answer; only the confirm button does.

> *Example: Pressing "All" on a counter-removal cost sets the count to the most it can be, and waits for the player to confirm.*

<sub>Basis: Owner ruling, adopted 2026-08-24, 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 124-counter-stepper.test.ts, 126-assign-split.test.ts · Example test: 124-counter-stepper.test.ts::"All" sets the count to the max and does NOT submit · Key: annexd.confirm.dials</sub>

<a id="rD7.2a"></a>**D7.2a** A question whose answer is a number, such as predicting a life total, offers a typed box as well as a dial, so any number in range can be entered. The value itself is sent, not a choice from a list.

> *Example: Prediction Prophet's prediction can be dialled or typed in as any number in range, and that number itself is sent.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 2 tests (a probe it wrote), all passed; 1 gate test file · Tests: 168-three-card-divergences.test.ts · Example test: 168-three-card-divergences.test.ts::CR D7.2a Prediction Prophet: THE CLIENT CAN EXPRESS IT — the numeric bar dials past the old cap and puts the VALUE on the wire, not an index · Key: annexd.confirm.dials.number</sub>

<a id="rD7.2b"></a>**D7.2b** A variable cost paid one point at a time, such as paying X life, offers the same typed box and dial. Nothing is paid until the player confirms. The dial cannot go below the points already chosen, and for a life cost its top counts them: the largest X it offers is one less than the player's life.

> *Example: Paying X life for Flesh Tithe, the player dials to 5 and back to 3; confirming pays 3.*

> *Example: With 1 life already chosen, the dial does not go below 1.*

> *Example: With 3 of 30 life chosen, the pay-X-life dial still tops out at X = 29.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 4 tests (a probe it wrote), all passed; 2 gate test files · Tests: 260-cost-ramp-and-bin-targets.test.ts, 591-life-dial-counts-chosen-points.test.ts · Example tests: 260-cost-ramp-and-bin-targets.test.ts::CR D7.2b one confirm walks the ramp to the dialled X and then stops, 260-cost-ramp-and-bin-targets.test.ts::CR D7.2b the dial goes DOWN as well as up, and never below what is already paid, 591-life-dial-counts-chosen-points.test.ts::CR 111.6b / report 273: with 3 of 30 life chosen, the pay-X-life dial still tops out at X = 29 · Key: annexd.confirm.dials.ramp</sub>

<a id="rD7.2c"></a>**D7.2c** The button that ends a variable cost ("That's enough") is drawn as a full button that commits, distinct from the buttons that decline.

> *Example: "That's enough — X = 3" is a filled button; "decline" stays a quiet one.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 260-cost-ramp-and-bin-targets.test.ts · Example test: 260-cost-ramp-and-bin-targets.test.ts::CR D7.2c that is enough is a full button, and the plain declines stay quiet · Key: annexd.confirm.dials.commit</sub>

<a id="rD7.2d"></a>**D7.2d** A cost that removes counters from allies asks the player to click a unit. One click may take several counters from that unit, up to the most that one unit can give. See rule 111.

> *Example: Four counters are spread over two allies, two each. One pick can take at most two.*

<sub>Basis: Owner ruling, adopted 2026-08-24 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 124-counter-stepper.test.ts · Example test: 124-counter-stepper.test.ts::CR D7.2: the pick max is the biggest SINGLE stack, not the whole ally pool · Key: annexd.confirm.dials.counters</sub>

<a id="rD7.2e"></a>**D7.2e** When the dealing player splits combat damage, they are asked one victim at a time, with what is left to assign shown. The client never refuses or forces a split the game would accept. See rule 608.

> *Example: A strike of 4 into a column of two: the player chooses how much the front unit takes, and the back unit gets the rest.*

<sub>Basis: Owner ruling, adopted 2026-08-25 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 126-assign-split.test.ts, 435-cr-digital-2.test.ts · Example test: 126-assign-split.test.ts::CR D7.2e (1): the total is forced — under and over allocations are refused, with the remainder said out loud · Key: annexd.confirm.dials.damage-split</sub>

<a id="rD7.2f"></a>**D7.2f** In an "up to" target choice, the button that stops picking reads "No targets" and is drawn as an ordinary button while nothing has been picked; after a pick it reads "No more targets" and is drawn as the quieter decline button. An "up to N" choice ends by itself at its Nth pick, with nothing more asked about it.

> *Example: Minor Kraken, grafted with Fester, attacks: its up-to-one target choice offers "No targets" as an ordinary button, and answering it moves on to Fester.*

> *Example: Twin Flame (up to two targets): after one pick the stop reads "No more targets"; the second pick ends the choice.*

<sub>Basis: Owner call · adopted 2026-10-16 · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 1 gate test file · Tests: 466-no-targets-is-a-button.test.ts · Example tests: 466-no-targets-is-a-button.test.ts::report 206 - Kraken grafted with Fester offers No targets as an ordinary button, 466-no-targets-is-a-button.test.ts::report 206 - an up to two spell finishes at two picks · Demonstrated by test: 466-no-targets-is-a-button.test.ts::report 206 - an up to X spell finishes at X picks · Key: annexd.confirm.dials.no-targets</sub>

<a id="rD7.3"></a>**D7.3.** When an effect does nothing, the game says so and says why. A printed clause that promises a per-seat outcome and then resolves over an empty collection of seats or of picks is announced for that clause, even when another clause of the same card is speaking. Saying so never changes what the effect does.

> *Example: Bloated Manablub's "Each opponent loses 3 life" resolves in a region with no opponent. The game says so, and no life is lost.*

> *Example: Cull resolves where no player has a unit. The game says so and nothing dies.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 3; verifier ran 2 tests, all passed; 2 gate test files · Tests: 158-silent-region-branches.test.ts, 179-empty-collection-branches.test.ts · Example tests: 158-silent-region-branches.test.ts::Bloated Manablub — "Each opponent loses 3 life" in a region holding no opponent says so and takes no life, 179-empty-collection-branches.test.ts::Cull — "each player sacrifices a unit" with nobody holding a unit here says so and kills nothing · Key: annexd.confirm.say-so</sub>

<sub>Discrepancies: D-U24-10 (discrepancies.md)</sub>

<a id="rD7.3a"></a>**D7.3a** A spell that resolves with no legal target fizzles, and the log says "<card>: it has no legal target — nothing happens." (see 704). See rule 704.

> *Example: Luminous Arc reaches resolution with no target. It fizzles and the log says so.*

<sub>Basis: Owner ruling, adopted 2026-08-28 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 196-empty-target-fizzle.test.ts · Example test: 196-empty-target-fizzle.test.ts::CR D7.3a spell:Luminous Arc: no target → fizzles and logs (CT-89 #1) · Key: annexd.confirm.say-so.no-target</sub>

<a id="rD7.3b"></a>**D7.3b** An "each opponent" effect in a region where no opponent is present says that no opponent is present, and does nothing (see 102.2a). See rule 102.2a.

> *Example: Bloated Manablub's "Each opponent loses 3 life" during its controller's own deployment says so and takes no life.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 158-silent-region-branches.test.ts · Example test: 158-silent-region-branches.test.ts::Bloated Manablub — "Each opponent loses 3 life" in a region holding no opponent says so and takes no life · Key: annexd.confirm.say-so.no-opponent</sub>

<a id="rD7.3c"></a>**D7.3c** A clause that promises something for each player, or each of something, and finds none says so for that clause, even when another clause of the same card has done something.

> *Example: Recall takes its life when nobody here has a unit to recall, and says the recall did not happen.*

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 179-empty-collection-branches.test.ts · Example test: 179-empty-collection-branches.test.ts::Recall — the life loss happens, the recall does not, and the card now says which · Key: annexd.confirm.say-so.per-clause</sub>

<a id="rD7.3d"></a>**D7.3d** An effect that would deal damage to each of a group, and finds nobody in the group, says there was nothing to damage.

> *Example: A "deal 2 damage to each enemy unit" effect with no enemy unit on the board announces that there was nothing to damage.*

<sub>Basis: Owner ruling, adopted 2026-08-23 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 93-engine-defects.test.ts · Example test: 93-engine-defects.test.ts::a damage batch handed an empty hit list announces that there was nothing to damage · Key: annexd.confirm.say-so.no-damage</sub>

<a id="rD7.4"></a>**D7.4.** An announcement the player is expected to act on, or has lost something by, must be shown somewhere other than the game log. The log is the record, not the notice. See rule D6.15a.

> *Example: Spell tokens erased after a declined attack are not announced only in the log: the player who lost them is shown a notice where the prompts appear.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: partial in round 3; verifier ran 2 tests, all passed; 1 gate test file · Tests: 244-log-is-not-the-only-surface.test.ts · Example test: 244-log-is-not-the-only-surface.test.ts::[CR D7.4a] the loss is put in front of the player who lost it, in the promptbar area · Key: annexd.confirm.not-only-log</sub>

<sub>Discrepancies: D-U24-5 (discrepancies.md)</sub>

<a id="rD7.4a"></a>**D7.4a** When a player's unused spell tokens are erased at regroup without a pass to confirm on, such as after a declined attack, that player is shown a notice in the prompt area. It stays until dismissed or until the next battle. The other player is not shown it.

> *Example: The round-2 attacker declines; the defender's unused spell tokens are erased, and the defender sees a notice saying so.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests, all passed; 2 gate test files · Tests: 244-log-is-not-the-only-surface.test.ts, 165-token-loss-warning.test.ts · Example test: 244-log-is-not-the-only-surface.test.ts::[CR D7.4a] the loss is put in front of the player who lost it, in the promptbar area · Demonstrated by test: 244-log-is-not-the-only-surface.test.ts::[CR D7.4a] a net client is not shown the opponent loss, and the notice goes stale at the next battle · Key: annexd.confirm.not-only-log.token-loss</sub>

<a id="rD7.4b"></a>**D7.4b** Any other announcement that a card or a cost the player spent did nothing is shown briefly near the board, under the label "⚠ this did nothing", with the game's own sentence beside it. Both players see it, and it is also in the log.

> *Example: A spell resolves with nothing to aim at. A toast says so on the screen.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 256-cost-toasts.test.ts · Example test: 256-cost-toasts.test.ts::[CR D7.4] a spell that resolves with nothing to aim at produces a toast, end to end · Demonstrated by test: 256-cost-toasts.test.ts::[CR D7.4] an ordinary resolution produces no toast at all · Key: annexd.confirm.not-only-log.toast</sub>

<a id="rD7.4c"></a>**D7.4c** Identical announcements from one resolution are shown once with a count. At most four are drawn at a time; the rest are counted and pointed to the log. None is dropped silently.

> *Example: Three identical "this did nothing" sentences in one batch show as one row marked ×3.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 256-cost-toasts.test.ts · Example test: 256-cost-toasts.test.ts::[CR D7.4] identical sentences in one batch coalesce into one row with a count · Key: annexd.confirm.not-only-log.coalesce</sub>

<a id="rD7.5"></a>**D7.5.** When the server refuses something, the player is told, whatever screen they are on: the connecting screen, a waiting room before the game starts, or the board. Joining with a code for which no game exists says that no game has that code. Joining with the code of a finished game the server no longer holds open says instead that the game is over and who won.

> *Example: A player types a room code that no game has. The connecting screen shows the refusal instead of waiting forever.*

> *Example: An error arriving in the constructed waiting room, where there is no board yet, is shown there.*

> *Example: The refusal for an unknown code names the code.*

> *Example: A finished game's link, followed after the server has let the game go, says the game is over and who won, not that no game has that code.*

<sub>Basis: Owner ruling, adopted 2026-08-30 (quoted from the retired ruling register) · Verified: confirmed in round 4; verifier ran 4 tests, all passed; 2 gate test files · Tests: 254-join-nonexistent-room.test.ts, 614-restart-keeps-rooms-honest.test.ts · Example tests: 254-join-nonexistent-room.test.ts::CR D7.5 a refused join reaches the connecting screen instead of Connecting forever, 254-join-nonexistent-room.test.ts::CR D7.5 an error in the constructed waiting room lands too, where there is still no board, 254-join-nonexistent-room.test.ts::CR D7.5 a code the server never minted is refused, and the refusal names it, 614-restart-keeps-rooms-honest.test.ts::CR D7.5 / CT-195: a finished game forgotten from memory answers its link with its result, not No game with code · Key: annexd.confirm.refusals</sub>

<a id="rD8"></a>
### D8. Tutorial and Single-Card Modes

<a id="rD8.1"></a>**D8.1.** Learn to Play is one learner against the Tutorial Bot in one continuous game, with lessons shown at the moment each rule first matters.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 305-lesson-flow.test.ts · Demonstrated by test: 305-lesson-flow.test.ts::§2 §3 in every element the core lessons open in order early, and the game ends with the end lesson · Key: annexd.modes.learn-to-play</sub>

<a id="rD8.1a"></a>**D8.1a** Learn to Play is a constructed game with its own deal. Each player's opening hand and draw per turn are set separately, turn 1 included, and there is no bottom step. Decks may be stacked so that a lesson's card arrives on its turn. The learner starts with no cards in hand: the draw of 2 on turn 1 is the whole starting hand. See rule 901.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 303-lesson-deal.test.ts, 435-cr-digital-2.test.ts · Demonstrated by test: 303-lesson-deal.test.ts::§1 hands and draws are per seat, turn 1 included, with no bottom step · Key: annexd.modes.learn-to-play.deal</sub>

<a id="rD8.1b"></a>**D8.1b** The Tutorial Bot's only card is Training Construct: "Create an X/X unit." It is an X-cost deploy spell with X at least 1, no element and no affinity cost. Training Construct exists only in Learn to Play; it is never in any other deck, pack or deal.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 303-lesson-deal.test.ts · Demonstrated by test: 303-lesson-deal.test.ts::§5 Training Construct lives only in lesson deals · Key: annexd.modes.learn-to-play.bot-card</sub>

<a id="rD8.1c"></a>**D8.1c** The Tutorial Bot gains one Shard each turn, starting on turn 1. It casts Training Construct at the largest X it can pay, attacks with every unit it has, and never blocks. Its hand is hidden from the learner.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests, all passed; 2 gate test files · Tests: 304-tutorial-bot.test.ts, 306-solo-backend.test.ts · Demonstrated by tests: 304-tutorial-bot.test.ts::§2 every Construct is cast at the largest X its mana allows (one Shard a turn), 304-tutorial-bot.test.ts::§3 it attacks with every unit it has and never blocks · Key: annexd.modes.learn-to-play.bot-play</sub>

<a id="rD8.2"></a>**D8.2.** In a Single Card Duel, each player picks one card before the game, and their deck is 30 copies of that card. This is the one exception to the two-copy limit. Everything else in the game is the same, except the draw (rule D8.2a). See rule 901.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Demonstrated by test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel — a deck of 30 copies of one card is a single-card deck, 29 is not, and two such decks make a duel · Key: annexd.modes.single-card-duel</sub>

<a id="rD8.2a"></a>**D8.2a** A duel has no draw phase. Each turn's card step is a flat draw of 2, and the draw-4, bottom-2 step never happens. The opening hand is still 4, so turn 1 starts with six cards. See rule 503.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Demonstrated by test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.draw — a duel has no bottom step, turn 1 starts on six cards, and turn 2 draws a flat 2 · Key: annexd.modes.single-card-duel.draw</sub>

<a id="rD8.2b"></a>**D8.2b** Cards are picked blind. Before the game, each player is told only whether the other has picked, not what.

> *Example: Ann picks her card first. Bob is told that Ann has picked, and not which card.*

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.blind — before the game the other player is told only that a card is picked, never which · Key: annexd.modes.single-card-duel.blind</sub>

<a id="rD8.2c"></a>**D8.2c** If neither picked card can make a unit, no game is dealt. It is a draw: both players are told both cards and why, nothing is recorded, and both pick again.

> *Example: Both players pick a spell that creates nothing. No game is dealt, each is shown both picks, and both pick again.*

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran no tests; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.no-units — two cards that make no unit deal no game: both are told both cards, nothing is recorded, and both pick again · Key: annexd.modes.single-card-duel.no-units</sub>

<a id="rD8.2d"></a>**D8.2d** A card can make a unit if it is a unit or spell unit, or if it is declared to create a unit token. What its printed text says is not read for this.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Demonstrated by test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.makes-units — unit cards and declared unit-token creators make units; a plain spell does not · Key: annexd.modes.single-card-duel.makes-units</sub>

<a id="rD8.2e"></a>**D8.2e** A duel counts toward no player's record, rating or achievements. It counts toward the card duel ladder instead, which rates cards rather than players.

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Demonstrated by test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.records — a duel moves no player rating · Key: annexd.modes.single-card-duel.records</sub>

<a id="rD8.2f"></a>**D8.2f** The card duel ladder counts any finished duel, except a mirror (the same card on both sides) and a walkover. An early concession counts at reduced weight. A card is ranked once it has five duels that are not mirrors. See rule D8.5.

> *Example: A mirror duel and a turn-1 walkover put no game on the ladder. A turn-2 concession moves the card rating by 10, half the 20 of a full game.*

<sub>Basis: Owner ruling, adopted 2026-09-18 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.ladder — mirrors and walkovers do not rate cards, and an early concession counts at half weight · Key: annexd.modes.single-card-duel.ladder</sub>

<a id="rD8.3"></a>**D8.3.** A live draft may be created with custom rules. Custom rules change the deal, never how a card works. See rule 902.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 296-custom-draft-deal.test.ts · Demonstrated by test: 296-custom-draft-deal.test.ts::BL-43 §1c a custom deal is ignored outside a live draft · Key: annexd.modes.custom-rules</sub>

<a id="rD8.3a"></a>**D8.3a** The custom rules are: pack size (3 to 15; standard 10); the number of elements (2 to 7; standard 3, and two elements default to Fire and Wood); opening hand (1 to 15; standard 6); draws per turn after turn 1 (0 to 5; standard 2); starting life (1 to 99; standard 30); simple cards only; banned cards; and a card filter.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests, all passed; 1 gate test file · Tests: 296-custom-draft-deal.test.ts · Demonstrated by tests: 296-custom-draft-deal.test.ts::BL-43 §2a pack size: packs of 5 at the deal, the commit leaves 5, and the turn-4 refresh deals 5, 296-custom-draft-deal.test.ts::BL-43 §2c two elements: the rulebook pair by default, a chosen pair when given, 113 cards · Key: annexd.modes.custom-rules.knobs</sub>

<a id="rD8.3b"></a>**D8.3b** Simple cards only keeps only cards with the silver complexity symbol in the pool. See rule 209.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 297-custom-rules-resolve.test.ts · Demonstrated by test: 297-custom-rules-resolve.test.ts::BL-43 resolve §3 Simple cards only leaves out exactly the cards that are not simple · Key: annexd.modes.custom-rules.simple</sub>

<a id="rD8.3c"></a>**D8.3c** The pool must hold at least 2 × opening hand + 4 × pack size + 6 × draws per turn cards: 64 for the standard game. Custom rules whose pool is smaller are refused before the game is created.

> *Example: The standard game needs a pool of 64 cards; the Beginner preset needs 44.*

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 2 tests, all passed; 2 gate test files · Tests: 296-custom-draft-deal.test.ts, 297-custom-rules-resolve.test.ts · Example test: 296-custom-draft-deal.test.ts::BL-43 §5 minPool: the standard game needs 64, the beginner deal 44 · Demonstrated by test: 297-custom-rules-resolve.test.ts::BL-43 resolve §8 too small a pool is refused with a message that names the fix · Key: annexd.modes.custom-rules.floor</sub>

<a id="rD8.3d"></a>**D8.3d** Custom rules left at the standard values are not a custom game: they deal the same game as no custom rules at all.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 296-custom-draft-deal.test.ts · Demonstrated by test: 296-custom-draft-deal.test.ts::BL-43 §1b no deal and a deal left at the defaults deal the identical game in every mode · Key: annexd.modes.custom-rules.standard</sub>

<a id="rD8.3e"></a>**D8.3e** A custom game is kept in the match history, marked as custom, and counts toward no profile total, achievement, deck record, rating or average game length. Matchmaking never makes a custom game.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 298-custom-rules-ui.test.ts · Demonstrated by test: 298-custom-rules-ui.test.ts::BL-43 ui §7 a custom row in the match history says it was not counted · Key: annexd.modes.custom-rules.not-counted</sub>

<a id="rD8.3f"></a>**D8.3f** The Beginner preset is two elements, simple cards only and packs of 5. It is this client's softening of the rulebook's Quick Start, not the Quick Start itself: 5-card packs are not in the printed rules.

<sub>Basis: Owner ruling, adopted 2026-09-14 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 1 gate test file · Tests: 298-custom-rules-ui.test.ts · Demonstrated by test: 298-custom-rules-ui.test.ts::BL-43 ui §2 the Beginner preset sends two elements, simple cards and packs of 5 · Key: annexd.modes.custom-rules.beginner</sub>

<a id="rD8.4"></a>**D8.4.** A scenario room, used to test a single card, is an ordinary game dealt from a declared starting board. It is a test fixture, not a game: it counts toward no player's record.

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 186-scenario-library.test.ts, 435-cr-digital-2.test.ts · Demonstrated by test: 186-scenario-library.test.ts::§3 history.ts refuses to fold a scenario room into anybody's record · Key: annexd.modes.scenarios</sub>

<a id="rD8.4a"></a>**D8.4a** Scenario rooms can be created only on a server configured for the tester. Elsewhere they do not exist.

<sub>Basis: Owner ruling, adopted 2026-08-26 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test, passed; 2 gate test files · Tests: 185-scenario-determinism.test.ts, 435-cr-digital-2.test.ts · Demonstrated by test: 185-scenario-determinism.test.ts::§2 an ordinary room is untouched by the tester existing · Key: annexd.modes.scenarios.gated</sub>

<a id="rD8.5"></a>**D8.5.** A conceded game is still a loss for the player who conceded (see 104.4). How much it counts toward records and ratings depends on the turn it was conceded on. See rule 104.4.

> *Example: A player concedes on turn 1. The result says it is a walkover, names the conceder and the turn, and says it was not counted.*

<sub>Basis: Owner ruling, adopted 2026-09-05 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 1 test, passed; 1 gate test file · Tests: 291-concession-weight.test.ts · Example test: 291-concession-weight.test.ts::CR D8.5 a walkover says so, names the conceder and the turn, and says it was not counted · Key: annexd.modes.concession</sub>

<a id="rD8.5a"></a>**D8.5a** A game conceded on turn 1 or earlier is a walkover. It counts toward nothing for either player: no game, win, loss, streak, statistic or achievement. In a rated game, the player who conceded loses 5 rating points and the winner gains nothing, and the game does not count toward the number of rated games played. It stays in each player's match history, marked "not counted".

<sub>Basis: Owner ruling, adopted 2026-09-05 (quoted from the retired ruling register) · Verified: confirmed in round 2; verifier ran 3 tests (a probe it wrote), all passed; 2 gate test files · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Demonstrated by test: 291-concession-weight.test.ts::CR D8.5 a walkover says so, names the conceder and the turn, and says it was not counted · Key: annexd.modes.concession.walkover</sub>

<a id="rD8.5b"></a>**D8.5b** A game conceded on turn 2 is an early concession. It counts as a game for the record, and in a rated game it moves ratings by half as much as a full game. It does not count toward the fast-game achievements or the match-length statistics.

> *Example: A player concedes on turn 2. The post-game screen says half weight, and that it still counts.*

<sub>Basis: Owner ruling, adopted 2026-09-05 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Example test: 291-concession-weight.test.ts::CR D8.5 an early concession says half weight, and that it still counts · Key: annexd.modes.concession.early</sub>

<a id="rD8.5c"></a>**D8.5c** A game conceded on turn 3 or later counts exactly as if the conceding player had been defeated.

> *Example: A player concedes on turn 5: the result is an ordinary loss, with no note attached.*

<sub>Basis: Owner ruling, adopted 2026-09-05 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 2 tests (a probe it wrote), all passed; 2 gate test files · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Example test: 291-concession-weight.test.ts::CR D8.5 ⭐ a normal concession (turn 3+) and a game with no concession say NOTHING · Key: annexd.modes.concession.normal</sub>

<a id="rD8.5d"></a>**D8.5d** Only a rated game moves a rating at all. An unrated walkover moves nobody's rating.

> *Example: A player concedes an unrated game on turn 1. Neither player has a rating change.*

<sub>Basis: Owner ruling, adopted 2026-09-05 (quoted from the retired ruling register) · Verified: confirmed in round 1; verifier ran 1 test (a probe it wrote), passed; 1 gate test file · Tests: 435-cr-digital-2.test.ts · Example test: 435-cr-digital-2.test.ts::cr:annexd.modes.concession.rated-only — an unrated walkover moves nobody · Key: annexd.modes.concession.rated-only</sub>
