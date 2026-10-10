# Annex D — Digital Play Conventions

*Algomancy Comprehensive Rules. Unofficial. Generated from this project's digital client.*

## Precedence

These are the conventions of this digital client: how it times, shows and confirms the game, where a table of players would simply agree. They are not rules of Algomancy. Where a convention here and a rule in the main document both speak to the game itself, the main document governs. Where they concern only how the client presents, times or confirms play, this annex governs.

<a id="rD1"></a>
### D1. General and Precedence

<a id="rD1.1"></a>**D1.1.** The pacing and concurrency conventions in this annex are not rules changes: none of them changes what is legal. See rules D3, D3.3, D3.4b.

> *Example (non-normative): The pacing conventions change no legality: a standing pass, a playback hold and full control leave the offered actions equal to the engine, and an action offered during the opponent decision is legal by the engine once it closes.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.not-rules — the pacing conventions change no legality: a standing pass, a playback hold and full control leave the offered actions equal to the engine, and an action offered during the opponent decision is legal by the engine once it closes</sub>

<sub>Basis: Owner call · Verified: partial, round 3, 0 tests run · Rulings: R150 (its CT-28 pacing half) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.not-rules</sub>

<sub>Discrepancies: D-U23-20 (discrepancies.md)</sub>

<a id="rD1.1a"></a>**D1.1a** A warning or a confirmation never removes a legal option. Where a choice looks like a misclick, the client may ask the player; it does not refuse the choice. See rule D2.8.

> *Example (non-normative): Fight aimed at two of the caster's own units asks "did you mean to target allies?"; answering yes resolves the spell exactly as chosen (illustrative).*

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R288 · Key: annexd.general.not-rules.warn-not-refuse</sub>

<a id="rD1.2"></a>**D1.2.** The client never makes a choice that belongs to a player. A real choice is always put to the player who makes it.

> *Example (non-normative): Every action answered for a player is the only move either seat has, so no real choice is ever taken.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides — every action answered for a player is the only move either seat has, so no real choice is ever taken</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R120 (its default-split option) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides</sub>

<a id="rD1.2a"></a>**D1.2a** An option the rules would refuse is not offered. The client shows only legal options; it does not show an option and then refuse it. See rule D1.3.

> *Example (non-normative): Every option the engine offers is accepted when taken; none is shown and then refused.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.unoffered — every option the engine offers is accepted when taken; none is shown and then refused</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R120 (its default-split option) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.unoffered</sub>

<a id="rD1.2b"></a>**D1.2b** The game takes an action for a player only where the battle leaves them nothing to decide: an attacker with no unit able to attack has the empty attack declared for them, and a defender with no unit in the battle region has the empty block declared for them. These forced actions are logged like any other. A player holding full control is not forced: the window is left to them. See rules 610, D1.2c, D1.2f, D1.2e, D2.7.

> *Example (non-normative): A battle on an empty board steps itself through to deployment by forced actions.* <sub>test: 21-fixes.test.ts::a whole empty-board battle drains through forced actions to deployment</sub>

> *Example (non-normative): An attacker with a unit is not forced: declaring is a real choice.* <sub>test: 21-fixes.test.ts::forcedAction is null whenever a real choice exists</sub>

> *Example (non-normative): With full control on, the drain stops and the player is left the window.* <sub>test: 273-full-control-both-seats.test.ts::BL-18 §2 with full control ON the drain stops and the player is left the window</sub>

<sub>Basis: Engine only · Verified: confirmed, round 3, 2 tests run · Rulings: R36, R287 · Engine: apply.ts:forcedAction · Tests: 21-fixes.test.ts, 273-full-control-both-seats.test.ts, 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.forced</sub>

<sub>Discrepancies: D-U23-21 (discrepancies.md)</sub>

<a id="rD1.2c"></a>**D1.2c** In round 2, a counterattack pool that holds exactly one unit, and no spell token that could ride along, declares the one-unit formation by itself. Engine differs, see F-U23-4. See rule 610. *(Engine differs, see F-U23-4.)*

> *Example (non-normative): A player who sent one unit to counterattack and no spell token is not asked to form it (illustrative).*

> *Example (non-normative): Today the engine still asks: a player who sent one unit and no spell token gets no forced declare in round 2, and is offered both declining and attacking with it (F-U23-4).* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.forced.lone-counterattacker — the engine still asks a lone sent counterattacker with no token to declare (engine differs)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 0 tests run · Rulings: R36, R36 · Engine: apply.ts:forcedAction · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.forced.lone-counterattacker</sub>

<sub>Discrepancies: D-U23-17 (discrepancies.md)</sub>

<a id="rD1.2d"></a>**D1.2d** When all of one player's simultaneously queued triggers are identical (the same card, the same ability and the same composed parts), the player is not asked to order them. They go on in the order they fired. Triggers from different cards or abilities, or composites whose parts differ, are still ordered by the player. See rule 706.

> *Example (non-normative): Flourishing Flora queuing three copies of its trigger asks nothing (illustrative).*

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R34, R34, R34 · Key: annexd.general.player-decides.identical-triggers</sub>

<a id="rD1.2e"></a>**D1.2e** A non-target choice that an ability makes as it goes on the stack (such as the ally a Wraith's start-of-deployment trigger aims at) is recorded without asking when there is only one candidate. With two or more candidates the player is asked. See rules 507, 706.

> *Example (non-normative): A lone Wraith aims at its only ally without asking; with a second ally the player is asked.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.one-subject — a lone Wraith aims at its only ally without asking; with a second ally the player is asked</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R144 (its half (b)), R144 (its half (b)) · Replaces: R144 (its half (a) and its flash amended by R286; half (b) stands) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.one-subject</sub>

<a id="rD1.2f"></a>**D1.2f** A target is asked for even when exactly one candidate is legal. A forced target is still a click. See rule 110.

> *Example (non-normative): Divine Foresight ("target opponent") cast in battle opens a target question with exactly one option, and no forced action answers it.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.forced-target — a target with exactly one legal candidate is still a decision put to the caster</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R67, R67 · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.forced-target</sub>

<a id="rD1.2g"></a>**D1.2g** Where a choice has a usual answer, the client may offer it as the first option, but it never picks it. The elective combat-damage split leads with "default — share front-to-back", and no automatic action answers that question. See rule 608.

> *Example (non-normative): The elective damage split leads with the default share, and nothing picks it for the player.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.player-decides.default-first — the elective damage split leads with the default share, and nothing picks it for the player</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R120 (its default-split option), R120 (its default-split option) · Replaces: R120 (its Piercing exclusion reversed by R319; the default-first option stands) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.player-decides.default-first</sub>

<a id="rD1.2h"></a>**D1.2h** The caster always chooses the order of a Burst group, one token at a time; the client offers no automatic order. A lone token is not asked to be ordered. See rule 803.

> *Example (non-normative): A single Fireball token cast alone goes on the stack with no ordering question.* <sub>test: 358-burst-order.test.ts::R309: a lone token is not asked to be ordered</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R309 · Tests: 358-burst-order.test.ts · Key: annexd.general.player-decides.burst-order</sub>

<a id="rD1.3"></a>**D1.3.** The client holds no opinion of its own about legality. Wherever the client decides something the engine also decides, the client's answer is derived from the engine's, in one place. *(Untested: no executed test demonstrates it.)*

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R245, R245 · Key: annexd.general.one-opinion</sub>

<a id="rD1.3a"></a>**D1.3a** A highlighted card, a clickable unit, a drop target or a one-click shortcut claims that the engine will take the action. The client draws one only where the engine would accept it.

> *Example (non-normative): A unit the engine would refuse for a counterattack is not ringed, and clicking it does nothing.* <sub>test: 223-client-legality.test.ts::[127] a unit the engine would refuse is not ringed and does not pick up on a click</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R245, R245 · Tests: 223-client-legality.test.ts · Key: annexd.general.one-opinion.affordances</sub>

<a id="rD1.4"></a>**D1.4.** A hidden simultaneous segment is a part of the turn in which both players act at once and neither sees what the other does until both are done. The resource step, the haste step and deployment are hidden simultaneous segments. See rules 501, 504, 507, D6.

> *Example (non-normative): The resource step, the haste step and deployment are hidden simultaneous segments; battle is not.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment — the resource step, the haste step and deployment are hidden simultaneous segments; battle is not</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R18 (its hidden-segment half), R18 (its hidden-segment half), R310 · Replaces: R18 (its skip and auto-done reversed by R224 and R228; the hidden segment stands) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.hidden-segment</sub>

<a id="rD1.4a"></a>**D1.4a** The hiding is done by the server's view of the game, the same way hands are hidden. The rules engine itself hides nothing.

> *Example (non-normative): The engine state holds the hidden play; only the server per-seat view leaves it out.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.redaction — the engine state holds the hidden play; only the server per-seat view leaves it out</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R18 (its hidden-segment half), R18 (its hidden-segment half) · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.hidden-segment.redaction</sub>

<a id="rD1.4b"></a>**D1.4b** A segment ends at a barrier, when every player is done. At the barrier each player is shown what the other did, in the recap. See rules D5, D6.

> *Example (non-normative): The step ends only when every player is done, and then each is played back what the other did.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.barrier — the step ends only when every player is done, and then each is played back what the other did</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R310 · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.hidden-segment.barrier</sub>

<a id="rD1.4c"></a>**D1.4c** Battle is not a hidden segment. Nothing that happens in battle is held back from either player.

> *Example (non-normative): In battle nothing is held: a cast is on the opponent view and in their events at once.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.general.hidden-segment.battle-open — in battle nothing is held: a cast is on the opponent view and in their events at once</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R310 · Tests: 434-cr-digital-1.test.ts · Key: annexd.general.hidden-segment.battle-open</sub>

<a id="rD2"></a>
### D2. Priority and Auto-Pass

<a id="rD2.1"></a>**D2.1.** While a decision is open for a player (a question the game is waiting on them to answer), that player must answer it, or concede, before taking any other action. See rule 104.4a.

> *Example (non-normative): A seat with its own question open cannot play a card until it answers.* <sub>test: 130-seat-aware-gate.test.ts::R154 §4: your own question still gates your own input</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R154 (its decision gate) · Replaces: R154 (its deployment settle() hold amended by R286; the decision gate stands) · Tests: 130-seat-aware-gate.test.ts · Key: annexd.auto-pass.open-decision</sub>

<a id="rD2.1a"></a>**D2.1a** In battle, a decision open for one player stops the other player too: nobody may act until it is answered. See rule 703.

> *Example (non-normative): A real battle decision for one seat leaves the other seat with nothing it may do.* <sub>test: 130-seat-aware-gate.test.ts::R154 §4: a REAL battle decision blocks the other seat</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R154 (its decision gate) · Tests: 130-seat-aware-gate.test.ts · Key: annexd.auto-pass.open-decision.battle</sub>

<a id="rD2.1b"></a>**D2.1b** Inside a hidden simultaneous segment, a decision open for one player does not stop the other player, who keeps every action they had, except as described in the next sub-rule. See rule D1.4.

> *Example (non-normative): While one seat answers its pile of Wraith triggers at the start of deployment, the other seat goes on deploying.* <sub>test: 130-seat-aware-gate.test.ts::R154 §1: every kind of action seat 0 had is still theirs</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R154 (its decision gate), R154 (its decision gate) · Tests: 130-seat-aware-gate.test.ts · Key: annexd.auto-pass.open-decision.segment</sub>

<a id="rD2.1c"></a>**D2.1c** Exception: when answering the open decision would rewind the game to before the other player acted (a resolution that stopped halfway), the other player is stopped as in battle. Online, an action they send meanwhile waits and is applied when the decision closes; they are told it is waiting, not that it is illegal.

> *Example (non-normative): A mid-resolution question for one seat still blocks the other seat's deployment play.* <sub>test: 130-seat-aware-gate.test.ts::R154 §3: a mid-resolution suspension still blocks the other seat</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R154 (its decision gate), R154 (its decision gate) · Replaces: R150 (its server shadow state and blanket deferral narrowed by R154 to this rewind case) · Tests: 130-seat-aware-gate.test.ts · Key: annexd.auto-pass.open-decision.rewind</sub>

<a id="rD2.1d"></a>**D2.1d** Only one decision can be open at a time. An action that would change what the other player's open decision reads when it is answered is refused, and the game stays as it was before the action.

> *Example (non-normative): Seat 0 cannot raise a question of its own while seat 1's question is open.* <sub>test: 130-seat-aware-gate.test.ts::R154 §2: seat 0 may not overwrite seat 1's open decision</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R154 (its decision gate), R170 · Tests: 130-seat-aware-gate.test.ts, 144-both-seats-decision-gate.test.ts · Key: annexd.auto-pass.open-decision.no-disturb</sub>

<a id="rD2.1e"></a>**D2.1e** Conceding is never blocked by an open decision, whichever player it belongs to. See rule 104.4a.

> *Example (non-normative): Either seat may concede while a question is open.* <sub>test: 130-seat-aware-gate.test.ts::R154 §4: concede is always reachable, from either seat</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R154 (its decision gate) · Tests: 130-seat-aware-gate.test.ts · Key: annexd.auto-pass.open-decision.concede</sub>

<a id="rD2.1f"></a>**D2.1f** On a screen that shows both players' sides at once, the open question stays on top, and the player who is not being asked keeps their own phase controls beneath it. The player being asked has only the question.

> *Example (non-normative): The free seat can still end its deployment from the button on screen.* <sub>test: 144-both-seats-decision-gate.test.ts::R170 §1: ending the free seat's deployment goes through, from the button on screen</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R170, R170 · Tests: 144-both-seats-decision-gate.test.ts · Key: annexd.auto-pass.open-decision.both-seats</sub>

<a id="rD2.2"></a>**D2.2.** When a player holds priority, the client offers up to three ways to pass: Pass, Pass through stack and Pass all. Pass through stack and Pass all are standing passes: promises the client keeps on the player's behalf in later windows. See rule 703.

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251, R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons</sub>

<sub>Discrepancies: D-U23-14 (discrepancies.md)</sub>

<a id="rD2.2a"></a>**D2.2a** Pass passes priority once. It sets up nothing for later windows.

> *Example (non-normative): Pass sends one pass and arms nothing: the next window the seat holds is left to them.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.pass-buttons.pass — Pass sends one pass and arms nothing: the next window the seat holds is left to them</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R251 · Tests: 434-cr-digital-1.test.ts · Key: annexd.auto-pass.pass-buttons.pass</sub>

<a id="rD2.2b"></a>**D2.2b** Pass through stack passes for the player until the stack items that were there when it was clicked have resolved, and then ends. It hands priority back sooner if a stack item outside that set appears, or if the player is offered an option they did not have when they clicked.

> *Example (non-normative): A spell the opponent casts in answer is outside the armed set, so priority comes back to the player.* <sub>test: 230-pass-modes.test.ts::[123] a stack item outside the armed scope hands priority back</sub>

> *Example (non-normative): Once the stack it was clicked on has resolved, the promise is over.* <sub>test: 230-pass-modes.test.ts::[123] pass through stack finishes when the stack it was armed on has resolved</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R251, R251, R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons.through-stack</sub>

<a id="rD2.2c"></a>**D2.2c** Pass through stack is offered only while there is a stack to pass through.

> *Example (non-normative): With an empty stack the battle bar shows Pass and Pass all only.* <sub>test: 230-pass-modes.test.ts::[123] the battle bar offers pass through stack only while there is a stack</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons.through-stack.offered</sub>

<a id="rD2.2d"></a>**D2.2d** Pass all passes for the player until the phase it was clicked in ends. A new stack item or a new option does not hand priority back.

> *Example (non-normative): The opponent casting a spell does not stop Pass all.* <sub>test: 230-pass-modes.test.ts::[123] pass all does not hand priority back for a new item or a new option</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251, R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons.all</sub>

<a id="rD2.2e"></a>**D2.2e** Both standing passes still stop before the one pass that would end the battle phase while the player holds spell tokens they could cast, so that that pass is the player's own click. See rules D2.6, 506.

> *Example (non-normative): Pass all armed with a castable Fireball token runs through the battle and hands the last pass back.* <sub>test: 230-pass-modes.test.ts::[123] pass all still stops on the one pass that would erase castable spell tokens</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251, R251 · Tests: 230-pass-modes.test.ts, 77-playtest-round17.test.ts · Key: annexd.auto-pass.pass-buttons.token-stop</sub>

<a id="rD2.2f"></a>**D2.2f** What counts as new for a standing pass is measured against the moment it was clicked. An option the player already had then is not new when it comes back later.

> *Example (non-normative): An activated ability on offer at the click, gone for a window and back again, does not stop the pass.* <sub>test: 230-pass-modes.test.ts::[123] an option that was on offer at the arm is not news several windows later</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons.baseline</sub>

<a id="rD2.2g"></a>**D2.2g** A standing pass is set up only by a click and can be cancelled at any time: one stop control drops whichever is running. The client shows which promise is running and how it ends.

> *Example (non-normative): Each pass button arms a chip naming its own promise, and one stop drops it.* <sub>test: 230-pass-modes.test.ts::[123] each pass button arms a chip that names its own promise, and one stop drops it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R251, R251 · Tests: 230-pass-modes.test.ts · Key: annexd.auto-pass.pass-buttons.revocable</sub>

<a id="rD2.3"></a>**D2.3.** A player may turn on auto-pass. With it on, the client passes priority for the player only in a window where passing is the only thing they could do. Auto-pass never passes through an open decision.

> *Example (non-normative): With a castable card in hand the window is put to the player even with auto-pass on.* <sub>test: 70-playtest-round15.test.ts::[59] the C4 toggle passes only when passing is the ONLY thing I could do</sub>

> *Example (non-normative): A pending decision is never answered by auto-pass.* <sub>test: 70-playtest-round15.test.ts::[59] a pending decision is never passed through, by any of the three</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 70-playtest-round15.test.ts · Key: annexd.auto-pass.preference</sub>

<sub>Discrepancies: D-U23-9 (discrepancies.md)</sub>

<a id="rD2.4"></a>**D2.4.** An answer the client sends without a click (an automatic pass, or the automatic haste-step ready) is sent once for each time it is owed. It is latched by being unanswered, not by counting game updates, so updates that arrive while it is outstanding do not send it again. Engine differs, see F-U23-2. *(Engine differs, see F-U23-2.)*

> *Example (non-normative): However many states arrive inside the haste step, one automatic ready goes out per unanswered send.* <sub>test: 223-client-legality.test.ts::[122] one automatic doneHaste per unanswered send, however many states arrive</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R245, R245 · Tests: 223-client-legality.test.ts, 70-playtest-round15.test.ts · Key: annexd.auto-pass.automatic-answers</sub>

<sub>Discrepancies: D-U23-13, D-U23-6 (discrepancies.md)</sub>

<a id="rD2.4a"></a>**D2.4a** If the server refuses an action the client sent on its own, the refusal is not shown as the player's error. It goes to the log and to a plain notice that says the client sent it.

> *Example (non-normative): A refused automatic ready does not light the red error bar.* <sub>test: 223-client-legality.test.ts::[122] a refusal of an action the CLIENT chose to send is not the player refusal</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R245, R245 · Tests: 223-client-legality.test.ts · Key: annexd.auto-pass.automatic-answers.refusal</sub>

<a id="rD2.5"></a>**D2.5.** When the haste step opens and the only legal action a player has in it is to finish the step, the client finishes it for them at once, unless they have turned on bluff haste. See rules 504.5, 504.5a.

> *Example (non-normative): With bluff haste off and nothing hasteable, the client sends the ready by itself.* <sub>test: 205-haste-auto-ready.test.ts::R236 §2a: with the preference OFF and nothing hasteable, the client sends doneHaste by itself</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R236, R236 · Tests: 205-haste-auto-ready.test.ts · Key: annexd.auto-pass.haste-ready</sub>

<sub>Discrepancies: D-U23-12, D-U23-15 (discrepancies.md)</sub>

<a id="rD2.5a"></a>**D2.5a** If the player has any legal play in the haste step, the client never finishes the step for them.

> *Example (non-normative): A playable haste card in hand keeps the player in the step, bluff haste on or off.* <sub>test: 205-haste-auto-ready.test.ts::R236 §2d: with something playable the client never answers, preference or not</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R236 · Tests: 205-haste-auto-ready.test.ts · Key: annexd.auto-pass.haste-ready.any-play</sub>

<a id="rD2.5b"></a>**D2.5b** Bluff haste is a preference, off by default and remembered by the browser. With it on, the client never finishes the haste step for the player; they stay in the step until they finish it themselves, whether or not they hold anything to play. See rule 504.5a.

> *Example (non-normative): With bluff haste on, the client sits in the step and offers the button.* <sub>test: 205-haste-auto-ready.test.ts::R236 §2c: with the preference ON the client sits in the step and offers the button</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R236, R236 · Tests: 205-haste-auto-ready.test.ts, 200-haste-step-is-unconditional.test.ts · Key: annexd.auto-pass.haste-ready.bluff</sub>

<a id="rD2.5c"></a>**D2.5c** The server never finishes the haste step for a player. The automatic ready, when there is one, comes from the player's own client. See rule 504.5a.

> *Example (non-normative): Both seats have to close the step; neither is marked done for them.* <sub>test: 200-haste-step-is-unconditional.test.ts::R228 §5: no seat is auto-done, and BOTH have to close the step</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R228, R228 · Replaces: R18 (its auto-done marking reversed by R224 and R228) · Tests: 200-haste-step-is-unconditional.test.ts, 434-cr-digital-1.test.ts · Key: annexd.auto-pass.haste-ready.server-never</sub>

<a id="rD2.5d"></a>**D2.5d** While the haste step is open, neither player is shown whether the other has finished it. Each player sees their own readiness, and the end of the step is shown to both.

> *Example (non-normative): The opponent's view of my readiness reads not-done until the step ends.* <sub>test: 205-haste-auto-ready.test.ts::R236 §3a: the opponent is not served my haste readiness while the step is open</sub>

> *Example (non-normative): The step's end still reaches both seats.* <sub>test: 205-haste-auto-ready.test.ts::R236 §3b: the step's END is still public</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R236, R236, R236 · Tests: 205-haste-auto-ready.test.ts · Key: annexd.auto-pass.haste-ready.readiness-hidden</sub>

<a id="rD2.5e"></a>**D2.5e** The game's action counter is still sent to both players and rises on every action, in every hidden segment, so a modified client can tell that its opponent acted and when. The shipped client shows nothing from it. See rule D1.4.

> *Example (non-normative): Across the haste step the only field that moves for the other seat is the action counter.* <sub>test: 205-haste-auto-ready.test.ts::R236 §3d: the residual, named and measured</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R236, R236 · Tests: 205-haste-auto-ready.test.ts · Key: annexd.auto-pass.haste-ready.residual</sub>

<sub>Discrepancies: D-U23-5 (discrepancies.md)</sub>

<a id="rD2.6"></a>**D2.6.** When passing would end the battle phase while the player still holds spell tokens they could cast, the client asks before sending the pass, because moving to regroup erases them. It asks on that pass only, not in the battle's other windows. See rule 506.

> *Example (non-normative): The Pass button asks before the pass that reaches Regroup, and only that one.* <sub>test: 77-playtest-round17.test.ts::[66] the Pass button asks before the pass that reaches Regroup, and only that one</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R194 · Tests: 77-playtest-round17.test.ts, 165-token-loss-warning.test.ts · Key: annexd.auto-pass.regroup-confirm</sub>

<a id="rD2.6a"></a>**D2.6a** When the battle phase ends with no pass to ask on (an attack declined with no window left, or a whole battle declined), the loss is announced instead: as regroup starts, each player who loses unused spell tokens is told which. Nothing is announced when nothing is lost.

> *Example (non-normative): A battle both players decline opens no priority window, and the token loss is still announced.* <sub>test: 165-token-loss-warning.test.ts::[CT-55] a battle both players decline opens no priority window at all, and the loss is still announced</sub>

> *Example (non-normative): The announcement is per seat, in a fixed order, and silent when nothing is lost.* <sub>test: 165-token-loss-warning.test.ts::[CT-55] the announcement is per seat, in a fixed order, and silent when there is nothing to lose</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R194, R194 · Tests: 165-token-loss-warning.test.ts · Key: annexd.auto-pass.regroup-confirm.announced</sub>

<a id="rD2.6b"></a>**D2.6b** A battle ended by a card while it resolves (Temporal Rift) cannot be warned about before the pass, since that cannot be known when the pass is made. The announcement covers it, as it covers every way a battle ends.

> *Example (non-normative): The pass under Temporal Rift does not read as ending the battle, yet the regroup announcement still fires when the Rift ends it.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.regroup-confirm.card-ended — the pass under Temporal Rift does not read as ending the battle, yet the regroup announcement still fires when the Rift ends it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R213, R213 · Tests: 434-cr-digital-1.test.ts · Key: annexd.auto-pass.regroup-confirm.card-ended</sub>

<a id="rD2.7"></a>**D2.7.** Full control is held, not set. While a player holds the Control key, the client gives them every stop: auto-pass, standing passes, auto-yields and the automatic haste-step ready all stand down. When they let go, everything returns to how it was.

> *Example (non-normative): With full control held, the auto-pass preference sends nothing.* <sub>test: 272-full-control.test.ts::BL-18 §2 with full control ON, the auto-pass preference sends nothing</sub>

> *Example (non-normative): Letting go restores the previous behaviour in one keyup.* <sub>test: 272-full-control.test.ts::CT-183 §6 letting go goes right back to the way it was</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R287, R287, R287 · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.full-control</sub>

<a id="rD2.7a"></a>**D2.7a** This includes deployment: while a player holds full control, nothing on their deployment stack resolves automatically. Engine differs, see F-U23-1. See rule 507. *(Engine differs, see F-U23-1.) (Untested: no executed test demonstrates it.)*

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R287, R287 · Key: annexd.auto-pass.full-control.deployment</sub>

<sub>Discrepancies: D-U23-4 (discrepancies.md)</sub>

<a id="rD2.7b"></a>**D2.7b** The client's own automatic actions stop at once when Control is pressed. The server's automatic actions stop only once the message reaches it, and an automatic action already sent is not recalled, so full control should be held before acting, not after.

> *Example (non-normative): The switch reaches the server on the join and on every change.* <sub>test: 272-full-control.test.ts::BL-18 §3 the switch reaches the SERVER, on the join and on every change</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R287, R287 · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.full-control.latency</sub>

<a id="rD2.7c"></a>**D2.7c** Leaving the window (switching away, hiding the page) releases full control, as if the key had been let go.

> *Example (non-normative): Alt-tabbing away is letting go.* <sub>test: 272-full-control.test.ts::CT-183 §6 (b) alt-tabbing away is letting go</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R287 · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.full-control.release</sub>

<a id="rD2.7d"></a>**D2.7d** Pressing another key while Control is down (Ctrl+Z, or a browser shortcut) makes a chord, not full control: it drops the hold until Control is released. See rule D4.

> *Example (non-normative): Ctrl+Z is undo, not full control.* <sub>test: 272-full-control.test.ts::CT-183 §6 (c) Ctrl+Z is undo, not full control</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R287, R287 · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.full-control.chord</sub>

<a id="rD2.7e"></a>**D2.7e** Full control is not remembered between sessions. The client shows whether it is being held.

> *Example (non-normative): The hold is not written to the browser.* <sub>test: 272-full-control.test.ts::CT-183 §6 the hold is not written to the browser</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R287 · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.full-control.not-persisted</sub>

<a id="rD2.8"></a>**D2.8.** When a spell has one target slot that must be an ally and another that may be any unit, and the player picks an ally for the second slot, the client asks whether they meant to target their own unit. It never refuses: yes resolves exactly as chosen, and no returns to the same target pick with nothing sent. See rules D7, D1.1a.

> *Example (non-normative): Fight with both picks on the caster's own units asks once before the cast goes out (illustrative).*

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R288, R288, R288 · Key: annexd.auto-pass.misclick-confirm</sub>

<a id="rD2.8a"></a>**D2.8a** The cards that ask are found from their target slots, not listed by name. Today they are Fight and Squish. Organic Exchange, which targets two units with no ally slot, does not ask.

> *Example (non-normative): Reading every card's target slots over the whole pool finds exactly Fight and Squish; Organic Exchange is not among them.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.auto-pass.misclick-confirm.family — the family derived from target slots over the whole pool is exactly Fight and Squish</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R288, R288 · Tests: 434-cr-digital-1.test.ts · Key: annexd.auto-pass.misclick-confirm.family</sub>

<sub>Discrepancies: D-U23-10 (discrepancies.md)</sub>

<a id="rD2.9"></a>**D2.9.** This client has no way to keep priority after acting: when a player puts something on the stack in battle, priority goes to the opponent. A player can still respond to their own spell, once priority comes back to them with it still on the stack. See rule 703.

> *Example (non-normative): The defender casts a spell, the attacker passes, and the defender casts a second spell on top of the first.* <sub>test: 272-full-control.test.ts::BL-18 §4 you can respond to your own spell with the first still on the stack</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 272-full-control.test.ts · Key: annexd.auto-pass.no-retain</sub>

<sub>Discrepancies: D-U23-16 (discrepancies.md)</sub>

<a id="rD3"></a>
### D3. Clocks

<a id="rD3.1"></a>**D3.1.** A game may be played with a chess clock, in which each player has a bank of time. The home screen offers three settings: no clock, 45 minutes and 60 minutes.

> *Example (non-normative): The picker offers Off, 45m and 60m.* <sub>test: 271-clock-picker-and-warning.test.ts::BL-26 §4 the home screen offers the owner's three banks, including no clock at all</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 271-clock-picker-and-warning.test.ts · Key: annexd.clocks.banks</sub>

<sub>Discrepancies: D-U23-1 (discrepancies.md)</sub>

<a id="rD3.1a"></a>**D3.1a** Unless the player chooses otherwise, the bank is 45 minutes for a constructed game and 60 minutes for a live draft.

> *Example (non-normative): The default is looked up by mode when the game is created.* <sub>test: 271-clock-picker-and-warning.test.ts::BL-26 §4 the default follows the MODE</sub>

<sub>Basis: Engine only · Verified: confirmed, round 2, 1 test run · Tests: 271-clock-picker-and-warning.test.ts · Key: annexd.clocks.banks.default</sub>

<a id="rD3.1b"></a>**D3.1b** A game with no clock shows no clocks.

> *Example (non-normative): A client never sent a clock draws none.* <sub>test: 271-clock-picker-and-warning.test.ts::BL-26 §1 a client that was never sent a clock draws no clocks at all</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 271-clock-picker-and-warning.test.ts · Key: annexd.clocks.banks.off</sub>

<a id="rD3.1c"></a>**D3.1c** Choosing a clock setting does not make a game a custom game.

> *Example (non-normative): Changing the clock leaves the game standard.* <sub>test: 366-clock-in-options.test.ts::366 changing the clock does not make the game custom</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 366-clock-in-options.test.ts · Key: annexd.clocks.banks.not-custom</sub>

<a id="rD3.1d"></a>**D3.1d** A player's clock is shown as critical when it is down to a tenth of the game's bank or to one minute, whichever is less.

> *Example (non-normative): On a ninety-second bank the warning comes at nine seconds; on a ten-hour bank five minutes left is not yet critical, because the threshold stops at one minute.* <sub>test: 271-clock-picker-and-warning.test.ts::BL-27 §2 the threshold is a tenth of the ROOM'S bank, not a constant</sub>

> *Example (non-normative): On the 45- and 60-minute banks the warning comes at one minute (illustrative).*

<sub>Basis: Engine only · Verified: confirmed, round 2, 1 test run · Tests: 271-clock-picker-and-warning.test.ts · Key: annexd.clocks.banks.critical</sub>

<sub>Discrepancies: D-U23-19 (discrepancies.md)</sub>

<a id="rD3.2"></a>**D3.2.** A player's clock runs only while the game is waiting on that player, and only while both players are connected.

> *Example (non-normative): A clock runs only for a seat the game is waiting on, and only while both players are connected.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running — a clock runs only for a seat the game is waiting on, and only while both players are connected</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.running</sub>

<sub>Discrepancies: D-U23-2 (discrepancies.md)</sub>

<a id="rD3.2a"></a>**D3.2a** In a step both players take at once, both clocks run; a player's clock stops when that player finishes the step. See rule D1.4.

> *Example (non-normative): After one player finishes the resource step, the haste step or deployment, that player has nothing left to do while the other still has legal actions.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running.simultaneous — in planning and the haste step both seats are waited on, and a seat that has finished has no legal action left</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.running.simultaneous</sub>

<a id="rD3.2b"></a>**D3.2b** A player's clock does not run in a priority window that their standing pass is answering, and the other player, who has nothing to do there, is not billed either. A real choice is billed even while a standing pass is set. If the client's pass has not arrived within a short backstop, the server passes for the player, and that pass is logged like any other. See rule D2.2.

> *Example (non-normative): The armed seat is not billed in the window its pass answers, the other seat neither, and the backstop pass after the delay goes in the log.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.clocks.running.standing-pass — the armed seat is not billed in the window its pass answers, the other seat neither, and the backstop pass after the delay goes in the log</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.running.standing-pass</sub>

<sub>Discrepancies: D-U23-3 (discrepancies.md)</sub>

<a id="rD3.2c"></a>**D3.2c** A player watching a recap is off the clock until the playback ends or the server's hold on it lapses. Acting ends the hold. See rule D5.

> *Example (non-normative): A seat watching a playback is not billed.* <sub>test: 360-playback-frames.test.ts::§8 a seat watching a playback is off the clock until it is done, or the hold lapses</sub>

> *Example (non-normative): The hold starts when the playback is sent and ends when the client says so or the seat acts.* <sub>test: 360-playback-frames.test.ts::§8b the server holds the clock when it sends a playback</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 360-playback-frames.test.ts, 372-recap-end-pause.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.running.playback</sub>

<a id="rD3.3"></a>**D3.3.** A player whose clock runs out loses the game, and the log says they ran out of time. This happens even if neither player acts. See rule 104.

> *Example (non-normative): A seat whose clock runs out loses with no move made, and the log says they ran out of time.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.clocks.out-of-time — a seat whose clock runs out loses with no move made, and the log says they ran out of time</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.out-of-time</sub>

<a id="rD3.4"></a>**D3.4.** A game is closed when nobody has moved in it for an hour, if fewer than five actions have been taken, or for twelve hours otherwise, and nobody (no player and no watcher) has been connected to it for the five-minute reconnect grace. An open tab keeps an idle game open.

> *Example (non-normative): A short game left alone closes after an hour.* <sub>test: 367-idle-rooms-close.test.ts::367 §1 a room with fewer than five actions closes after an hour without a move, not before</sub>

> *Example (non-normative): A longer game left alone closes after twelve hours.* <sub>test: 367-idle-rooms-close.test.ts::367 §2 a room with five or more actions closes after twelve hours without a move, not before</sub>

> *Example (non-normative): A connected seat or a watcher keeps an idle room open; an empty one gets a grace to reconnect.* <sub>test: 367-idle-rooms-close.test.ts::367 §3 a connected seat or a watcher keeps an idle room open, and an empty one gets a grace to reconnect</sub>

<sub>Basis: Engine only · Verified: confirmed, round 3, 1 test run · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.idle-rooms</sub>

<a id="rD3.4a"></a>**D3.4a** A connected player or a watcher keeps an idle game open, and an empty game is given a grace period for a player to reconnect.

> *Example (non-normative): A connected seat or a watcher keeps the room open.* <sub>test: 367-idle-rooms-close.test.ts::367 §3 a connected seat or a watcher keeps an idle room open</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.idle-rooms.kept-open</sub>

<a id="rD3.4b"></a>**D3.4b** A game closed for being idle has no winner, is not rated, and is recorded as unfinished.

> *Example (non-normative): A closed game reads as unfinished.* <sub>test: 367-idle-rooms-close.test.ts::367 §6 a closed game has no winner, is not rated and reads as unfinished</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 367-idle-rooms-close.test.ts, 434-cr-digital-1.test.ts · Key: annexd.clocks.idle-rooms.no-result</sub>

<a id="rD4"></a>
### D4. Undo

<a id="rD4.1"></a>**D4.1.** Inside a hidden simultaneous segment, a player may undo their own actions, one at a time, back toward the start of the step, within the limits of the rules below. See rule D1.4.

> *Example (non-normative): An earlier deployment play can be undone when nothing hidden has been seen since.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §2: an undo of an earlier play BEFORE any glimpse still works</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R312 · Tests: 374-undo-locks-on-reveal.test.ts, suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.hidden-step</sub>

<sub>Discrepancies: D-U23-7 (discrepancies.md)</sub>

<a id="rD4.1a"></a>**D4.1a** The opponent acting in the same step does not stop a player's undo.

> *Example (non-normative): The opponent acting in the same step does not stop my undo.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.undo.hidden-step.opponent — the opponent acting in the same step does not stop my undo</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.hidden-step.opponent</sub>

<a id="rD4.1b"></a>**D4.1b** An undo cannot go back past what the step itself did as it began, such as a payment or an ability that happens at the start of the step.

> *Example (non-normative): An undo stops at what the step did as it began: the answer to a start-of-deployment trigger cannot be taken back.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.undo.hidden-step.floor — an undo stops at what the step did as it began: the answer to a start-of-deployment trigger cannot be taken back</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: suite.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.hidden-step.floor</sub>

<a id="rD4.1c"></a>**D4.1c** Actions taken in battle are not undone. For that reason an irreversible activated ability asks for confirmation in battle, while in deployment it activates on the click and undo is the safety net. See rule D7.

> *Example (non-normative): In deployment an irreversible ability activates on the click.* <sub>test: 373-no-confirm-where-undo-works.test.ts::in deployment, an irreversible ability activates on the click</sub>

> *Example (non-normative): In battle the same ability asks "Yes, activate" first.* <sub>test: 373-no-confirm-where-undo-works.test.ts::in battle, the same ability still asks</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 373-no-confirm-where-undo-works.test.ts · Key: annexd.undo.hidden-step.battle</sub>

<sub>Discrepancies: D-U23-11 (discrepancies.md)</sub>

<a id="rD4.2"></a>**D4.2.** A cast that has not yet gone on the stack, while its X, costs or targets are still being chosen, may be cancelled. A Burst group is cancelled whole. See rules 702, 803.

> *Example (non-normative): A cast still choosing its targets is cancelled: the card is back in hand and nothing went on the stack.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.undo.cast-cancel — a cast still choosing its targets is cancelled: the card is back in hand and nothing went on the stack</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R312, R309, R309 · Tests: 434-cr-digital-1.test.ts · Key: annexd.undo.cast-cancel</sub>

<a id="rD4.3"></a>**D4.3.** An action that showed a player hidden cards cannot be undone, and neither can anything that player did before it.

> *Example (non-normative): A Glimpse in deployment cannot be undone.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §1: a Glimpse in deployment cannot be undone</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R312, R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards</sub>

<a id="rD4.3a"></a>**D4.3a** Actions the player took after that one can still be undone, back to just after it.

> *Example (non-normative): A spawn after the glimpse is undoable back to the glimpse, and not past it.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §3: a plain spawn after the glimpse is undoable back to the glimpse</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R312, R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.after</sub>

<a id="rD4.3b"></a>**D4.3b** The refusal reads "you've seen those cards — that can't be taken back".

> *Example (non-normative): The refusal reads: you have seen those cards and that cannot be taken back.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.undo.seen-cards.message — the refusal reads: you have seen those cards and that cannot be taken back</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.message</sub>

<a id="rD4.3c"></a>**D4.3c** Only the player who saw the cards is locked. The opponent looking at a shared deck does not lock a player's undo, since inside a hidden step it shows that player nothing.

> *Example (non-normative): The opponent's glimpse of the shared deck leaves my undo free.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §5: the opponent's glimpse of the SHARED deck does not lock your undo</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 0 tests run · Rulings: R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.only-seer</sub>

<a id="rD4.3d"></a>**D4.3d** An undo is refused if it would change cards the opponent has already been shown.

> *Example (non-normative): Taking back a shuffle after the opponent glimpsed the deck it shuffled is refused (illustrative).*

> *Example (non-normative): My undo is refused when it would change the cards the opponent has since been shown.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.undo.seen-cards.opponent-shown — my undo is refused when it would change the cards the opponent has since been shown</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R312 · Tests: 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.opponent-shown</sub>

<a id="rD4.3e"></a>**D4.3e** Whether an action showed a player hidden cards is measured, not listed: an action counts if what it shows the player depends on the order of hidden cards. A glimpse, a draw, a reveal or a look at a hand counts. Playing a card from hand, recycling, or putting a card on the bottom of a deck does not. In a Single Card Duel nothing locks, since every card in the deck is the same. See rule D8.

> *Example (non-normative): A spawn trigger's Glimpse 1 in the haste step locks too.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §6: measured, not listed</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R312, R312, R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.measured</sub>

<a id="rD4.3f"></a>**D4.3f** The lock survives a server restart and an undo.

> *Example (non-normative): A restored room measures the lock again.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §4: the lock survives a restart</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R312 · Tests: 374-undo-locks-on-reveal.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.seen-cards.restart</sub>

<a id="rD4.4"></a>**D4.4.** In Learn to Play, undo works in every phase, under the same lock: a turn's draw, a glimpse or a look at the Bot's hand ends the undo of whatever came before it. Starting a turn again after a loss is a fresh attempt, not an undo. See rule D8.

> *Example (non-normative): A turn's draw ends the undo of the turn before.* <sub>test: 374-undo-locks-on-reveal.test.ts::R312 §7: Learn to Play applies the same floor</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R312, R312, R312 · Tests: 374-undo-locks-on-reveal.test.ts, 306-solo-backend.test.ts, 434-cr-digital-1.test.ts · Key: annexd.undo.learn-to-play</sub>

<a id="rD5"></a>
### D5. Recap and Playback

<a id="rD5.1"></a>**D5.1.** When the haste step or deployment ends, each player is shown what the other did there as a playback (the recap): one frame per move, in the order the moves were made. See rule D1.4b.

> *Example (non-normative): A haste step closes into frames the same way as deployment.* <sub>test: 360-playback-frames.test.ts::§7 a haste step closes into frames the same way</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310, R310 · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what</sub>

<a id="rD5.1a"></a>**D5.1a** The recap changes nothing in the game. A game played with recap frames is the same game, action for action, as one without them.

> *Example (non-normative): Frames do not alter the action log.* <sub>test: 360-playback-frames.test.ts::§1 a game with frames is the same game without them</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what.no-effect</sub>

<a id="rD5.1b"></a>**D5.1b** A frame of the opponent's move shows that move on their side, their hand still face down, and the player's own side as the player left it.

> *Example (non-normative): Their move on their half, their hand face down, your half as you left it.* <sub>test: 360-playback-frames.test.ts::§3 an opponent frame</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what.opponent-frame</sub>

<a id="rD5.1c"></a>**D5.1c** A move with nothing to show is not given a frame, but its log line is kept.

> *Example (non-normative): An empty move is not a step, and its line is not lost.* <sub>test: 360-playback-frames.test.ts::§4 a move with nothing to show is not a step</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what.nothing-to-show</sub>

<a id="rD5.1d"></a>**D5.1d** The end of turn is played as one frame per trigger, in order.

> *Example (non-normative): Each end-of-turn trigger gets its own frame.* <sub>test: 360-playback-frames.test.ts::§2 the end of turn is a frame per trigger</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what.end-of-turn</sub>

<a id="rD5.1e"></a>**D5.1e** The resource step is not played back: its close arrives whole, in one update. See rule 502.

> *Example (non-normative): The resource step close is sent whole in one update, with no playback.* <sub>test: 434-cr-digital-1.test.ts::cr:annexd.recap.what.resource-step — the resource step close is sent whole in one update, with no playback</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R310, R310 · Tests: 434-cr-digital-1.test.ts · Key: annexd.recap.what.resource-step</sub>

<a id="rD5.1f"></a>**D5.1f** Undoing a move inside the step removes that move's frame and keeps the others. See rule D4.

> *Example (non-normative): An undone move leaves no frame behind.* <sub>test: 360-playback-frames.test.ts::§6 undoing a move inside the step takes its frame with it</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 1 test run · Tests: 360-playback-frames.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.what.undo</sub>

<a id="rD5.2"></a>**D5.2.** A Glimpse made in a hidden step is shown to the opponent in the recap, exactly once, in the frame of the action that made it, with its card notice. The player who glimpsed sees their own reveal at once. A Glimpse in battle reaches the opponent at once. See rules D6, 801.

> *Example (non-normative): The opponent's glimpse notice pops when its recap frame plays, not before.* <sub>test: 371-glimpse-in-the-recap.test.ts::R310 §1: the opponent's glimpse notice pops when its recap frame plays, not before</sub>

> *Example (non-normative): The reveal plays in the frame of the Oracle play and nowhere else.* <sub>test: 203-reveal-waits-for-the-barrier.test.ts::R310 §3: the reveal plays in the recap</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R310, R310, R310 · Replaces: R235 (reversed by R310: a reveal in a hidden step was public immediately) · Tests: 371-glimpse-in-the-recap.test.ts, 203-reveal-waits-for-the-barrier.test.ts · Key: annexd.recap.glimpse</sub>

<a id="rD5.3"></a>**D5.3.** The deployment recap pauses after the opponent's moves and again after the end of turn; the haste step's recap pauses the same way. Skip jumps to the next pause, never past it. A quiet end of turn does not pause twice.

> *Example (non-normative): The deployment recap stops after their moves and after the end of turn.* <sub>test: 383-recap-stops.test.ts::report #198: the deployment recap stops after their moves</sub>

> *Example (non-normative): Skip jumps to the next stop, never past it.* <sub>test: 383-recap-stops.test.ts::report #198: Skip jumps to the next stop, never past it</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 383-recap-stops.test.ts · Key: annexd.recap.stops</sub>

<sub>Discrepancies: D-U23-8 (discrepancies.md)</sub>

<a id="rD5.3a"></a>**D5.3a** A recap can be watched again. Watching again pauses at the same places, shows the glimpse notices again, and hands back the board.

> *Example (non-normative): Watch again stops at the same places and hands back the board.* <sub>test: 383-recap-stops.test.ts::report #198: "watch again" stops at the same places</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310 · Tests: 383-recap-stops.test.ts · Key: annexd.recap.stops.watch-again</sub>

<a id="rD5.3b"></a>**D5.3b** The hand-over to the next turn at the end of a recap pauses longer than a frame. Every recap, live, watched again or in Learn to Play, is paced by the same rule.

> *Example (non-normative): The hand-over waits longer than a frame.* <sub>test: 372-recap-end-pause.test.ts::the hand-over to the next turn waits PLAYBACK_END_MS, longer than a frame</sub>

> *Example (non-normative): Live, watch-again and Learn to Play use one gap rule.* <sub>test: 372-recap-end-pause.test.ts::every playback goes through the one gap rule</sub>

<sub>Basis: Engine only · Verified: confirmed, round 1, 2 tests run · Tests: 372-recap-end-pause.test.ts · Key: annexd.recap.stops.end-pause</sub>

<a id="rD5.4"></a>**D5.4.** The client shows play no faster than one step per second. This one tempo paces both the updates the client receives and the steps within a single update.

> *Example (non-normative): The beat tempo is the client-wide ceiling.* <sub>test: 218-one-tempo.test.ts::§1a the beat tempo IS the client-wide ceiling</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R150 (its CT-28 pacing half), R242 · Tests: 218-one-tempo.test.ts, 128-ui-pace.test.ts · Key: annexd.recap.tempo</sub>

<a id="rD5.4a"></a>**D5.4a** Items that happen at the same time under the rules arrive on screen together, then leave one at a time, in resolution order, one tempo step apart. The next group waits until this one has finished.

> *Example (non-normative): A simultaneous batch shares one arrival.* <sub>test: 218-one-tempo.test.ts::§2a "all at once": a simultaneous batch shares ONE arrival</sub>

> *Example (non-normative): They leave in resolution order.* <sub>test: 218-one-tempo.test.ts::§2c they leave in RESOLUTION order</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R242, R242 · Tests: 218-one-tempo.test.ts · Key: annexd.recap.tempo.cascade</sub>

<a id="rD5.4b"></a>**D5.4b** Only an update the player cannot act on is held back to keep the tempo. A decision for the player, the echo of the player's own action and the end of the game are never held, and an update with legal actions is never held unless auto-pass will answer it. See rule D2.3.

> *Example (non-normative): A decision of mine is never held.* <sub>test: 128-ui-pace.test.ts::R150 #94: a decision of MINE is never held</sub>

> *Example (non-normative): The game ending is never held.* <sub>test: 128-ui-pace.test.ts::R150 #94: the game ending is never held</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R150 (its CT-28 pacing half), R150 (its CT-28 pacing half) · Tests: 128-ui-pace.test.ts · Key: annexd.recap.tempo.held</sub>

<a id="rD5.4c"></a>**D5.4c** When an update the player can act on arrives, everything held before it is released with it, in order, so the player is never asked a question over an old board.

> *Example (non-normative): An urgent arrival flushes the backlog rather than jumping it.* <sub>test: 128-ui-pace.test.ts::R150 #94: an urgent arrival FLUSHES the backlog rather than jumping it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R150 (its CT-28 pacing half) · Tests: 128-ui-pace.test.ts · Key: annexd.recap.tempo.flush</sub>

<a id="rD5.4d"></a>**D5.4d** The player's own input is never delayed by the tempo.

> *Example (non-normative): My own action's echo is never held.* <sub>test: 128-ui-pace.test.ts::R150 #94: my OWN action's echo is never held</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R150 (its CT-28 pacing half) · Tests: 128-ui-pace.test.ts · Key: annexd.recap.tempo.input</sub>

<a id="rD5.4e"></a>**D5.4e** The screen never falls more than a fixed number of tempo steps behind the live game.

> *Example (non-normative): The queue never falls further than its bound behind.* <sub>test: 128-ui-pace.test.ts::R150 #94: the queue never falls further than PACE_MAX_HELD intervals behind</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R242 · Tests: 128-ui-pace.test.ts, 218-one-tempo.test.ts · Key: annexd.recap.tempo.lag-bound</sub>

<a id="rD5.5"></a>**D5.5.** Outside a recap playback, while play is being held back, the S key jumps to the live state. Skipping drops pending animations but still delivers the held log lines. No skip control is drawn for this. See rules D5.5c, D5.3.

> *Example (non-normative): Several held arrivals draw nothing on screen, and S releases them all.* <sub>test: 237-live-while-held.test.ts::R258 several held arrivals still draw nothing, and S releases them all</sub>

> *Example (non-normative): Skipping releases the beats rather than dropping them.* <sub>test: 218-one-tempo.test.ts::§4b skipping RELEASES the beats rather than dropping them</sub>

<sub>Basis: Owner call · Verified: confirmed, round 3, 3 tests run · Rulings: R150 (its CT-28 pacing half), R242, R242 · Tests: 237-live-while-held.test.ts, 218-one-tempo.test.ts · Key: annexd.recap.skip</sub>

<sub>Discrepancies: D-U23-18 (discrepancies.md)</sub>

<a id="rD5.5a"></a>**D5.5a** While play is held, whether the opponent is connected, and the clocks, stay current; nothing else on the board changes until the held updates are released.

> *Example (non-normative): A disconnect that arrives while play is held is on screen at once.* <sub>test: 237-live-while-held.test.ts::R258 a disconnect that arrives while the throttle is holding is on screen at once</sub>

> *Example (non-normative): A plain held update moves nothing on screen.* <sub>test: 237-live-while-held.test.ts::R258 a held update moves the live slots and NOTHING else on the board</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R258 · Tests: 237-live-while-held.test.ts · Key: annexd.recap.skip.live</sub>

<a id="rD5.5b"></a>**D5.5b** A disconnect is shown at once, not queued behind held updates, and showing it does not release them.

> *Example (non-normative): A disconnect that arrives while the throttle is holding is on screen at once.* <sub>test: 237-live-while-held.test.ts::R258 a disconnect that arrives while the throttle is holding is on screen at once</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R258 · Tests: 237-live-while-held.test.ts · Key: annexd.recap.skip.disconnect</sub>

<a id="rD5.5c"></a>**D5.5c** During a recap playback, skipping does not jump to the live state. Skip (the S key, Space, or the Skip button drawn on the play bar) jumps to the next stop, and on a stop it continues the playback. See rules D5.3, D5.5.

> *Example (non-normative): Skip jumps to the next stop, never past it.* <sub>test: 383-recap-stops.test.ts::report #198: Skip jumps to the next stop, never past it</sub>

<sub>Basis: Engine only · Verified: confirmed, round 3, 1 test run · Tests: 383-recap-stops.test.ts, 434-cr-digital-1.test.ts · Key: annexd.recap.skip.in-playback</sub>

<sub>Discrepancies: D-U23-22 (discrepancies.md)</sub>

<a id="rD6"></a>
### D6. Reveal Timing of Simultaneous Steps

<a id="rD6.1"></a>**D6.1.** The resource step, the haste step and deployment are hidden simultaneous steps. Inside one, both players act at the same time, and neither is shown what the other does until the step ends. The end of the step is the reveal: everything the other player did in the step is shown then. At the end of the haste step and of deployment it is played back in the recap. See rule D6.2.

> *Example (non-normative): During deployment, nothing a player does in their region reaches the other player until deployment ends.* <sub>test: 203-reveal-waits-for-the-barrier.test.ts::R310 §4: of everything a hidden step emits, nothing reaches the other seat before the barrier</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310, R310, R78, R310, R310 · Replaces: R235 (reversed by R310 (a reveal inside a hidden step had escaped the hold)) · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-steps</sub>

<a id="rD6.1a"></a>**D6.1a** Inside a hidden step, the other player's side of the game is shown as it stood when the step opened. The events the other player's actions produce are held and delivered at the end of the step. Whether the other player has finished the step is not frozen: it is shown live, except in the haste step, where the other player's readiness is hidden while the step is open.

> *Example (non-normative): In Learn to Play, a unit the Tutorial Bot casts during deployment is not shown to the learner until deployment closes.* <sub>test: 306-solo-backend.test.ts::§2 inside deployment the bot's cast is frozen out, and revealed when the step closes</sub>

<sub>Basis: Owner call · Verified: confirmed, round 3, 1 test run · Rulings: R78 (its note that viewFor freezes the other seat's players and entities inside a segment), R310, R310, R228 (its general live done-flag clause; its haste half is overridden by R236), R236 · Tests: 306-solo-backend.test.ts, 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-steps.frozen</sub>

<a id="rD6.1b"></a>**D6.1b** In the haste step and in deployment, the shared deck count and the shared recycle count are shown to both players as they were when the step opened. A player's own play that moves cards into or out of those piles shows on the counts only at the reveal.

> *Example (non-normative): A player glimpses during deployment. The shared deck count does not drop for either player until deployment ends.* <sub>test: 203-reveal-waits-for-the-barrier.test.ts::R310 §1: the shared deck and recycle counts do not move under a hidden Glimpse</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310, R310 · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-steps.counts</sub>

<a id="rD6.1c"></a>**D6.1c** Nothing is held during the battle phase. What happens in battle is shown to every player as it happens.

> *Example (non-normative): Premonition is cast in battle. Its Glimpse reveal reaches the opponent at once.* <sub>test: 159-glimpse-reveal-visibility.test.ts::Premonition: the Glimpse X reveal is public to the opponent (R41/R45)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310 · Tests: 159-glimpse-reveal-visibility.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-steps.battle</sub>

<a id="rD6.1d"></a>**D6.1d** While the haste step is open, a player is not shown whether the other player has finished it. Each player sees their own readiness. The end of the step is shown to both players.

> *Example (non-normative): One player finishes the haste step while the other is still choosing. The other player is not told that the first has finished.* <sub>test: 205-haste-auto-ready.test.ts::R236 §3a: the opponent is not served my haste readiness while the step is open</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R236, R236 · Tests: 205-haste-auto-ready.test.ts · Key: annexd.reveal.hidden-steps.haste-ready</sub>

<a id="rD6.2"></a>**D6.2.** A glimpse that happens inside a hidden step is shown to the other player at the reveal, not when it happens. At the end of the haste step or deployment it plays in the recap, at the moment it happened. See rule D6.1.

> *Example (non-normative): Oracle of Foretelling is played during deployment and glimpses 5. The opponent learns the five cards when deployment ends, in the recap.* <sub>test: 159-glimpse-reveal-visibility.test.ts::Oracle of Foretelling: its reveal is inside the hidden deployment segment, and waits for the barrier (R310)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310, R310 · Replaces: R235 (reversed by R310: R235 had made the reveal public immediately); R222 (reversed by R310: the same "immediately" answer, round 29); R188 (the open question (barrier or moment), absorbed into R310) · Tests: 203-reveal-waits-for-the-barrier.test.ts, 159-glimpse-reveal-visibility.test.ts, 371-glimpse-in-the-recap.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.glimpse</sub>

<a id="rD6.2a"></a>**D6.2a** The player who glimpses sees their own revealed cards when they glimpse.

> *Example (non-normative): Oracle of Foretelling glimpses during deployment. Its controller is sent the revealed cards on the action that glimpses; the opponent is sent nothing until the step ends.* <sub>test: 203-reveal-waits-for-the-barrier.test.ts::R310 §1: inside deployment the opponent is sent nothing of a Glimpse — live or on a resync</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R310 · Tests: 203-reveal-waits-for-the-barrier.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.glimpse.own</sub>

<a id="rD6.2b"></a>**D6.2b** At the reveal the other player is shown the glimpse exactly once, with its card notice, and the finished game log holds it once.

> *Example (non-normative): The opponent's glimpse notice pops when the recap frame of the glimpse plays, and not before.* <sub>test: 371-glimpse-in-the-recap.test.ts::R310 §1: the opponent's glimpse notice pops when its recap frame plays, not before</sub>

> *Example (non-normative): When deployment ends, the opponent is sent the glimpse once, and the finished game log records it once.* <sub>test: 203-reveal-waits-for-the-barrier.test.ts::R310 §2: the barrier delivers the reveal exactly once, and the finished log holds it once</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R310, R310 · Tests: 203-reveal-waits-for-the-barrier.test.ts, 371-glimpse-in-the-recap.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.glimpse.once</sub>

<a id="rD6.2c"></a>**D6.2c** Holding a glimpse until the reveal only delays it. The revealed cards are public, and every player sees them. See rule D6.1c.

> *Example (non-normative): Foretell is played in battle. The card it reveals is shown to the opponent.* <sub>test: 159-glimpse-reveal-visibility.test.ts::Foretell: the Glimpse 1 reveal is public to the opponent (R41/R45)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310, R310 · Tests: 159-glimpse-reveal-visibility.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.glimpse.public</sub>

<a id="rD6.2d"></a>**D6.2d** The same holds in Learn to Play: a glimpse by the Tutorial Bot inside a hidden step is shown to the learner in the recap. See rule D8.1.

> *Example (non-normative): The Tutorial Bot glimpses during deployment. The learner's glimpse notice pops when the recap plays.* <sub>test: 371-glimpse-in-the-recap.test.ts::R310 §2: Learn to Play holds the bot's glimpse for the recap, and the recap pops it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R310 · Tests: 371-glimpse-in-the-recap.test.ts · Key: annexd.reveal.glimpse.learn-to-play</sub>

<a id="rD6.3"></a>**D6.3.** During the battle phase, when an item has begun to resolve and is waiting on a choice from its controller, every player is shown that the item is resolving and whose it is. The item has left the stack, and no player can respond to it (see 703.6). See rule 703.6.

> *Example (non-normative): An effect stops mid-resolution to ask its controller a question. Both players see it marked as resolving; neither can target or negate it.* <sub>test: 67-resolving-and-stack-viruses.test.ts::R78: a resolving item cannot be responded to, negated or targeted</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R78, R78 · Tests: 67-resolving-and-stack-viruses.test.ts · Key: annexd.reveal.resolving</sub>

<sub>Discrepancies: D-U24-3 (discrepancies.md)</sub>

<a id="rD6.3a"></a>**D6.3a** Outside the battle phase the other player is shown nothing of an item resolving. Its controller still sees the question.

> *Example (non-normative): Oracle of Foretelling is played in deployment and asks its controller which card to cache. The other player is served no resolving item and no pending question; the same kind of question from Premonition in battle is shown to them.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.reveal.resolving.battle-only — outside battle the other player is served nothing of an item resolving while its controller is asked; in battle they are</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R78, R78 · Tests: 435-cr-digital-2.test.ts · Key: annexd.reveal.resolving.battle-only</sub>

<a id="rD6.3b"></a>**D6.3b** While a resolution waits on a player's answer, every player is shown the board as it is partway through the resolution: whatever the effect has already done is on the table, including what its controller played and paid.

> *Example (non-normative): Insidious Invitation lets the caster play a unit first, then asks the opponent. When the opponent is asked, the caster's unit and spent mana are already on the table.* <sub>test: 72-resolution-window.test.ts::R85 Insidious Invitation: at the OPPONENT’s prompt, the caster’s play is already on the table</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R85, R85 · Tests: 72-resolution-window.test.ts · Key: annexd.reveal.resolving.partial</sub>

<a id="rD6.3c"></a>**D6.3c** On a board partway through a resolution, the only actions any player may take are answering the open question and conceding. See rule 104.4a.

> *Example (non-normative): Mid-resolution, neither player can cast or pass; the asked player can answer, and either player can concede.* <sub>test: 72-resolution-window.test.ts::R85 the mid-resolution board is a PREVIEW: only decide and concede are legal on it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R85 · Tests: 72-resolution-window.test.ts · Key: annexd.reveal.resolving.only-answer</sub>

<a id="rD6.4"></a>**D6.4.** Outside a hidden simultaneous step, that a player owes an answer to a question is public, and so is the card it comes from when that card is already in view. What the question is is not: its prompt, its options, its candidate targets and its kind are shown only to the player who must answer. Inside a hidden simultaneous step, not even the fact that the other player owes an answer is shown.

> *Example (non-normative): The attacker's Tempest Wrangler makes them choose an {Alluring} target. The defender's bar reads "Waiting for Rashi (Tempest Wrangler)" and names neither the prompt nor the candidate.* <sub>test: 50-ui-inspect.test.ts::R247: the pause bar names the effect an opponent is answering, off the server stub</sub>

<sub>Basis: Owner call · Verified: confirmed, round 3, 1 test run · Rulings: R247, R247, R247, R247, R247 · Tests: 50-ui-inspect.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.pending-choice</sub>

<a id="rD6.4a"></a>**D6.4a** The waiting player may be told which card the question comes from, but only when that card is already visible to them. Inside a hidden step, it is not named.

> *Example (non-normative): An opponent's {Alluring} trigger asks them to choose a target. The other player's bar names the opponent and the card the trigger came from, and nothing about the targets.* <sub>test: 50-ui-inspect.test.ts::R247: the pause bar names the effect an opponent is answering, off the server stub</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R247, R247 · Tests: 50-ui-inspect.test.ts · Key: annexd.reveal.pending-choice.source</sub>

<a id="rD6.5"></a>**D6.5.** No message the client receives names a card in a zone hidden from that player. When cards enter another player's hand, the player is told how many entered, not which. See rule 402.2.

> *Example (non-normative): The opponent draws two cards. The player sees the opponent's hand grow by two card backs and is not sent their names.* <sub>test: 172-event-channel-secrecy.test.ts::R202 §2: no event names a card in a zone the state channel hides — the invariant, not the instance</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R202, R202 · Tests: 172-event-channel-secrecy.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-names</sub>

<a id="rD6.5a"></a>**D6.5a** When an effect lets a player look at a hand, the cards seen are named in the game log to that player only. The other players' log says only that the hand was looked at. See rule 402.2a. *(Engine differs, see F-U24-5.) (Untested: no executed test demonstrates it.)*

> *Example (non-normative): Thought Extraction is aimed at a player's own hand. The opponent is not shown the cards in it.* <sub>test: 173-look-at-a-hand.test.ts::R197b §1 Thought Extraction: aimed at YOUR OWN hand, the opponent is the one seat it leaked to</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197b, R197b · Tests: 173-look-at-a-hand.test.ts · Key: annexd.reveal.hidden-names.look-at</sub>

<a id="rD6.5b"></a>**D6.5b** A card that an effect moves out of a hidden hand into another hidden zone, without the effect saying "reveal", is named only to the player who chose it. The other players are told that a card moved, not which.

> *Example (non-normative): Bripp recycles a card from the looked-at hand. The table is told a card was recycled; only Bripp's controller sees its name.* <sub>test: 173-look-at-a-hand.test.ts::R197b §1 Bripp: "Look at target player's hand" — and the card it recycles is not named to the table either</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197b, R197b · Tests: 173-look-at-a-hand.test.ts, 435-cr-digital-2.test.ts · Key: annexd.reveal.hidden-names.moved-card</sub>

<a id="rD6.6"></a>**D6.6.** Both players' caches are shown to both players in full: every cached card, and any prophecy attached to it (see 403.2). See rule 403.2.

> *Example (non-normative): Both players are sent the same cache contents for both caches.* <sub>test: 36-cache-prophecy.test.ts::R41: the cache is PUBLIC — both seats read the same zone, unredacted</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R41 · Tests: 36-cache-prophecy.test.ts · Key: annexd.reveal.public-zones</sub>

<a id="rD6.6a"></a>**D6.6a** A cached card whose prophecy condition counts toward a number shows its progress on the board, on its owner's cache, to every player. The count shown is the one for the cache's owner.

> *Example (non-normative): The opponent has prophesied Vengeance ("13 Units Die"). The player can see on the opponent's cache how many of the 13 deaths have been counted.* <sub>test: 294-prophecy-meter.test.ts::§4 it meters the OPPONENT's cache too — the zone is public (R41)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R302, R302 · Tests: 294-prophecy-meter.test.ts · Key: annexd.reveal.public-zones.prophecy-meter</sub>

<a id="rD6.6b"></a>**D6.6b** A prophecy whose condition is a state rather than a count shows no meter. A fulfilled prophecy shows as fulfilled instead of a meter.

> *Example (non-normative): A cached card whose prophecy reads "Your life is 5 or less" puts no meter on the board.* <sub>test: 294-prophecy-meter.test.ts::§4 a state condition puts no meter on the board — there is nothing to count</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R302, R302 · Tests: 294-prophecy-meter.test.ts · Key: annexd.reveal.public-zones.prophecy-state</sub>

<a id="rD6.6c"></a>**D6.6c** Any player may open either player's erased pile, from the menu of the bare table (see 407.1a). See rules 407.1a, D6.15.

> *Example (non-normative): A player right-clicks the empty table and opens the opponent's erased pile.* <sub>test: 216-menu-scoping.test.ts::§2 both field entries are still reachable — from bare table</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R241, R65 (its erased-pile half) · Replaces: R65 (narrowed by R241: its view-erased entry left the card menus for the bare-table menu) · Tests: 216-menu-scoping.test.ts · Key: annexd.reveal.public-zones.erased</sub>

<a id="rD6.6d"></a>**D6.6d** Either player may open either player's bin. When something on the stack targets a card in a bin, that card is brought to the top of the bin on the board, for both players.

> *Example (non-normative): A Hooba-Mon trigger on the stack targets a card six deep in a bin. That card is drawn on top of the bin for both players.* <sub>test: 260-cost-ramp-and-bin-targets.test.ts::R280 §7b the opponent sees the target too, which is the half the report is really about</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R280, R280 · Tests: 260-cost-ramp-and-bin-targets.test.ts · Key: annexd.reveal.public-zones.bin</sub>

<a id="rD6.6e"></a>**D6.6e** In constructed, the elements a player's deck contains are sent to both players. Whether they should be public at the start of the game is an open question for the owner (see the discrepancy report).

> *Example (non-normative): A fire deck plays a water deck in constructed. Each player is sent that one deck is fire and the other water.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.reveal.public-zones.deck-elements — in constructed, the deck elements of both players are in the view each player is sent</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R99, R99 · Tests: 435-cr-digital-2.test.ts · Key: annexd.reveal.public-zones.deck-elements</sub>

<sub>Discrepancies: D-U24-2 (discrepancies.md)</sub>

<a id="rD6.7"></a>**D6.7.** Things that happen at the same time in the rules are shown at the same time, and things that happen one after another are shown one after another.

> *Example (non-normative): Combat kills several units at once and their death triggers are queued together. All of them appear on the stack strip in one beat.* <sub>test: 160-simultaneous-trigger-beats.test.ts::R189 THE REPORT: a trigger sweep puts every trigger on the strip in ONE frame</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R189 (its pacing rule) · Replaces: R189 (amended by R242 (simultaneous items share one arrival but depart in resolution order); its sub-step fixture replaced by R261) · Tests: 160-simultaneous-trigger-beats.test.ts · Key: annexd.reveal.beats</sub>

<a id="rD6.7a"></a>**D6.7a** This pacing only explains what happened. It never delays the game: the board under it is already final.

> *Example (non-normative): While the beats of a death sweep are still playing, the units are already gone from the board state.* <sub>test: 160-simultaneous-trigger-beats.test.ts::R189 a beat explains and never gates: the board under it is already final</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R189 (its pacing rule), R189 (its pacing rule) · Tests: 160-simultaneous-trigger-beats.test.ts · Key: annexd.reveal.beats.never-gates</sub>

<a id="rD6.8"></a>**D6.8.** A unit that has become a copy of another card is drawn with the art of the card it copied, and stays marked as a copy. See rule 710.

> *Example (non-normative): Borrower of Forms copies Sporebloom Siren. It is drawn with Sporebloom Siren's art and a copy mark.* <sub>test: 198-copy-art.test.ts::R229 §1: a Borrower of Forms is DRAWN as the card it borrowed</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R229, R229 · Tests: 198-copy-art.test.ts · Key: annexd.display.copies</sub>

<sub>Discrepancies: D-U24-1 (discrepancies.md)</sub>

<a id="rD6.8a"></a>**D6.8a** A copy is marked even when its numbers match the card it copied. The bin shows the physical card, not the copied face.

> *Example (non-normative): Borrower of Forms (2/2) copies a 2/2. It still wears the copy mark.* <sub>test: 198-copy-art.test.ts::R229 §3b: a copy is marked even when the borrowed body matches its own</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R229, R229 · Tests: 198-copy-art.test.ts · Key: annexd.display.copies.marked</sub>

<a id="rD6.8b"></a>**D6.8b** A card that only borrows abilities from another, without taking its name, keeps its own art.

> *Example (non-normative): Ancient One shares the text box of an adjacent ally but keeps its own portrait.* <sub>test: 198-copy-art.test.ts::R229 §3: an Ancient One keeps its OWN art — a projection is not an identity</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R229 · Tests: 198-copy-art.test.ts · Key: annexd.display.copies.projection</sub>

<a id="rD6.9"></a>**D6.9.** Where a card's printed text uses a bare X, or names a card, and this copy of the card has a value for it, the text box shows that value in its place. Stat notation (X/X, +X/+X, -X/-X), the [x] cost pip and reminder text are never changed, even when X has a value. A board-read X on the stack is not written into the text box; it is shown as a forecast (see annexd.display.live-values.x-forecast). See rules D6.9c, D6.9a.

> *Example (non-normative): A Poison created with X = 5 reads "Put 5 -1/-1 counters on target unit".* <sub>test: 127-token-x-and-dormant.test.ts::R151/CT-33: a Poison created with X=5 says "Put 5 -1/-1 counters", from the engine</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 3 tests run · Rulings: R151, R279 (its §1, §3 and §4), R151, R151, R151, R151, R246 · Tests: 127-token-x-and-dormant.test.ts, 259-card-text-surface.test.ts · Key: annexd.display.live-values</sub>

<a id="rD6.9a"></a>**D6.9a** A token's text box shows its actual X in place of X. Stat notation such as X/X, +X/+X and -X/-X is never changed, and neither is reminder text.

> *Example (non-normative): A Poison created with X = 5 reads "Put 5 -1/-1 counters on target unit".* <sub>test: 127-token-x-and-dormant.test.ts::R151/CT-33: a Poison created with X=5 says "Put 5 -1/-1 counters", from the engine</sub>

> *Example (non-normative): A Robot reads its X off its counters, so its text changes when they change.* <sub>test: 127-token-x-and-dormant.test.ts::R151/CT-33: a Robot reads its X off its COUNTERS, so it stays true as they change</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R151, R151 · Tests: 127-token-x-and-dormant.test.ts · Key: annexd.display.live-values.token-x</sub>

<sub>Discrepancies: D-U24-4 (discrepancies.md)</sub>

<a id="rD6.9b"></a>**D6.9b** A card that names a card shows the named card in its text box, and so does a host carrying that text as a mod. With no card named, the printed text stands.

> *Example (non-normative): The Everywhere has named Triskaidekaphage. Its text box reads "Triskaidekaphage loses all abilities."* <sub>test: 259-card-text-surface.test.ts::CT-163: the box of the card that named says WHICH card it named</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R279 (its §1, §3 and §4), R279 (its §1, §3 and §4) · Replaces: R279 (its §2 copy premise replaced by R336; the substitution in §1 is unaffected) · Tests: 259-card-text-surface.test.ts · Key: annexd.display.live-values.named-card</sub>

<a id="rD6.9c"></a>**D6.9c** When a card on the stack reads its X from the board at resolution, and the card itself declares how to forecast that X, the stack shows what X would be right now, worded as a forecast. A declared mode narrows the forecast to that mode. If X was paid, the paid X is shown and no forecast is. A board-read X with no declared forecast shows none (see annexd.display.live-values.x-not-forecast). See rule D6.9e.

> *Example (non-normative): Retribution Thing is on the stack. It shows the X it would deal now.* <sub>test: 225-stack-readout.test.ts::§1a Retribution Thing wears its X on the stack, and it is the number it will deal</sub>

> *Example (non-normative): A spell whose X was paid shows only the paid X.* <sub>test: 225-stack-readout.test.ts::§1c a paid X still wins — the forecast never doubles it</sub>

> *Example (non-normative): Retribution Thing was cast in the life-lost mode. The stack shows only that mode's forecast.* <sub>test: 225-stack-readout.test.ts::§1b the declared mode narrows the forecast to the half that was chosen</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 3 tests run · Rulings: R246, R246, R246, R246 · Tests: 225-stack-readout.test.ts · Key: annexd.display.live-values.x-forecast</sub>

<a id="rD6.9d"></a>**D6.9d** Spell tokens in play are counted by name, with the X of each, because casting one burst token casts every token of that name (see 803). Each spell token shows its X as a large die face. See rule 803.

> *Example (non-normative): A player holds Fireball 1, Fireball 1 and Fireball 3. The strip shows one Fireball row: three of them, two at X = 1 and one at X = 3.* <sub>test: 233-burst-count-and-size.test.ts::§1b a group of one name at different sizes prints every size — the report verbatim</sub>

> *Example (non-normative): A Fireball with X = 3 shows a die face with three pips.* <sub>test: 358-burst-order-ui.test.ts::§3 a token wears its X as a die face, not "X=n" in the stat corner</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R254 (its §1, §3 and §4), R309 · Replaces: R254 (its §2 fixed entity-id cast order amended by R309 (the caster orders a burst)) · Tests: 233-burst-count-and-size.test.ts, 358-burst-order-ui.test.ts · Key: annexd.display.live-values.burst</sub>

<a id="rD6.9e"></a>**D6.9e** A card whose X is read from the board at resolution, but which declares no forecast for it, shows no forecast on the stack. See rule D6.9c.

> *Example (non-normative): Burden of Life on the stack shows no forecast; its X is its controller's life total, which is already on the screen. (illustrative)*

<sub>Basis: Owner call · Verified: partial, round 3, 1 test run · Rulings: R246 · Tests: 225-stack-readout.test.ts · Key: annexd.display.live-values.x-not-forecast</sub>

<sub>Discrepancies: D-U24-8 (discrepancies.md)</sub>

<a id="rD6.10"></a>**D6.10.** A card whose printed text box is empty, but whose type line carries attributes, shows those attributes and their reminders in its text box instead of "no rules text". A card with no text and no attributes still says it has no rules text. See rule 204.

> *Example (non-normative): Whispering Mantid has no ability text and {Sneaky} on its type line. Its text box shows {Sneaky} and its reminder.* <sub>test: 262-type-line-attributes.test.ts::R282: a card whose only rules content is a type-line attribute stops saying no rules text</sub>

> *Example (non-normative): Tidal Menace has no text and no attributes, and still says it has no rules text.* <sub>test: 262-type-line-attributes.test.ts::R282: a card with no attribute and no text still says nothing, and the guard does not reach it</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R282, R282 · Tests: 262-type-line-attributes.test.ts · Key: annexd.display.text-box</sub>

<a id="rD6.10a"></a>**D6.10a** A printed bracket that offers two modes is drawn as two boxes, one around each mode, with the "or" outside them. On the stack, the mode that was not chosen is no longer shown. See rule 111.

> *Example (non-normative): Void Memory's "[unit or spell]" is drawn as a unit box and a spell box with "or" between them.* <sub>test: 122-cardtext-markup.test.ts::R284: a MODAL bracket draws two boxes with the "or" outside them</sub>

> *Example (non-normative): A cost bracket is still one box.* <sub>test: 122-cardtext-markup.test.ts::R284: a COST bracket still draws exactly one box</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R284, R284 · Tests: 122-cardtext-markup.test.ts · Key: annexd.display.text-box.modal</sub>

<a id="rD6.10b"></a>**D6.10b** When a once-per-turn ability has been used, its note wears the marker printed on that ability: [Switch1] or [once]. A card that spells the limit out in words, with no marker, gets [Once].

> *Example (non-normative): A spent bounded graft ability shows [Switch1], as its card prints.* <sub>test: 228-spent-marker.test.ts::R249: a spent bounded GRAFT ability wears the [Switch1] its own card prints</sub>

> *Example (non-normative): A spent [once] ability shows [Once].* <sub>test: 228-spent-marker.test.ts::R249: a spent [once] ability wears [Once] — the same code, the other card</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R249, R249 · Tests: 228-spent-marker.test.ts · Key: annexd.display.text-box.spent</sub>

<a id="rD6.10c"></a>**D6.10c** A card that is {Unstable}, whether printed or acquired, shows {Unstable} on its attribute line, with how it became Unstable.

> *Example (non-normative): A modded unit shows {Unstable} on its attribute line, marked as coming from a mod.* <sub>test: 251-fizzle-label-and-mod-strips.test.ts::R271 §5b the acquired kind says WHICH way in, on the same line</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R271, R271 · Tests: 251-fizzle-label-and-mod-strips.test.ts · Key: annexd.display.text-box.unstable</sub>

<a id="rD6.10d"></a>**D6.10d** A card with a prophecy banner shows the banner in its text box, as printed, and carries the Prophecy reminder.

> *Example (non-normative): The Foretold, whose whole printed text box is its banner, shows the banner instead of "no rules text".* <sub>test: 259-card-text-surface.test.ts::CT-165: the printed prophecy banner is IN the box, on every card that prints one</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R279 (its §1, §3 and §4), R279 (its §1, §3 and §4) · Tests: 259-card-text-surface.test.ts · Key: annexd.display.text-box.prophecy</sub>

<a id="rD6.10e"></a>**D6.10e** A card that can transform shows, in its details, what it transforms into, before the transform's cost is paid. A card that has already transformed shows no such row.

> *Example (non-normative): Scholar of the Void's details say it transforms into Beyond, Codex Incarnate, before its hand-discard cost is paid.* <sub>test: 50-ui-inspect.test.ts::the inspector says what Scholar of the Void transforms into, before the hand is discarded</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R101 (its inspector row) · Replaces: R101 (its rot clause corrected by R102; its token transform reversed by R157 — neither touches the inspector row) · Tests: 50-ui-inspect.test.ts · Key: annexd.display.text-box.transform</sub>

<a id="rD6.11"></a>**D6.11.** The reminder shown for a keyword is the game's own words wherever the game has them, in this order of preference: a reminder printed on a card in the pool; the Manual's sentence under a heading that names the term; a dated quote of a designer-posted card; and only then this client's own sentence.

> *Example (non-normative): {Piercing} reads "Excess damage from piercing sources is dealt to the recipient's controller." — the sentence Protective Adaptations prints.* <sub>test: 177-glossary-conformance.test.ts::R248: a row the pool prints a reminder for SHOWS that reminder, verbatim</sub>

> *Example (non-normative): The card-library sentence for {Rot} is used only because neither a card nor the Manual states one.* <sub>test: 245-printed-reminder-reach.test.ts::R267: the card library is consulted LAST, never over the pool or the manual</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R248, R252 (its order of channels), R267 · Replaces: R252 (its §1 Ambush row and its §3/§4 claim that Glimpse and Unstable have no game statement corrected by R267) · Tests: 245-printed-reminder-reach.test.ts, 231-manual-text.test.ts, 177-glossary-conformance.test.ts · Key: annexd.display.reminders</sub>

<a id="rD6.11a"></a>**D6.11a** No reminder, label or rules text shown to a player cites this client's ruling numbers.

> *Example (non-normative): Rendering every card in the pool shows no ruling number anywhere.* <sub>test: 227-reminder-text.test.ts::R248: rendering every card in the pool leaks no R-number</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R248 · Tests: 227-reminder-text.test.ts · Key: annexd.display.reminders.no-numbers</sub>

<a id="rD6.11b"></a>**D6.11b** Where the game's reminder is shorter than the rule this client enforces, the client's fuller statement is kept and shown under the game's reminder in the card browser. Shortening what a player reads never deletes a rule.

> *Example (non-normative): {Piercing} shows the printed sentence, and the card browser also keeps the client's fuller rule beneath it.* <sub>test: 227-reminder-text.test.ts::R248: Piercing shows the sentence the card prints and keeps the one it does not</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R248, R252 (its order of channels) · Tests: 227-reminder-text.test.ts · Key: annexd.display.reminders.fuller-rule</sub>

<a id="rD6.11c"></a>**D6.11c** The card browser explains every keyword a card names, on its type line or in its text box, and never explains less about a card than the in-game inspector does.

> *Example (non-normative): Brough grants {Balanced} from its text box. The browser explains {Balanced} on Brough.* <sub>test: 236-browser-glossary-reach.test.ts::CT-129: an attribute a card grants from its text box gets a reminder row</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R257 (its union rule) · Replaces: R257 (its "No skip" bullet amended by R282 (a row gives way to a term the text box already states)) · Tests: 236-browser-glossary-reach.test.ts · Key: annexd.display.reminders.browser</sub>

<a id="rD6.12"></a>**D6.12.** Each item on the stack strip is shown in exactly one state: waiting, resolving, answered (negated), fizzled, or resolved. An item that fizzles is shown as fizzled, never as resolved. See rule 704.

> *Example (non-normative): A spell resolves with no legal target. The strip labels it fizzled.* <sub>test: 251-fizzle-label-and-mod-strips.test.ts::R271 §1b THE REPORT: the strip says the spell fizzled, not that it resolved</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R271, R271 · Tests: 251-fizzle-label-and-mod-strips.test.ts · Key: annexd.display.stack-states</sub>

<a id="rD6.12a"></a>**D6.12a** A card on the stack carrying mods is drawn the same way as a unit carrying mods: its mods show beneath it.

> *Example (non-normative): A {Modular} spell with a mod is drawn on the stack with the mod peeking out beneath it, as it would be on a unit.* <sub>test: 251-fizzle-label-and-mod-strips.test.ts::R271 §4a a modded stack item composes the same picture as a modded unit</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R271 · Tests: 251-fizzle-label-and-mod-strips.test.ts · Key: annexd.display.stack-states.mods</sub>

<a id="rD6.13"></a>**D6.13.** While the other player is building an attack or a block, the live view of it is drawn in the same orientation as the declared one. It differs only in being marked as not yet committed. See rules 604, 606.

> *Example (non-normative): When the opponent confirms their attack, no unit changes side or column on the watching player's screen.* <sub>test: 253-combat-orientation.test.ts::the live attack and the declared attack put the same units in the same halves</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R273 · Tests: 253-combat-orientation.test.ts · Key: annexd.display.declarations</sub>

<a id="rD6.14"></a>**D6.14.** A card in hand is marked by what can be done with it now. A card that can be cast is drawn plainly; a card that can only be used another way, such as grafted, augmented or recycled, is drawn differently and says how.

> *Example (non-normative): During deployment a {Battle} spell can only be grafted. It is not drawn like a castable deployment card.* <sub>test: 155-hand-affordances.test.ts::R183 §2: a {Battle} spell in deployment is NOT drawn like a castable deployment card</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R183 · Tests: 155-hand-affordances.test.ts · Key: annexd.display.hand</sub>

<a id="rD6.14a"></a>**D6.14a** A cached card that can be played right now is also shown at the right of the hand. It stays in the cache as well; clicking either copy plays the same card.

> *Example (non-normative): A card glimpsed this turn is drawn beside the hand and in the cache row.* <sub>test: 155-hand-affordances.test.ts::R183 §4: a playable cached card is drawn at the right of the hand AND left in the cache row</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R183, R183 · Tests: 155-hand-affordances.test.ts · Key: annexd.display.hand.cached</sub>

<a id="rD6.14b"></a>**D6.14b** In constructed, the menu for recycling a card for a resource lists the elements in the player's own deck first, then Prismite. Every other element of the game, and the Shard, are behind an expander. The menu changes nothing about what is legal: a resource of any element of the game may still be made. See rules 105.9a, 106.6a.

> *Example (non-normative): A mono-Fire constructed deck still has all seven elements legal for recycling; the menu just lists Fire first.* <sub>test: 34-constructed.test.ts::deckElements: it is a PRESENTATION default — all seven stay legal</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R99, R99, R299, R299 · Tests: 34-constructed.test.ts, 308-recycle-for-prismite.test.ts · Key: annexd.display.hand.resource-menu</sub>

<a id="rD6.15"></a>**D6.15.** Right-clicking a card the player can read shows only things about that card. The erased piles, concede and the game log are on the menu of the bare table. Right-clicking a card back opens the bare-table menu. See rule 104.4.

> *Example (non-normative): Right-clicking a unit offers its details and the judge, not concede.* <sub>test: 216-menu-scoping.test.ts::§1 right-clicking a CARD shows card things, and nothing about the field</sub>

> *Example (non-normative): Right-clicking a card in the opponent's hand opens the table menu.* <sub>test: 216-menu-scoping.test.ts::§3 a card BACK is not a dead click: an unreadable card gets the table menu</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R241, R241, R253 · Replaces: R65 (narrowed by R241: view-erased and concede had been on every card menu) · Tests: 216-menu-scoping.test.ts, 232-log-modal.test.ts · Key: annexd.display.menus</sub>

<sub>Discrepancies: D-U24-7 (discrepancies.md)</sub>

<a id="rD6.15a"></a>**D6.15a** The game log opens from the bare-table menu and shows the whole log.

> *Example (non-normative): A log longer than 80 lines is shown in full.* <sub>test: 252-viewport-and-log.test.ts::R272 §1a a log longer than the old 80-line window is shown WHOLE</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R253, R272 · Tests: 232-log-modal.test.ts, 252-viewport-and-log.test.ts · Key: annexd.display.menus.log</sub>

<a id="rD7"></a>
### D7. Confirmations and Misclicks

<a id="rD7.1"></a>**D7.1.** A warning or a confirmation never makes a legal play illegal. The option stays offered, and going ahead does exactly what the play would have done without the warning.

> *Example (non-normative): Fight aimed at two of the player's own units is still offered and, if confirmed, resolves exactly as it would have.* <sub>test: 278-ally-misclick.test.ts::R288 §4 the question changes no legality: same candidates, same outcome</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R74, R288 · Tests: 278-ally-misclick.test.ts · Key: annexd.confirm.never-refuse</sub>

<a id="rD7.1a"></a>**D7.1a** When choosing X = 0 makes an effect certain to do nothing, the option to stop at X = 0 carries a warning saying so. It stays legal (see 107.2b). See rule 107.2b.

> *Example (non-normative): Necromantic Rebuke's option to stop at X = 0 is offered with a warning that it negates nothing.* <sub>test: 42-dark-b.test.ts::Necromantic Rebuke: stopping at X = 0 is offered WITH a warning, and stays legal (R74)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R74, R74 · Tests: 42-dark-b.test.ts · Key: annexd.confirm.never-refuse.x-zero</sub>

<a id="rD7.1b"></a>**D7.1b** When a spell has one target that must be an ally and another that may be any unit, and the player picks one of their own units for the second, the client asks whether they meant to. Yes sends the pick. No sends nothing and leaves the same pick open.

> *Example (non-normative): Fight's first target is the player's ally; the player then picks another of their own units. The client asks whether they meant to target an ally.* <sub>test: 278-ally-misclick.test.ts::R288 §1 Fight aimed at a second unit of your own asks whether you meant it</sub>

> *Example (non-normative): Answering no leaves the second pick open.* <sub>test: 278-ally-misclick.test.ts::R288 §5 "no" sends nothing and leaves the same pick open</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R288, R288 · Tests: 278-ally-misclick.test.ts · Key: annexd.confirm.never-refuse.ally</sub>

<sub>Discrepancies: D-U24-6 (discrepancies.md)</sub>

<a id="rD7.1c"></a>**D7.1c** A pass that would end the battle phase, and with it erase the player's unused spell tokens at regroup, first asks the player to confirm. It asks on that pass and on no other window of the battle.

> *Example (non-normative): A player holding unused spell tokens passes in the last window of the battle. They are asked to confirm before Regroup erases the tokens.* <sub>test: 165-token-loss-warning.test.ts::[66] control: the Regroup confirm still fires on the pass that reaches Regroup</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R266, R266 · Tests: 165-token-loss-warning.test.ts · Key: annexd.confirm.never-refuse.regroup</sub>

<a id="rD7.2"></a>**D7.2.** A dial, a stepper or an "All" button only sets an amount. It never sends an answer; only the confirm button does.

> *Example (non-normative): Pressing "All" on a counter-removal cost sets the count to the most it can be, and waits for the player to confirm.* <sub>test: 124-counter-stepper.test.ts::"All" sets the count to the max and does NOT submit</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R139, R197 (its §1) · Tests: 124-counter-stepper.test.ts, 126-assign-split.test.ts · Key: annexd.confirm.dials</sub>

<a id="rD7.2a"></a>**D7.2a** A question whose answer is a number, such as predicting a life total, offers a typed box as well as a dial, so any number in range can be entered. The value itself is sent, not a choice from a list.

> *Example (non-normative): Prediction Prophet's prediction can be dialled or typed past the old cap of life + 5.* <sub>test: 168-three-card-divergences.test.ts::R197 §1c Prediction Prophet: THE CLIENT CAN EXPRESS IT — the numeric bar dials past the old cap and puts the VALUE on the wire, not an index</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R197 (its §1) · Replaces: R90 (its menu cap of life + 5 replaced by R197's uncapped number question) · Tests: 168-three-card-divergences.test.ts · Key: annexd.confirm.dials.number</sub>

<a id="rD7.2b"></a>**D7.2b** A variable cost paid one point at a time, such as paying X life, offers the same typed box and dial. Nothing is paid until the player confirms. The dial cannot go below what has already been paid.

> *Example (non-normative): Paying X life for Flesh Tithe, the player dials to 5 and back to 3; confirming pays 3.* <sub>test: 260-cost-ramp-and-bin-targets.test.ts::R280 §4 one confirm walks the ramp to the dialled X and then stops</sub>

> *Example (non-normative): With 1 life already paid, the dial does not go below 1.* <sub>test: 260-cost-ramp-and-bin-targets.test.ts::R280 §2b the dial goes DOWN as well as up, and never below what is already paid</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R280, R280 · Tests: 260-cost-ramp-and-bin-targets.test.ts · Key: annexd.confirm.dials.ramp</sub>

<a id="rD7.2c"></a>**D7.2c** The button that ends a variable cost ("That's enough") is drawn as a full button that commits, distinct from the buttons that decline.

> *Example (non-normative): "That's enough — X = 3" is a filled button; "decline" stays a quiet one.* <sub>test: 260-cost-ramp-and-bin-targets.test.ts::R280 §3 that is enough is a full button, and the plain declines stay quiet</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R280 · Tests: 260-cost-ramp-and-bin-targets.test.ts · Key: annexd.confirm.dials.commit</sub>

<a id="rD7.2d"></a>**D7.2d** A cost that removes counters from allies asks the player to click a unit. One click may take several counters from that unit, up to the most that one unit can give. See rule 111.

> *Example (non-normative): Four counters are spread over two allies, two each. One pick can take at most two.* <sub>test: 124-counter-stepper.test.ts::R139: the pick max is the biggest SINGLE stack, not the whole ally pool</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R139, R139 · Tests: 124-counter-stepper.test.ts · Key: annexd.confirm.dials.counters</sub>

<a id="rD7.2e"></a>**D7.2e** When the dealing player splits combat damage, they are asked one victim at a time, with what is left to assign shown. The client never refuses or forces a split the game would accept. See rule 608.

> *Example (non-normative): A strike of 4 into a column of two: the player chooses how much the front unit takes, and the back unit gets the rest.* <sub>test: 126-assign-split.test.ts::R149 (1): the total is forced — under and over allocations are refused, with the remainder said out loud</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R149, R149 · Tests: 126-assign-split.test.ts, 435-cr-digital-2.test.ts · Key: annexd.confirm.dials.damage-split</sub>

<a id="rD7.3"></a>**D7.3.** When an effect does nothing, the game says so and says why. A printed clause that promises a per-seat outcome and then resolves over an empty collection of seats or of picks is announced for that clause, even when another clause of the same card is speaking. Saying so never changes what the effect does.

> *Example (non-normative): Bloated Manablub's "Each opponent loses 3 life" resolves in a region with no opponent. The game says so, and no life is lost.* <sub>test: 158-silent-region-branches.test.ts::Bloated Manablub — "Each opponent loses 3 life" in a region holding no opponent says so and takes no life</sub>

> *Example (non-normative): Cull resolves where no player has a unit. The game says so and nothing dies.* <sub>test: 179-empty-collection-branches.test.ts::Cull — "each player sacrifices a unit" with nobody holding a unit here says so and kills nothing</sub>

<sub>Basis: Owner call · Verified: confirmed, round 3, 2 tests run · Rulings: R187, R209, R209, R209 · Tests: 158-silent-region-branches.test.ts, 179-empty-collection-branches.test.ts · Key: annexd.confirm.say-so</sub>

<sub>Discrepancies: D-U24-10 (discrepancies.md)</sub>

<a id="rD7.3a"></a>**D7.3a** A spell that resolves with no legal target fizzles, and the log says "<card>: it has no legal target — nothing happens." (see 704). See rule 704.

> *Example (non-normative): Luminous Arc reaches resolution with no target. It fizzles and the log says so.* <sub>test: 196-empty-target-fizzle.test.ts::R227 spell:Luminous Arc: no target → fizzles and logs (CT-89 #1)</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R223, R227 · Tests: 196-empty-target-fizzle.test.ts · Key: annexd.confirm.say-so.no-target</sub>

<a id="rD7.3b"></a>**D7.3b** An "each opponent" effect in a region where no opponent is present says that no opponent is present, and does nothing (see 102.2a). See rule 102.2a.

> *Example (non-normative): Bloated Manablub's "Each opponent loses 3 life" during its controller's own deployment says so and takes no life.* <sub>test: 158-silent-region-branches.test.ts::Bloated Manablub — "Each opponent loses 3 life" in a region holding no opponent says so and takes no life</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R187 · Tests: 158-silent-region-branches.test.ts · Key: annexd.confirm.say-so.no-opponent</sub>

<a id="rD7.3c"></a>**D7.3c** A clause that promises something for each player, or each of something, and finds none says so for that clause, even when another clause of the same card has done something.

> *Example (non-normative): Recall takes its life when nobody here has a unit to recall, and says the recall did not happen.* <sub>test: 179-empty-collection-branches.test.ts::Recall — the life loss happens, the recall does not, and the card now says which</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R209 · Tests: 179-empty-collection-branches.test.ts · Key: annexd.confirm.say-so.per-clause</sub>

<a id="rD7.3d"></a>**D7.3d** An effect that would deal damage to each of a group, and finds nobody in the group, says there was nothing to damage.

> *Example (non-normative): A "deal 2 damage to each enemy unit" effect with no enemy unit on the board announces that there was nothing to damage.* <sub>test: 93-engine-defects.test.ts::a damage batch handed an empty hit list announces that there was nothing to damage</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R109 · Tests: 93-engine-defects.test.ts · Key: annexd.confirm.say-so.no-damage</sub>

<a id="rD7.4"></a>**D7.4.** An announcement the player is expected to act on, or has lost something by, must be shown somewhere other than the game log. The log is the record, not the notice. See rule D6.15a. *(Engine differs, see F-U24-4.)*

> *Example (non-normative): Spell tokens erased after a declined attack used to be announced only in the log; the player who lost them is now shown a notice where the prompts appear.* <sub>test: 244-log-is-not-the-only-surface.test.ts::[R266] the loss is put in front of the player who lost it, in the promptbar area</sub>

<sub>Basis: Owner call · Verified: partial, round 3, 2 tests run · Rulings: R266, R266 · Tests: 244-log-is-not-the-only-surface.test.ts · Key: annexd.confirm.not-only-log</sub>

<sub>Discrepancies: D-U24-5, D-U24-9 (discrepancies.md)</sub>

<a id="rD7.4a"></a>**D7.4a** When a player's unused spell tokens are erased at regroup without a pass to confirm on, such as after a declined attack, that player is shown a notice in the prompt area. It stays until dismissed or until the next battle. The other player is not shown it.

> *Example (non-normative): The round-2 attacker declines; the defender's unused spell tokens are erased, and the defender sees a notice saying so.* <sub>test: 244-log-is-not-the-only-surface.test.ts::[R266] the loss is put in front of the player who lost it, in the promptbar area</sub>

> *Example (non-normative): The other player's lost tokens are not shown to this player, and the notice lapses at the next battle.* <sub>test: 244-log-is-not-the-only-surface.test.ts::[R266] a net client is not shown the opponent loss, and the notice goes stale at the next battle</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 3 tests run · Rulings: R266, R266 · Tests: 244-log-is-not-the-only-surface.test.ts, 165-token-loss-warning.test.ts · Key: annexd.confirm.not-only-log.token-loss</sub>

<a id="rD7.4b"></a>**D7.4b** Any other announcement that a card or a cost the player spent did nothing is shown briefly near the board, under the label "⚠ this did nothing", with the game's own sentence beside it. Both players see it, and it is also in the log.

> *Example (non-normative): A spell resolves with nothing to aim at. A toast says so on the screen.* <sub>test: 256-cost-toasts.test.ts::[R276] a spell that resolves with nothing to aim at produces a toast, end to end</sub>

> *Example (non-normative): An ordinary resolution produces no toast.* <sub>test: 256-cost-toasts.test.ts::[R276] an ordinary resolution produces no toast at all</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R276, R276, R276 · Tests: 256-cost-toasts.test.ts · Key: annexd.confirm.not-only-log.toast</sub>

<a id="rD7.4c"></a>**D7.4c** Identical announcements from one resolution are shown once with a count. At most four are drawn at a time; the rest are counted and pointed to the log. None is dropped silently.

> *Example (non-normative): Three identical "this did nothing" sentences in one batch show as one row marked ×3.* <sub>test: 256-cost-toasts.test.ts::[R276] identical sentences in one batch coalesce into one row with a count</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R276, R276 · Tests: 256-cost-toasts.test.ts · Key: annexd.confirm.not-only-log.coalesce</sub>

<a id="rD8"></a>
### D8. Tutorial and Single-Card Modes

<a id="rD8.1"></a>**D8.1.** Learn to Play is one learner against the Tutorial Bot in one continuous game, with lessons shown at the moment each rule first matters.

> *Example (non-normative): In every element, the core lessons open in order early in the game, and the game ends with the end lesson.* <sub>test: 305-lesson-flow.test.ts::§2 §3 in every element the core lessons open in order early, and the game ends with the end lesson</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R297 · Tests: 305-lesson-flow.test.ts · Key: annexd.modes.learn-to-play</sub>

<a id="rD8.1a"></a>**D8.1a** Learn to Play is a constructed game with its own deal. Each player's opening hand and draw per turn are set separately, turn 1 included, and there is no bottom step. Decks may be stacked so that a lesson's card arrives on its turn. The learner starts with no cards in hand: the draw of 2 on turn 1 is the whole starting hand. See rule 901.

> *Example (non-normative): In a lesson game each seat draws its own number on turn 1, and neither puts cards on the bottom.* <sub>test: 303-lesson-deal.test.ts::§1 hands and draws are per seat, turn 1 included, with no bottom step</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R297, R297, R297 · Tests: 303-lesson-deal.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.learn-to-play.deal</sub>

<a id="rD8.1b"></a>**D8.1b** The Tutorial Bot's only card is Training Construct: "Create an X/X unit." It is an X-cost deploy spell with X at least 1, no element and no affinity cost. Training Construct exists only in Learn to Play; it is never in any other deck, pack or deal.

> *Example (non-normative): Training Construct is not in any constructed, draft or shared deal.* <sub>test: 303-lesson-deal.test.ts::§5 Training Construct lives only in lesson deals</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R297, R297 · Tests: 303-lesson-deal.test.ts · Key: annexd.modes.learn-to-play.bot-card</sub>

<a id="rD8.1c"></a>**D8.1c** The Tutorial Bot gains one Shard each turn, starting on turn 1. It casts Training Construct at the largest X it can pay, attacks with every unit it has, and never blocks. Its hand is hidden from the learner.

> *Example (non-normative): The bot casts Construct at the largest X its Shards allow.* <sub>test: 304-tutorial-bot.test.ts::§2 every Construct is cast at the largest X its mana allows (one Shard a turn)</sub>

> *Example (non-normative): The bot attacks with every unit and never blocks.* <sub>test: 304-tutorial-bot.test.ts::§3 it attacks with every unit it has and never blocks</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 3 tests run · Rulings: R297, R297, R297 · Tests: 304-tutorial-bot.test.ts, 306-solo-backend.test.ts · Key: annexd.modes.learn-to-play.bot-play</sub>

<a id="rD8.2"></a>**D8.2.** In a Single Card Duel, each player picks one card before the game, and their deck is 30 copies of that card. This is the one exception to the two-copy limit. Everything else in the game is the same, except the draw (annexd.modes.single-card-duel.draw). See rule 901.

> *Example (non-normative): A deck of 30 copies of one unit is a single-card deck; 29 copies is not. Two such decks make the game a duel.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel — a deck of 30 copies of one card is a single-card deck, 29 is not, and two such decks make a duel</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel</sub>

<a id="rD8.2a"></a>**D8.2a** A duel has no draw phase. Each turn's card step is a flat draw of 2, and the draw-4, bottom-2 step never happens. The opening hand is still 4, so turn 1 starts with six cards. See rule 503.

> *Example (non-normative): In a duel each player starts turn 1 with six cards, is never asked to put cards on the bottom, and draws exactly 2 on turn 2.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.draw — a duel has no bottom step, turn 1 starts on six cards, and turn 2 draws a flat 2</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.draw</sub>

<a id="rD8.2b"></a>**D8.2b** Cards are picked blind. Before the game, each player is told only whether the other has picked, not what.

> *Example (non-normative): Ann picks her card first. Bob is told that Ann has picked, and not which card.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.blind — before the game the other player is told only that a card is picked, never which</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.blind</sub>

<a id="rD8.2c"></a>**D8.2c** If neither picked card can make a unit, no game is dealt. It is a draw: both players are told both cards and why, nothing is recorded, and both pick again.

> *Example (non-normative): Both players pick a spell that creates nothing. No game is dealt, each is shown both picks, and both pick again.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.no-units — two cards that make no unit deal no game: both are told both cards, nothing is recorded, and both pick again</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.no-units</sub>

<a id="rD8.2d"></a>**D8.2d** A card can make a unit if it is a unit or spell unit, or if it is declared to create a unit token. What its printed text says is not read for this.

> *Example (non-normative): A unit card makes units, and so does a spell declared to create a Unit Token. A spell that creates nothing does not.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.makes-units — unit cards and declared unit-token creators make units; a plain spell does not</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.makes-units</sub>

<a id="rD8.2e"></a>**D8.2e** A duel counts toward no player's record, rating or achievements. It counts toward the card duel ladder instead, which rates cards rather than players.

> *Example (non-normative): A finished duel leaves every player rating where it was.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.records — a duel moves no player rating</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.records</sub>

<a id="rD8.2f"></a>**D8.2f** The card duel ladder counts any finished duel, except a mirror (the same card on both sides) and a walkover. An early concession counts at reduced weight. A card is ranked once it has five duels that are not mirrors. See rule D8.5.

> *Example (non-normative): A mirror duel and a turn-1 walkover put no game on the ladder. A turn-2 concession moves the card rating by 10, half the 20 of a full game.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.single-card-duel.ladder — mirrors and walkovers do not rate cards, and an early concession counts at half weight</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R298, R298, R298 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.single-card-duel.ladder</sub>

<a id="rD8.3"></a>**D8.3.** A live draft may be created with custom rules. Custom rules change the deal, never how a card works. See rule 902.

> *Example (non-normative): Custom rules given to a constructed game are ignored.* <sub>test: 296-custom-draft-deal.test.ts::BL-43 §1c a custom deal is ignored outside a live draft</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R292, R292 · Tests: 296-custom-draft-deal.test.ts · Key: annexd.modes.custom-rules</sub>

<a id="rD8.3a"></a>**D8.3a** The custom rules are: pack size (3 to 15; standard 10); the number of elements (2 to 7; standard 3, and two elements default to Fire and Wood); opening hand (1 to 15; standard 6); draws per turn after turn 1 (0 to 5; standard 2); starting life (1 to 99; standard 30); simple cards only; banned cards; and a card filter.

> *Example (non-normative): With packs of 5, every pack is dealt at 5 and the turn-4 refresh deals 5.* <sub>test: 296-custom-draft-deal.test.ts::BL-43 §2a pack size: packs of 5 at the deal, the commit leaves 5, and the turn-4 refresh deals 5</sub>

> *Example (non-normative): Two elements default to the rulebook pair, Fire and Wood.* <sub>test: 296-custom-draft-deal.test.ts::BL-43 §2c two elements: the rulebook pair by default, a chosen pair when given, 113 cards</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 2 tests run · Rulings: R292, R292, R292, R292, R292 · Tests: 296-custom-draft-deal.test.ts · Key: annexd.modes.custom-rules.knobs</sub>

<a id="rD8.3b"></a>**D8.3b** Simple cards only keeps only cards with the silver complexity symbol in the pool. See rule 209.

> *Example (non-normative): Simple cards only leaves out exactly the cards that are not simple.* <sub>test: 297-custom-rules-resolve.test.ts::BL-43 resolve §3 Simple cards only leaves out exactly the cards that are not simple</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R292 · Tests: 297-custom-rules-resolve.test.ts · Key: annexd.modes.custom-rules.simple</sub>

<a id="rD8.3c"></a>**D8.3c** The pool must hold at least 2 × opening hand + 4 × pack size + 6 × draws per turn cards: 64 for the standard game. Custom rules whose pool is smaller are refused before the game is created.

> *Example (non-normative): The standard game needs a pool of 64 cards; the Beginner preset needs 44.* <sub>test: 296-custom-draft-deal.test.ts::BL-43 §5 minPool: the standard game needs 64, the beginner deal 44</sub>

> *Example (non-normative): Rules leaving too small a pool are refused with a message saying how to fix them.* <sub>test: 297-custom-rules-resolve.test.ts::BL-43 resolve §8 too small a pool is refused with a message that names the fix</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R292, R292, R292 · Tests: 296-custom-draft-deal.test.ts, 297-custom-rules-resolve.test.ts · Key: annexd.modes.custom-rules.floor</sub>

<a id="rD8.3d"></a>**D8.3d** Custom rules left at the standard values are not a custom game: they deal the same game as no custom rules at all.

> *Example (non-normative): For the same seed, no custom rules and custom rules at the defaults deal identical games.* <sub>test: 296-custom-draft-deal.test.ts::BL-43 §1b no deal and a deal left at the defaults deal the identical game in every mode</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R292 · Tests: 296-custom-draft-deal.test.ts · Key: annexd.modes.custom-rules.standard</sub>

<a id="rD8.3e"></a>**D8.3e** A custom game is kept in the match history, marked as custom, and counts toward no profile total, achievement, deck record, rating or average game length. Matchmaking never makes a custom game.

> *Example (non-normative): A custom game's row in the match history says it was not counted.* <sub>test: 298-custom-rules-ui.test.ts::BL-43 ui §7 a custom row in the match history says it was not counted</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R292, R292, R292 · Tests: 298-custom-rules-ui.test.ts · Key: annexd.modes.custom-rules.not-counted</sub>

<a id="rD8.3f"></a>**D8.3f** The Beginner preset is two elements, simple cards only and packs of 5. It is this client's softening of the rulebook's Quick Start, not the Quick Start itself: 5-card packs are not in the printed rules.

> *Example (non-normative): Choosing the Beginner preset sends two elements, simple cards only and packs of 5.* <sub>test: 298-custom-rules-ui.test.ts::BL-43 ui §2 the Beginner preset sends two elements, simple cards and packs of 5</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R292, R292 · Tests: 298-custom-rules-ui.test.ts · Key: annexd.modes.custom-rules.beginner</sub>

<a id="rD8.4"></a>**D8.4.** A scenario room, used to test a single card, is an ordinary game dealt from a declared starting board. It is a test fixture, not a game: it counts toward no player's record.

> *Example (non-normative): A finished scenario room is not folded into either player's record.* <sub>test: 186-scenario-library.test.ts::§3 history.ts refuses to fold a scenario room into anybody's record</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R216 (its scenario-room half), R216 (its scenario-room half) · Tests: 186-scenario-library.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.scenarios</sub>

<a id="rD8.4a"></a>**D8.4a** Scenario rooms can be created only on a server configured for the tester. Elsewhere they do not exist.

> *Example (non-normative): An ordinary room is not affected by the tester existing.* <sub>test: 185-scenario-determinism.test.ts::§2 an ordinary room is untouched by the tester existing</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R216 (its scenario-room half) · Tests: 185-scenario-determinism.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.scenarios.gated</sub>

<a id="rD8.5"></a>**D8.5.** A conceded game is still a loss for the player who conceded (see 104.4). How much it counts toward records and ratings depends on the turn it was conceded on. See rule 104.4.

> *Example (non-normative): A player concedes on turn 1. The result says it is a walkover, names the conceder and the turn, and says it was not counted.* <sub>test: 291-concession-weight.test.ts::R290 §1 a walkover says so, names the conceder and the turn, and says it was not counted</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 1 test run · Rulings: R290, R290 · Tests: 291-concession-weight.test.ts · Key: annexd.modes.concession</sub>

<a id="rD8.5a"></a>**D8.5a** A game conceded on turn 1 or earlier is a walkover. It counts toward nothing for either player: no game, win, loss, streak, statistic or achievement. In a rated game, the player who conceded loses 5 rating points and the winner gains nothing, and the game does not count toward the number of rated games played. It stays in each player's match history, marked "not counted".

> *Example (non-normative): A player concedes on turn 1. The post-game screen says it was a walkover and was not counted.* <sub>test: 291-concession-weight.test.ts::R290 §1 a walkover says so, names the conceder and the turn, and says it was not counted</sub>

<sub>Basis: Owner call · Verified: confirmed, round 2, 2 tests run · Rulings: R290, R290, R290 · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.concession.walkover</sub>

<a id="rD8.5b"></a>**D8.5b** A game conceded on turn 2 is an early concession. It counts as a game for the record, and in a rated game it moves ratings by half as much as a full game. It does not count toward the fast-game achievements or the match-length statistics.

> *Example (non-normative): A player concedes on turn 2. The post-game screen says half weight, and that it still counts.* <sub>test: 291-concession-weight.test.ts::R290 §1 an early concession says half weight, and that it still counts</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R290, R290, R290 · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.concession.early</sub>

<a id="rD8.5c"></a>**D8.5c** A game conceded on turn 3 or later counts exactly as if the conceding player had been defeated.

> *Example (non-normative): A turn-5 concession carries no note and no tag.* <sub>test: 291-concession-weight.test.ts::R290 §1 ⭐ a normal concession (turn 3+) and a game with no concession say NOTHING</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 1 test run · Rulings: R290, R290 · Tests: 291-concession-weight.test.ts, 435-cr-digital-2.test.ts · Key: annexd.modes.concession.normal</sub>

<a id="rD8.5d"></a>**D8.5d** Only a rated game moves a rating at all. An unrated walkover moves nobody's rating.

> *Example (non-normative): A player concedes an unrated game on turn 1. Neither player has a rating change.* <sub>test: 435-cr-digital-2.test.ts::cr:annexd.modes.concession.rated-only — an unrated walkover moves nobody</sub>

<sub>Basis: Owner call · Verified: confirmed, round 1, 0 tests run · Rulings: R290, R290 · Tests: 435-cr-digital-2.test.ts · Key: annexd.modes.concession.rated-only</sub>
