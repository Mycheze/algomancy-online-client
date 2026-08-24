/* DOM-free view logic, so it can be unit-tested without a browser.
 *
 * Everything here answers a question the UI asks about game state and card
 * data — "what is this stack item actually going to do?", "will clicking this
 * ability cost me something I can't get back?" — and none of it touches the
 * document. main.ts renders the answers; test/50-ui-inspect.test.ts checks
 * them.
 */
import { allCardNames, effectByKey, getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { allureViolation } from '../src/apply.ts';
import { specForSlot } from '../src/cards/dsl.ts';
import type { ActivatedAbility } from '../src/cards/dsl.ts';
import { createsOf, DECK_LIST, transformingCardNames, transformsInto } from '../src/cards/registry.ts';
import { matcherFor } from './glossary.ts';
import { clean, entityTextBox, switchClause } from './cardtext.ts';
import type {
  Action, CardName, EngineEvent, Entity, EntityId, EffectPart, GameState, Seat, StackItem,
} from '../src/types.ts';

// clean/switchClause live in ui/cardtext.ts now — one implementation, so the
// stack rows and the text box can never disagree about how a soft-hyphenated
// scan line reads. Re-exported for the tests that reach them through here.
export { switchClause };

/**
 * The rules text of ONE part of a stack item, and the card it came from.
 *
 * Playtest ask: a triggered or grafted ability on the stack used to preview
 * the whole card, which for a graft stack is a wall of text that says nothing
 * about what is about to happen. A part maps back to exactly one authored
 * clause through its effect key (dsl.ts):
 *   spell:<Card>        the card itself is the effect — its printed text
 *   ability:<Card>#<i>  abilities[i]
 *   augment:<Card>#<i>  augmentText[i] (text-box [Augment] text)
 *   graft:<Card>        the card's [Switch]-marked clause
 * Returns null for a key that names nothing renderable, so callers can fall
 * back to the item label rather than print an empty row.
 */
export function partText(effectKey: string): { source: CardName; text: string; graft?: boolean } | null {
  const ci = effectKey.indexOf(':');
  if (ci < 0) return null;
  const tag = effectKey.slice(0, ci), rest = effectKey.slice(ci + 1);
  try {
    if (tag === 'spell') {
      const t = clean(getCard(rest).text);
      return t ? { source: rest, text: t } : null;
    }
    if (tag === 'graft') {
      const t = switchClause(rest);
      return t ? { source: rest, text: t, graft: true } : null;
    }
    const [name, idxStr] = rest.split('#');
    const i = Number(idxStr);
    if (!name || !Number.isInteger(i)) return null;
    const c = getCard(name);
    const ab = tag === 'ability' ? c.abilities?.[i] : tag === 'augment' ? c.augmentText?.[i] : undefined;
    if (!ab?.label) return null;
    return { source: name, text: ab.label };
  } catch { return null; }
}

/** one attributed clause of a stack item, with the X that clause itself paid */
export interface StackAbilityRow {
  source: CardName;
  text: string;
  graft?: boolean;
  /** index into item.parts — what ties the row to the clause that paid for it */
  part: number;
  /** the cast cost THIS clause paid, defining its own X — R64's counted
   * payment, or the receipt stat the clause sizes itself off (partCostX). A
   * grafted rider's X is not its carrier's (types.ts EffectPart.costPaid.x),
   * so it is attributed to the row rather than to the item. */
  x?: number;
  /** what that payment actually consumed, in words ("erased 10 cards") */
  receipt?: string;
}

/** every live part of a stack item, in resolution order, as attributed text.
 * Spent parts (a bounded graft already used this turn, a declined cost) are
 * dropped — they will do nothing, so showing them would mislead. */
export function stackAbilityRows(item: StackItem): StackAbilityRow[] {
  const out: StackAbilityRow[] = [];
  item.parts.forEach((p, i) => {
    if (p.spent) return;
    const t = partText(p.effectKey);
    if (!t) return;
    const x = partCostX(p);
    const receipt = costReceipt(p.costPaid);
    out.push({ ...t, part: i, ...(x !== undefined ? { x } : {}), ...(receipt ? { receipt } : {}) });
  });
  return out;
}

/**
 * WHICH card and which list an activateAbility action addresses — the mirror
 * of apply.ts's `activationSource`, and it has to stay one.
 *
 * `own` is true for the unit's own text (the two `via` shapes that address the
 * IDENTITY face), false when the ability is borrowed from somewhere the player
 * has to be told about: an augment mod, or an R118 face projected onto the
 * unit right now. `card` is that source's name.
 *
 * ⚠ R118: `unit.card` is the PHYSICAL card and is NOT the answer for the own
 * arms — a unit wearing a copy reads its own text off `E.faceName`. Reading
 * `unit.card` here is exactly how the inspector would come to show a different
 * ability list from the one the game offers.
 */
function activationTextSource(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): { card: CardName; list: 'abilities' | 'augmentText'; own: boolean } | undefined {
  const via = a.via;
  if (via === undefined) return { card: new E(state).faceName(unit), list: 'abilities', own: true };
  if (via === 'augment') return { card: new E(state).faceName(unit), list: 'augmentText', own: true };
  if ('face' in via) {
    return { card: via.face, list: via.text === 'augment' ? 'augmentText' : 'abilities', own: false };
  }
  const card = state.entities[via.mod]?.card;
  return card ? { card, list: 'augmentText', own: false } : undefined;
}

/** the ActivatedAbility an activateAbility action refers to, resolving its
 * `via` (own abilities / own [Augment] text / an augment mod's donated text /
 * an R118 face projected onto the unit) */
export function abilityOf(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): ActivatedAbility | undefined {
  try {
    const src = activationTextSource(state, unit, a);
    const ab = src && getCard(src.card)[src.list]?.[a.abilityIndex];
    return ab && ab.type === 'activated' ? ab : undefined;
  } catch { return undefined; }
}

/**
 * Should activating this ask "are you sure?" before it fires?
 *
 * Playtest report: "Sacrifice me:" abilities are very easy to fire by accident
 * during battle — you meant to pick the unit as a blocker — and there is no
 * taking it back. Two things make one safe to fire on a single click:
 *  - the cost is only mana, so nothing permanent is spent; or
 *  - the engine will stop and ask for a TARGET, which is both a moment to
 *    notice and (since R57) strictly before anything is paid.
 *
 * The target test is "will a decision actually appear", not "does the card
 * print the word target". An ability whose targets have no legal candidates
 * skips the decision entirely and pays the cost anyway — precisely the trap
 * that "up to one target" with nothing to aim at sets.
 */
export function activationNeedsConfirm(
  e: E, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): boolean {
  const ab = abilityOf(e.s, unit, a);
  if (!ab) return false;
  const c = ab.cost;
  const irreversible = !!(c.sacrificeSelf || c.life || c.discard
    || c.sacrificeOther || c.discardOrSacrifice || c.debt);
  if (!irreversible) return false;
  const spec = ab.effect.targets;
  if (!spec) return true;                       // nothing will stop to ask
  try {
    return e.targetCandidates(
      specForSlot(spec, 0), e.actionRegion(unit.controller), undefined, unit.controller,
    ).length === 0;
  } catch { return true; }
}

/**
 * The cards `seat` could release from their cache RIGHT NOW, by name.
 *
 * Playtest ask: a reminder before ending deployment, because the cache is a
 * zone nobody has muscle memory for and a prophecy you already paid for is
 * easy to walk past. "Playable now" is narrower than "permitted" — a fulfilled
 * prophecy still has to clear normal timing (R42) — and the legal-action list
 * is the only thing that knows both, so this reads from there rather than
 * re-deriving it. Deduped and index-ordered: one entry may be offered by
 * several actions.
 */
export function playableCachedNames(cache: { card: CardName }[], legal: Action[]): CardName[] {
  const idx = new Set(legal
    .filter((a): a is Extract<Action, { type: 'playCached' }> => a.type === 'playCached')
    .map(a => a.index));
  return [...idx].sort((x, y) => x - y).map(i => cache[i]?.card).filter((n): n is CardName => !!n);
}

/**
 * Why one cache entry is not playable right now — the reason the UI prints.
 *
 * Playtest report #78 (room EGCW): the cache panel said "not this step" for a
 * {Deployment} card, during deployment, that was permitted and correctly timed
 * and short only of MANA. Nothing illegal was offered and nothing legal was
 * refused — enforcement was right and the LABEL was wrong. Both render sites
 * had computed "permitted" from cachePermission and "playable now" from the
 * legal-action list, then blamed the entire gap on timing without ever asking
 * whether the timing already matched.
 *
 * So the UI must not restate the rule; it must ask the SAME questions in the
 * SAME order the enumerator does. pushCachedPlays (apply.ts) walks:
 *     no `via`                                  → not permitted at all
 *     !allowed(cachedTiming)                    → wrong step
 *     via === 'glimpse' && !canPayManaOnly      → cannot pay
 *     !castable(...)                            → nothing legal to aim at
 *     otherwise it offers the play
 * and this mirrors that, clause for clause. The last clause is the residual:
 * `castable` is engine-private, so once permission, timing and mana are known
 * to be fine, "still not in `legal`" IS "no legal target".
 *
 * `allowed` is not a free parameter — it comes from the step the game is in
 * (haste → {Haste}; battle priority → {Battle}; deployment → {Deployment} or
 * {Haste}), so a step that offers no cached play at all reads as 'timing'.
 */
export type CacheBlock = 'none' | 'no-permission' | 'timing' | 'mana' | 'no-target';

/** the timing predicate `pushCachedPlays` would be handed right now, or null
 * when this step never reaches it for this seat (legalActions' dispatcher, and
 * the battle step/priority gates inside legalBattleActions) */
function cacheTimingGate(e: E, seat: Seat): ((t: string) => boolean) | null {
  const s = e.s;
  if (s.phase === 'gameover' || s.decision) return null;
  if (s.phase === 'planning' && s.hasteDone) {
    return s.hasteDone[seat] ? null : (t: string) => t === 'haste';
  }
  if (s.phase === 'planning') return null;
  if (s.phase === 'battle' && s.battle) {
    const b = s.battle;
    if (b.step === 'declare' && seat === b.attacker) return null;
    if (b.step === 'blocks' && seat === b.defender) return null;
    if (s.priority !== seat) return null;
    return (t: string) => t === 'battle';
  }
  if (e.deploying(seat)) return (t: string) => t === 'deploy' || t === 'haste';
  return null;
}

export function cacheBlockReason(e: E, seat: Seat, i: number, legal: Action[]): CacheBlock {
  const cc = e.cache(seat)[i];
  if (!cc) return 'no-permission';
  const via = e.cachePermission(seat, i);
  if (!via) return 'no-permission';
  const allowed = cacheTimingGate(e, seat);
  if (!allowed || !allowed(e.cachedTiming(seat, i, via))) return 'timing';
  if (via === 'glimpse' && !e.canPayManaOnly(seat, cc.card)) return 'mana';
  const offered = legal.some(a => a.type === 'playCached' && a.index === i && a.seat === seat);
  return offered ? 'none' : 'no-target';
}

/**
 * Should the client auto-pass this priority window because the thing about to
 * resolve is a trigger the player has chosen to yield to?
 *
 * Playtest 2026-08-20 ("auto yield literally isn't doing anything"): the old
 * test was `stack.every(item is a yielded trigger)`. Passing priority only
 * ever resolves the TOP of the stack, so requiring the whole stack to be
 * yielded meant that the moment anything else was on it — the opponent's
 * spell, a second unit's trigger, the very common case in a real game — the
 * chip did nothing at all. One of Bena's stacks that turn held four triggers
 * from four different units.
 *
 * The right question is about the top item only. Everything under it gets its
 * own window later, and this runs again for each.
 */
export function shouldAutoYield(
  state: GameState, seat: Seat, yielded: ReadonlySet<number>,
): boolean {
  if (!yielded.size) return false;
  // a priority window of my own, with nothing being asked of anybody
  if (state.priority !== seat || state.decision) return false;
  // R68 note: negation REMOVES the item from the stack the instant it
  // resolves, so `negated` is no longer reachable on anything in
  // GameState.stack (test/50 pins that against the live engine). The guard
  // stays anyway, and is not dead weight: the flag is still on the type, and
  // this client now MINTS negated stack items itself — ui/flash.ts stamps one
  // on every snapshot it replays for a beat — so "never silently pass through
  // a negated item" is a live sentence again, not a fossil.
  const top = state.stack[state.stack.length - 1];
  if (!top || top.negated) return false;
  return top.kind === 'triggered' && top.sourceId !== undefined && yielded.has(top.sourceId);
}

// ── [59] the one automatic-pass decision ──────────────────────────────

/**
 * Identity keys of every activateAbility currently legal for a seat.
 *
 * "Pass all" snapshots these when it is armed; a key that was NOT in the
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

/** distinct spell tokens this legal-action list can cast right now (C5) */
export function castableTokens(legal: readonly Action[]): number {
  return new Set(legal
    .filter(a => a.type === 'castSpellToken')
    .map(a => (a as { entityId: EntityId }).entityId)).size;
}

/** what the client's own settings say about passing without being asked */
export interface AutoPassArm {
  /** the "Pass all" chip is armed */
  armed: boolean;
  /** stack height when it was armed — growth disarms it */
  armedStack: number;
  /** activationKeys() when it was armed — a NEW key disarms it */
  armedSig: readonly string[];
  /** the persistent auto-pass TOGGLE (C4) is on */
  prefOn: boolean;
  /** units whose triggers this player yields to (#2) */
  yieldIds: ReadonlySet<EntityId>;
}
export interface AutoPassPlan {
  /** the "Pass all" chip must come off */
  disarm: boolean;
  /** why a pass is going out for this state — null means the window is mine */
  pass: 'passall' | 'pref' | 'yield' | null;
}

/**
 * Will this client pass this priority window by itself?
 *
 * [59] "I see a flash of the top of the screen that looks like it's giving me
 * prio for like 1 frame AND I see a 'You do not have priority' note."
 *
 * Both halves of that report come from the same shape of mistake: the decision
 * to pass used to be made AFTER the board had been painted, by three separate
 * functions that each carried their own one-shot guard. So the prompt bar
 * claimed priority for a whole server round trip before the corrective view
 * arrived, and — with the auto-pass toggle on AND a yielded trigger on top —
 * two of those three fired for the same state, the second one earning a
 * "you do not have priority" refusal that stuck.
 *
 * This is the decision, alone, as a pure function: one answer per state, made
 * BEFORE anything is drawn (so the bar can say "auto-passing" instead of
 * lying) and consumed once (so exactly one pass goes out). The order is the
 * one the old chain had — Pass-all, then the toggle, then the yield — and now
 * it is an ordering rather than three independent chances to send.
 *
 * WHAT IS NOT HERE ANY MORE: the Pass-all branch. Report #68 ("I hit pass all,
 * but then it stopped passing all") was this function's own C5 clause —
 * "castableTokens(legal) > 0 → disarm", true in nearly every priority window
 * of nearly every battle, so the chip performed exactly one pass and switched
 * itself off. The whole release list moved to ui/battle.ts `passAllRelease`,
 * which asks the sharper question, and `autoPassDecision` (same file) is the
 * one caller: it asks THIS function with `armed: false` for the remaining two
 * reasons and owns Pass-all itself. The branch stayed here for a round after
 * that, reachable only from its own tests, and is now gone — `arm.armed` and
 * `arm.armedStack`/`armedSig` are read by `passAllRelease` alone. There is
 * exactly one answer to "why did pass-all stop", and it is a PassAllRelease.
 */
export function autoPassPlan(
  s: GameState, seat: Seat, legal: readonly Action[], arm: AutoPassArm,
): AutoPassPlan {
  // C4: the toggle passes whenever passing is my ONLY legal action
  if (arm.prefOn && !s.decision && s.phase !== 'gameover'
    && legal.length > 0 && legal.every(a => a.type === 'passPriority')) {
    return { disarm: false, pass: 'pref' };
  }
  // #2: the top of the stack is a trigger from a unit I yield to
  if (shouldAutoYield(s, seat, arm.yieldIds) && legal.some(a => a.type === 'passPriority')) {
    return { disarm: false, pass: 'yield' };
  }
  return { disarm: false, pass: null };
}

/** the two stamps that make an automatic pass one-per-state (UiState) */
export interface SendLatch {
  /** actionCount an automatic pass has already been scheduled for */
  autoAt: number;
  /** actionCount ANY intent was handed to the socket for */
  sentFor: number;
}

/**
 * Does the pass this plan calls for actually go out — and, if so, claim the
 * state so nothing else sends for it.
 *
 * [59] This is the other half of the report. render() runs many times per
 * server state (a hover, a beat waking the log, the chip disarming and
 * repainting itself), and the old code had a separate stamp per auto-pass
 * reason, so two reasons could each pass their own guard for one state. The
 * server applies the first and refuses the second with "you do not have
 * priority" — the sticky note Bena saw. One latch, one send, whatever the
 * reason and however many times the board is painted.
 */
export function takeAutoPass(plan: AutoPassPlan, actionCount: number, latch: SendLatch): boolean {
  if (!plan.pass) return false;
  if (latch.autoAt === actionCount || latch.sentFor === actionCount) return false;
  latch.autoAt = actionCount;
  return true;
}

// ── [08b] what a single click is allowed to just DO ───────────────────

/**
 * Must this action be picked off a menu rather than fired by the click that
 * revealed it?
 *
 * Playtest [08b]: "I was able to Prophecy Air Plant without having any Wood
 * resources. I just wanted to click the card to see what would happen and it
 * just immediately went to the Cache zone." The cost was right — R42's
 * prophecy banner is plain mana with no affinity — but the CLICK was not.
 * During deployment a {Flying} unit that cannot be played and has no augment
 * mode leaves prophesying as the only thing on offer, and `offer()` fires a
 * lone item on the spot.
 *
 * Prophesying spends mana and moves a card out of hand for good, and unlike a
 * cast it never stops to ask for a target — so there is no moment anywhere in
 * it to notice. It gets the menu the other prophesy sources already show
 * (a bin card that can also be augmented opens one today), which is the same
 * second click, in the same interaction language, with the banner cost and the
 * condition spelled out in the label before you commit.
 */
export function actionNeedsMenu(a: Action): boolean {
  return a.type === 'prophesy';
}

/** what clicking a card with these options should do */
export type OfferPlan = { kind: 'none' } | { kind: 'go'; index: number } | { kind: 'menu' };

/**
 * The common tail of every card click: exactly one harmless thing just
 * happens, anything else opens the menu at the cursor.
 *
 * "Harmless" is the whole judgement — an item flagged `confirm` never fires
 * on its own, however alone it is (see actionNeedsMenu above).
 */
export function planOffer(items: readonly { confirm?: boolean }[]): OfferPlan {
  if (!items.length) return { kind: 'none' };
  if (items.length === 1 && !items[0]!.confirm) return { kind: 'go', index: 0 };
  return { kind: 'menu' };
}

// ── [30]/[31] what the board itself offers on a right-click ───────────

/** one entry the board's right-click menu shows, before main.ts hangs an
 * action on it. `confirm` means the entry only OPENS a question. */
export interface BoardMenuEntry {
  kind: 'erased' | 'concede';
  seat: Seat;
  label: string;
  confirm: boolean;
}

/**
 * R65: the two things the board offers wherever you right-click — both were
 * playtest asks ("We need a way to right click -> concede match :(", "I dont
 * think there's currently a way to view erased cards"). They ride on every
 * card menu too, so you never have to hunt for bare table.
 *
 * `mySeat` is the seat this client drives, or null in hotseat (where one
 * person drives both, so both are offered).
 */
export function boardMenuEntries(s: GameState, mySeat: Seat | null): BoardMenuEntry[] {
  const items: BoardMenuEntry[] = [];
  for (const p of [0, 1] as Seat[]) {
    const pl = s.players[p]!;
    // the same count the dialog shows: real cards, then "+n tokens" (R69)
    const n = erasedPileView(pl.erased).countLabel;
    const mine = mySeat !== null && p === mySeat;
    items.push({
      kind: 'erased', seat: p, confirm: false,
      label: `🚫 ${mine ? 'My' : `${pl.name}'s`} erased cards (${n})`,
    });
  }
  if (s.phase !== 'gameover') {
    // net: you may only concede your own seat. Hotseat: one person is driving
    // both, so both are offered — and priority can be null (planning, draft),
    // which is exactly when someone might want to stop.
    for (const seat of (mySeat !== null ? [mySeat] : [0, 1]) as Seat[]) {
      items.push({
        kind: 'concede', seat, confirm: true,
        label: mySeat !== null ? '🏳 Concede the match' : `🏳 Concede as ${s.players[seat]!.name}`,
      });
    }
  }
  return items;
}

// ── [35] the classes one card scan wears ──────────────────────────────

/** every state a card scan can be drawn in (cardHtml's options) */
export interface CardFlags {
  playable?: boolean; candidate?: boolean; selected?: boolean;
  carrying?: boolean; modhost?: boolean;
  /** UZRG: it has a legal activated ability — a DIFFERENT fact from `playable`
   * ("can be dragged into a formation"), and both can be true at once */
  activatable?: boolean;
}
/**
 * The class list for a card scan. `.activatable` is the one that has to be
 * spelled out here rather than inlined: it is the only class with no click
 * behaviour of its own — deleting it breaks nothing but the green halo
 * (style.css `.card.activatable`), which is exactly the ask it answers.
 */
export function cardClasses(f: CardFlags): string[] {
  const cls = ['card'];
  if (f.playable) cls.push('playable');
  if (f.candidate) cls.push('candidate');
  if (f.selected) cls.push('selected');
  if (f.carrying) cls.push('carrying');
  if (f.modhost) cls.push('modhost');
  if (f.activatable) cls.push('activatable');
  return cls;
}

// ── R79: where a mod-in-progress may LAND ─────────────────────────────

/** the mod the client is placing (UiState.modding), minus the seat. Leave
 * `index` off to ask about EVERY card in that zone at once — which is the
 * question the bin dialog's banner asks, before any one card is picked. */
export interface ModPick {
  from: 'hand' | 'bin' | 'cache';
  index?: number;
  mode: 'augment' | 'graft';
}

/**
 * The hosts one in-progress mod may legally land on, split by KIND.
 *
 * There are two kinds and there have always been two: a unit in play
 * (`Action.hostId`) and — R79, sourced Caleb 2025-04-06 (*"In Battle, can you
 * augment a spell with a virus… Yes"*) — a SPELL ON THE STACK
 * (`Action.hostStack`). The client only ever read the first, because the cache
 * behind the glow was a `Set<EntityId>` and a `StackItem` is not an `Entity`,
 * so the whole ruling was unreachable from the board: `legalActions` offered
 * the action and nothing on screen could emit it.
 *
 * This is a READ of the legal-action list, never a re-derivation. Which stack
 * items qualify is `apply.ts`'s `STACK_VIRUS_HOSTS` ({spell, spellUnit,
 * spellToken} — not a trigger, not an ability, not another virus, not an
 * ambusher), and it is deliberately not restated here: the UI drifting from
 * the engine's own answer is the entire bug this fixes.
 */
export interface ModHosts {
  /** units in play (`hostId`) */
  units: Set<EntityId>;
  /** items on the stack (`hostStack`) — augment only, spells only */
  stack: Set<number>;
  /**
   * R89: spell tokens IN PLAY (`hostId` again — a token is an Entity like a
   * unit, so the engine names it in exactly the same field).
   *
   * Only filled when `modHosts` is given the state to ask; without it a token
   * host is indistinguishable from a unit host and lands in `units`, which is
   * what every caller that does not care about the difference wants. Optional
   * so a caller can still hand-build a `ModHosts` of the two original kinds.
   */
  tokens?: Set<EntityId>;
}

export function modHosts(legal: readonly Action[], m: ModPick | null, s?: GameState): ModHosts {
  const hosts: ModHosts = { units: new Set(), stack: new Set(), tokens: new Set() };
  if (!m) return hosts;
  for (const a of legal) {
    if (a.type !== m.mode) continue;
    const c = a as { from?: string; index?: number; hostId?: EntityId; hostStack?: number };
    if (c.from !== m.from) continue;
    if (m.index !== undefined && c.index !== m.index) continue;
    if (c.hostId !== undefined) {
      // R89 — Caleb 2025-03-06: "You can augment spells during deployment but
      // currently that would only be possible with spell tokens." The engine
      // offers it in `hostId`, so the KIND is the only thing that separates the
      // two, and only the state knows it.
      if (s && s.entities[c.hostId]?.kind === 'spellToken') hosts.tokens!.add(c.hostId);
      else hosts.units.add(c.hostId);
    }
    if (c.hostStack !== undefined) hosts.stack.add(c.hostStack);
  }
  return hosts;
}

/** how many places this mod could go */
export const modHostCount = (h: ModHosts): number =>
  h.units.size + h.stack.size + (h.tokens?.size ?? 0);

/**
 * What to CALL the hosts on offer, for the prompt bar, the menu entry and the
 * bin banner — all three of which used to promise a unit and only a unit
 * ("Glowing cards can be applied to a unit as a mod right now"). Reads the
 * offer rather than the rules, so it cannot promise a host the engine will
 * refuse, and it never widens: a graft has no stack form at all.
 *
 * Written to follow the article "a": `a ${modHostPhrase(hosts)}`.
 *
 * R89 adds the third kind — a spell TOKEN standing in your region during
 * deployment. It is named separately from "a unit" for the same reason the
 * stack host was: a banner that says "unit" is how a ruling stays invisible.
 */
export function modHostPhrase(h: ModHosts): string {
  const parts: string[] = [];
  if (h.units.size) parts.push('unit');
  if (h.tokens?.size) parts.push('spell token');
  if (h.stack.size) parts.push('spell on the stack');
  return parts.length ? parts.join(', or a ') : 'unit';
}

/**
 * R89: what an augment would actually donate to a SPELL host.
 *
 * "Also you can only do this with attributes" (Caleb 2025-03-06). A mod whose
 * whole payload is rules text — Graxxlid, Skybreaker — is a perfectly legal
 * thing to put on a spell token and changes nothing about it, and the engine
 * says so in the log at the moment the card is committed (doAugment). This is
 * the same fact one moment EARLIER, while the player can still change their
 * mind, which is what R79's stack-host banner does for the stack kind.
 */
export function spellAugmentAttrs(card: CardName): string[] {
  try { return [...getCard(card).augmentAttrs]; } catch { return []; }
}

/** the sentence that fact is worth, for the mod-in-progress bar */
export function spellAugmentNote(card: CardName): string {
  const attrs = spellAugmentAttrs(card);
  return attrs.length
    ? `a spell token would gain {${attrs.join('} {')}} — attributes are all a spell can take`
    : 'a spell token would gain NOTHING — only ATTRIBUTES cross to a spell, and this grants none';
}

// ── card names inside prose (the log, the reveal, the stack) ──────────

/** the longest card name in the pool, in words — the window the scan slides */
const MAX_NAME_WORDS = 6;
/** punctuation that clings to a word in prose but is never part of a name */
const CLING = /^[.,!:;()'"“”‘’]+|[.,!:;()'"“”‘’]+$/g;
/** the same characters, one at a time (a /g/ regex's `test` is stateful) */
const CLING_CH = /[.,!:;()'"“”‘’]/;

/**
 * Fast reject: could a card name begin with this word at all?
 *
 * The log is rescanned on every render, 80 lines at a time, and `getCard`
 * answers "no" by THROWING — several thousand exceptions per repaint is a
 * frame budget spent on nothing. Built once, from the registry itself.
 * (Retired ALIASES are not in allCardNames() and so are not prefiltered;
 * state only ever stores canonical names, which is what prose quotes.)
 */
let nameStarts: Set<string> | null = null;
function startsAName(word: string): boolean {
  if (!nameStarts) {
    nameStarts = new Set(allCardNames().map(n => n.split(' ')[0]!.toLowerCase()));
  }
  return nameStarts.has(word.toLowerCase());
}

/** one run of a message: either a stretch of plain prose, or a card name */
export interface NameSpan {
  /** the ORIGINAL text, verbatim — the log must still read the way it reads */
  text: string;
  /** the card it names, or null for ordinary prose */
  name: CardName | null;
}

/**
 * Cut a message into spans, marking every stretch that names a known card.
 *
 * Playtest UZRG: "the log and the stack are not inspectable". The engine does
 * log X, and does log "Bena spawns Wraith" — but the log was inert prose, so
 * there was nothing to hover, nothing to right-click, and no way to find out
 * what a Wraith is at the exact moment you are being told about one.
 *
 * Leftmost-longest, up to MAX_NAME_WORDS: at each word boundary the longest
 * name that starts there wins, so "Echo of Despair" is never mistaken for
 * "Echo". Punctuation clinging to the outside of a candidate is ignored for
 * the lookup and excluded from the span, so the sentence still punctuates
 * itself outside the link.
 *
 * This is the ONE name-matcher in the client: `findCardName` (the deployment
 * reveal) is a query over the same spans rather than a second implementation
 * that can disagree with it.
 */
export function linkCardNames(msg: string): NameSpan[] {
  const out: NameSpan[] = [];
  const words: { text: string; at: number; end: number }[] = [];
  for (const m of msg.matchAll(/\S+/g)) {
    words.push({ text: m[0], at: m.index, end: m.index + m[0].length });
  }
  let cut = 0;                       // how much of msg is already emitted
  const plain = (upto: number): void => {
    if (upto > cut) out.push({ text: msg.slice(cut, upto), name: null });
    cut = upto;
  };
  for (let i = 0; i < words.length;) {
    if (!startsAName(words[i]!.text.replace(CLING, ''))) { i++; continue; }
    let hit: { name: CardName; last: number } | null = null;
    for (let len = Math.min(MAX_NAME_WORDS, words.length - i); len >= 1 && !hit; len--) {
      const cand = words.slice(i, i + len).map(w => w.text.replace(CLING, '')).join(' ');
      if (!cand) continue;
      try { getCard(cand); hit = { name: cand, last: i + len - 1 }; } catch { /* not a card */ }
    }
    if (!hit) { i++; continue; }
    // trim the clinging punctuation back OUT of the span, so the full stop
    // after a card name is not part of the link
    let start = words[i]!.at, end = words[hit.last]!.end;
    while (start < end && CLING_CH.test(msg[start]!)) start++;
    while (end > start && CLING_CH.test(msg[end - 1]!)) end--;
    plain(start);
    out.push({ text: msg.slice(start, end), name: hit.name });
    cut = end;
    i = hit.last + 1;
  }
  plain(msg.length);
  return out;
}

/**
 * The longest word-sequence in `msg` that names a known card, if any.
 *
 * The deployment reveal picks ONE scan per row, and the longest name is the
 * most specific thing the sentence said. Ties go to the first, which is the
 * order the sentence puts them in.
 */
export function findCardName(msg: string): CardName | null {
  let best: CardName | null = null, bestLen = 0;
  for (const sp of linkCardNames(msg)) {
    if (!sp.name) continue;
    const len = sp.name.split(' ').length;
    if (len > bestLen) { best = sp.name; bestLen = len; }
  }
  return best;
}

// ── the cast list: which cards this game has actually shown ───────────
//
// Playtest UFAB: "all strings that match card names become hoverable cards…
// so 'Battle:' (which happens every turn) looks like it's a card name.
// Instead, the game log should only highlight actual cards used in the game
// to generate those effects."
//
// `Battle` really is a card ("Two target units fight"), so the phase line
// `Battle: Ben may attack.` — an `ev('phase', …)` carrying no card data at
// all — linked every single turn. And it is not one unlucky word: 133 card
// names are a single word, `Fight`, `Recall`, `Capture`, `Perish`, `Cull`,
// `Crystal`, `Poison`, `Wisp`, `Robot` among them, so any new log phrasing
// can collide tomorrow.
//
// The fix is Bena's own sentence: keep a set of the cards this game has
// really shown, and let the log link a name only if it is in that set. The
// matcher itself stays general — `findCardName` (the deployment reveal) is a
// question about ONE sentence, not about a game, and reads the raw spans.
//
// The set GROWS and never shrinks: a card recalled to hand, binned, erased or
// recycled away must still link in the old lines that talk about it.

/** memoised "is this string a card name?" — `getCard` answers no by THROWING,
 * and the ledger asks about a lot of strings */
const nameKnown = new Map<string, boolean>();
function isCardName(s: unknown): s is CardName {
  if (typeof s !== 'string' || !s) return false;
  const hit = nameKnown.get(s);
  if (hit !== undefined) return hit;
  // the same prefilter the scanner uses, so a stack item's LABEL (or any
  // other long prose string riding in event data) never reaches getCard and
  // never grows the memo
  if (!startsAName(s.split(' ')[0] ?? '')) { nameKnown.set(s, false); return false; }
  let ok = false;
  try { getCard(s); ok = true; } catch { ok = false; }
  nameKnown.set(s, ok);
  return ok;
}

/** the card names a stack item puts on the table: the card itself, the mods
 * riding with it, and the source of each of its effect parts (a trigger has
 * no `card` of its own — 'ability:Boreal Wanderer#0' is the only place its
 * name appears) */
function itemNames(it: StackItem | null | undefined, out: CardName[]): void {
  if (!it) return;
  if (isCardName(it.card)) out.push(it.card);
  for (const m of it.mods ?? []) if (isCardName(m?.card)) out.push(m.card);
  for (const p of it.parts ?? []) {
    const src = partText(p?.effectKey ?? '')?.source;
    if (isCardName(src)) out.push(src);
  }
}

/**
 * Every card name visible in `s` — the zones this client is actually shown.
 *
 * Deliberately NOT the decks or the packs. A deck is hidden information (the
 * hotseat Harness holds the real one, unredacted), and a card nobody has seen
 * yet is exactly the card the log must not pretend to be talking about.
 */
export function namesInState(s: GameState | null | undefined): CardName[] {
  const out: CardName[] = [];
  if (!s) return out;
  const add = (n: unknown): void => { if (isCardName(n)) out.push(n); };
  for (const p of s.players ?? []) {
    for (const n of p.hand ?? []) add(n);
    for (const n of p.bin ?? []) add(n);
    for (const n of p.erased ?? []) add(n);
    for (const c of p.cache ?? []) add(c?.card);
  }
  // R118: an entity puts TWO names on the table when it is wearing a copied
  // face — the physical card (which is what bins, ruling 1) and the card it
  // currently reads as, whose text box and art the client is now showing.
  for (const en of Object.values(s.entities ?? {})) {
    add(en?.card);
    for (const c of en?.copies ?? []) add(c?.card);
  }
  for (const it of s.stack ?? []) itemNames(it, out);
  itemNames(s.resolving, out);
  // a hand you were shown (Bripp) is a hand you have seen
  for (const sh of s.seenHand ?? []) for (const n of sh?.cards ?? []) add(n);
  // and so are the cards a decision is currently offering you
  for (const o of s.decision?.options ?? []) add(o?.card);
  return out;
}

/** how deep the event-data walk goes — a stack item nests item → mods → parts
 * and nothing in the engine is deeper than that */
const DATA_DEPTH = 6;

/**
 * Every card name carried in a batch of events' DATA.
 *
 * The message is not read, on purpose — reading it is the bug. Only values
 * the engine put in `data` count, and only exact matches: `data.card`,
 * `data.cards[]`, the whole `StackItem` inside a 'stackFlash'. That last one
 * is what catches a spell token created and resolved inside a single batch
 * ("Ben creates a Fireball 30") — it is never in any state this client is
 * handed, so nothing else would ever see it.
 */
export function namesInEvents(events: readonly EngineEvent[]): CardName[] {
  const out: CardName[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > DATA_DEPTH || v === null || v === undefined) return;
    if (typeof v === 'string') { if (isCardName(v)) out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    // a stack item knows more about itself than a blind walk can find
    if (typeof o['id'] === 'number' && typeof o['label'] === 'string' && Array.isArray(o['parts'])) {
      itemNames(o as unknown as StackItem, out);
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const e of events) walk(e?.data, 0);
  return out;
}

/**
 * Fold this game's newest facts into the cast list. Mutates and returns
 * `known`, which is the point: it must grow monotonically for the whole game.
 */
export function growCardLedger(
  known: Set<CardName>, state: GameState | null | undefined,
  events: readonly EngineEvent[] = [],
): Set<CardName> {
  const add = (n: CardName): void => {
    if (known.has(n)) return;      // already expanded — createsOf is not free
    known.add(n);
    // A card in the game brings its tokens with it. `createsOf` is DECLARED on
    // the effect and conformance-tested (registry.ts), so this is not a guess:
    // Spirit of Nature's own trigger line says "create a Poison 2 or a Crystal
    // 2" BEFORE either token exists anywhere, and that line is exactly where a
    // reader most needs to hover the word and find out what a Crystal is.
    for (const t of createsOf(n)) if (isCardName(t)) known.add(t);
  };
  for (const n of namesInState(state)) add(n);
  for (const n of namesInEvents(events)) add(n);
  return known;
}

/**
 * The same spans with every name OUTSIDE `known` demoted back to prose.
 *
 * Adjacent prose runs are welded back together so the caller sees the line the
 * way `linkCardNames` would have cut it if the demoted name had never been a
 * card — one span in, one span out, no empty seams.
 */
export function onlyKnownNames(
  spans: readonly NameSpan[], known: ReadonlySet<string>,
): NameSpan[] {
  const out: NameSpan[] = [];
  for (const sp of spans) {
    if (sp.name !== null && known.has(sp.name)) { out.push(sp); continue; }
    const last = out[out.length - 1];
    if (last && last.name === null) out[out.length - 1] = { text: last.text + sp.text, name: null };
    else out.push({ text: sp.text, name: null });
  }
  return out;
}

/** one row of the reveal: a card scan (or none) and the sentence(s) it covers */
export interface RevealRow { name: CardName | null; text: string }

/** drop a single trailing full stop so messages can be joined with commas */
const unstop = (s: string): string => s.trim().replace(/\.$/, '');

/**
 * Join one row's messages: "a, b, c." — with a run of the SAME message
 * collapsed to "a ×3", because three identical sentences separated by commas
 * is the verbosity we are removing, not a shorter form of it.
 */
function joinMessages(msgs: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < msgs.length;) {
    let n = 1;
    while (i + n < msgs.length && msgs[i + n] === msgs[i]) n++;
    parts.push(unstop(msgs[i]!) + (n > 1 ? ` ×${n}` : ''));
    i += n;
  }
  const out = parts.join(', ');
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/**
 * Group the deployment reveal into rows.
 *
 * Playtest 2026-08-20, Bena: "single cards create 5 full sized entries […]
 * it's good to show the full chain of events, but they don't need to take up
 * so much space." One card being deployed is one beat, but the engine narrates
 * it as several events — played, resolved, and one line per token it made —
 * and each was drawing its own full card scan.
 *
 * CONSECUTIVE messages that resolve to the same card art collapse onto a
 * single row. Consecutive, not global: the point is to compress a chain, not
 * to reorder it, so a card that comes up again later still gets its own row in
 * the place it happened.
 */
export function groupReveal(msgs: readonly string[]): RevealRow[] {
  const groups: { name: CardName | null; msgs: string[] }[] = [];
  for (const msg of msgs) {
    const name = findCardName(msg);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.msgs.push(msg);
    else groups.push({ name, msgs: [msg] });
  }
  return groups.map(g => ({ name: g.name, text: joinMessages(g.msgs) }));
}

// ── which units can ACT right now (playtest UZRG) ─────────────────────

/**
 * The units with at least one legal activated ability, by entity id.
 *
 * Playtest report (UZRG): "units with activated abilities don't get a green
 * highlight around them indicating you can activate their abilities". The
 * affordance simply did not exist — the board's `clickable` flag means "can be
 * dragged into a formation", which is a different question with a different
 * answer, and is false whenever there is no battle.
 *
 * This is a READ of the legal-action list, never a re-derivation. `legalActions`
 * already gates on suppression (R62), the per-ability {Battle}/{Deployment}
 * marker (R49), cost payability, bounded budgets and R64's "a mandatory target
 * with no candidate is not an option". Deriving the glow a second way is how a
 * highlight ends up promising something the engine will refuse.
 */
export function activatableUnits(legal: readonly Action[]): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const a of legal) if (a.type === 'activateAbility') out.add(a.entityId);
  return out;
}

/**
 * How to NAME one activateAbility option: the ability's own label, prefixed
 * with the mod that donated it when it is not the unit's own text.
 *
 * `via` is the four-way the engine uses (`ActivateVia`): undefined = the
 * IDENTITY face's `abilities`, 'augment' = that face's text-box [Augment]
 * clause, { mod } = an augment mod slid under it, { face } = an R118 face
 * projected onto it. The last two name their source.
 */
function abilityOptionLabel(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): string {
  try {
    const src = activationTextSource(state, unit, a);
    if (!src) return '?';
    const label = getCard(src.card)[src.list]?.[a.abilityIndex]?.label ?? '?';
    // its own text names itself already; borrowed text (a mod's, or an R118
    // face projected onto it) says whose it is
    return src.own ? label : `${src.card}: ${label}`;
  } catch { return '?'; }
}

/**
 * The badge a unit wears when it has something to activate.
 *
 * The glow says "something here"; the badge says WHAT, which is the difference
 * between an affordance and a mystery. One ability names itself; several
 * collapse to a count, because the menu is one click away and a card is 70px
 * wide.
 */
export function activationBadge(
  state: GameState, unit: Entity, legal: readonly Action[],
): string | null {
  const mine = legal.filter((a): a is Extract<Action, { type: 'activateAbility' }> =>
    a.type === 'activateAbility' && a.entityId === unit.id);
  if (!mine.length) return null;
  return mine.length === 1
    ? abilityOptionLabel(state, unit, mine[0]!)
    : `${mine.length} abilities`;
}

/** the formation job this unit could be clicked for, as main.ts knows it */
export interface FormationRole {
  /** which declaration is being built right now */
  step: 'attack' | 'block';
  /** it is already standing in a column (or in the send list) */
  placed: boolean;
  /** it is the unit currently in hand, waiting for a slot */
  carrying: boolean;
}

export interface UnitClickOption {
  kind: 'formation' | 'activate';
  label: string;
  /** present exactly when kind === 'activate' */
  action?: Extract<Action, { type: 'activateAbility' }>;
}

/**
 * Everything clicking this unit could mean right now.
 *
 * The second half of the UZRG report, and the worse half. main.ts tested the
 * formation branch FIRST, so during your own declare step (or your own block
 * step) a click on your own unit always picked it up for a column and the
 * `else if` that opened the ability menu was unreachable. A {Battle}-timed
 * ability on a unit you are also attacking with therefore had no input path at
 * all — the right-click menu offers details, judge and auto-yield, but never
 * activate.
 *
 * So the two are not a precedence any more, they are a LIST: one entry means
 * do it, more than one means ask.
 */
export function unitClickOptions(
  state: GameState, unit: Entity, legal: readonly Action[],
  formation: FormationRole | null,
): UnitClickOption[] {
  const out: UnitClickOption[] = [];
  if (formation) {
    out.push({
      kind: 'formation',
      label: formation.placed ? '↩ take out of the formation'
        : formation.carrying ? '✋ put back down'
          : formation.step === 'attack' ? '⚔ pick up — put in an attack column'
            : '🛡 pick up — put in a block',
    });
  }
  for (const a of legal) {
    if (a.type !== 'activateAbility' || a.entityId !== unit.id) continue;
    out.push({ kind: 'activate', label: abilityOptionLabel(state, unit, a), action: a });
  }
  return out;
}

// ── the tokens a card creates (playtest UZRG) ─────────────────────────

/**
 * Every registered card name that is not a playable deck card — i.e. a token.
 *
 * Tokens are ordinary registry cards (spawnUnit looks them up by name), so
 * "not in DECK_LIST" is the whole definition and a new token needs no
 * bookkeeping. Resource FACES are registry cards too and nothing creates one,
 * so they are dropped. Longest first, so "Crystal 2" wins over "Crystal" on
 * the same sentence.
 */
const TOKEN_NAMES: readonly string[] = (() => {
  const playable = new Set<string>(DECK_LIST);
  // R101: a TRANSFORM BACK FACE is also a registry card outside DECK_LIST —
  // "Beyond, Codex Incarnate" is even printed as a "Book Token Unit" — but it
  // is not a token anything CREATES, and Scholar of the Void's printed text
  // names it in a perfectly scannable sentence. Without this it would appear
  // under "Tokens it creates" on the card that transforms INTO it, which is a
  // false statement about the rules: Scholar becomes it, it never makes one.
  // Excluded from the SCAN list only — the back face is still a token
  // everywhere the type line is what matters (`tokenOnlyName`, DECK_LIST).
  const backFaces = new Set(transformingCardNames().map(n => transformsInto(n)!));
  return allCardNames()
    .filter(n => !playable.has(n) && !backFaces.has(n)
      && !/ Resource$/.test(n) && !/^Dormant/.test(n))
    .sort((a, b) => b.length - a.length);
})();

/**
 * Token names a piece of rules text NAMES — the fallback half of
 * `tokensCreatedBy`, and inflection-tolerant.
 *
 * The bug this fixes (UZRG: "Primordial Coalescence isn't showing the Tokens
 * it creates"): the old scan built `\bWraith\b` by hand, and card text says
 * "Create two **Wraiths**". Five cards were affected. `matcherFor` is the
 * matcher ui/glossary.ts already uses for exactly this job — one regex idiom
 * for the whole client rather than a second, worse one here.
 *
 * It stays a FALLBACK. Printed text is the card's history, not its rules, so
 * it cannot see a token created by granted (R63), donated or graft-composite
 * text, and it can never see a token whose card is also in DECK_LIST (Echo of
 * Despair, Hooba-God). Only the declared `EffectDef.creates` list can.
 */
export function tokensNamedIn(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let left = text;
  for (const name of TOKEN_NAMES) {
    const re = matcherFor({ term: name, text: '' });
    if (!re.test(left)) continue;
    out.push(name);
    left = left.replace(new RegExp(re.source, 'gi'), ' ');   // don't match it twice
  }
  return out;
}

/**
 * The tokens this card can put onto the board.
 *
 * DECLARED first (`EffectDef.creates`, R69 — registry.createsOf), because that
 * is the rules answer and a conformance test keeps it honest. The text scan is
 * only a safety net for cards whose declaration has not been written yet.
 *
 * Pass `live` and the scan reads the unit's CURRENT text box instead of the
 * printed string — symmetric with `entityTextBox`, and the reason the
 * inspector can now show the Wraiths a unit makes because something GRANTED it
 * that clause five minutes ago. Every card contributing a live clause also
 * contributes its own declarations.
 */
export function tokensCreatedBy(name: CardName, live?: { e: E; unit: Entity }): string[] {
  const out: string[] = [];
  const add = (n: string): void => { if (n && !out.includes(n)) out.push(n); };
  const declared = (card: string): void => {
    try { for (const t of createsOf(card)) add(t); } catch { /* not a registry card */ }
  };
  declared(name);
  let text = '';
  if (live) {
    let box;
    try { box = entityTextBox(live.e, live.unit); } catch { box = undefined; }
    for (const line of box?.lines ?? []) {
      if (!line.active) continue;                 // switched off (R62) — it makes nothing
      if (line.from && line.from !== name) declared(line.from);
      text += `${line.text}\n`;
    }
  } else {
    try { text = getCard(name).text; } catch { /* unknown card */ }
  }
  for (const t of tokensNamedIn(text)) add(t);
  return out;
}

// ── the face a card TRANSFORMS INTO (playtest ledger #24) ─────────────

/**
 * The back face(s) this card can turn into — [] for the 99% of cards that
 * have none.
 *
 * THE REPORT, verbatim (ZQPC, 2026-08-20): "Scholar of the Void doesn't say
 * what the Beyond card it can transform into does". Note what that is and is
 * not. It is not a complaint that the transform is broken; it is that you
 * cannot see what you would BECOME before committing — and Scholar's cost for
 * finding out is discarding your entire hand, which is the most expensive
 * "try it and see" in the pool. So this is the fix the owner actually asked
 * for, and it has to work while the card is still in hand.
 *
 * DECLARATIVE, from `registry.transformsInto`, exactly like `tokensCreatedBy`
 * leads with `EffectDef.creates` — and for the same reason, spelled out at
 * length in test/65-effect-conformance: the inspector used to scrape printed
 * text for a card NAME and that is wrong three ways. Here it would even
 * appear to work, because Scholar's text does name the card in a scannable
 * sentence; it would break the moment a transform is granted, or is worded
 * "turn me over", or names a card whose name contains another's. There is
 * deliberately NO text-scan fallback: unlike a token name, a transform target
 * is not something a scan can ever confirm.
 *
 * `live` mirrors `tokensCreatedBy`'s parameter and answers two questions the
 * printed lookup gets wrong, both by reading the entity's OWN card name:
 *   · a Scholar that has ALREADY transformed is a Beyond, and Beyond has no
 *     back face — the row disappears once it is spent, instead of offering an
 *     option the unit no longer has;
 *   · a host WEARING a Scholar as an augment mod shows no row, which is not
 *     an omission but the rule: "transform me" rebinds to the host, and the
 *     host has its own reverse side (batch-dark-c.ts refuses exactly this
 *     case). The view and the engine agree because both ask the same question
 *     of the same name.
 *
 * Returns names, so the caller renders them with the very same row builder it
 * uses for tokens (`tokenRowHtml` in ui/main.ts) — which already prints the
 * face's stats, type line and rules text, which is what "say what it does"
 * means.
 */
export function transformFaces(name: CardName, live?: { e: E; unit: Entity }): CardName[] {
  const from = live ? live.unit.card : name;
  const back = transformsInto(from);
  return back ? [back] : [];
}

// ── the erased pile, as it is SHOWN (R69 fallout) ─────────────────────

/**
 * A name that can only ever have been a token — never a real card.
 *
 * The identification is the registry's TYPE LINE ("… Token …"), which is what
 * a token is and the same test DECK_LIST is built from, so a new token needs
 * no bookkeeping here and no list of names is hardcoded.
 *
 * It is deliberately NOT "absent from DECK_LIST", the other tempting question.
 * The two differ in both directions and the type line is right both times:
 *   • Resource FACES are registry cards outside DECK_LIST that are not tokens
 *     (ui/inspect's TOKEN_NAMES has to except them by hand); the type line
 *     never confuses one for a token.
 *   • `Echo of Despair` and `Hooba-God` spawn token COPIES of themselves, so
 *     their names land in the pile for both a token and the real card. Their
 *     printed type line says Unit, not Token — so they are shown, which is
 *     what the viewer wants: the pile records names, not entities, and after
 *     the fact nothing can tell the copy from the card. Hiding a real card
 *     that is genuinely out of the game is a false negative the player cannot
 *     recover from; showing two token copies is noise they can read past.
 * The DECK_LIST check stays as a guard on that promise — a deck card is never
 * hidden — rather than as the identification; today DECK_LIST's own filter
 * already implies it.
 *
 * An unregistered name (never mind how) is not a token: it gets shown.
 */
function tokenOnlyName(name: CardName): boolean {
  let type: string;
  try { type = getCard(name).type; } catch { return false; }
  if (!/Token/.test(type)) return false;
  return !DECK_LIST.includes(name);
}

/** the erased pile as the viewer shows it: real cards, plus an honest count of
 * what was left out */
export interface ErasedPileView {
  /** the entries worth listing, in the order they were erased */
  cards: CardName[];
  /** entries dropped because that name can only be a token */
  tokensOmitted: number;
  /** the trailing line for the omitted entries — '' when nothing was hidden */
  note: string;
  /** compact count for a header or a menu label: '3', or '3 +7 tokens' */
  countLabel: string;
}

/**
 * What the erased-pile viewer lists, out of everything `PlayerState.erased`
 * records.
 *
 * R65 built the viewer to answer one question — "which REAL cards are out of
 * the game?" — and R69 then made every dying token pass through a bin and be
 * erased by the state-based sweep. Correct by the rules, and the engine's
 * record stays complete; but a Dark board buries the handful of real cards
 * under a game's worth of Wisps, Wraiths and Fireballs. So the pile keeps
 * every entry and the VIEW drops the token-only ones. Presentation, not rules.
 *
 * What counts as a token is `tokenOnlyName` above. What is dropped is COUNTED
 * and reported (`note`, `countLabel`): a viewer that silently swallows entries
 * would be a worse bug than the noisy pile it is fixing.
 */
export function erasedPileView(erased: readonly CardName[] | undefined): ErasedPileView {
  const cards: CardName[] = [];
  let tokensOmitted = 0;
  for (const n of erased ?? []) {
    if (tokenOnlyName(n)) tokensOmitted++;
    else cards.push(n);
  }
  const note = tokensOmitted
    ? `+${tokensOmitted} token${tokensOmitted === 1 ? '' : 's'}`
    : '';
  return { cards, tokensOmitted, note, countLabel: note ? `${cards.length} ${note}` : `${cards.length}` };
}

// ── X on the stack (playtest UZRG) ────────────────────────────────────

/** what a cast-time cost payment actually consumed, in words. Public under
 * R65 — erasing a bin happens in the open, and the player who just paid ten
 * cards for a spell is entitled to see the receipt while it is still resolving. */
export function costReceipt(paid: EffectPart['costPaid']): string | undefined {
  if (!paid) return undefined;
  const bits: string[] = [];
  const n = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;
  if (paid.erased?.length) bits.push(`erased ${n(paid.erased.length, 'card')}`);
  if (paid.discarded?.length) bits.push(`discarded ${n(paid.discarded.length, 'card')}`);
  if (paid.sacrificedUnits?.length) bits.push(`sacrificed ${n(paid.sacrificedUnits.length, 'unit')}`);
  if (paid.sacrificed) bits.push(`sacrificed ${paid.sacrificed.card}`);
  if (paid.counters?.length) {
    const total = paid.counters.reduce((t, c) => t + c.n, 0);
    bits.push(`removed ${n(total, 'counter')}`);
  }
  if (paid.life) bits.push(`paid ${n(paid.life, 'life', 'life')}`);
  if (paid.debt) bits.push(`took ${n(paid.debt, 'debt', 'debt')}`);
  return bits.length ? bits.join(', ') : undefined;
}

/**
 * A clause that sizes itself off a stat of the unit its cost sacrificed.
 *
 * Playtest GETD: "there's still no way to see the X value for Volatile
 * Toxicity on the stack. All spells with X should be clear what X is when
 * they're cast." Report UZRG's fix covered the two X's that arrive as a
 * NUMBER — R35's mana X on the item, R64's counted variable cost in
 * `costPaid.x` — and this card has neither. Its cost is ONE sacrifice, a
 * fixed amount, so `finishVariableCost` never runs and `costPaid.x` stays
 * undefined; the X is a stat of the corpse: "X is the defense of the
 * sacrificed unit". The engine snapshots exactly that stat into the receipt
 * at payment (types.ts costPaid.sacrificed) precisely because the unit is
 * gone by resolution — so the number is already fixed, already on the stack
 * item, and was simply never read out.
 *
 * Which stat is a per-card sentence, so this reads the sentence rather than
 * keeping a hand-kept list that would rot: the printed clause names 'defense'
 * or 'power' "of the sacrificed unit", and the receipt carries both. Like
 * VARIABLE_LABEL below this is presentation only — a phrasing it misses costs
 * one badge, never a rule — but it cannot invent a number: no sentence, no
 * row.
 *
 * Two cards in the pool print it. Volatile Toxicity calls the stat X outright;
 * Structural Collapse ("until their total defense is at least equal to the
 * defense of your sacrificed unit") never writes an X but is sized by the same
 * snapshot, and is included deliberately — the bar is the whole question a
 * responder has about that spell, and showing it as "X = 6, sacrificed Good
 * Whale" beside the clause that spells out what the number means is worth more
 * than withholding it over the letter X.
 */
const SACRIFICED_STAT = /\b(defense|power)\s+of\s+(?:the|your|that)\s+sacrificed\s+unit/i;

/**
 * The X of ONE part: what its own cast cost fixed.
 *
 * R64's counted payment is the X when there is one (`costPaid.x`); otherwise
 * the clause may still read its X off the receipt (SACRIFICED_STAT). Both live
 * on the part rather than the item so a grafted rider's X cannot collide with
 * its carrier's (types.ts EffectPart.costPaid.x), and both are settled before
 * the item reaches the stack — this only ever reports a number that is already
 * final.
 */
function partCostX(part: EffectPart): number | undefined {
  const paid = part.costPaid;
  if (!paid) return undefined;
  if (paid.x !== undefined) return paid.x;
  const sac = paid.sacrificed;
  if (!sac) return undefined;
  const stat = SACRIFICED_STAT.exec(partText(part.effectKey)?.text ?? '')?.[1];
  if (!stat) return undefined;
  return stat.toLowerCase() === 'power' ? sac.power : sac.defense;
}

export interface StackXRow {
  /** 'cast'  = the R35 mana X the whole item was cast for;
   *  'cost'  = the cast cost ONE part paid, defining that part's X: R64's
   *            counted variable payment, or the stat its receipt snapshotted
   *            when the clause sizes itself off that (partCostX);
   *  'event' = R80: the amount the EVENT that fired a triggered ability
   *            carried, which is the X of every "that much" / "that many" /
   *            "X is the damage I am dealt" trigger in the pool */
  kind: 'cast' | 'cost' | 'event';
  x: number;
  /** index into item.parts — 'cost' only; a mana X belongs to the item */
  part?: number;
  /** the card the clause came from, when the effect key names one */
  source?: CardName;
  /** what a variable cost consumed ("erased 10 cards") */
  receipt?: string;
  /** 'event' only: the log line of the event that fired the trigger */
  from?: string;
}

/**
 * A triggered ability whose amount comes from its event says so in its label:
 * "create an X/X unit (X = the damage dealt)", "I deal THAT MUCH damage to
 * each opponent", "create THAT MANY 1/1 units". The labels are authored in the
 * card sets, so this reads a written intent rather than guessing — and it is
 * presentation only: a label this misses costs one badge, never a rule. It
 * exists because the alternative is stamping every damage-fired trigger with a
 * number that most of them do not use.
 */
const VARIABLE_LABEL = /\bx\b|that many|that much|equal to|double that/i;

/**
 * Every X on a stack item, per part.
 *
 * Playtest report (UZRG): "it's not possible to see the X value for an effect
 * while it's on the stack". The server is innocent — view.ts never touches
 * v.stack, so both X's arrive intact and stackFlash snapshots carry them too.
 * The client threw them away: the board printed `it.card ?? it.label` and kept
 * `it.label` (the one string apply.ts rewrites to "Card (X=n)") as a tooltip,
 * and the focus viewer replaces the label with ability rows, so for any real
 * spell the string carrying X was exactly the string discarded.
 *
 * There are TWO X's and they cannot be one number: R35's mana X lives on the
 * item, while R64's variable cast cost lives on the part that paid it,
 * precisely so a grafted rider's own X does not collide with its carrier's
 * (types.ts EffectPart.costPaid.x). Spent parts are skipped — they resolve to
 * nothing, so their X is not about to matter.
 *
 * R80 adds a THIRD, and it is the one the report was actually about the second
 * time (VEAV): "Awoken Tomb's trigger, while on the stack, doesn't say what X
 * is equal to." A triggered ability's X is usually neither of the other two —
 * it is a number the triggering EVENT carried ("create an X/X unit, where X is
 * the damage I am dealt"), and that number lives on `item.event`, nowhere
 * else. Every engine event that has an amount calls it `n`, so this needs no
 * per-card declaration and cannot rot the way a hand-kept list would. When the
 * event was part of a damage BATCH whose total differs, the hint says so —
 * Ember of Life reads the total where Awoken Tomb reads its own share.
 *
 * GETD came back a third time — "there's still no way to see the X value for
 * Volatile Toxicity" — because a cast-cost X is not always a COUNT: see
 * partCostX and SACRIFICED_STAT above for the clause that reads its X off the
 * receipt instead. It is still a per-part X, so it lands in the same 'cost'
 * row and needs no fourth kind.
 */
/** One declared MODE riding on a stack item — R57. */
export interface StackModeRow {
  /** index into item.parts */
  part: number;
  /** the ModeSpec key ('stat', 'mode', 'tok', …) — names the choice */
  key: string;
  /** the option's own label if it can still be computed, else the raw value */
  label: string;
  /** which clause declared it, for a composed/grafted item */
  source?: string;
}

/**
 * R57: a modal card declares its half in the CAST window, before anyone may
 * respond — see 97-mode-conformance.test.ts. That was the whole point of the
 * report (EGCW #81): the caster used to pick AFTER seeing the response, with
 * the option labels recomputed off the post-response board.
 *
 * Declaring it early is only half the fix. If the opponent cannot READ the
 * declared half off the stack, they are still responding blind and the
 * response window is still not meaningful — so the mode has to be visible
 * here, next to X and the targets, the same way {Modular} mods are.
 *
 * The stored value is the ModeSpec option's `value`; the LABEL is nicer
 * ("Power (5 → 10)" rather than "power"), so re-run `options()` to recover it.
 * That call reads live state and can legitimately fail on a redacted client
 * view — a missing label must never cost the viewer the fact that a mode was
 * chosen at all, so any throw falls back to the raw value.
 */
export function stackItemModes(item: StackItem, g?: E): StackModeRow[] {
  const out: StackModeRow[] = [];
  item.parts.forEach((p, i) => {
    if (p.spent || p.mode === undefined) return;
    const spec = effectByKey(p.effectKey).modes;
    if (!spec) return;
    let label = typeof p.mode === 'string' ? p.mode : JSON.stringify(p.mode);
    if (g) {
      try {
        const hit = spec.options(g, item, p).find(o => o.value === p.mode);
        if (hit) label = hit.label;
      } catch { /* redacted view or missing target — the raw value still tells the truth */ }
    }
    const src = partText(p.effectKey)?.source;
    out.push({ part: i, key: spec.key, label, ...(src ? { source: src } : {}) });
  });
  return out;
}

export function stackItemX(item: StackItem): StackXRow[] {
  const out: StackXRow[] = [];
  if (item.x !== undefined) {
    out.push({ kind: 'cast', x: item.x, ...(item.card ? { source: item.card } : {}) });
  }
  if (item.kind === 'triggered' && VARIABLE_LABEL.test(item.label)) {
    const d = item.event?.data;
    const n = d?.n;
    if (typeof n === 'number') {
      const total = d?.total;
      const from = [
        item.event?.msg,
        typeof total === 'number' && total !== n ? `${total} in all from that effect` : '',
      ].filter(Boolean).join(' · ');
      out.push({ kind: 'event', x: n, ...(from ? { from } : {}) });
    }
  }
  item.parts.forEach((p, i) => {
    if (p.spent) return;
    const x = partCostX(p);
    if (x === undefined) return;
    const src = partText(p.effectKey)?.source;
    const receipt = costReceipt(p.costPaid);
    out.push({
      kind: 'cost', x, part: i,
      ...(src ? { source: src } : {}), ...(receipt ? { receipt } : {}),
    });
  });
  return out;
}

/** the X's as one short tag for the card on the stack ('' when there is none).
 * Every card wears its own, not just the lead — the caption only ever
 * describes one item, and a stack four deep has four X's to answer for. */
export function stackXMark(item: StackItem): string {
  const xs = stackItemX(item);
  if (!xs.length) return '';
  const uniq = [...new Set(xs.map(r => r.x))];
  return `X=${uniq.join('/')}`;
}

// ── decision-bar options (playtest UZRG) ──────────────────────────────

export interface DecisionOptionLike { label: string; card?: CardName; value: unknown }

/** the value shapes the engine uses for "stop" rather than "do" */
const DECLINE_KEYS = ['doneTargets', 'doneCost', 'doneMods', 'declineCost'];

/** a decision option whose value names something on the board (or in a public
 * zone) — the kind the player is meant to click on the table */
function isTargetRefValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return ['unit', 'player', 'stack', 'cached', 'bin'].some(k => k in (v as object));
}

/** a decision option that ENDS the step instead of answering it */
function isDeclineValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return DECLINE_KEYS.some(k => k in (v as object));
}

/**
 * #3 (and BL-24): the LIVE entity a decision option's button should ping and
 * preview on the board — or null for an option that names none.
 *
 * Two value shapes name an entity: a ref object carrying `unit`, and — for
 * R4's electric path ONLY — a bare number, because that decision's options
 * are raw entity ids by contract. A bare number under any OTHER kind is a
 * payload in its own namespace (an R75 formation-slot index, an X amount, a
 * hand index) that collides with the entity-id namespace by arithmetic
 * accident. BL-24's presentational half: R75's slot question rode kind
 * 'electricPath', so "column 1, behind Hooba-Bot" (value 1) pinged whichever
 * unit happened to own entity id 1. The engine now asks it as
 * 'formationSlot', and this refuses to ping numbers for every kind but R4's.
 */
export function optionPingId(value: unknown, kind: string | undefined): EntityId | null {
  if (value !== null && typeof value === 'object' && 'unit' in (value as object)) {
    const u = (value as { unit: unknown }).unit;
    return typeof u === 'number' ? (u as EntityId) : null;
  }
  if (typeof value === 'number' && kind === 'electricPath') return value as EntityId;
  return null;
}

export interface OptionSplit {
  /** render as a clickable card scan (bin/cache targets, hand looks, deck tops) */
  cards: number[];
  /** names something on the board: a real button, AND still clickable there */
  refs: number[];
  /** ordinary options with no board presence */
  plain: number[];
  /** "No more targets" / "Don't pay" — last, and secondary */
  decline: number[];
}

/**
 * Split a decision's options into the four things the prompt bar draws.
 *
 * Playtest UZRG, and the expensive one: the player paid a 10-card variable
 * cost for Necromantic Rebuke and then declined the target, losing their whole
 * bin for nothing. Part of that is engine ordering, but part is this bar —
 * ref-valued options ({stack:96}) rendered NO button at all, so with min:0 the
 * only button on screen was the decline, sitting in the same spot the player
 * had just clicked ten times to pay the cost.
 *
 * So every option gets a real, labelled button, and the decline is separated
 * out to be drawn last and styled as the secondary thing it is. Order within
 * each bucket is the engine's own.
 */
export function partitionOptions(options: readonly DecisionOptionLike[]): OptionSplit {
  const split: OptionSplit = { cards: [], refs: [], plain: [], decline: [] };
  options.forEach((o, i) => {
    if (isDeclineValue(o.value)) split.decline.push(i);
    else if (o.card) split.cards.push(i);
    else if (isTargetRefValue(o.value)) split.refs.push(i);
    else split.plain.push(i);
  });
  return split;
}

// ── the seen-hand memory aid (playtest round 13) ──────────────────────

/** `GameState.seenHand[viewer]`: the opponent's hand as this seat last saw it */
export interface SeenHandSnapshot { turn: number; cards: CardName[] }

/**
 * The viewer's dismissals, layered OVER engine state.
 *
 * `seenHand` belongs to the engine and is re-sent on every state; the aid is
 * a note-to-self about what is still worth remembering, which is nobody's
 * business but this client's. So dismissals live here, keyed to the exact
 * snapshot they were made against (`key`), and main.ts persists them in
 * localStorage per room like `algoYield:` does.
 */
export interface SeenHandDismissals {
  /** `seenHandKey` of the snapshot these dismissals were made against */
  key: string;
  /** indexes into that snapshot's `cards` that the viewer has forgotten */
  cards: number[];
  /** the viewer dismissed the whole strip */
  all?: boolean;
}

/** one card still worth showing, and the index that dismisses it */
export interface SeenHandCard { name: CardName; index: number }

export interface SeenHandView {
  /** paint the strip at all */
  show: boolean;
  /** the live snapshot's signature — what a dismissal must be stored against */
  key: string;
  /** the turn the look happened on: the one fact that decays */
  turn: number;
  /** what to paint, in the order the cards were seen */
  cards: SeenHandCard[];
  /** how many of the snapshot the viewer has forgotten */
  dismissed: number;
}

const NO_SEEN: SeenHandView = { show: false, key: '', turn: 0, cards: [], dismissed: 0 };

/**
 * The identity of a look: which turn, and exactly which cards.
 *
 * The obvious key is `turn` alone, and it is nearly right — a later reveal
 * must never inherit the dismissals of an earlier one, or the aid would hide
 * cards the viewer has never seen dismissed. But `E.revealHandTo` stamps
 * `state.turn`, so two looks in the SAME turn share a turn number while
 * describing different hands. Folding the card list in costs nothing and
 * makes the key say what it means: same look ⇒ keep my dismissals, any other
 * look ⇒ start clean.
 */
export function seenHandKey(seen: SeenHandSnapshot | null | undefined): string {
  return seen ? `${seen.turn}:${seen.cards.join('|')}` : '';
}

/**
 * What the memory strip should paint, given engine state and this client's
 * dismissals.
 *
 * Dismissals belonging to a different look are ignored rather than applied —
 * that is the whole reason the key exists. `show` is false when there is no
 * look, when the viewer dismissed the aid outright, or when they have
 * dismissed every card in it: an empty strip is just a label taking up room.
 */
export function seenHandView(
  seen: SeenHandSnapshot | null | undefined,
  dismissed: SeenHandDismissals | null | undefined,
): SeenHandView {
  if (!seen) return NO_SEEN;
  const key = seenHandKey(seen);
  const mine = dismissed && dismissed.key === key ? dismissed : null;
  if (mine?.all) return { show: false, key, turn: seen.turn, cards: [], dismissed: seen.cards.length };
  const gone = new Set(mine?.cards ?? []);
  const cards = seen.cards
    .map((name, index) => ({ name, index }))
    .filter(c => !gone.has(c.index));
  return { show: cards.length > 0, key, turn: seen.turn, cards, dismissed: seen.cards.length - cards.length };
}

/** forget one card of the current look (by its index in the snapshot) */
export function dismissSeenCard(
  seen: SeenHandSnapshot | null | undefined,
  dismissed: SeenHandDismissals | null | undefined,
  index: number,
): SeenHandDismissals {
  const key = seenHandKey(seen);
  const mine = dismissed && dismissed.key === key ? dismissed : null;
  const cards = new Set(mine?.cards ?? []);
  cards.add(index);
  return { key, cards: [...cards].sort((a, b) => a - b), ...(mine?.all ? { all: true } : {}) };
}

/** forget the whole aid — until the next look replaces the key */
export function dismissSeenHand(seen: SeenHandSnapshot | null | undefined): SeenHandDismissals {
  return { key: seenHandKey(seen), cards: [], all: true };
}

// ── R78: what the other seat is doing, when the view will not say ──────

/**
 * A public fingerprint of one seat's hand and of everywhere a card leaving it
 * could visibly land.
 *
 * This exists to close the hole R78 left one step EARLIER than itself. A
 * cast-time suspension — R35's X, {Modular} mods, an R49 bracketed cost, R67's
 * targets — happens after the card has left the hand and BEFORE the item
 * reaches `state.stack`, so the item exists nowhere but `state.suspension`,
 * and `server/view.ts` nulls the other seat's suspension along with their
 * decision. The opponent is left looking at a frozen board with no explanation
 * at all: the same complaint as the report, one beat sooner.
 *
 * There is no `state.casting` to read, and inventing one needs `src/` and
 * `server/view.ts`. What the client CAN see is public and exact: the card is
 * out of the hand and has not turned up anywhere. `shown` counts every public
 * place a card that left a hand can be — the stack, the item resolving, play,
 * both bins, both caches, both erased piles. Counting BOTH seats' piles is
 * deliberate over-counting: a card belongs to its owner, so an enemy spell is
 * erased onto the owner's pile, and over-counting can only ever COST us the
 * hint, never fabricate one.
 */
export interface CastProbe {
  /** cards in that seat's hand (a count is all the view gives for an opponent) */
  hand: number;
  /** everywhere public a card out of a hand could have gone */
  shown: number;
}

export function castProbe(s: GameState, seat: Seat): CastProbe {
  let shown = s.stack.length + (s.resolving ? 1 : 0) + Object.keys(s.entities).length;
  for (const p of s.players) {
    shown += p.bin.length + (p.cache?.length ?? 0) + (p.erased?.length ?? 0);
  }
  return { hand: s.players[seat]?.hand.length ?? 0, shown };
}

/**
 * The sticky "a card has left their hand and has not appeared" watch.
 *
 * `base` is the last probe that was fully explained; `casting` is true while
 * the live probe is SHORT of that baseline with nothing new to show for it.
 * Freezing the baseline while the shortfall lasts is what makes the state
 * survive the caster's own answers: paying X changes their resources, not
 * their hand, so a per-update diff would blink the hint out on the first click.
 *
 * `quiet` — this update carried no log line at all — is what keeps the guess
 * honest, and it is a measured property, not a hope. Of the 79 battle-timing
 * cards in the pool that suspend at cast time, 77 do it in complete silence;
 * the two that do not (Discharge, Hyper Beam) announce a bracketed cost, which
 * already tells the opponent something is under way. Every OTHER way a hand
 * shrinks in battle writes a line — a "Discard me" mode, a discard cost, a mod
 * applied from hand — so requiring silence excludes them all, and `shown`
 * excludes them a second time.
 *
 * The consequence of a wrong guess is a wrong message, so the failure mode is
 * chosen: with no `prev` (a fresh join, a resync, an undo's replay) the watch
 * simply re-baselines and says nothing. A missing hint, never a false one.
 */
export interface CastWatch {
  base: CastProbe;
  /** true while `seat` is holding a card the rest of the world cannot see */
  casting: boolean;
}

export function watchCast(
  prev: CastWatch | null, s: GameState, seat: Seat, quiet: boolean,
): CastWatch {
  const now = castProbe(s, seat);
  const short = (base: CastProbe): boolean => now.hand < base.hand && now.shown <= base.shown;
  // already watching: hold the baseline until the shortfall is explained
  if (prev?.casting) return short(prev.base) ? { base: prev.base, casting: true } : { base: now, casting: false };
  if (prev && quiet && short(prev.base)) return { base: prev.base, casting: true };
  return { base: now, casting: false };
}

/**
 * The grey sub-line under "Waiting for <opponent>…".
 *
 * Ordered by how much it explains. R78's `resolving` is a real field and says
 * exactly what is happening, so it wins; the cast watch is an inference and
 * says only what it actually observed ("a card has left their hand"), which is
 * a statement about the board rather than a claim about their intent, and so
 * cannot be wrong even if the card turns out to be a mod rather than a spell.
 */
export function waitingNote(s: GameState, casting = false): string {
  if (s.resolving) {
    return `they are resolving ${s.resolving.label} — it has left the stack and can no longer be answered`;
  }
  if (casting) {
    return 'a card has left their hand — you will see what it is once they have finished choosing';
  }
  if (s.stack.length) return 'they are answering something on the stack — nothing is yours to do yet';
  return 'nothing is yours to do yet';
}

// ── R84 {Alluring}: the block declaration the board is holding ─────────

/**
 * Why the block declaration currently being built would be REFUSED, in the
 * engine's own words — `null` when it would be accepted.
 *
 * Playtest BRDM (2026-08-20) and again, verbatim, UFAB (2026-08-22): Tempest
 * Wrangler's {Alluring} duty. The engine has been right about this for rounds
 * — `allureViolation` names the duty precisely and `legalActions` builds every
 * block option on top of the compulsory core — but the CLIENT had no idea the
 * attribute existed: `grep -rn Alluring ui/` found one glossary entry and
 * nothing else. The block bar promised "assign blockers", Confirm was always
 * live, and the only feedback a lured defender ever got was a red error
 * AFTER committing, phrased as though the click had been a mistake.
 *
 * This is a READ of the engine's own validator, never a second opinion. The
 * duty is conjunctive across columns and turns on {Pure}, {Feeble}, {Flying},
 * {Evasive} and a lone {Sneaky} attacker; restating any of that here is how
 * the client ends up refusing a block the engine would have taken, which is
 * the same bug wearing the other hat.
 *
 * The state is cloned because `E` is a mutator that happens to be queried
 * here — the same reason `legalActions` clones before it reads.
 */
export function blockPlanIssue(
  s: GameState, seat: Seat, blocks: Record<number, EntityId[]>,
): string | null {
  // the cheap early-out: no lure on the board, nothing to check, and no
  // structuredClone of a whole game state on every paint of every battle
  if (!Object.values(s.entities).some(e => e.allured && e.controller === seat)) return null;
  return allureViolation(new E(structuredClone(s)), seat, blocks);
}

// ── which elements a resource menu SHOWS (playtest ledger #63) ─────────

/**
 * The elements a resource menu (recycle, prismite exchange) leads with for one
 * seat, and the ones it keeps behind an expander.
 *
 * THE REPORT, verbatim (GETD, 2026-08-22): "In constructed, the resource
 * options from recycling and prismites should be limited just to the elements
 * that are in your deck. No need to put the whole list for every single game
 * when they're not relevant."
 *
 * ⚠ THIS IS A PRESENTATION DEFAULT, NOT A RULE, and the distinction is
 * load-bearing rather than cautious. Reap the Due is mono-light and scales off
 * DARK affinity, so a mono-light deck running it MUST still be able to take a
 * dark resource or the card is blank. So nothing here removes an option: the
 * engine still offers all seven (`legalActions` was deliberately left alone in
 * R99), and everything this hides is one click away under `hidden`. A caller
 * that renders `show` without also offering `hidden` has broken the card, not
 * tidied the menu.
 *
 * `state.deckElements?.[seat] ?? state.elements` — ALWAYS the asking seat's own
 * entry, never the opponent's, and never the union of both. The fallback covers
 * three real cases at once and all three want the same answer:
 *   · 'shared' and 'draft', where the engine never writes the field (draft has
 *     already narrowed `elements` to its trio, so a second narrowing is noise);
 *   · a game saved before R99, which simply lacks it;
 *   · a seat entry that is missing or empty.
 *
 * And one more guard that is not paranoia: if the deck's elements and what the
 * menu is offering do not intersect at all, we show everything rather than an
 * EMPTY menu. A menu with nothing in it reads as "you may not do this", which
 * is a rules claim, and it would be a false one.
 *
 * `offered` is what the caller can actually put on screen — `s.elements` for
 * recycling, the elements of the legal `exchangePrismite` actions for a
 * prismite — so this never invents an option the engine did not offer.
 *
 * ⚠ CALLERS MUST NOT key an auto-fire off `show.length`. The prismite site
 * auto-acts when there is exactly ONE legal thing to do; counting the FILTERED
 * list there would silently spend a mono-element deck's prismite with no menu
 * at all. Auto-fire is a statement about legality, so it counts legal actions;
 * this function only ever decides what is drawn.
 */
export function resourceMenuElements<T extends string>(
  s: Pick<GameState, 'elements' | 'deckElements'>,
  seat: Seat,
  offered: readonly T[],
  expanded = false,
): { show: T[]; hidden: T[] } {
  const all = [...offered];
  if (expanded) return { show: all, hidden: [] };
  // `element` on an exchangePrismite action is typed ResourceKind, which is
  // Element plus 'prismite' — hence the widened compare rather than a cast that
  // would quietly swallow a real mismatch.
  const deck: readonly string[] | undefined = s.deckElements?.[seat];
  if (!deck || deck.length === 0) return { show: all, hidden: [] };
  const show = all.filter(el => deck.includes(el));
  const hidden = all.filter(el => !deck.includes(el));
  // never an empty menu — that would read as "you may not do this"
  if (show.length === 0) return { show: all, hidden: [] };
  return { show, hidden };
}

/**
 * What clicking one of your resources should DO — the prismite site of #63,
 * with the hazard that site carries built in.
 *
 * `opts` is every legal action on that resource slot (`activateResource` and
 * the seven `exchangePrismite`s), straight from `legalActions`. The click has
 * always auto-fired when there was exactly one legal thing to do, and that
 * shortcut is a statement about LEGALITY.
 *
 * ⚠ THE HAZARD, and the whole reason this is a function and not two lines at
 * the call site: an active prismite offers seven exchanges and NO activate, so
 * for a mono-element constructed deck the display list narrows to exactly one.
 * Filter first and count second and the click stops being a menu — it silently
 * spends the prismite on the deck's own element, with no way to reach the other
 * six and no way back. So the count happens BEFORE the filter, always, and
 * `resourceMenuElements` is only ever asked what to DRAW.
 *
 * `hidden` is how many elements are behind the expander; the caller reopens
 * with `expanded: true` to get all of them. It is never a menu of nothing.
 */
export function prismiteClickPlan(
  s: Pick<GameState, 'elements' | 'deckElements'>,
  seat: Seat,
  opts: readonly Action[],
  expanded = false,
): { kind: 'none' } | { kind: 'auto'; action: Action }
  | { kind: 'menu'; actions: Action[]; hidden: number } {
  if (opts.length === 0) return { kind: 'none' };
  // ⚠ legality, not display — see above
  if (opts.length === 1) return { kind: 'auto', action: opts[0]! };
  const offered = opts.flatMap(a => a.type === 'exchangePrismite' ? [a.element] : []);
  const { show, hidden } = resourceMenuElements(s, seat, offered, expanded);
  const actions = opts.filter(a => a.type !== 'exchangePrismite' || show.includes(a.element));
  return { kind: 'menu', actions, hidden: hidden.length };
}
