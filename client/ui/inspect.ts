/* DOM-free view logic, so it can be unit-tested without a browser.
 *
 * Everything here answers a question the UI asks about game state and card
 * data — "what is this stack item actually going to do?", "will clicking this
 * ability cost me something I can't get back?" — and none of it touches the
 * document. main.ts renders the answers; test/50-ui-inspect.test.ts checks
 * them.
 */
import { allCardNames, effectByKey, getCard } from '../engine/src/cards/dsl.ts';
import { E } from '../engine/src/engine.ts';
import { allureViolation } from '../engine/src/apply.ts';
import { specForSlot } from '../engine/src/cards/dsl.ts';
import type { ActivatedAbility } from '../engine/src/cards/dsl.ts';
import { createsOf, DECK_LIST, transformingCardNames, transformsInto } from '../engine/src/cards/registry.ts';
import { matcherFor } from './glossary.ts';
import { clean, entityTextBox, narrowToMode, switchClause } from './cardtext.ts';
import type {
  Action, CardName, EngineEvent, Entity, EntityId, EffectPart, GameState, Phase, Seat, StackItem,
} from '../engine/src/types.ts';

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

/**
 * R284 — the printed half a part DECLARED, as an index into its bracket.
 *
 * The stored `part.mode` is the ModeSpec option's `value` ('lose', 'wither',
 * 'Crystal'), which says nothing about which printed words it stands for; the
 * option's `half` does, and only re-running `options()` can recover it. That
 * call reads live state and can legitimately fail on a redacted client view —
 * exactly as `stackItemModes` notes — and a failure here must cost the viewer
 * nothing but the narrowing, so it falls back to "no half known" and the text
 * is left reading both.
 */
function declaredHalf(item: StackItem, part: EffectPart, g?: E): 0 | 1 | undefined {
  if (!g || part.mode === undefined || part.mode === null) return undefined;
  const spec = effectByKey(part.effectKey).modes;
  if (!spec) return undefined;
  try {
    return spec.options(g, item, part).find(o => o.value === part.mode)?.half;
  } catch { return undefined; }
}

/** every live part of a stack item, in resolution order, as attributed text.
 * Spent parts (a bounded graft already used this turn, a declined cost) are
 * dropped — they will do nothing, so showing them would mislead.
 *
 * R284: a part that has DECLARED its half reads as that half — the unchosen
 * words are dropped from the printed clause, so a card on the stack says what
 * it is going to do rather than what it could have done. Needs `g` to recover
 * which half (see `declaredHalf`); without it the text is simply not narrowed,
 * which is the same text this returned before the ruling. */
export function stackAbilityRows(item: StackItem, g?: E): StackAbilityRow[] {
  const out: StackAbilityRow[] = [];
  item.parts.forEach((p, i) => {
    if (p.spent) return;
    const t = partText(p.effectKey);
    if (!t) return;
    const half = declaredHalf(item, p, g);
    const text = half === undefined ? t.text : narrowToMode(t.text, half);
    const x = partCostX(p);
    const receipt = costReceipt(p.costPaid);
    out.push({ ...t, text, part: i, ...(x !== undefined ? { x } : {}), ...(receipt ? { receipt } : {}) });
  });
  return out;
}

/* ── R271: THE MODS PEEKING OUT FROM UNDER A CARD ─────────────────────
 *
 * Two owner reports, 2026-08-30, about the same strip.
 *
 *  [#141] "Cards on the stack that are modded should show the little modded
 *         effect under them when hovering, just like a modded unit."
 *  [#146] "In the focus card window, the mods are shown attached to the unit
 *         with a TON of extra space in order to fit the badge. That extra
 *         space/badge isn't needed. Just have the bottom of the card peek
 *         through according to where the augment/graft symbol is."
 *
 * They are one fix because they are one picture. The focus viewer composed a
 * modded UNIT this way and a modded STACK ITEM not at all — `previewEntityHtml`
 * had the strips, `previewStackHtml` had none — and R35 / R105 are explicit
 * that a {Modular} card's mods RIDE ON THE STACK with it, so the two surfaces
 * were describing the same physical object two different ways. One builder,
 * two callers, and the badge #146 objects to is gone from both at once.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO TEMPLATES. It is the only reason the two
 * can be asserted equal: a unit's mods are entity ids carrying `appliedAs`, a
 * stack item's are `{ card, from }` records with no entity behind them
 * (types.ts StackItem.mods), and nothing but a shared shape stops the second
 * picture from drifting away from the first the way it already had.
 */
export interface ModStripSource {
  card: CardName;
  /** a live mod entity knows how it was applied; a stack item's does not */
  appliedAs?: 'augment' | 'graft';
  /** R35: the zone a {Modular} mod was paid out of, when that is known */
  from?: 'hand' | 'bin';
}

export interface ModStrip {
  card: CardName;
  /** what the strip is, in words — the hover title. #146 takes the printed
   * BADGE off the picture; it does not take the fact off the page. */
  title: string;
}

export function modStrips(mods: readonly ModStripSource[]): ModStrip[] {
  return mods.map(m => {
    const how = m.appliedAs === 'graft' ? 'grafted onto'
      : m.appliedAs === 'augment' ? 'augmenting'
        : 'applied to';
    const zone = m.from ? ` — paid out of your ${m.from}` : '';
    return { card: m.card, title: `${m.card} — ${how} this card${zone}` };
  });
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
    // R265: `unit.id` as the SOURCE, matching apply.ts's `abilityUnusable` —
    // the real gate — which passes it. Without it, any restriction that reads
    // `ctx.sourceId` (`notSelf` is one) answers a different question here than
    // it answers there, and this is the surface that decides whether a player
    // is warned before paying an irreversible cost. Nothing in the pool is
    // currently both irreversible-cost and source-sensitive, which is exactly
    // why it could sit wrong indefinitely; 243 §4b is the guard.
    return e.targetCandidates(
      specForSlot(spec, 0), e.actionRegion(unit.controller), undefined, unit.controller, unit.id,
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
  return playableCachedIndexes(legal).map(i => cache[i]?.card).filter((n): n is CardName => !!n);
}

/**
 * The same judgement as `playableCachedNames`, but keeping the HANDLE.
 *
 * CT-50 (#63): a cached card that can be played right now is drawn a second
 * time, at the right-hand end of its owner's hand. A name is enough for a
 * reminder sentence; a card you can CLICK needs the cache index, because that
 * is what `data-act="cache"` carries and what `handleCacheClick` looks up. One
 * implementation, so the hand strip and the reminder can never disagree about
 * which entries are live.
 */
export function playableCachedIndexes(legal: Action[]): number[] {
  const idx = new Set(legal
    .filter((a): a is Extract<Action, { type: 'playCached' }> => a.type === 'playCached')
    .map(a => a.index));
  return [...idx].sort((x, y) => x - y);
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
  if (!allowed || !allowed(e.cachedTiming(seat, i))) return 'timing';
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
export interface AutoPassPlan {
  /** the armed pass chip must come off, whichever promise it was (R251) */
  disarm: boolean;
  /** why a pass is going out for this state — null means the window is mine.
   * 'haste' is R236 and is NOT a priority pass: it is the haste step being
   * readied through, and main.ts sends `doneHaste` for it rather than
   * `passPriority`. It rides in this union because the two answers are one
   * question — "is this window going to be answered without asking?" — and the
   * prompt bar, the latch and the send all key off that one answer. */
  pass: 'passall' | 'pref' | 'yield' | 'haste' | null;
}

/**
 * R236 (owner, 2026-08-28) — WILL THIS CLIENT READY THROUGH THE HASTE STEP BY
 * ITSELF?
 *
 * ── THE INSTRUCTION
 * *"If the player doesn't have a haste card or doesn't have haste bluff
 * enabled, they should auto 'ready and pass' through haste, which will make it
 * happen very very quickly."*
 *
 * ── WHY IT IS A CLIENT ANSWER AND NOT AN ENGINE CONDITION
 * R224/R228 made the step UNCONDITIONAL and deleted `canHaste`, because a step
 * that only opened when you could act published "I am holding something
 * haste-playable" out of a hand the opponent's view redacts. That ruling also
 * recorded the debt this pays: *an always-open window is a tax on every turn
 * unless passing through it is cheap*. So the step still opens for everybody,
 * every turn; this only decides whether the ANSWER needs a human.
 *
 * ⚠ "NOTHING I COULD LEGALLY DO" IS READ, NEVER RE-DERIVED. The predicate is
 * `legal` — the authoritative list `apply.ts::legalHasteActions` built and the
 * server pushed — and the whole question asked of it is "is `doneHaste` the
 * only thing on it?". `legalHasteActions` pushes exactly one `doneHaste` and
 * then every payable printed-{Haste} play, every R97/R123 granted play, every
 * [Haste]-release out of the cache and every R95 haste mod. A new route into
 * the step therefore switches this OFF on the day it is added, with nothing
 * here to update. Re-deriving "do I hold a haste card?" here would rebuild the
 * duplicate R228 deleted, and it would be wrong for four of those five routes.
 *
 * The phase guard is not a second copy of that predicate — `doneHaste` is only
 * ever offered inside the haste step, so it is belt and braces about WHICH
 * step this is, not about what is playable in it.
 *
 * `bluff` is the per-player "Bluff Haste" preference (main.ts, `algoBluffHaste`,
 * default OFF). With it ON this always answers false: the player has said they
 * intend to SIT in the step, which is the point of the feature.
 */
export function autoHasteDone(
  s: GameState, seat: Seat, legal: readonly Action[], bluff: boolean,
): boolean {
  if (bluff) return false;
  if (s.phase !== 'planning' || !s.hasteDone || s.hasteDone[seat]) return false;
  return legal.length > 0 && legal.every(a => a.type === 'doneHaste');
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
 * action on it. `confirm` means the entry only OPENS a question.
 *
 * A union rather than one shape with an optional seat: CT-124's "view game
 * log" is about the TABLE, not about a player, and a `seat` on it would be a
 * field every reader has to decide to ignore. The discriminant carries it. */
export type BoardMenuEntry =
  | { kind: 'erased'; seat: Seat; label: string; confirm: boolean }
  | { kind: 'concede'; seat: Seat; label: string; confirm: boolean }
  | { kind: 'log'; label: string; confirm: boolean };

/**
 * R65, narrowed by R241 (BL-20): the two things THE BOARD offers on a
 * right-click — both were playtest asks ("We need a way to right click ->
 * concede match :(", "I dont think there's currently a way to view erased
 * cards").
 *
 * ⚠ WHERE THEY APPEAR IS NOT DECIDED HERE and it CHANGED. R65 rode them on
 * every card menu as well; the owner has since ruled that a card menu carries
 * card things only and these belong to a right-click of bare table. The
 * composition is `ui/main.ts`'s contextmenu handler and the claim is
 * `216-menu-scoping.test.ts`. This function still answers only WHICH entries
 * exist and what they are called.
 *
 * `mySeat` is the seat this client drives, or null in hotseat (where one
 * person drives both, so both are offered).
 */
export function boardMenuEntries(s: GameState, mySeat: Seat | null): BoardMenuEntry[] {
  const items: BoardMenuEntry[] = [];
  // CT-124 / report #131: *"the game log would be better to hide by default.
  // Instead of always being on screen, it should be accessible by the
  // 'generic' right click menu."* It is FIRST because it is now the only way
  // in — an erased pile and a concede are both rarer than reading the log.
  //
  // Declared HERE rather than in main.ts's contextmenu handler on purpose:
  // `216-menu-scoping.test.ts` asserts the card-back menu is exactly this
  // list, so an entry that existed only in main.ts would be a silent
  // divergence between the two ways into the same menu (R241).
  items.push({ kind: 'log', confirm: false, label: '📜 View game log' });
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
  /** CT-49 (#54): `.playable` is on, but CASTING is not one of the things on
   * offer — the whole glow is augment/graft/prophesy/recycle. */
  nocast?: boolean;
  /** CT-49 (#54): more than one KIND of thing is on offer, so the click will
   * open a menu rather than do the obvious thing. */
  multi?: boolean;
  /** CT-50 (#63): this scan is a card in the CACHE, drawn a second time next
   * to the hand. The original is still in the cache row. */
  cached?: boolean;
}
/**
 * The class list for a card scan. `.activatable` is the one that has to be
 * spelled out here rather than inlined: it is the only class with no click
 * behaviour of its own — deleting it breaks nothing but the green halo
 * (style.css `.card.activatable`), which is exactly the ask it answers.
 *
 * CT-49/CT-50 append `.nocast`, `.multi` and `.cached` AFTER `.activatable`,
 * on purpose: the plain castable card in hand — far and away the common case —
 * keeps the exact class string `card playable` it has always had, so the fix
 * for the ambiguous ones cannot move the unambiguous one.
 */
export function cardClasses(f: CardFlags): string[] {
  const cls = ['card'];
  if (f.playable) cls.push('playable');
  if (f.candidate) cls.push('candidate');
  if (f.selected) cls.push('selected');
  if (f.carrying) cls.push('carrying');
  if (f.modhost) cls.push('modhost');
  if (f.activatable) cls.push('activatable');
  if (f.nocast) cls.push('nocast');
  if (f.multi) cls.push('multi');
  if (f.cached) cls.push('cached');
  return cls;
}

// ── CT-49 (#54): WHAT a card in hand is offering, not just THAT it is ─
//
// The hand's green ring used to be the OR of five different actions — play,
// augment, graft, prophesy, recycle-for-resource — and said which only after
// you had clicked it. Playtest report #80 is the receipt: the owner read a
// glowing {Battle} spell during deployment as castable, went to cast it, and
// found the client offering a GRAFT. Nothing was wrong with the rules; the ring
// had folded "you can graft this" and "you can cast this" into one shape.
//
// THE VOCABULARY. Three channels, each answering exactly one question, so
// adding CT-50's cached cards to the same strip does not make it ambiguous
// again:
//
//   the ring EXISTS        → "something is on offer here"  (unchanged)
//   the ring's LOOK        → "…can I cast it?"   green solid = yes (the
//                            unmarked, default meaning of a card in hand);
//                            `.nocast` amber dashed = no, only the named
//                            verbs; `.multi` = more than one, the click asks
//   an `offer` CHIP        → the verbs, by name
//   `.cached` + its group  → "…and this one is not in your hand at all"
//
// The chip is SUPPRESSED in the two cases where another channel already says
// the same thing better: a bare `cast` (the unmarked default — a chip there
// would be noise on every card in every hand), and a bare `prophesy` (the hand
// already pushes a richer `📜 prophesy [n]` chip carrying the banner cost).

/** one of the five things a card in hand can be offering */
export type OfferKind = 'cast' | 'augment' | 'graft' | 'prophesy' | 'recycle';

/** drawn in this order wherever they are listed, so two cards offering the
 * same pair never read differently */
const OFFER_ORDER: OfferKind[] = ['cast', 'augment', 'graft', 'prophesy', 'recycle'];
const OFFER_ICON: Record<OfferKind, string> = {
  cast: '▶', augment: '⊕', graft: '⇄', prophesy: '📜', recycle: '♻',
};

/**
 * Which of the five kinds `legal` is offering for hand card `index`.
 *
 * This is the same OR the ring was built from, taken apart again — the
 * information was always computed, it was only ever thrown away at render
 * time. `recycleForResource` is emitted by `legalPlanningActions` and nowhere
 * else in apply.ts, so it needs no phase guard of its own here.
 */
export function handOffers(legal: Action[], index: number): OfferKind[] {
  const seen = new Set<OfferKind>();
  for (const a of legal) {
    if (a.type === 'playCard' && a.handIndex === index) seen.add('cast');
    else if (a.type === 'augment' && a.from === 'hand' && a.index === index) seen.add('augment');
    else if (a.type === 'graft' && a.from === 'hand' && a.index === index) seen.add('graft');
    else if (a.type === 'prophesy' && a.from === 'hand' && a.index === index) seen.add('prophesy');
    else if (a.type === 'recycleForResource' && a.handIndex === index) seen.add('recycle');
  }
  return OFFER_ORDER.filter(k => seen.has(k));
}

/**
 * The chip that names those kinds, or null when another channel already does.
 *
 * `cls` carries `offer` plus the same `nocast`/`multi` word the card wears, so
 * the chip and the ring cannot drift apart in the stylesheet. The full list is
 * always on the chip's own tooltip even when `packBadgeLine` has to squeeze the
 * label — the strip is 74px and "cast/augment/graft" does not fit in it.
 */
export function handOfferBadge(kinds: OfferKind[]): Badge | null {
  if (kinds.length === 0) return null;
  if (kinds.length === 1 && (kinds[0] === 'cast' || kinds[0] === 'prophesy')) return null;
  const words = kinds.join('/');
  if (kinds.length === 1) {
    const k = kinds[0]!;
    return {
      t: `${OFFER_ICON[k]} ${k}`,
      cls: 'offer nocast',
      title: `you cannot cast this right now — the only thing on offer from your hand is: ${k}`,
    };
  }
  return {
    t: `⑂ ${words}`,
    cls: `offer multi${kinds.includes('cast') ? '' : ' nocast'}`,
    title: `${kinds.length} different things on offer — clicking will ask which: ${kinds.join(' · ')}`,
  };
}

// ── R136: the badge strip is ONE line ─────────────────────────────────

/** one corner chip on a card scan (cardHtml `badges`) */
export interface Badge {
  t: string;
  mod?: boolean;
  ctr?: boolean;
  /** `t` is markup, not text — a mod chip carries an icon and a motion key */
  html?: boolean;
  cls?: string;
  title?: string;
}

/** what cardHtml actually draws: the chips that fit, the ones folded away,
 * and the "+N" chip that keeps the folded ones reachable on hover */
export interface BadgeLine {
  /** the chips to draw, in the order the call sites pushed them */
  shown: Badge[];
  /** the chips that did not fit — never dropped, only folded into `more` */
  hidden: Badge[];
  /** the "+N" chip to draw last, or null when everything fit */
  more: Badge | null;
  /** every chip's label, for the strip's own tooltip */
  title: string;
}

/**
 * The badge strip used to be `flex-wrap: wrap`, so a unit wearing counters, an
 * activated ability, three attributes and two mods spilled down over its art
 * until the scan was unreadable (BL-23). The owner's complaint is the WRAPPING,
 * not the badge count — so nothing may be dropped, only folded.
 *
 * Widths are in CSS pixels, modelled rather than measured — this runs while the
 * HTML is being built, long before anything has a box. GLYPH/CHIP/MORE were
 * calibrated against Chrome's real chip boxes at the strip's 9px font
 * (`+2/+2` 32px, `sent` 26px, `+Ironhide` 49px, `+2` 18px), and land within
 * about 15% either way. `.length` (not code points) is deliberate: an astral
 * emoji counts 2, which is roughly what it renders as. The model decides what
 * is WORTH putting on the line; style.css's `nowrap` is what guarantees there
 * is only ever one of them.
 */
const GLYPH = 4.4;
const CHIP = 10;
/** the "+N" chip's own width — reserved before anything else is fitted, so the
 * affordance that reaches the folded chips can never be squeezed out */
const MORE = 20;
/** the strip on the default 78px board scan (style.css `--cw`), less its insets */
export const BADGE_LINE_PX = 74;

/** a badge's plain text: the chip's own label with the icon markup read out of
 * it, so a mod chip measures (and lists) as the words a player would read */
export function badgeLabel(b: Badge): string {
  if (!b.html) return b.t;
  return b.t
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .trim();
}

/** how many pixels of the strip one chip eats, its gap included */
export function badgeWidth(b: Badge): number {
  return badgeLabel(b).length * GLYPH + CHIP;
}

/** A printed attribute is the only chip that repeats something the card itself
 * already says — the inspector's text box has it either way. Live state (a
 * counter, an activated ability, a mod, "sent", a prophecy window) is the chip
 * that has nowhere else to be, so it is the last to fold.
 *
 * A mod chip also carries the mod's motion key (ui/main.ts unitHtml), so
 * folding one costs its flight a landing spot — ui/anim.ts elFor is null-safe
 * and pulses fall back to the host unit, so it degrades to no flourish rather
 * than to a crash. Ranking mods above attributes keeps that rare. */
const badgeRank = (b: Badge): number => (b.mod || b.ctr || b.cls ? 0 : 1);

/** one over-long label, cut to the strip's width, keeping its full text on the
 * chip's own tooltip. A single long chip never overflows, so it would never
 * reach the "+N" — without this it would just be clipped silently by CSS. */
function squeeze(b: Badge, px: number): Badge {
  // markup is not safe to cut mid-tag; CSS ellipsis and the strip tooltip cover it
  if (b.html) return b;
  const max = Math.max(1, Math.floor((px - CHIP) / GLYPH));
  if (b.t.length <= max) return b;
  return { ...b, t: `${b.t.slice(0, max - 1)}…`, title: b.title ?? b.t };
}

/**
 * Hold a badge list to one line `px` wide.
 *
 * Everything that fits is shown in the order it was pushed; the rest folds into
 * a "+N" chip whose tooltip names them. At least one chip is always shown, even
 * when it alone is wider than the strip — an empty strip on a badged card would
 * be a worse lie than a clipped one.
 */
export function packBadgeLine(badges: Badge[], px = BADGE_LINE_PX): BadgeLine {
  const fitted = badges.map(b => squeeze(b, px));
  const title = fitted.map(badgeLabel).join(' · ');
  const total = fitted.reduce((n, b) => n + badgeWidth(b), 0);
  if (total <= px) return { shown: fitted, hidden: [], more: null, title };

  // pick by rank, break ties by push order — but DRAW in push order, so folding
  // an attribute away never shuffles the chips that stayed
  const byRank = fitted.map((_, i) => i)
    .sort((a, b) => (badgeRank(fitted[a]!) - badgeRank(fitted[b]!)) || a - b);
  const keep = new Set<number>();
  let used = MORE;
  for (const i of byRank) {
    const w = badgeWidth(fitted[i]!);
    // a wide chip being rejected must not block a narrow one behind it
    if (keep.size && used + w > px) continue;
    keep.add(i);
    used += w;
  }
  const shown = fitted.filter((_, i) => keep.has(i));
  const hidden = fitted.filter((_, i) => !keep.has(i));
  return {
    shown,
    hidden,
    more: { t: `+${hidden.length}`, cls: 'more', title: hidden.map(badgeLabel).join('\n') },
    title,
  };
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
  // R184: 'formation' is a TargetRef arm too — a player's whole side of the
  // battle grid, which is very much something on the board.
  return ['unit', 'player', 'stack', 'cached', 'bin', 'formation'].some(k => k in (v as object));
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
  /** CT-174: every card is crossed off. The aid is STILL SHOWN — collapsed to
   * its head and a way back — because vanishing here is indistinguishable
   * from the player having dismissed it, and one ✕ too many is how that
   * happens. See `seenHandView`. */
  emptied: boolean;
}

const NO_SEEN: SeenHandView = { show: false, key: '', turn: 0, cards: [], dismissed: 0, emptied: false };

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
 * that is the whole reason the key exists.
 *
 * ── CT-174 (#156): THE AID HIDES ON ONE THING ONLY, AND IT IS A DECISION
 *
 * Report, verbatim: *"It'd be better to NOT automatically dismiss the 'hand
 * revealed' helper box for the player. Just leave it there till they dismiss
 * it themselves."*
 *
 * This used to read `show: cards.length > 0`, with the reasoning "an empty
 * strip is just a label taking up room". The reasoning is fine and the
 * CONSEQUENCE was the report: the strip's own hint tells you to ✕ cards as
 * they are played, so crossing off the last one is the NORMAL end of using
 * the aid — and it made the whole thing disappear, persistently
 * (`algoSeen:<room>` in localStorage) and with no way back. From the player's
 * side that is indistinguishable from the box dismissing itself, and one ✕
 * hit by accident does the same thing.
 *
 * MEASURED, not assumed. Nothing else can hide it: `seenHand` is written once
 * by `E.revealHandTo`, cleared only by a draft pack merge (apply.ts) — which
 * a constructed game never reaches — and `server/view.ts` never touches it, so
 * it survives every push. Replaying DQVZ's own 197 actions, the look lands at
 * [97] and `show` is true at every action after it, the report's [119]
 * included. `seenDrop` has exactly one writer, `forgetSeen`, and exactly two
 * callers, both click handlers. So the ONLY path from shown to hidden was a
 * click — and the last-card path made an ordinary click do the drastic thing.
 *
 * So: `all` — the explicit "✕ dismiss" — is now the only way to false, and
 * `emptied` tells the renderer to collapse to a head with a way back instead.
 */
export function seenHandView(
  seen: SeenHandSnapshot | null | undefined,
  dismissed: SeenHandDismissals | null | undefined,
): SeenHandView {
  if (!seen) return NO_SEEN;
  const key = seenHandKey(seen);
  const mine = dismissed && dismissed.key === key ? dismissed : null;
  if (mine?.all) {
    return { show: false, key, turn: seen.turn, cards: [], dismissed: seen.cards.length, emptied: true };
  }
  const gone = new Set(mine?.cards ?? []);
  const cards = seen.cards
    .map((name, index) => ({ name, index }))
    .filter(c => !gone.has(c.index));
  return {
    show: true, key, turn: seen.turn, cards,
    dismissed: seen.cards.length - cards.length,
    emptied: cards.length === 0,
  };
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

/** CT-174: put the whole look back — the undo for a ✕ that was not meant.
 * Every dismissal of THIS look is dropped; a record for any other look is left
 * alone, because it is not this look's to discard. */
export function restoreSeenHand(
  seen: SeenHandSnapshot | null | undefined,
  dismissed: SeenHandDismissals | null | undefined,
): SeenHandDismissals | null {
  const key = seenHandKey(seen);
  if (!key) return dismissed ?? null;
  if (dismissed && dismissed.key !== key) return dismissed;
  return { key, cards: [] };
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
 * R247 — the server's redacted stub for "somebody else owes an answer".
 *
 * Declared structurally rather than imported: `server/view.ts` is not on the
 * client's import path (same reason `PackInfo` is redeclared in ui/main.ts).
 * `server/test-pending-ask.ts` closes that seam by driving a REAL redacted
 * view straight into `waitingNote` below, so the two spellings cannot drift
 * without a test going red.
 *
 * ⚠ IT CARRIES NO CONTENT AND MUST NEVER BE MADE TO. `source` is an entity id
 * this client already holds; everything the line below says about the effect it
 * reads off its own board. See `server/view.ts PendingAsk`.
 */
export interface PendingAsk { seat: Seat; source?: EntityId }

/**
 * The grey sub-line under "Waiting for <opponent>…".
 *
 * Ordered by how much it explains. R78's `resolving` is a real field and says
 * exactly what is happening, so it wins; R247's `pendingAsk` is the next most
 * definite — the SERVER saying a seat owes an answer, and which of their
 * permanents raised it; the cast watch is last because it is an inference and
 * says only what it actually observed ("a card has left their hand"), which is
 * a statement about the board rather than a claim about their intent, and so
 * cannot be wrong even if the card turns out to be a mod rather than a spell.
 *
 * ⚠ NOTHING HERE MAY DESCRIBE THE QUESTION. Report #117 asked to see *"that
 * Rashi is choosing that"*, and that is the whole of what this says: who, and
 * off which card. The kind of choice, the options and the candidates are not on
 * the wire, deliberately (R247), and inventing a likely-looking phrase for them
 * from the card text would be the client holding an opinion about a state it
 * cannot see — R245, in the one place the temptation is strongest.
 */
export function waitingNote(s: GameState, casting = false): string {
  if (s.resolving) {
    return `they are resolving ${s.resolving.label} — it has left the stack and can no longer be answered`;
  }
  // R247: the effect NAMED, which is the half of #117 the client could not do
  // on its own. The name is read off this seat's own entity map — the stub
  // carries an id and nothing else — so a source that is not on this board
  // simply does not get named.
  const ask = (s as GameState & { pendingAsk?: PendingAsk }).pendingAsk;
  const src = ask?.source !== undefined ? s.entities[ask.source] : undefined;
  if (src) return `they are answering something from ${src.card} — you will see what once they are done`;
  if (casting) {
    return 'a card has left their hand — you will see what it is once they have finished choosing';
  }
  if (s.stack.length) return 'they are answering something on the stack — nothing is yours to do yet';
  // ⚠ A SOURCELESS STUB ADDS NOTHING TO SAY. `pendingAsk` without a source is
  // "somebody owes an answer" and no more — which the bar's own headline
  // ("Waiting for Rashi…") already says, and which R247 notes this client could
  // derive unaided anyway. The field still rides for the seat it names; there
  // is simply no extra sentence in it.
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

// ═══ R149 — the SHARED quantity stepper ═══════════════════════════════════

/**
 * The dial itself: an integer held inside [min, max], and what −, + and "All"
 * may do to it. Nothing about counters, nothing about damage — factored out
 * of BL-25/R139's `counterStepper` (below) when CT-34 needed the same control
 * for the R120 elective damage split.
 *
 * ⚠ WHY THIS IS ONE FUNCTION AND NOT TWO. BL-19 is the cautionary tale: three
 * "clear" buttons each rolled its own "is anything built" gate and one board
 * showed the player no button at all. A second hand-written stepper would
 * drift the same way — one of them would learn that a non-number falls to the
 * floor and the other would not. So the clamp, the arrow gates and the "All"
 * gate live here once, and the two decision shapes above them differ only in
 * where their min and max come from.
 *
 * What they do NOT share, and must not: the RANGE. Counter removal is one
 * unit choosing k off itself; a damage split is one victim in a queue of
 * victims whose floor is "lethal to the unit in front" and whose ceiling is
 * "everything left". Those are different questions and they compute min/max
 * differently — but they dial identically, and that is the part that drifts.
 */
export interface QuantityStepperView {
  /** the dialled-in value, ALREADY clamped into [min, max] */
  count: number;
  min: number;
  max: number;
  canDown: boolean;
  canUp: boolean;
  /** "All" would move the count somewhere it is not already */
  canAll: boolean;
}

/** a count, forced into the range the decision will actually accept. A
 * non-number falls to the FLOOR, never to zero and never to NaN — a NaN in
 * the dial renders as an empty button that answers nothing. */
export function clampQuantity(want: number, min: number, max: number): number {
  if (!Number.isFinite(want)) return min;
  if (max < min) return min;
  return Math.min(Math.max(Math.floor(want), min), max);
}

export function quantityStepper(want: number, min: number, max: number): QuantityStepperView {
  const hi = Math.max(min, max);
  const count = clampQuantity(want, min, hi);
  return {
    count, min, max: hi,
    canDown: count > min, canUp: count < hi, canAll: count !== hi,
  };
}

/**
 * What −, + and All do to the count.
 *
 * `submit: false` is not decoration — it is the ruling, in the type. The owner
 * said "All … jumps the count to the max (WITHOUT auto submitting)", and the
 * point of that is a unit carrying a lot of counters (or a strike carrying a
 * lot of damage): you want to SEE the number before you spend it. No path
 * through this function produces a decision index, so no path through it can
 * pay a cost or assign a point of damage.
 */
export interface StepperAction { count: number; submit: false }

export function stepQuantity(v: QuantityStepperView, act: 'up' | 'down' | 'all'): StepperAction {
  if (act === 'all') return { count: v.max, submit: false };
  return { count: clampQuantity(v.count + (act === 'up' ? 1 : -1), v.min, v.max), submit: false };
}

// ═══ BL-25 / R139 — the counter-removal quantity stepper ══════════════════

/**
 * The owner, on the counter-removal prompt: *"It's actually okay, it's just
 * not clear that it wants you to click the unit. It needs to say that. Plus
 * maybe a counter with up/down arrows would be nice too or an 'All' button
 * which jumps the count to the max (without auto submitting) for cases where
 * there are a ton of counters."*
 *
 * So the mechanism is not redesigned. What is added is a QUANTITY: how many
 * counters this one pick takes. The judgement lives here rather than in
 * main.ts for the reason R134 and R136 both landed on — main.ts runs DOM code
 * on import and no test can reach it.
 *
 * Two decision shapes ask about a quantity of counters, and they are genuinely
 * separate engine paths:
 *
 *   'pick'   the `removeCounters` CAST COST (Discharge's "[Remove X +1/+1
 *            counters from allies]", Soul Reaver's "from me"). Options name a
 *            unit — `{counterFrom: id}` for one counter, `{counterFrom: id,
 *            n: k}` for k. You choose the unit, the stepper chooses k.
 *   'amount' an EFFECT that removes counters and asks how many (Chombot's
 *            "move up to two counters"). The unit is already fixed by the
 *            effect's targets, so the options are bare amounts and the whole
 *            question is the number.
 *
 * ⚠ THE MAX IS THE ENGINE'S, NEVER THIS FILE'S. `Decision.counterMax` comes
 * from `E.counterPickMax`, which reads the same `counterPool` the payability
 * check reads. Recomputing it here from board state was the obvious thing and
 * it is wrong: `counterPool` counts the whole ALLY pool while a pick names ONE
 * unit, so a client tallying "counters I can see" would offer to take four off
 * a unit that has two — and R130's "all counters count as counters" would have
 * had to be re-decided in the UI to do even that. The option list is used only
 * as the fallback for a decision that carries no ceiling; the two agree by
 * construction, because the engine builds both from the same pool.
 */
export type CounterMode = 'none' | 'pick' | 'amount';

/** the shape of `GameState.decision` this module needs — kept structural so a
 * test can hand-build one without a whole engine */
export interface CounterDecisionLike {
  prompt: string;
  options: readonly { label: string; value: unknown; card?: CardName }[];
  counterMax?: number;
}

export interface CounterStepperView extends QuantityStepperView {
  mode: CounterMode;
  /** what the bar must say, or '' when the engine's prompt already said it */
  hint: string;
}

/**
 * The instruction the owner asked for: the prompt has to SAY that a unit is
 * the thing to click. The engine's own cost prompt carries it (see
 * `collectCastCosts`), so this string is what a decision that does NOT carry
 * it — a card effect writing its own prompt — gets appended.
 */
export const COUNTER_CLICK_HINT = 'click a unit to take counters off it';
export const COUNTER_AMOUNT_HINT = 'set how many counters, then confirm';

const NO_STEPPER: CounterStepperView = {
  mode: 'none', count: 0, min: 0, max: 0, hint: '', canDown: false, canUp: false, canAll: false,
};

/** the unit and amount a `removeCounters` cost option names, or null. A
 * missing `n` is one counter — the exact value shape saved games and the four
 * pre-R139 tests send. */
export function counterPickValue(v: unknown): { unit: EntityId; n: number } | null {
  if (!v || typeof v !== 'object' || !('counterFrom' in (v as object))) return null;
  const id = (v as { counterFrom: unknown }).counterFrom;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  const raw = (v as { n?: unknown }).n;
  const n = typeof raw === 'number' ? Math.floor(raw) : 1;
  return Number.isFinite(n) && n >= 1 ? { unit: id as EntityId, n } : null;
}

/** the amount a bare-number option names (the 'amount' shape), or null */
export function counterAmountValue(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** a count, forced into the range the decision will actually accept.
 * R149: the body moved to `clampQuantity` when the damage split needed the
 * same clamp; this name stays because four tests and main.ts call it. */
export function clampCounterCount(want: number, min: number, max: number): number {
  return clampQuantity(want, min, max);
}

/** say the instruction ONCE: '' when the engine's prompt already carries it.
 * R149: shared with the damage-split stepper below. */
function hintOnce(prompt: string, hint: string): string {
  return prompt.toLowerCase().includes(hint.toLowerCase()) ? '' : hint;
}

/** What the prompt bar draws over a counter-removal decision — 'none' for
 * every decision that is not one, which is almost all of them. */
export function counterStepper(dec: CounterDecisionLike | null | undefined, want: number): CounterStepperView {
  if (!dec) return NO_STEPPER;
  const picks = dec.options.flatMap(o => { const p = counterPickValue(o.value); return p ? [p] : []; });
  if (picks.length) {
    const offered = picks.reduce((m, p) => Math.max(m, p.n), 0);
    const max = dec.counterMax ?? offered;
    return {
      ...quantityStepper(want, 1, max),
      mode: 'pick', hint: hintOnce(dec.prompt, COUNTER_CLICK_HINT),
    };
  }
  // an effect's own "how many?" menu — only ever a stepper when the ENGINE
  // said so, because a bare number is otherwise just a payload (an X amount,
  // a hand index, R75's formation slot — the same namespace collision
  // `optionPingId` above refuses to guess at)
  if (dec.counterMax === undefined) return NO_STEPPER;
  const amounts = dec.options.flatMap(o => { const n = counterAmountValue(o.value); return n === null ? [] : [n]; });
  if (!amounts.length) return NO_STEPPER;
  const min = Math.min(...amounts);
  return {
    ...quantityStepper(want, min, Math.max(min, dec.counterMax)),
    mode: 'amount', hint: hintOnce(dec.prompt, COUNTER_AMOUNT_HINT),
  };
}

/** R149: the shared `StepperAction` — kept under the old name for main.ts and
 * the BL-25 tests. `submit: false` is the ruling, in the type; see
 * `stepQuantity`. */
export type CounterStepperAction = StepperAction;

export function counterStepperCount(
  dec: CounterDecisionLike | null | undefined, want: number, act: 'up' | 'down' | 'all',
): CounterStepperAction {
  const v = counterStepper(dec, want);
  if (v.mode === 'none') return { count: want, submit: false };
  return stepQuantity(v, act);
}

/**
 * The option index for "take `want` counters off `unit`" — the click the
 * stepper is FOR.
 *
 * Clamped DOWNWARDS to what the unit can give: a stepper set to 5 that lands
 * on a unit holding 2 takes 2. Refusing the click instead would make the
 * stepper a trap on exactly the board the owner was complaining about (several
 * allies, uneven counters), where the count dialled in for one unit is wrong
 * for the next. -1 when this unit is not on the menu at all.
 */
export function counterPickIndex(
  dec: CounterDecisionLike | null | undefined, unit: EntityId, want: number,
): number {
  let best = -1, bestN = 0;
  if (!dec) return best;
  const cap = Math.max(1, Math.floor(Number.isFinite(want) ? want : 1));
  dec.options.forEach((o, i) => {
    const p = counterPickValue(o.value);
    if (!p || p.unit !== unit) return;
    if (p.n <= cap && p.n > bestN) { best = i; bestN = p.n; }
  });
  return best;
}

/** the 'amount' shape's confirm: the option whose value IS the count, or -1 */
export function counterAmountIndex(dec: CounterDecisionLike | null | undefined, want: number): number {
  if (!dec) return -1;
  return dec.options.findIndex(o => counterAmountValue(o.value) === Math.floor(want));
}

/** the units a 'pick' decision names, in menu order — ONE entry per unit, even
 * though the menu carries one option per (unit, amount) pair. This is what
 * keeps the prompt bar's card row one scan per ally, as it was before the
 * amounts were added to the menu. */
export function counterPickUnits(dec: CounterDecisionLike | null | undefined): EntityId[] {
  const seen = new Set<EntityId>();
  for (const o of dec?.options ?? []) {
    const p = counterPickValue(o.value);
    if (p) seen.add(p.unit);
  }
  return [...seen];
}

// ═══ CT-34 / R149 — the R120 elective damage-split ticker ═════════════════

/**
 * Owner report #100, room SMVJ: *"The damage distribution UI is terrible and
 * confusing. Better would to have a ticker counter thing on each unit that you
 * click up/down and they always are forced to sum to the amount of damage you
 * have."*
 *
 * The MECHANIC is not touched. R120 made the combat split elective on "never
 * decide for the player" and it stays elective; this is the affordance.
 *
 * ⚠ WHAT THE ENGINE ACTUALLY ASKS — and it is NOT what the report assumes.
 * `E.electionWalk` raises ONE decision per victim, front-to-back, and each one
 * is a single scalar question: "how much of `remaining` to <this unit>?" There
 * is no decision anywhere that carries all N victims at once, so there is no
 * option payload a simultaneous N-ticker widget could answer. Two consequences,
 * both load-bearing:
 *
 *  1. The sum is already forced BY CONSTRUCTION, not by this file. Each
 *     question's menu is exactly [share .. remaining] — the floor is "lethal to
 *     this unit, because units in front must die before damage walks past them"
 *     and the ceiling is "everything you have left" — and the last living
 *     victim is auto-filled with whatever is left. An under- or
 *     over-allocation is not refused by the client; it is never representable.
 *  2. What the player was missing is therefore not a constraint, it is the
 *     ARITHMETIC. The old bar drew a flat wall of "1 to X / 2 to X / 3 to X /
 *     4 to X (everything)" buttons with no running total, no sight of the units
 *     behind, and no sense that answering this question schedules another. That
 *     is the "terrible and confusing".
 *
 * So the ticker is per-victim, and around it goes the whole column: the
 * victims already answered with their locked amounts, the one being asked with
 * the live dial, the ones behind still waiting, and the remainder between them.
 * The player sees the sum being forced instead of being told about it.
 *
 * ⚠ THE RANGE IS THE ENGINE'S, NEVER THIS FILE'S — the same doctrine as
 * `counterStepper`'s counterMax, and here it matters more, because the floor is
 * `victimShare`: printed-vs-effective defense under {Unaware} (R106), doubled
 * receipt under {Vulnerable} (R23), the {Deadly} floor of 1 (R114), damage
 * already marked. A client recomputing that from board state would be
 * re-deciding four rulings to draw a number. `min`/`max` are read off the
 * option VALUES the engine emitted and nothing else.
 */
export const ASSIGN_SPLIT_HINT =
  'set how much this unit takes; the rest goes to the units behind it';

/** the numeric amount an `assignDamage` option names, or null. The one-click
 * default rides the same menu as the string 'default', so a plain number is
 * how an amount is told apart from it. */
export function assignSplitValue(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** the shape of `GameState.decision` this module needs — structural, so a test
 * can hand-build one without a whole engine. `kind` is REQUIRED: a bare number
 * option is otherwise just a payload (an X amount, a hand index, R75's
 * formation slot), and guessing at it is exactly the namespace collision that
 * made BL-25 unreachable. */
export interface AssignDecisionLike {
  kind: string;
  prompt: string;
  options: readonly { label: string; value: unknown }[];
}

/** the slice of `GameState` the victim rows are derived from. Every field is
 * one a client really has: `viewFor` nulls the suspension only for the seat it
 * does NOT belong to, and this decision belongs to the seat reading it. */
export interface AssignStateLike {
  suspension?: { type: string; key?: string } | null;
  battle?: {
    columns: readonly (readonly EntityId[])[];
    blocks: Readonly<Record<number, readonly EntityId[]>>;
    assignPlans?: Readonly<Record<string, { picks: readonly number[]; def?: boolean }>> | null;
  } | null;
  entities: Readonly<Record<number, { card: CardName } | undefined>>;
}

export type AssignRowState = 'locked' | 'active' | 'behind';

export interface AssignVictimRow {
  unit: EntityId;
  card: CardName;
  /** locked: the answer already given. active: what the dial holds now.
   * behind: 0 — it has not been asked yet, and `remaining` is what it is
   * competing for. */
  amount: number;
  state: AssignRowState;
}

export interface AssignSplitView extends QuantityStepperView {
  mode: 'none' | 'assign';
  /** every victim of this strike front-to-back, or [] when the column could
   * not be derived — see `assignSplitVictims`. The dial is valid either way. */
  rows: AssignVictimRow[];
  /** the strike's whole pool: what is already locked plus what is still left */
  total: number;
  /** locked answers plus the dial — what submitting now would have spent */
  assigned: number;
  /** what would still be left for the units BEHIND the active one */
  remaining: number;
  hint: string;
  /** the option index that answers the dialled `count` (>= 0 in 'assign' mode) */
  index: number;
  /** the one-click "default — share front-to-back" option, or -1 */
  defaultIndex: number;
}

const NO_ASSIGN: AssignSplitView = {
  mode: 'none', count: 0, min: 0, max: 0, canDown: false, canUp: false, canAll: false,
  rows: [], total: 0, assigned: 0, remaining: 0, hint: '', index: -1, defaultIndex: -1,
};

/**
 * The victims of the pending strike, front-to-back, exactly as
 * `E.electionWalk` walks them — or null when they cannot be derived.
 *
 * The suspension key is `${sub}:atk|blk:${colIdx}`, and it names the side
 * DEALING: `atk` is the attacker striking, so its victims are the BLOCKERS of
 * that column, and `blk` is the blockers striking back, so its victims are the
 * attacking column. `aliveInCol` is just "the entity still exists", which is
 * the same filter here.
 *
 * ⚠ R72: a column index is stable only for the length of combat, which is
 * exactly as long as this decision lives. Never cache the result.
 */
export function assignSplitVictims(s: AssignStateLike | null | undefined): EntityId[] | null {
  const key = s?.suspension?.type === 'combatAssign' ? s.suspension.key : undefined;
  const b = s?.battle;
  if (!key || !b) return null;
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const side = parts[1], ci = Number(parts[2]);
  if (!Number.isInteger(ci) || ci < 0) return null;
  const ids = side === 'atk' ? b.blocks[ci] : side === 'blk' ? b.columns[ci] : undefined;
  if (!ids) return null;
  return ids.filter(id => !!s!.entities[id]);
}

/**
 * The victim this question is about, as an index into `assignSplitVictims`.
 *
 * `AssignPlan.picks` holds the answers in ask order, and the walk consumes one
 * pick per victim in lockstep with its own index — every branch that does NOT
 * consume a pick (the last living victim, a remainder too small to unlock the
 * unit behind) also ENDS the walk. So the victim being asked is simply
 * `picks.length`. No prose is parsed out of the prompt to find it.
 */
function activeVictimIndex(s: AssignStateLike | null | undefined): number {
  const key = s?.suspension?.type === 'combatAssign' ? s.suspension.key : undefined;
  if (!key) return 0;
  return s?.battle?.assignPlans?.[key]?.picks.length ?? 0;
}

/** the pool amounts already locked in by earlier answers to THIS strike */
function lockedPicks(s: AssignStateLike | null | undefined): number[] {
  const key = s?.suspension?.type === 'combatAssign' ? s.suspension.key : undefined;
  if (!key) return [];
  return [...(s?.battle?.assignPlans?.[key]?.picks ?? [])];
}

/**
 * What the prompt bar draws over an elective-split decision — 'none' for every
 * decision that is not one.
 *
 * ⚠ THE BL-25 CLAMP, and the reason it is applied on RENDER rather than on
 * submit. The dial is ONE stored `ui.` number (like `ui.counterCount`) that
 * outlives any single question — a reload restores it, and a strike asks one
 * question per victim, each with its own narrower menu. So a stored 4 can
 * arrive at a victim whose menu is [1..2]. Clamping downwards HERE means the
 * player reads 2 the instant that question paints; clamping at submit time
 * would let them read 4, click confirm, and be given 2. BL-25's lesson was
 * exactly that: a stepper showing a number the click will not honour is a trap
 * on precisely the crowded board the owner was complaining about.
 *
 * The rows degrade to [] rather than lie: if the derived column disagrees with
 * the menu the engine actually sent — the active victim's card name is in every
 * one of its option labels, so they are checkable against each other — the bar
 * draws the dial and the remainder alone. A wrong column of scans would be a
 * second BL-25.
 */
export function assignSplitStepper(
  dec: AssignDecisionLike | null | undefined,
  s: AssignStateLike | null | undefined,
  want: number,
): AssignSplitView {
  if (!dec || dec.kind !== 'assignDamage') return NO_ASSIGN;
  const amounts = dec.options.flatMap(o => {
    const n = assignSplitValue(o.value);
    return n === null ? [] : [n];
  });
  if (!amounts.length) return NO_ASSIGN;
  const min = Math.min(...amounts), max = Math.max(...amounts);
  const q = quantityStepper(want, min, max);
  const picks = lockedPicks(s);
  const total = picks.reduce((a, n) => a + n, 0) + max;
  const assigned = picks.reduce((a, n) => a + n, 0) + q.count;
  return {
    ...q,
    mode: 'assign',
    rows: assignSplitRows(dec, s, q.count),
    total, assigned, remaining: total - assigned,
    hint: hintOnce(dec.prompt, ASSIGN_SPLIT_HINT),
    index: assignSplitIndex(dec, q.count),
    defaultIndex: dec.options.findIndex(o => o.value === 'default'),
  };
}

/** the column as rows, or [] when it cannot be derived or does not agree with
 * the menu the engine sent (see `assignSplitStepper`) */
export function assignSplitRows(
  dec: AssignDecisionLike | null | undefined,
  s: AssignStateLike | null | undefined,
  count: number,
): AssignVictimRow[] {
  const victims = assignSplitVictims(s);
  if (!victims || !dec) return [];
  const picks = lockedPicks(s);
  const active = activeVictimIndex(s);
  if (active >= victims.length) return [];
  const cards = victims.map(id => s!.entities[id]?.card);
  if (cards.some(c => !c)) return [];
  // the agreement check: every amount option is labelled `${a} to ${card}` for
  // the victim being asked, so a derived column that names someone else is
  // wrong and must not be drawn
  const activeCard = cards[active]!;
  const labelled = dec.options.some(o => assignSplitValue(o.value) !== null && o.label.includes(activeCard));
  if (!labelled) return [];
  return victims.map((unit, i) => ({
    unit, card: cards[i]!,
    amount: i < active ? (picks[i] ?? 0) : i === active ? count : 0,
    state: (i < active ? 'locked' : i === active ? 'active' : 'behind') as AssignRowState,
  }));
}

/**
 * The option index for "assign `want` to the unit being asked".
 *
 * Clamped DOWNWARDS to what is actually on the menu, the same rule and for the
 * same reason as `counterPickIndex`: the dial carries over between the
 * questions of one strike, and refusing the click instead of honouring the
 * largest legal amount would make it a trap. -1 only for a want BELOW the
 * floor — that is not a clamp, it is the rule that a unit in front must be
 * assigned lethal before any damage goes behind it, and quietly rounding a
 * player UP into killing something is deciding for them.
 */
export function assignSplitIndex(dec: AssignDecisionLike | null | undefined, want: number): number {
  if (!dec || dec.kind !== 'assignDamage') return -1;
  const cap = Number.isFinite(want) ? Math.floor(want) : -1;
  let best = -1, bestN = -1;
  dec.options.forEach((o, i) => {
    const n = assignSplitValue(o.value);
    if (n === null || n > cap || n <= bestN) return;
    best = i; bestN = n;
  });
  return best;
}

export interface AssignSplitSubmit {
  /** the option index to send, or -1 when the allocation is refused */
  index: number;
  ok: boolean;
  /** '' when ok; otherwise why, naming the remainder */
  why: string;
  /** what would be left for the units behind — NEGATIVE when over-allocated */
  remaining: number;
}

/**
 * The guard on a RAW allocation — what `assignSplitStepper` has already
 * clamped, checked against the unclamped number a caller holds.
 *
 * This is the function that answers the report's "they always are forced to
 * sum to the amount of damage you have": an under-allocation (less than the
 * unit in front is owed) and an over-allocation (more damage than the strike
 * has) both come back `ok: false` with the remainder said out loud, so the bar
 * can tell the player WHY confirm is dark instead of just darkening it.
 */
export function assignSplitSubmit(
  dec: AssignDecisionLike | null | undefined, want: number,
): AssignSplitSubmit {
  const v = assignSplitStepper(dec, null, want);
  if (v.mode === 'none') return { index: -1, ok: false, why: '', remaining: 0 };
  const n = Number.isFinite(want) ? Math.floor(want) : NaN;
  if (!Number.isFinite(n) || n < v.min) {
    const short = v.min - (Number.isFinite(n) ? n : 0);
    return {
      index: -1, ok: false, remaining: v.max - (Number.isFinite(n) ? n : 0),
      why: `assign at least ${v.min} here — a unit in front must be assigned lethal `
        + `before any damage goes behind it (${short} short)`,
    };
  }
  if (n > v.max) {
    return {
      index: -1, ok: false, remaining: v.max - n,
      why: `only ${v.max} left to assign — that is ${n - v.max} more damage than this strike has`,
    };
  }
  return { index: assignSplitIndex(dec, n), ok: true, why: '', remaining: v.max - n };
}

/** what −, + and All do to the damage dial — the SHARED `stepQuantity`, so the
 * damage ticker and the counter ticker can never learn different arithmetic.
 * "All" jumps to everything-left and does NOT submit (R139's ruling, in the
 * type): with a strike big enough to kill the whole column you want to see the
 * number before you spend it. */
export function assignSplitStep(
  dec: AssignDecisionLike | null | undefined,
  s: AssignStateLike | null | undefined,
  want: number, act: 'up' | 'down' | 'all',
): StepperAction {
  const v = assignSplitStepper(dec, s, want);
  if (v.mode === 'none') return { count: want, submit: false };
  return stepQuantity(v, act);
}

// ═══ R197 — the NUMERIC ENTRY bar ═════════════════════════════════════════
//
// `kind: 'number'` is the one DecisionKind whose answer is NOT an index into
// `options`: `options` is empty and the `decide` action carries the VALUE. A
// decision kind is a contract about what its values mean, and the reason this
// judgement lives here rather than inline in ui/main.ts is the cautionary tale
// in `optionPingId` above — `electricPath`'s values are raw entity ids while
// `formationSlot`'s are slot indexes, one client read them as one namespace,
// and the player saw "placement isn't working". So the client's whole
// understanding of a numeric question is these two functions, and they are
// tested.
//
// The dial is the SHARED `quantityStepper` wherever it can be: a numeric entry
// with a ceiling dials exactly like a counter stepper. What it cannot share is
// an unbounded max — `quantityStepper` needs a finite `hi` to clamp to — so an
// open-ended range gets its ceiling from the dial itself and `canUp` is always
// true. That is the honest shape: there is no top, and the box the player
// types into is what makes the range reachable in one gesture rather than in
// two hundred clicks.

/** the slice of a `Decision` a numeric bar reads */
export interface NumberDecisionLike {
  kind: string;
  prompt: string;
  numeric?: { min: number; max: number | null; suggest: number; suggestLabel?: string } | undefined;
}

export interface NumberEntryView {
  /** this decision is a numeric entry at all */
  active: boolean;
  /** the dialled-in value, already clamped into the accepted range */
  value: number;
  min: number;
  /** null means NO CEILING — the card takes any number (Prediction Prophet) */
  max: number | null;
  canDown: boolean;
  canUp: boolean;
  /** the values worth a one-click button of their own: the floor, the
   * suggestion, and the ceiling when there is one. Never empty. */
  quick: { label: string; value: number }[];
}

const NO_NUMBER: NumberEntryView = {
  active: false, value: 0, min: 0, max: null, canDown: false, canUp: false, quick: [],
};

export function numberEntry(
  dec: NumberDecisionLike | null | undefined, want: number,
): NumberEntryView {
  if (!dec || dec.kind !== 'number' || !dec.numeric) return NO_NUMBER;
  const { min, max, suggest, suggestLabel } = dec.numeric;
  // an unbounded range still needs a finite number to clamp against; the dial
  // supplies it, which is why `canUp` below is true regardless
  const ceiling = max ?? Math.max(min, suggest, Number.isFinite(want) ? Math.floor(want) : min);
  const value = clampQuantity(want, min, Math.max(min, ceiling));
  const quick: { label: string; value: number }[] = [{ label: String(min), value: min }];
  if (suggest !== min) {
    quick.push({ label: suggestLabel ? `${suggest} (${suggestLabel})` : String(suggest), value: suggest });
  }
  if (max !== null && max !== min && max !== suggest) quick.push({ label: String(max), value: max });
  return {
    active: true, value, min, max,
    canDown: value > min,
    canUp: max === null || value < max,
    quick,
  };
}

/** `choice` for a numeric decision — the VALUE, never an index. `ok: false`
 * carries the reason out loud, so the bar can say why confirm is dark rather
 * than merely darkening it. */
export interface NumberEntrySubmit { choice: number; ok: boolean; why: string }

export function numberEntrySubmit(
  dec: NumberDecisionLike | null | undefined, want: number,
): NumberEntrySubmit {
  const v = numberEntry(dec, want);
  if (!v.active) return { choice: -1, ok: false, why: '' };
  const n = Number.isFinite(want) ? Math.floor(want) : NaN;
  if (!Number.isFinite(n)) return { choice: -1, ok: false, why: 'type a whole number' };
  if (n < v.min) return { choice: -1, ok: false, why: `the smallest legal answer is ${v.min}` };
  if (v.max !== null && n > v.max) {
    return { choice: -1, ok: false, why: `the largest legal answer is ${v.max}` };
  }
  return { choice: n, ok: true, why: '' };
}

/** what −, +, −10 and +10 do to the numeric dial. Like every other stepper in
 * this file it NEVER submits (R139's ruling, in the type): the number is read
 * before it is spent. */
export function stepNumberEntry(
  dec: NumberDecisionLike | null | undefined, want: number,
  act: 'up' | 'down' | 'up10' | 'down10',
): StepperAction {
  const v = numberEntry(dec, want);
  if (!v.active) return { count: want, submit: false };
  const by = act === 'up' ? 1 : act === 'down' ? -1 : act === 'up10' ? 10 : -10;
  const hi = v.max ?? Math.max(v.min, v.value + Math.max(by, 0));
  return { count: clampQuantity(v.value + by, v.min, Math.max(v.min, hi)), submit: false };
}

// ── R230: which scrolls may take the long-hover tooltip away ──────────

/** the only thing the rule below needs of a scrolled element: whether the card
 * the cursor is on lives inside it. `Element.contains` is exactly this, so
 * main.ts passes the real node and a test can pass a two-line stand-in. */
export interface ScrollContainer { contains(node: unknown): boolean }

/**
 * Report #110 — "It's weirdly difficult to get the hover to work on units and
 * show their text. I often have to move my mouse several times to get it to
 * show up."
 *
 * ui/main.ts hides the long-hover tooltip on `scroll`, captured at the window,
 * because a scroll means the player is doing something else — and concretely
 * because the card the tooltip describes has slid out from under the cursor.
 * That listener could not tell a USER scroll from the client's OWN: ONE
 * mouseover arms the 550ms dwell and then paints the focus rail, and painting
 * the rail ends in `scrollFocusToBottom`, which assigns `#preview.scrollTop`.
 * The scroll event that follows three milliseconds later cancelled the dwell
 * the same gesture had just armed. Measured in headless Chrome at 1280x720:
 * 0 of 4 units showed a tooltip on first landing; at 1400x900, 2 of 4 — the
 * two whose rail content overflowed. Not intermittent, just geometric.
 *
 * The rule, derived rather than special-cased: a scroll hides the tip when it
 * COULD HAVE MOVED THE HOVERED CARD, and not otherwise.
 *
 *  - the document scrolled (`scroller` is null — the event's target is the
 *    document, not an element): everything moved, so hide.
 *  - nothing is being hovered: there is nothing to protect, so hide — this is
 *    the branch that keeps a stale tip from surviving on a re-render.
 *  - an element scrolled: hide only if the hovered card is INSIDE it. The side
 *    rail is not an ancestor of a board card, so the client scrolling its own
 *    rail is the client talking to itself and the dwell survives. A genuinely
 *    scrollable board container still hides, with no list of ids anywhere.
 *
 * The deliberate behaviour change that falls out of this: a player who scrolls
 * the focus rail with the wheel while dwelling on a board card keeps the
 * tooltip. That is right — the card did not move, and the two panels are
 * showing the same unit anyway.
 */
export function scrollHidesHoverTip(
  scroller: ScrollContainer | null, hovered: unknown | null,
): boolean {
  if (!scroller) return true;
  if (!hovered) return true;
  return scroller.contains(hovered);
}

/**
 * R266 / CT-134 — THE UNUSED SPELL TOKENS, IN FRONT OF THE PLAYER WHO LOST THEM.
 *
 * Owner, answering the round-32 question sheet: *"no warnings should only
 * exist in the log. In fact, NOTHING should only exist in the log. Everything
 * should be clear in the UI. The log is for checking past things. So this
 * warning about spell tokens should be in the normal warning and choice area,
 * where all the normal buttons are."*
 *
 * ⚠ HALF OF THIS WAS ALREADY DONE, AND THE HALF THAT WAS NOT IS NOT A WARNING.
 * Report #66's warning — *"You're about to move to Regroup which will remove
 * your Spell Tokens. Are you sure?"* — has been a `.promptbar` confirm since
 * R194 (`ui/main.ts`, `confirmBarHtml('pass', …)`). It is armed by
 * `passEndsBattlePhase` and it fires on the pass that would reach Regroup and
 * on no other window. That one was never log-only.
 *
 * What IS log-only is the case that HAS NO PASS TO WARN ON: a round-2 attacker
 * who declines goes `doDeclareAttack` → `endBattleRound` → `startRegroup`
 * without opening a priority window at all, so the defender's castable tokens
 * are gone before any bar could ask them anything (see engine.ts's own note at
 * `startRegroup`, and R194 for why the window is not opened). R194 announced
 * the loss instead of preventing it, and the announcement went to the log —
 * which report #131 has since hidden behind a right-click menu.
 *
 * So this is a NOTICE, not a warning: the thing has already happened and there
 * is no choice attached to it. It still belongs where the owner put it,
 * because that is where the player is looking.
 *
 * ── THE PREDICATE, AND WHY IT IS A SHAPE RATHER THAN A SENTENCE
 *
 * `startRegroup`'s announcement is `ev('erased', …, { seat, ids })`, and the
 * MISSING key is what identifies it. `E.ev()` keeps the R65 public erased pile
 * centrally: an 'erased' event with a numeric `seat` AND `cards`/`card` has
 * those names pushed onto that seat's erased list, which `erasedDialogHtml`
 * draws. R194 deliberately passes neither — a spell token is not a card and
 * has never been recorded there — so this is the one erase in the engine that
 * reaches NO existing surface, and "erased, with a seat, with ids, with no
 * card names" says exactly that. Matching the prose instead would break on a
 * reworded sentence while still looking green.
 *
 * `mySeat` is the viewer, or null in hotseat where one screen is both players:
 * the owner asked for this in front of the player who LOST the tokens, so a
 * net client is not told about the opponent's loss.
 *
 * Returns the engine's own sentence rather than rebuilding it. By the time the
 * client paints, the token entities are deleted, so `ids` cannot be resolved
 * back to names — the message is the only place they survive.
 */
export function tokenLossNotice(
  events: readonly EngineEvent[], mySeat: Seat | null,
): { seat: Seat; n: number; msg: string } | null {
  // last one wins: a batch that erased both seats' tokens shows the viewer's,
  // and `mySeat` has already filtered the other one out
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'erased' || !e.msg) continue;
    const d = e.data ?? {};
    const seat = d['seat'], ids = d['ids'];
    if (typeof seat !== 'number') continue;
    if (!Array.isArray(ids) || ids.length === 0) continue;
    if ('cards' in d || 'card' in d) continue;   // R65 pile: the erased dialog has it
    if (mySeat !== null && seat !== mySeat) continue;
    return { seat: seat as Seat, n: ids.length, msg: e.msg };
  }
  return null;
}
