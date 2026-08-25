/* Fuzz harness (docs/04 §1: "a fuzzer as the main QA tool").
 * Plays random legal actions and asserts engine invariants after every step.
 * Shared by fuzz.test.ts (small, in the suite) and fuzz-run.ts (big runs). */
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { allCardNames } from '../src/cards/dsl.ts';
import { rngNext } from '../src/rng.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

export interface FuzzResult {
  seed: number;
  actions: Action[];
  finished: boolean;      // reached gameover (vs action cap)
  turns: number;
  state: GameState;
  /** R169 / CT-47: how many times legalActions' ONE documented exception
   * actually fired in this game (see the catch block below). Exposed so a test
   * can assert the exception is EXERCISED rather than merely tolerated — a
   * fuzzer that swallows a whole class of refusal without ever proving it
   * happens is a fuzzer that will swallow the next real one too. */
  disturbed: number;
}

export function fuzzGame(seed: number, maxActions = 3000, mode: 'shared' | 'draft' = 'shared', els?: import('../src/types.ts').Element[]): FuzzResult {
  let rng = (seed * 2654435761) >>> 0;
  const rand = () => { const [v, next] = rngNext(rng); rng = next; return v; };
  const pickFrom = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  let { state } = createGame(seed, undefined, mode, els);
  const actions: Action[] = [];
  let disturbed = 0;

  for (let i = 0; i < maxActions && state.phase !== 'gameover'; i++) {
    checkInvariants(state);
    const legal: { seat: Seat; a: Action }[] = [];
    for (const seat of [0, 1]) {
      for (const a of legalActions(state, seat)) legal.push({ seat, a });
    }
    if (!legal.length) {
      throw new Error(`stuck state: no legal actions for anyone (seed ${seed}, action ${i}, phase ${state.phase}, step ${state.battle?.step}, decision ${JSON.stringify(state.decision)})`);
    }

    // sometimes replace a formation action with a random-shaped one
    let action: Action = pickFrom(legal).a;
    const custom = maybeRandomFormation(state, rand) ?? maybeRandomDraft(state, rand);
    if (custom && rand() < 0.5) {
      try {
        const r = apply(state, custom);
        state = r.state;
        actions.push(custom);
        continue;
      } catch (err) {
        if (!(err instanceof IllegalAction)) throw err;
        // fall through to the guaranteed-legal action
      }
    }
    try {
      const r = apply(state, action);
      state = r.state;
      actions.push(action);
    } catch (err) {
      if (err instanceof IllegalAction) {
        if (isContractException(state, action, err, `seed ${seed}, action ${i}`)) {
          disturbed++;
          continue;   // the state is untouched; pick again next iteration
        }
        throw new Error(`legalActions lied: ${JSON.stringify(action)} rejected: ${(err as Error).message} (seed ${seed}, action ${i})`);
      }
      throw new Error(`engine crash on ${JSON.stringify(action)} (seed ${seed}, action ${i}): ${(err as Error).stack}`);
    }
  }
  checkInvariants(state);
  return { seed, actions, finished: state.phase === 'gameover', turns: state.turn, state, disturbed };
}

/**
 * R169 / CT-47 — THE ONE NAMED EXCEPTION to `legalActions`' contract
 * ("every action returned is legal", apply.ts). Nothing else may pass.
 *
 * R154 lets a seat act while the OTHER seat holds an open question, so long as
 * the engine can prove the question is none of its business. Whether the action
 * it picks will DISTURB that question cannot be known until the action has run
 * — it depends on the card, its targets and the board — so `legalActions`
 * offers it and `apply()` discards the draft afterwards, flagging `disturbs`.
 * That refusal means "not YET", never "not ever": the server parks the action
 * and lands it once the question is answered (rooms.ts `deferrableRefusal`).
 *
 * Three properties keep this from being a hole the fuzzer falls through:
 *   · it is recognised BY THE FLAG, never by matching on a message;
 *   · it is CHECKED, not assumed — a disturbance is only the R154 exception
 *     when a question is actually standing and belongs to somebody else, so a
 *     mis-flagged refusal is louder here than an unflagged one;
 *   · `fuzzGame` COUNTS it (`FuzzResult.disturbed`), so a test can assert the
 *     exception is exercised rather than merely tolerated.
 *
 * Widen this and the whole class of bug the fuzzer exists to find goes quiet.
 */
export function isContractException(
  state: GameState, action: Action, err: unknown, where = '',
): boolean {
  if (!(err instanceof IllegalAction) || err.disturbs !== true) return false;
  const at = where ? ` (${where})` : '';
  if (!state.decision) {
    throw new Error(`\`disturbs\` refusal with NO decision standing — that is not the R154 exception: ${JSON.stringify(action)}${at}`);
  }
  if (state.decision.seat === action.seat) {
    throw new Error(`\`disturbs\` refusal on the ASKING seat's own action — that is not the R154 exception: ${JSON.stringify(action)}${at}`);
  }
  return true;
}

/** random hand↔pack merges beyond legalActions' single-swap set */
function maybeRandomDraft(state: GameState, rand: () => number): Action | null {
  if (state.mode !== 'draft' || state.phase !== 'planning' || !state.draftDone || state.decision) return null;
  const seats = ([0, 1] as Seat[]).filter(s => !state.draftDone![s]);
  if (!seats.length) return null;
  const seat = seats[Math.floor(rand() * seats.length)]!;
  const pack = state.packs[seat]!;
  const pileLen = state.players[seat]!.hand.length + pack.length;
  const packIndices = shuffle(Array.from({ length: pileLen }, (_, i) => i), rand).slice(0, pack.length);
  return { type: 'draftCommit', seat, packIndices };
}

/** random attack/block shapes beyond legalActions' representative set */
function maybeRandomFormation(state: GameState, rand: () => number): Action | null {
  const b = state.battle;
  if (!b || state.decision) return null;
  const units = (seat: Seat, region: number) =>
    Object.values(state.entities)
      .filter(e => e.kind === 'unit' && e.controller === seat && !e.absent && e.region === region)
      .map(e => e.id);
  if (b.step === 'declare') {
    const from = b.round === 1 || b.attackerPool === null
      ? state.regions.findIndex(r => r.owner === b.attacker)
      : b.region;
    let pool = units(b.attacker, from);
    if (b.attackerPool) pool = pool.filter(id => b.attackerPool!.includes(id));
    if (!pool.length) return null;
    const n = 1 + Math.floor(rand() * pool.length);
    const chosen = shuffle(pool, rand).slice(0, n);
    const columns: EntityId[][] = [];
    for (let i = 0; i < chosen.length;) {
      const two = rand() < 0.4 && i + 1 < chosen.length;
      columns.push(two ? [chosen[i]!, chosen[i + 1]!] : [chosen[i]!]);
      i += two ? 2 : 1;
    }
    return { type: 'declareAttack', seat: b.attacker, columns };
  }
  if (b.step === 'blocks') {
    const pool = shuffle(units(b.defender, b.region), rand);
    const blocks: Record<number, EntityId[]> = {};
    let k = 0;
    for (let ci = 0; ci < b.columns.length && k < pool.length; ci++) {
      if (rand() < 0.5) continue;
      const two = rand() < 0.3 && k + 1 < pool.length;
      blocks[ci] = two ? [pool[k]!, pool[k + 1]!] : [pool[k]!];
      k += two ? 2 : 1;
    }
    const send = b.round === 1 ? pool.slice(k).filter(() => rand() < 0.3) : [];
    return { type: 'declareBlocks', seat: b.defender, blocks, send };
  }
  return null;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const KNOWN = new Set(allCardNames());

export function checkInvariants(s: GameState): void {
  const die = (msg: string) => { throw new Error(`invariant violated: ${msg}`); };

  for (const [idStr, e] of Object.entries(s.entities)) {
    if (e.id !== Number(idStr)) die(`entity table key mismatch for ${idStr}`);
    if (!KNOWN.has(e.card)) die(`unknown card in play: ${e.card}`);
    if (e.region < 0 || e.region >= s.regions.length) die(`bad region on ${e.card}`);
    if (e.damage < 0) die(`negative damage on ${e.card}`);
    for (const modId of e.mods) {
      const m = s.entities[modId];
      if (!m) { die(`ghost mod ${modId} on ${e.card}`); return; }
      if (m.modOf !== e.id) die(`mod ${m.card} does not point back to host ${e.card}`);
      if (m.kind !== 'mod') die(`non-mod in mod stack of ${e.card}`);
    }
    if (e.kind === 'mod') {
      const host = e.modOf !== undefined ? s.entities[e.modOf] : undefined;
      if (!host) { die(`orphan mod ${e.card}`); return; }
      if (!host.mods.includes(e.id)) die(`mod ${e.card} unlisted by host`);
    }
  }
  for (const p of s.players) {
    if (!Number.isFinite(p.life)) die('life is not a number');
    if (p.activationsLeft < 0) die('negative activations');
    for (const c of [...p.hand, ...p.bin]) if (!KNOWN.has(c)) die(`unknown card: ${c}`);
    // R41: the cache is a real zone — its contents are held to the same
    // standard as hand and bin, and a prophecy must carry its anchors
    for (const cc of p.cache ?? []) {
      if (!KNOWN.has(cc.card)) die(`unknown card in cache: ${cc.card}`);
      if (cc.prophecy && !Number.isInteger(cc.prophecy.turn)) die(`cached ${cc.card} has an unanchored prophecy`);
    }
    for (const r of p.resources) {
      if (!['dormant', 'open', 'expended'].includes(r.state)) die('bad resource state');
    }
  }
  for (const c of s.sharedDeck) if (!KNOWN.has(c)) die(`unknown card in deck: ${c}`);
  for (const pack of s.packs) {
    for (const c of pack) if (!KNOWN.has(c)) die(`unknown card in pack: ${c}`);
  }
  if (s.mode === 'draft' && s.draftDone !== null && s.phase !== 'planning') {
    die('draft step open outside planning');
  }
  if (s.decision) {
    if (!s.suspension) die('decision without suspension');
    if (!s.decision.options.length) die('decision with no options');
  }
  if (s.suspension && !s.decision) die('suspension without decision');
  if (s.phase === 'battle' && !s.battle) die('battle phase without battle state');
  for (const item of s.stack) {
    if (item.region < 0 || item.region >= s.regions.length) die('stack item in bad region');
    // R79: a virus is aimed at EITHER a unit or a stack item, never both and
    // never neither
    if (item.kind === 'virus' && (item.hostId === undefined) === (item.hostStack === undefined)) {
      die(`virus ${item.card} names ${item.hostId === undefined ? 'no host' : 'two hosts'}`);
    }
    for (const a of item.augments ?? []) if (!KNOWN.has(a.card)) die(`unknown virus on the stack: ${a.card}`);
  }
  // R78: an item is only ever left mid-resolution because somebody has to
  // answer something. A resolving item with no open decision is off the stack
  // with nothing left to put it back — the stuck state this whole rule exists
  // to make visible rather than invisible.
  if (s.resolving) {
    if (!s.decision) die(`${s.resolving.label} is resolving with no decision pending`);
    if (s.phase !== 'battle') die('a resolving item published outside the battle phase');
    if (s.stack.some(i => i.id === s.resolving!.id)) die('the resolving item is ALSO on the stack');
    const sus = s.suspension;
    if (sus?.type !== 'resolve') die('a resolving item under a non-resolve suspension');
    else if (sus.item !== s.resolving) die('resolving and suspension.item are two objects');
  } else if (s.suspension?.type === 'resolve' && s.phase === 'battle') {
    die('a mid-resolution suspension in battle with nothing marked as resolving');
  }
}
