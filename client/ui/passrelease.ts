/* THE STANDING PASS'S JUDGEMENTS, WHERE BOTH SIDES OF THE WIRE CAN ASK THEM.
 *
 * The owner, 2026-09-28: *"When a player is 'Pass all'ed, their timer should
 * never go down."* The server stops a seat's clock while its Pass all / Pass
 * through stack is answering a window, and passes for it if the client's pass
 * is late (server/rooms.ts settlePassAll, server/main.ts sweepPassAll). To do
 * that without a second opinion about when the arm comes off, the server asks
 * the client's OWN release list — this file.
 *
 * MOVED, NOT WRITTEN. Every function and type below is the one that lived in
 * ui/battle.ts ([66] passEndsBattlePhase / tokensAtRisk, R245 inPassWindow,
 * R251 passAllRelease) or ui/inspect.ts (the option keys and the arm's types),
 * cut out verbatim. Both modules re-export them, so every client caller and
 * every test still imports from where it always did, and the client's
 * behaviour is byte-for-byte what it was.
 *
 * ⚠ WHY A FILE OF ITS OWN (BL-41, engine/test/282-dom-free-trio.test.ts). The
 * server may reach into ui/ only for modules whose whole import chain is pure
 * and DOM-free, and it compiles without the DOM lib to make that a build error
 * rather than a promise. ui/battle.ts and ui/inspect.ts reach the card text,
 * the glossary and ui/util.ts's clipboard helper; this file imports nothing but
 * engine TYPES, and 282 §4 walks its imports to keep it that way.
 */
import type { Action, EntityId, GameState, Phase, Seat } from '../engine/src/types.ts';

/**
 * Identity keys of every activateAbility currently legal for a seat.
 *
 * A standing pass snapshots these when it is armed; a key that was NOT in the
 * snapshot means a resolution granted a new ability, and the chip disarms so
 * the window is the player's again.
 */
export function activationKeys(legal: readonly Action[]): string[] {
  return legal
    .filter(a => a.type === 'activateAbility')
    .map(a => {
      const aa = a as Extract<Action, { type: 'activateAbility' }>;
      const via = aa.via === undefined ? 'own'
        : aa.via === 'augment' ? 'aug'
          // R118: a projected face is its own identity — two neighbours'
          // abilities at the same index are two different options
          : 'face' in aa.via ? `face:${aa.via.face}:${aa.via.text ?? 'ability'}`
            : `mod${aa.via.mod}`;
      return `${aa.entityId}:${aa.abilityIndex}:${via}`;
    });
}

/**
 * R245 — EVERY OPTION THIS WINDOW OFFERS, keyed by identity.
 *
 * `activationKeys` above is one action type out of the several a priority
 * window can hold, and the reason it was written down — *"a new option that
 * appeared BECAUSE the game moved"* — is not a statement about
 * `activateAbility`. Ledger #123 ("Pass All still isn't working right") is the
 * third visit to that chip, and the measurement that settled it is blunt:
 * across room VYTV's 55 pass-windows for seat 0 and 52 for seat 1,
 * `activationKeys` was EMPTY at every single one — a release clause that could
 * not have fired on the reported game at all — while the options that DID
 * appear out of nowhere were a spell token created mid-battle (six times) and
 * a card that became castable (once). None of them touched the chip.
 *
 * So the set is DERIVED BY EXCLUSION (docs/13-assessment.md §7.2): every legal
 * action is an option, minus the three that are not a choice to weigh —
 *
 *   passPriority  is what the chip is doing FOR you; it is present in every
 *                 window by construction and can never be news.
 *   decide        never coexists with the chip (`s.decision` gates it, and
 *                 `passAllRelease` returns before asking).
 *   concede       is always available, always has been, and is not an option
 *                 a resolution grants you.
 *
 * A new action type added to the engine therefore extends this for free, which
 * is the whole point — the old clause had to be edited by hand to notice one.
 *
 * ⚠ THE KEYS MUST SURVIVE RENUMBERING, or the chip releases on bookkeeping —
 * which is the same failure in the other direction. An action that names a
 * ZONE SLOT (`playCard.handIndex`, and `from`+`index` for a mod, a prophecy or
 * a recycle) means something different the moment a card leaves that zone,
 * because every index after it shifts down; keyed raw, playing one card would
 * read as four new options. So a slot is resolved to the CARD standing in it.
 * Entity ids never shift (`nextId` only grows), so everything else is keyed by
 * its payload as it stands.
 */
function slotCard(s: GameState, seat: Seat, from: string, index: number): string {
  const p = s.players[seat];
  const zone = from === 'bin' ? p?.bin
    : from === 'cache' ? p?.cache?.map(c => c.card)
      : p?.hand;
  return zone?.[index] ?? `#${index}`;
}

export function optionKeys(s: GameState, legal: readonly Action[]): string[] {
  const out = new Set<string>();
  for (const a of legal) {
    if (a.type === 'passPriority' || a.type === 'decide' || a.type === 'concede') continue;
    if (a.type === 'activateAbility') { out.add(`activateAbility:${activationKeys([a])[0]}`); continue; }
    const { seat: _seat, ...rest } = a as Action & { seat: Seat } & Record<string, unknown>;
    if (typeof rest['handIndex'] === 'number') {
      rest['handIndex'] = slotCard(s, a.seat, 'hand', rest['handIndex']) as never;
    }
    if (typeof rest['index'] === 'number' && typeof rest['from'] === 'string') {
      rest['index'] = slotCard(s, a.seat, rest['from'], rest['index']) as never;
    }
    out.add(`${a.type}:${JSON.stringify(rest)}`);
  }
  return [...out].sort();
}

/** distinct spell tokens this legal-action list can cast right now (C5) */
export function castableTokens(legal: readonly Action[]): number {
  return new Set(legal
    .filter(a => a.type === 'castSpellToken')
    .map(a => (a as { entityId: EntityId }).entityId)).size;
}

/**
 * R251 — WHICH OF THE TWO PROMISES THE CHIP IS KEEPING.
 *
 * The owner named three buttons (round-31 sheet Q6): *"Pass just does a single
 * effect resolution. Pass through the stack assumes a pass is given to all
 * effects that are currently on the stack, but gives priority if something
 * changes. And Pass all is the assumption that the player doesn't want priority
 * until the next phase."*
 *
 * Pass is not a mode — it is one action and it arms nothing. The other two are
 * the same machine with different SCOPES, which is why this is a mode on the
 * arm rather than a second chip:
 *
 *   'stack'  scoped to the items that were on the stack when it was armed
 *            (`armedItems`). Every "something changed" clause is live, and the
 *            promise ENDS when that scope has resolved — 'done'.
 *   'all'    scoped to the PHASE it was armed in (`armedPhase`). The change
 *            clauses are not asked at all: the player has said they do not want
 *            priority again until the phase turns over, and a chip that hands it
 *            back on a change is the other button.
 */
export type PassMode = 'stack' | 'all';

/** what the client's own settings say about passing without being asked */
export interface AutoPassArm {
  /** one of the two standing pass promises is armed (R251) */
  armed: boolean;
  /**
   * R251 — which promise it is keeping. Absent means 'stack': every release
   * clause live, which is what the single pre-R251 chip did and what an arm
   * built without a mode still means.
   */
  mode?: PassMode;
  /**
   * R251 — the phase the chip was armed IN, so "until the next phase" is the
   * arm's own answer rather than a hard-coded `'battle'`. Absent means
   * 'battle', which is the only phase the chip has ever been armable in.
   */
  armedPhase?: Phase;
  /**
   * ⚠ PRE-R245 ARM, kept only so an arm built without the two snapshots below
   * still answers. Stack height at the last window the chip looked at; growth
   * disarms it. `armedItems` SUBSUMES it — the stack only grows by gaining an
   * id that was not there — so it is asked only when `armedItems` is absent.
   */
  armedStack: number;
  /** ⚠ PRE-R245, subsumed by `armedOpts` exactly as `armedStack` is by
   * `armedItems`: activationKeys() at the last window, a NEW key disarming it. */
  armedSig: readonly string[];
  /**
   * R245 — the stack, BY IDENTITY, at the last window the chip declined.
   *
   * A height cannot tell "the top resolved and something new went on" apart
   * from "nothing happened", and one server batch routinely carries both: a
   * spell resolves and its own death trigger goes straight back on. Room
   * VYTV, the room ledger #123 was filed from, does it three times for seat 0
   * alone — and at each of those windows the chip passed through a stack item
   * it had promised to hand back. Ids never repeat (`nextId` only grows), so
   * "an id I have not seen" is the question the height was approximating.
   */
  armedItems?: readonly EntityId[];
  /** R245 — `optionKeys` at the last window the chip declined. A key that is
   * here now and was not then is an option the game handed the player while
   * the chip was doing the passing for them. */
  armedOpts?: readonly string[];
  /** the persistent auto-pass TOGGLE (C4) is on */
  prefOn: boolean;
  /** units whose triggers this player yields to (#2) */
  yieldIds: ReadonlySet<EntityId>;
}

// ── [66] the pass that costs you your spell tokens ────────────────────

/**
 * Would passing priority RIGHT NOW take the game out of the battle phase and
 * into Regroup — the step that erases spell tokens (R11)?
 *
 * This is derived from the engine's own transition, and it is worth spelling
 * out because the answer is not "the last window I can see":
 *
 *   E.passPriority   a pass with a non-empty stack resolves the top instead of
 *                    advancing anything, so it can never end the battle.
 *   advanceBattleStep only `afterWindow` ends a battle ROUND. `attackWindow`
 *                    hands over to blocks, `blockWindow` to combat damage —
 *                    both of which open another window you can still cast in.
 *   endBattleRound   round 2's end IS Regroup. Round 1's end normally starts
 *                    round 2 (more windows, tokens safe) — EXCEPT when the
 *                    defender already committed at block time (`happened`) and
 *                    sent nobody: `endBattleRound` then declines round 2 on the
 *                    spot and recurses straight into `startRegroup`.
 *
 * ⚠ R213 / CARD-TODO #82(a): THAT LIST IS THREE OF FOUR, AND THE FOURTH IS
 * NOT COVERABLE HERE. `endBattleRound` has a caller that is not the engine
 * deciding anything — **Temporal Rift** (`batch-hybrids-wm-b.ts`), a CARD that
 * ends the battle mid-resolution. This function answers "would passing RIGHT
 * NOW end the battle", and it answers it from the state at pass time; whether
 * some card later on the stack will end the battle cannot be predicted from
 * there. So the warning genuinely cannot fire for that path, and it is not a
 * bug that it does not.
 *
 * It IS a bug to enumerate the transitions as if they were all of them, which
 * is how CT-82(a) came to be filed: the comment read as a complete invariant
 * and was not one. R194's token-loss announcement still reaches all four
 * paths, because every exit from `endBattleRound` funnels through
 * `startRegroup` — that is asserted in `183-end-battle-round-paths.test.ts`,
 * along with the caller count, so a fifth path fails the suite instead of
 * quietly widening this gap.
 *
 * Note what is deliberately NOT required: `s.passes >= 1`, i.e. "mine is the
 * second pass, the one that actually advances the step". Priority in every
 * window opens on the initiative player (E.openPriority), so gating on the
 * closing pass would mean the initiative player — half of all games — is never
 * warned at all. Passing FIRST in this window is not irrevocable (if the
 * opponent responds, the stack grows and priority comes back round), but it is
 * the last window this client is guaranteed to get, and that is what the
 * warning is about. The cost is at most one extra confirm per battle instead of
 * one per priority window, which is the whole of report #66.
 */
export function passEndsBattlePhase(s: GameState, seat: Seat): boolean {
  if (s.phase !== 'battle') return false;
  const b = s.battle;
  if (!b) return false;
  if (s.decision) return false;
  if (s.priority !== seat) return false;
  // a pass with something on the stack resolves the top — a new window follows
  if (s.stack.length) return false;
  // the only step whose close ends the round
  if (b.step !== 'afterWindow') return false;
  if (s.battleRound === 2) return true;
  // round 1 hands over to round 2 — unless the defender declined the
  // counterattack at block time, in which case round 2 ends the instant it
  // starts and the game falls through into Regroup.
  return b.happened && b.sentAttackers.length === 0;
}

/**
 * The spell tokens `seat` would lose to Regroup if this pass closes the battle:
 * the ones they could still be CASTING (the legal-action list is the authority
 * on that — an uncastable token is not something the player is about to waste).
 */
export function tokensAtRisk(s: GameState, seat: Seat, legal: readonly Action[]): number {
  return passEndsBattlePhase(s, seat) ? castableTokens(legal) : 0;
}

// ── [68] every condition under which Pass-all stops being in effect ───

/**
 * Why an armed pass chip must come off — or null to keep passing.
 *
 * One named place for the whole release list, so the answer to "why did it stop
 * passing?" is a value a test can read rather than a chain of `else if`s inside
 * a bigger decision:
 *
 *   'phase'   the phase the chip was armed in is over. This is 'all''s whole
 *             promise ("no priority until the next phase") and 'stack''s outer
 *             bound, and it is a deliberate release in both.
 *   'stack'   something NEW is on the stack that was not in the armed scope.
 *             Deliberate: it is exactly the thing "gives priority if something
 *             changes" is about.
 *   'ability' the game handed me an option I did not have when the chip was
 *             armed (a negate, typically). Deliberate: it is a new option that
 *             appeared BECAUSE the game moved.
 *             ⚠ R245 / ledger #123 — the name is historical and the CLAUSE IS
 *             NOT ABOUT ABILITIES. It read `activateAbility` alone, which is
 *             one action type out of several a window can hold; measured over
 *             the room the report came from, that list was empty at all 107
 *             pass-windows of the game, while six spell tokens and one castable
 *             card appeared out of resolutions and moved nothing. The set is
 *             derived by exclusion now (ui/inspect.ts `optionKeys`), so a new
 *             kind of option extends the clause without anyone editing it.
 *   'done'    R251 — the stack the player said yes to has resolved. NOT a
 *             change and not a failure: it is "Pass through stack" reaching the
 *             end of its own scope, and it is the reason that mode terminates
 *             at all.
 *   'tokens'  this pass would end the battle and erase castable spell tokens.
 *             Deliberate — and the fix for #68: it used to read "I hold a
 *             castable spell token", with no reference to whether passing cost
 *             anything, which fired on the first window after arming and made
 *             the chip a one-shot.
 *
 * Nothing else releases it. In particular a pass going out, a state arriving,
 * priority bouncing to the opponent and back, and a resolution that grants the
 * OPPONENT something are all non-events for the chip.
 */
export type PassAllRelease = 'phase' | 'stack' | 'ability' | 'done' | 'tokens' | null;

/**
 * R245 — is this a window the chip is being asked to PASS?
 *
 * Everything the chip declines a window for is a judgement ABOUT that window,
 * and a state where nothing is being asked of this seat is not a window it can
 * decline: the declare step, the block step, the opponent's own priority and
 * the far side of a decision all pass through here on the way to the next real
 * pass. Before R245 the two "something changed" clauses were asked at those
 * states too, so arriving at the block step with a different option list on
 * offer could take the chip off — through no act of the opponent's, and while
 * its own promise ("keep passing until the battle ends") was still standing.
 *
 * Nothing is lost by waiting: the chip's only act is a pass, so a release it
 * defers to the next window it could have passed is a release that lands
 * before anything is passed. The 'phase' clause is asked BEFORE this, because
 * the battle ending is the promise's own terminus and is not about a window.
 */
export function inPassWindow(s: GameState, seat: Seat, legal: readonly Action[]): boolean {
  return !s.decision && s.priority === seat && legal.some(a => a.type === 'passPriority');
}

/**
 * R251 — ONE RELEASE LIST, TWO PROMISES, AND THE MODE IS THE ONLY DIFFERENCE.
 *
 * The clauses are not per-button: every one of them is computed the same way
 * for both modes, and the mode says which of them the promise HONOURS. That is
 * deliberate — a second copy of "what counts as a change", written for the
 * stronger button, is precisely the second opinion R245 exists to forbid, and
 * it is how #68 and #123 both happened.
 *
 * ── 'stack' (the button reading "Pass through stack")
 * Everything is live: the two change clauses, its own terminus 'done', and the
 * token guard. Its scope is `armedItems`.
 *
 * ── 'all' (the button reading "Pass all")
 * The change clauses are NOT asked. *"Pass all is the assumption that the
 * player doesn't want priority until the next phase"* — a chip that hands
 * priority back because the opponent cast something is the other button, and
 * building it here would leave the owner with two spellings of one feature and
 * still no way to say "I am done acting this battle".
 *
 * ⚠ 'tokens' IS STILL ASKED IN 'all' MODE, and that is not a shortened promise.
 * `passEndsBattlePhase` is true only of the pass that LEAVES the phase — the
 * very boundary 'all' is aiming at — so this fires at the terminus rather than
 * before it, and all it does is make the last step of the promise the player's
 * own click. R11 erases spell tokens at Regroup and there is no undo; #66 fixed
 * the warning to fire exactly there and nowhere else, and a chip that skated
 * past it would re-open the report it closed. A player holding no castable
 * token never sees it.
 */
export function passAllRelease(
  s: GameState, seat: Seat, legal: readonly Action[], arm: AutoPassArm,
): PassAllRelease {
  if (!arm.armed) return null;
  const mode = arm.mode ?? 'stack';
  // the promise's own outer terminus, asked first in both modes because a phase
  // that has turned over is not a judgement about a window (R245)
  if (s.phase !== (arm.armedPhase ?? 'battle')) return 'phase';
  // R245: every clause below is about the window in front of the player
  if (!inPassWindow(s, seat, legal)) return null;
  if (mode === 'stack') {
    // 'stack' — by identity where the arm carries one, by height where it does
    // not. The height is not a second opinion: growth can only happen by
    // gaining an id, so the id question strictly contains it (test/223).
    const fresh = arm.armedItems
      ? s.stack.some(it => !arm.armedItems!.includes(it.id))
      : s.stack.length > arm.armedStack;
    if (fresh) return 'stack';
    // 'ability' — likewise: every option, or the one action type the pre-R245
    // arm knew how to snapshot.
    const gained = arm.armedOpts
      ? optionKeys(s, legal).some(k => !arm.armedOpts!.includes(k))
      : activationKeys(legal).some(k => !arm.armedSig.includes(k));
    if (gained) return 'ability';
    // 'done' — the scope has resolved. The scope IS `armedItems`, so an arm
    // that carries none (a pre-R245 arm, or one taken at an empty stack) has
    // no scope to exhaust and this cannot fire for it. That is not a special
    // case being excused: `ui/main.ts` only offers the button while there is a
    // stack to pass through, so a scopeless 'stack' arm is unreachable from
    // the board, and the two suites that build arms by hand keep meaning what
    // they meant.
    if (arm.armedItems?.length && !s.stack.some(it => arm.armedItems!.includes(it.id))) {
      return 'done';
    }
  }
  if (tokensAtRisk(s, seat, legal) > 0) return 'tokens';
  return null;
}
