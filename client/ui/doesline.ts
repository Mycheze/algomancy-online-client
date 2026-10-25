/**
 * WHAT A STACK ITEM WILL DO, IN ONE LINE (owner, 2026-09-30).
 *
 * "I'm worried about the user's perspective. I think just a short line of
 * something like 'Delete {Unit Name}' or 'Deal 2 damage to {A} and {B}' would
 * be an ideal text description. Or 'Negate {effect}. {Player} draws a card'
 * for something like Graxxlid."
 *
 * The sweep (var/records/stack-text-sweep/REPORT.md) found the stack never
 * said what a spell would do, and that the one authored string for an
 * ability — the DSL `label` — is the whole printed line, cost and all. So
 * every clause in the pool has a TEMPLATE, written once, offline, in the
 * owner's register (ui/does-lines.json, keyed by effectKey), and this fills
 * it with the names on the table. Display only: the engine's own label and
 * log text are untouched, and a saved game reads in the new words too.
 *
 * Slots (the whole vocabulary — test/344 rejects anything else):
 *   {0} {1} …          target i by name (absolute, extraSlots first)
 *   {0+}               every target from i on, as a list ("A, B and C")
 *   {0.controller}     the player who controls target i
 *   {me}               the body the clause runs on (the host of an augment,
 *                      the carrier of a graft, the card itself for a spell)
 *   {you} {opponent}   the item's controller, and the other player
 *   {X}                the clause's AMOUNT (amountOf, below). The owner's rule,
 *                      2026-09-30: "'Create a Fireball X (currently 4)' for
 *                      things that check on resolution or have an unknown
 *                      amount and just 'Fireball 4' for things that will not
 *                      check, are using last known information or have a
 *                      single paid X value." So a FIXED amount prints as its
 *                      number; a LIVE one prints "X" and the sentence ends
 *                      "(currently 4)"; an amount with no value yet is "X".
 *   {mode:a=…|b=…}     words by the mode chosen at cast (part.mode); the
 *                      words may hold one slot of their own
 * A sentence with a slot that has nothing to name (an optional target left
 * empty, a target list with nobody in it) is DROPPED, so "{0+} each lose 1
 * life. Draw a card" reads "Draw a card" when no player was chosen.
 *
 * A graft cause's own clause may be the empty string: it does nothing itself,
 * it only carries the grafts (owner: "the grafted ability should just
 * immediately be the thing that's on the stack as a single, unified ability").
 * The item's line is then the grafts' lines alone.
 *
 * Pure; ui/test/344 walks every clause in the pool through it.
 */
import doesJson from './does-lines.json' with { type: 'json' };
import type { EffectPart, Entity, EntityId, GameState, Seat, StackItem, TargetRef } from '../engine/src/types.ts';
import { effectByKey, eventAmountOf, getCard, type EffectDef } from '../engine/src/cards/dsl.ts';
import { eventCardCost } from '../engine/src/cards/sets/helpers.ts';
import { E } from '../engine/src/engine.ts';

export const DOES: Readonly<Record<string, string>> = doesJson as Record<string, string>;

/** "A", "A and B", "A, B and C" */
export function listText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface SlotContext {
  /** target i's name, or null when there is no target i */
  target: (i: number) => string | null;
  /** every chosen target, in order */
  count: number;
  /** the name of the player controlling target i */
  controllerOf: (i: number) => string | null;
  me: string | null;
  you: string | null;
  opponent: string | null;
  /** the {X} amount — see amountOf */
  amount: Amount | undefined;
  mode: unknown;
  /** escapes the template's own words (main.ts passes esc; tests identity) */
  text: (s: string) => string;
  /** CT-194: the item deals double damage ({Powerful}) — its own "Deal N
   * damage" says the doubled number, and why. The simple
   * case of `damage`, which wins when both are given. */
  powerful?: boolean;
  /** CT-370: the item's own damage as it will land (`damagePricer`) */
  damage?: DamagePricer;
  /** CT-412: a life, rot, debt or counter amount as it will land (`amountPricer`) */
  amounts?: AmountPricer;
}

/** CT-370: one damage number as it will land, and the words that say why
 * (already escaped) */
export interface Priced {
  n: number; why: string[];
  /** CT-412: the shield that prevents all of it (E.preventedBy) — `n` is then
   * what would have been dealt, and none is */
  none?: string;
}
/**
 * CT-370: the printed amount `n` → what lands. `named` is the target indices
 * the sentence names after its damage verb ({0}, {1+}), or null for a
 * sentence that names none ("each unit"), which is priced for a plain
 * recipient — with a note for the units on the table that take otherwise when
 * `unitsHit` (the sentence says "unit": "each player" has no such note).
 */
export type DamagePricer = (n: number, named: number[] | null, unitsHit?: boolean, players?: PlayerGroup | null) => Priced;

/** CT-412: the players a sentence names by word rather than by target slot */
export type PlayerGroup = 'you' | 'opponent' | 'each';
/** CT-412: the amount kinds the engine prices besides damage (E.amountPreview) */
export type AmountKind = 'lifeGain' | 'lifeLoss' | 'rot' | 'debt' | 'counters';
/**
 * CT-412: who a sentence's amount lands on, read off the template's own words
 * (`whoPlayers`, `whoUnits`): players by word or by target slot ({0}, {1+},
 * {0.controller}), or units — {me}, target slots, or a group on the table.
 */
export type Who =
  | { players: PlayerGroup }
  | { players: 'slot'; idx: number; on?: true }
  | { players: 'controllerOf'; idx: number }
  | { units: 'me' }
  | { units: 'slot'; idx: number }
  | { units: 'yours' | 'enemy' | 'each' };
/** CT-412: the printed amount `n` (signed for counters: a -1/-1 counter is -1)
 * → its size as it will land, and the words that say why */
export type AmountPricer = (kind: AmountKind, n: number, who: Who) => Priced;

const WORD_N: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

/** CT-412: the amount clauses a caption sentence may hold, besides damage:
 * `verb`, `amt` (a number, a word, {X}, "that much"; none for "… equal to"),
 * and for counters `kind` (+1/+1 or -1/-1). The rest of the sentence after a
 * counter clause names the units ("on {me}", "on each enemy"). */
const AMOUNT_CLAUSES: readonly { re: RegExp; kind: (verb: string, noun: string) => AmountKind; units?: true }[] = [
  { re: /\b(?<verb>[Gg]ain|gains|[Ll]ose|loses) (?<amt>\d+|\{X\}|that much) life\b/g, kind: v => (/^[Gg]ain/.test(v) ? 'lifeGain' : 'lifeLoss') },
  { re: /\b(?<verb>[Gg]ain|gains) life equal to\b/g, kind: () => 'lifeGain' },
  { re: /\b(?<verb>[Gg]ain|gains) (?<amt>a|one|two|three|four|\d+|\{X\}) (?<noun>rot|debt)\b/g, kind: (_v, u) => u as AmountKind },
  { re: /\b(?<verb>[Gg]ain|gains) debt equal to\b/g, kind: () => 'debt' },
  { re: /\b(?<verb>[Pp]ut) (?<amt>a|an|one|two|three|four|\d+|\{X\}) (?<kind>[+-]\d+\/[+-]\d+) counters? on /g, kind: () => 'counters', units: true },
];

/** CT-412: the players an amount clause lands on, from the words before it */
export function whoPlayers(before: string): Who {
  let m: RegExpExecArray | null;
  if ((m = /\{(\d+)\.controller\}\s*$/.exec(before))) return { players: 'controllerOf', idx: Number(m[1]) };
  if ((m = /\{(\d+)\+\} each\s*$/.exec(before))) return { players: 'slot', idx: Number(m[1]), on: true };
  if ((m = /\{(\d+)\}\s*$/.exec(before))) return { players: 'slot', idx: Number(m[1]) };
  if (/\{opponent\}|\beach opponent\b/i.test(before)) return { players: 'opponent' };
  if (/\bplayers?\b/i.test(before)) return { players: 'each' };
  return { players: 'you' };
}

/** CT-412: the units a counter clause lands on, from the words after "on " */
export function whoUnits(after: string): Who | null {
  let m: RegExpExecArray | null;
  if (/^\{me\}/.test(after)) return { units: 'me' };
  if ((m = /^\{(\d+)\}/.exec(after))) return { units: 'slot', idx: Number(m[1]) };
  if (/^(each of your units|your units)\b/.test(after)) return { units: 'yours' };
  if (/^each enemy\b/.test(after)) return { units: 'enemy' };
  if (/^each unit\b/.test(after)) return { units: 'each' };
  return null;
}

/** CT-412: the words naming players a damage sentence hits without a slot */
function playersHitBy(rest: string): PlayerGroup | null {
  if (/\{opponent\}|\beach opponent\b/i.test(rest)) return 'opponent';
  if (/\beach player\b|\bplayers\b/i.test(rest)) return 'each';
  if (/\{you\}/.test(rest)) return 'you';
  return null;
}
const POWERFUL: DamagePricer = n => ({ n: 2 * n, why: ['Powerful'] });

/** CT-370: the target indices a sentence names ({0}, {1+}), or null for none */
function namedAfter(rest: string, count: number): number[] | null {
  const out: number[] = [];
  for (const m of rest.matchAll(/\{(\d+)(\+)?\}/g)) {
    const i = Number(m[1]);
    if (m[2]) for (let j = i; j < count; j++) out.push(j);
    else out.push(i);
  }
  return out.length ? [...new Set(out)] : null;
}

/** every slot token a template may use — test/344 holds templates to it */
export const SLOT_RE = /\{(\d+)(\+|\.controller)?\}|\{(me|you|opponent|X)\}|\{mode:((?:[^{}]|\{[^{}]*\})*)\}/g;

/**
 * CT-194: the damage the ITEM deals — "Deal 3 damage", "deal damage equal to",
 * "{me} deals {X} damage" (the printed "I deal"). Not "{0} deals": Squish's
 * damage is dealt by its target, whose attributes are its own (CR 802.10e).
 */
const OWN_DAMAGE_RE = /(^|[^}\w])([Dd]eal|\{me\} deals) (?:(\d+|\{X\}) )?damage\b/;

/** fill one template; null when every sentence of it dropped out */
export function renderTemplate(tpl: string, c: SlotContext): string | null {
  const sentences = tpl.split(/(?<=\.)\s+/).map(raw => {
    let missing = false;
    let live = false;
    // CT-194: a {Powerful} item deals double (CR 802.10d) — say the number it
    // will really deal, and why, rather than the printed one
    // CT-370: …and the additive modifiers before it (Conduit of Pain), and a
    // named recipient's {Vulnerable} after it — `damagePricer`, below
    let sentence = raw;
    let why: string[] = [];
    let priceX: ((n: number) => Priced) | null = null;
    const price = c.damage ?? (c.powerful ? POWERFUL : undefined);
    const dm = price ? OWN_DAMAGE_RE.exec(raw) : null;
    if (dm && price) {
      const n = dm[3];
      const head = raw.slice(0, dm.index) + dm[1] + dm[2];
      let rest = raw.slice(dm.index + dm[0].length);
      const named = namedAfter(rest, c.count);
      const unitsHit = /\bunits?\b/.test(rest);
      const players = named ? null : playersHitBy(rest);
      const at = (k: number): Priced => price(k, named, unitsHit, players);
      // Channel Through's points: each is one more dealing, doubled as the rest
      // is (its "+1" per point is not said: the split is the controller's)
      // the multiple a plain recipient is dealt: (k + add) x mult is linear
      const mult = price(2, null).n - price(1, null).n;
      rest = rest.replace(/\bsplit (\d+)\b/, (_m, k: string) => `split ${mult > 0 ? mult * Number(k) : k}`);
      if (n === undefined) {
        // "deal damage equal to …": no number to price, so say the multiple
        const p = at(1);
        const m = at(2).n - p.n;
        why = p.why;
        sentence = `${head} ${m === 2 ? 'double ' : m > 2 ? `${m}× ` : ''}damage${rest}`;
      } else if (n === '{X}') {
        priceX = at;
        sentence = `${head} {X} damage${rest}`;
      } else {
        const p = at(Number(n));
        why = p.why;
        sentence = `${head} ${p.n} damage${rest}`;
      }
    }
    // CT-412: life, rot, debt and counters, as the engine will price them
    if (c.amounts) {
      const r = priceAmounts(sentence, c.amounts, c.count, !priceX);
      sentence = r.sentence;
      why.push(...r.why.filter(w => !why.includes(w)));
      if (r.priceX) priceX = r.priceX;
    }
    const xNow = (): number => {
      if (!priceX) return c.amount!.x;
      const p = priceX(c.amount!.x);
      why = [...why.filter(w => !p.why.includes(w)), ...p.why];
      return p.n;
    };
    let out = '';
    let last = 0;
    for (const m of sentence.matchAll(SLOT_RE)) {
      out += c.text(sentence.slice(last, m.index));
      last = m.index! + m[0].length;
      let v: string | null = null;
      if (m[1] !== undefined) {
        const i = Number(m[1]);
        if (m[2] === '+') {
          const names: string[] = [];
          for (let j = i; j < c.count; j++) { const n = c.target(j); if (n) names.push(n); }
          v = names.length ? listText(names) : null;
        } else if (m[2] === '.controller') v = c.controllerOf(i);
        else v = c.target(i);
      } else if (m[3] === 'me') v = c.me;
      else if (m[3] === 'you') v = c.you;
      else if (m[3] === 'opponent') v = c.opponent;
      else if (m[3] === 'X') {
        if (c.amount && !c.amount.live) v = String(xNow());
        else { v = 'X'; live = !!c.amount; }
      }
      else if (m[4] !== undefined) {
        // a mode's words may hold a slot of their own ("Create {X} 1/1 units")
        const pick = m[4].split('|').map(o => o.split('=')).find(([k]) => k === String(c.mode));
        v = pick ? renderTemplate(pick.slice(1).join('='), c) : null;
      }
      if (v === null) { missing = true; break; }
      out += v;
    }
    if (missing) return null;
    const tail = sentence.slice(last);
    // a live amount says what it is now, once, at the end of its sentence;
    // a doubled one says why
    const cur = live ? xNow() : 0;
    const now = live ? ` (currently ${cur}${why.length ? `, ${why.join(', ')}` : ''})`
      : why.length ? ` (${why.join(', ')})` : '';
    return out + c.text(tail.replace(/\.$/, '')) + now + (tail.endsWith('.') ? '.' : '');
  }).filter((s): s is string => s !== null && s.trim() !== '');
  // "Put 1 -1/-1 counters" → "counter": a filled number of one takes the singular
  return sentences.length ? sentences.join(' ').replace(/(^|\s)1 ((?:[+-]?\d+\/[+-]?\d+ )?[a-z]+?)s\b/g, '$11 $2') : null;
}

/**
 * CT-412: rewrite each life / rot / debt / counter clause of one sentence to the
 * amount that will land (`price`), and collect why. A clause naming no number
 * ("gain that much life", "debt equal to its cost") keeps its words and gains
 * only the why. `xFree`: no {X} pricer is taken yet (damage takes it first), so
 * an {X} clause may take it.
 */
function priceAmounts(sentence: string, price: AmountPricer, count: number, xFree: boolean):
  { sentence: string; why: string[]; priceX: ((n: number) => Priced) | null } {
  const why: string[] = [];
  const note = (p: Priced): void => { for (const w of p.why) if (!why.includes(w)) why.push(w); };
  let priceX: ((n: number) => Priced) | null = null;
  for (const clause of AMOUNT_CLAUSES) {
    let out = '';
    let last = 0;
    // a clause inside a mode slot is priced when the chosen mode's words are
    // filled (renderTemplate recurses with the same pricer), not here as well
    const modes = [...sentence.matchAll(SLOT_RE)].filter(m => m[4] !== undefined)
      .map(m => [m.index!, m.index! + m[0].length] as const);
    for (const m of sentence.matchAll(clause.re)) {
      const g = m.groups!;
      const at = m.index!;
      if (modes.some(([a, b]) => at > a && at < b)) continue;
      const who = clause.units ? whoUnits(sentence.slice(at + m[0].length)) : whoPlayers(sentence.slice(0, at));
      // a slot with nobody in it: the sentence is dropped when it is filled
      if (!who || ('idx' in who && who.idx >= count)) continue;
      const kind = clause.kind(g['verb']!, g['noun'] ?? '');
      const sign = g['kind']?.startsWith('-') ? -1 : 1;
      const priceOf = (k: number): Priced => price(kind, sign * k, who);
      const amt = g['amt'];
      if (amt === '{X}') {
        if (xFree && !priceX) priceX = priceOf;
        continue;
      }
      if (amt === undefined || amt === 'that much') { note(priceOf(1)); continue; }
      const n = WORD_N[amt] ?? Number(amt);
      const p = priceOf(n);
      note(p);
      if (p.n === n) continue;
      // the amount in figures, and a counter's noun agreeing with it
      const rest = clause.units ? ` ${g['kind']} ${p.n === 1 ? 'counter' : 'counters'} on ` : m[0].slice(g['verb']!.length + 1 + amt.length);
      out += sentence.slice(last, at) + `${g['verb']} ${p.n}${rest}`;
      last = at + m[0].length;
    }
    sentence = out + sentence.slice(last);
  }
  return { sentence, why, priceX };
}

export interface Amount { x: number; live: boolean }

const eventData = (item: StackItem): Record<string, unknown> =>
  (item.event?.data as Record<string, unknown> | undefined) ?? {};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const fixed = (x: number | undefined): Amount | undefined => (x === undefined ? undefined : { x, live: false });
const live = (x: number | undefined): Amount | undefined => (x === undefined ? undefined : { x, live: true });
const expended = (e: E, seat: Seat): number =>
  e.player(seat).resources.filter(r => r.state === 'expended').length;
const statOf = (e: E, t: TargetRef | undefined, i: 0 | 1): number | undefined => {
  if (!t || !('unit' in t)) return undefined;
  const u = e.entity(t.unit);
  return u ? e.effStats(u)[i] : undefined;
};

/** What each amount-bearing clause reads, copied from its own `run` (the
 * source is cited per line) — only where the card has no `xPreview` of its
 * own to ask, and where the amount needs the item (its source unit, its
 * target, its event) that a card-level preview cannot see. test/344 §2b holds
 * every {X} line to having a source here, in the item, or in a preview. */
type AmountFn = (e: E, item: StackItem, part: EffectPart, me: Entity | undefined) => Amount | undefined;
export const AMOUNT: Readonly<Record<string, AmountFn>> = {
  // FIXED — the event, the paid cost, or last known information
  'ability:Perpetual Construct#0': (e, it) => {
    const mod = e.entity(eventData(it)['mod'] as EntityId);
    const m = mod ? getCard(mod.card).mana : undefined;
    return fixed(typeof m === 'number' ? m : 0);
  },
  'augment:A Pile of Runes#0': (_e, it) => fixed(num(eventData(it)['aporDefense'])),
  'augment:Static Courier#0': (_e, it) => fixed(num(eventData(it)['courierPower'])),
  'augment:Arcane Concentrator#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Channeled Amalgam#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Unstable Apparition#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Ember of Life#0': (_e, it) => fixed(num(eventData(it)['total']) ?? num(eventData(it)['n'])),
  'spell:Volatile Toxicity': (_e, _it, p) => fixed(p.costPaid?.sacrificed?.defense),
  'graft:Volatile Toxicity': (_e, _it, p) => fixed(p.costPaid?.sacrificed?.defense),
  'spell:Covenant of the Damned': (_e, _it, p) => {
    const t = p.targets[0];
    const m = t && 'bin' in t ? getCard(t.bin.card).mana : undefined;
    return fixed(typeof m === 'number' ? m : undefined);
  },
  // LIVE — read at resolution, shown as it stands now
  'ability:Harbinger of Immolation#0': (e, it) => live(1 + e.tokensOf(it.controller).length),
  'ability:Spewing Mushroom#0': (e, _it, _p, me) => live(me ? e.effStats(me)[0] : undefined),
  'graft:Spewing Mushroom': (e, _it, _p, me) => live(me ? e.effStats(me)[0] : undefined),
  'augment:Deathglow Strider#0': (e, _it, _p, me) => live(me ? e.effStats(me)[1] : undefined),
  'augment:Debt Plant#0': (e, it) => live(Math.floor(expended(e, it.controller) / 2)),
  'augment:Keeper of Tithes#0': (e, it) => live(expended(e, it.controller)),
  'augment:Embermaw Fledgling#0': (e, _it, _p, me) => {
    const b = e.s.battle;
    if (!b || !me) return undefined;
    return live(b.columns.flat().filter(id => e.entity(id)?.controller === me.controller).length);
  },
  'augment:Flamebreath Initiate#0': (e, it, _p, me) =>
    live(me ? e.adjacentInFormation(me.id).filter(u => u.controller === it.controller).length + 1 : undefined),
  'augment:Iyngstra#0': (e, it) => statOf(e, { unit: eventData(it)['unit'] as EntityId }, 1) === undefined
    ? undefined : live(statOf(e, { unit: eventData(it)['unit'] as EntityId }, 1)),
  'augment:Roving Quillback#0': e => live(e.s.battle ? Object.keys(e.s.battle.blocks).length : undefined),
  'spell:Accumulated Nucleation': (e, it) => live(e.affinity(it.controller, 'earth')),
  'spell:All-Consuming Blaze': (e, it) => live(e.affinity(it.controller, 'fire')),
  'spell:All-Consuming Blight': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'spell:Galactic Germination': (e, _it, p) => {
    const t = p.targets[0];
    return live(t && 'formation' in t ? e.formationUnits(t.formation).length : undefined);
  },
  'spell:Haunting Memories': (e, it) =>
    live(2 * e.seatsHere(it.region).reduce((n, s) => n + e.player(s).bin.length, 0)),
  'spell:Might of the Grove': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'graft:Might of the Grove': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'spell:Overwhelm': (e, it) => live(e.player(it.controller).hand.length),
  'graft:Overwhelm': (e, it) => live(e.player(it.controller).hand.length),
  'spell:Reap the Due': (e, it) => live(2 * e.affinity(it.controller, 'light')),
  'spell:Squish': (e, _it, p) => live(statOf(e, p.targets[0], 1)),
  'graft:Squish': (e, _it, p) => live(statOf(e, p.targets[0], 1)),
  'spell:Stellar Fission': (e, _it, p) => {
    const pw = statOf(e, p.targets[0], 0), df = statOf(e, p.targets[0], 1);
    return live(pw === undefined || df === undefined ? undefined : pw + df);
  },
  'spell:Sylvan Sprouting': (e, it) => live(e.affinity(it.controller, 'wood')),
  // the grafted Life Channel has no "gain 3 life" of its own to count
  'graft:Life Channel': (e, it) => live(e.battleCounter(it.region, `lifeGained:${it.controller}`)),
};

/**
 * The {X} of one part. In order: what the item COMMITTED (a paid X, the
 * triggering event's amount, the counters on units sacrificed as its cost),
 * then the clause's own entry above, then the card's own `xPreview` (the
 * card-level live X the hand already shows — one row, or the row the chosen
 * mode or the targeted player names).
 */
export function amountOf(item: StackItem, part: EffectPart, state: GameState): Amount | undefined {
  if (item.x !== undefined && part.effectKey === `spell:${item.card}`) return fixed(item.x);
  // CR 608.9a, report #215: the amount this part's effect declares it reads
  // off the event (EffectDef.eventAmount), not always the event's `n`.
  let def: EffectDef | undefined;
  try { def = effectByKey(part.effectKey); } catch { def = undefined; }
  const n = item.event ? eventAmountOf(def, item.event, item.sourceId) : undefined;
  const sac = part.costPaid?.sacrificedUnits;
  const fn = AMOUNT[part.effectKey];
  let e: E;
  try { e = new E(state); } catch { return undefined; }
  const me = item.sourceId !== undefined ? e.entity(item.sourceId) ?? undefined : undefined;
  if (fn) {
    try { const a = fn(e, item, part, me); if (a) return a; } catch { /* fall through */ }
  }
  if (n !== undefined) return fixed(n);
  if (sac) return fixed(sac.reduce((t, u) => t + u.counters, 0));
  if (item.x !== undefined) return fixed(item.x);
  const card = part.effectKey.slice(part.effectKey.indexOf(':') + 1).split('#')[0]!;
  try {
    const c = getCard(card);
    const rows = c.xPreviewRows?.(e, item.controller, item.region)?.filter(r => Number.isFinite(r.x));
    if (rows?.length) {
      const mode = typeof part.mode === 'string' ? part.mode.toLowerCase() : null;
      const who = part.targets.map(t => ('player' in t ? state.players[t.player]?.name.toLowerCase() : null));
      const pick = rows.length === 1 ? rows
        : rows.filter(r => r.label.toLowerCase() === mode || who.includes(r.label.toLowerCase()));
      if (pick.length === 1) return live(pick[0]!.x);
      return undefined;
    }
    const v = c.xPreview?.(e, item.controller, item.region);
    return live(typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  } catch { return undefined; }
}

/**
 * LAST KNOWN NAMES (#189, room QJAF). An erased unit leaves `state.entities`
 * outright and a negated item leaves `state.stack`, so once the thing a
 * resolving item aimed at is gone the table has no name for it and no seat —
 * and a sentence whose slot cannot be filled is dropped. Mid-Glimpse, Celestial
 * Purge's "Erase {0}. {0.controller} Glimpses 3" read "Erase (gone)." with the
 * Glimpse — the very thing being asked — missing.
 *
 * The client has SEEN the target: it was on the table one update earlier,
 * when the spell was waiting with it named. So the board remembers every unit
 * and stack item it is shown, by id (ids are never reused within a game), and
 * a target that has left is named from that memory. Only what this seat was
 * shown goes in, so nothing hidden can leak out of it. A page opened mid-
 * resolution has seen nothing and degrades to the old reading.
 */
export interface Known { name: string; seat: Seat }
export interface TableMemory {
  units: Map<EntityId, Known>;
  items: Map<number, Known>;
  /** the last state's actionCount: a smaller one is a new game or a rewind */
  actions: number;
}
export const tableMemory = (): TableMemory => ({ units: new Map(), items: new Map(), actions: -1 });

/** remember what is on the table now; a new game (or a replay stepped back)
 * starts the memory over, since its ids mean other things */
export function noteTable(m: TableMemory, state: GameState): void {
  if (state.actionCount < m.actions) { m.units.clear(); m.items.clear(); }
  m.actions = state.actionCount;
  for (const u of Object.values(state.entities)) m.units.set(u.id, { name: u.card, seat: u.controller });
  for (const it of state.resolving ? [...state.stack, state.resolving] : state.stack) {
    m.items.set(it.id, { name: it.label, seat: it.controller });
  }
}

/** what the memory knows of a unit or stack-item target; undefined for the
 * other kinds, which never leave the table (a player) or carry their own
 * name (a bin card) */
export function lastKnown(m: TableMemory | undefined, t: TargetRef): Known | undefined {
  if (!m) return undefined;
  if ('unit' in t) return m.units.get(t.unit);
  if ('stack' in t) return m.items.get(t.stack);
  return undefined;
}

/**
 * The item's line: each live part's template, filled, joined ", then " (a
 * graft resolves after its carrier, Manual p.33). Null when any live part has
 * no template — the caller keeps what it drew before, so a clause the data
 * has not caught up with degrades to the old caption, never to a hole.
 *
 * `label` names a target (main.ts: escaped, struck through when it has left);
 * `text` escapes the words between; `memory` names the seat of a target that
 * has left the table (see `TableMemory`).
 */
export function doesLine(item: StackItem, state: GameState, label: (t: TargetRef) => string,
  text: (s: string) => string = s => s, memory?: TableMemory): string | null {
  const names = state.players.map(p => p.name);
  const you = names[item.controller] ?? null;
  const opp = names.length === 2 ? names[1 - item.controller] ?? null : null;
  const src = item.sourceId !== undefined ? state.entities[item.sourceId] : undefined;
  const me = src?.card ?? item.card ?? null;
  const seatOf = (t: TargetRef | undefined): Seat | null => {
    if (!t) return null;
    if ('unit' in t) return state.entities[t.unit]?.controller ?? null;
    if ('player' in t) return t.player;
    if ('formation' in t) return t.formation;
    if ('cached' in t) return t.cached.seat;
    if ('bin' in t) return t.bin.seat;
    return state.stack.find(i => i.id === t.stack)?.controller ?? null;
  };
  // a unit or item that has left: its seat when the board last saw it
  const seatOrKnown = (t: TargetRef | undefined): Seat | null =>
    seatOf(t) ?? (t ? lastKnown(memory, t)?.seat ?? null : null);
  // each line, and whether it may be lowercased after ", then " (not when it
  // opens on a name)
  const lines: { text: string; lower: boolean }[] = [];
  for (const p of item.parts) {
    if (p.spent) continue;
    const tpl = DOES[p.effectKey];
    if (tpl === undefined) return null;
    if (tpl === '') continue;
    const ctx: SlotContext = {
      target: i => (p.targets[i] ? label(p.targets[i]!) : null),
      count: p.targets.length,
      controllerOf: i => { const s = seatOrKnown(p.targets[i]); return s === null ? null : names[s] ?? null; },
      me: me ? text(me) : null, you: you ? text(you) : null, opponent: opp ? text(opp) : null,
      amount: amountOf(item, p, state), mode: p.mode, text,
      damage: damagePricer(item, p, state, label, text),
      amounts: amountPricer(item, p, state, label, text),
    };
    // an optional target left empty, and nothing else to say: "Negate nothing"
    // (owner, 2026-09-30, on Nothyr's "up to one")
    const line = renderTemplate(tpl, ctx)
      ?? (p.targets.length ? null : renderTemplate(tpl, { ...ctx, target: () => text('nothing'), count: 1 }));
    if (line) lines.push({ text: line, lower: !/^[{<]/.test(tpl) });
  }
  if (!lines.length) return null;
  const join = (ls: typeof lines): string => ls
    .map((l, i) => (i && l.lower ? l.text[0]!.toLowerCase() + l.text.slice(1) : l.text)).join(', then ');
  return repeats(lines, join);
}

/**
 * CT-370: what the item's own damage will be when it lands, asked of the
 * engine's own pieces in `dealEffectDamageAllIn`'s order (CR 112.9) — the
 * additive amount modifiers first (`E.amountDeltaPreview`: Conduit of Pain's
 * "plus 1"), then {Powerful} (CR 802.10d, the item's attributes as
 * `E.stackItemAttrs` assembles them for resolution), then, per recipient, what
 * it RECEIVES under {Vulnerable} (CR 802.16a). {Pure} on either side of a
 * pairing switches both attribute steps off for it (CR 802.25g); it does not
 * touch an amount modifier, which is not an attribute.
 *
 * A sentence naming its recipients is priced for each of them: one number when
 * they agree, else the number a plain recipient is dealt and who takes
 * otherwise. A sentence naming none ("each unit") is priced for a plain
 * recipient, with a note for the Pure or Vulnerable units on the table in the
 * item's region, which take otherwise if they are hit.
 *
 * CT-412: damage to a player is then a life loss, priced again on its way to
 * the total (`E.amountPreview` lifeLoss — Arbiter of Vitality doubles it), and
 * said as the life it costs ("6 life lost, Arbiter of Vitality") — for a
 * named player, and for the players a sentence names by word.
 *
 * NOT priced, and said nowhere on the line: prevention (`preventUnitDamage`
 * shields), {Piercing} or {Electric} overflow (elective, and distributed at
 * resolution), and Channel Through's split points (each point is a dealing the
 * controller places at resolution, so the Conduit's +1 per point is not said).
 * Undefined when the engine cannot read the state.
 */
export function damagePricer(item: StackItem, part: EffectPart, state: GameState,
  label: (t: TargetRef) => string, text: (s: string) => string = s => s): DamagePricer | undefined {
  let e: E;
  let attrs: Set<string>;
  try { e = new E(state); attrs = e.stackItemAttrs(item, part); } catch { return undefined; }
  const srcPure = attrs.has('Pure'), srcPowerful = attrs.has('Powerful');
  const sourceName = item.card ?? item.label;
  type Recipient = { unit?: Entity; player?: Seat };
  const one = (r: Recipient, n: number): Priced => {
    if (n <= 0) return { n, why: [] };
    let d = { delta: 0, by: [] as string[] };
    try {
      d = e.amountDeltaPreview({
        kind: 'effectDamage', region: item.region, amount: n,
        ...(r.unit ? { unit: r.unit } : r.player !== undefined ? { player: r.player } : {}),
        sourceSeat: item.controller, sourceName, combat: false,
      });
    } catch { /* an unreadable board adds nothing */ }
    let k = n + d.delta;
    if (k <= 0) return { n: 0, why: [] };
    const pure = srcPure || (!!r.unit && e.effAttrs(r.unit).has('Pure'));
    const why: string[] = [];
    if (!pure && srcPowerful) { k *= 2; why.push('Powerful'); }
    if (d.delta) why.push(text(`${d.delta > 0 ? '+' : ''}${d.delta} ${d.by.join(', ')}`.trim()));
    if (!pure && r.unit && e.effAttrs(r.unit).has('Vulnerable')) { k *= 2; why.push('Vulnerable'); }
    // CT-412: damage to a player is a life loss, priced again on its way to
    // the total (E.lifeAmount: Arbiter of Vitality doubles it)
    if (r.player !== undefined) why.push(...lossNote([r.player], k));
    // CT-412: a shield on the recipient prevents all of it (preventUnitDamage)
    const shield = r.unit ? e.preventedBy(r.unit, k) : null;
    if (shield) return { n: k, why: [...why, text(`prevented by ${shield}`)], none: text(shield) };
    return { n: k, why };
  };
  /** what `k` damage to `seats` takes off their life, when that is not `k`:
   * "6 life lost", "6 life lost each", or per player when they differ */
  const lossNote = (seats: Seat[], k: number): string[] => {
    const ls = seats.map(s => ({ s, l: e.amountPreview({ kind: 'lifeLoss', seat: s, n: k }) }));
    const odd = ls.filter(x => x.l.n !== k);
    if (!odd.length) return [];
    const by = [...new Set(odd.flatMap(x => x.l.by))].join(', ');
    if (odd.length === ls.length && ls.every(x => x.l.n === ls[0]!.l.n)) {
      return [text(`${ls[0]!.l.n} life lost${ls.length > 1 ? ' each' : ''}`), text(by)];
    }
    return [...odd.map(x => text(`${state.players[x.s]?.name ?? 'a player'} loses ${x.l.n} life`)), text(by)];
  };
  const recipientOf = (t: TargetRef | undefined): Recipient | null => {
    if (!t) return null;
    if ('player' in t) return { player: t.player };
    if ('unit' in t) { const u = e.entity(t.unit); return u ? { unit: u } : null; }
    return null;
  };
  // a board the engine cannot read (a hand-built test state) prices nothing
  return (n, named, unitsHit = false, players = null) => {
    try { return priced(n, named, unitsHit, players); } catch { return { n, why: [] }; }
  };
  function priced(n: number, named: number[] | null, unitsHit: boolean, players: PlayerGroup | null): Priced {
    const plain = one({}, n);
    if (named) {
      const each = named.flatMap(i => {
        const r = recipientOf(part.targets[i]);
        return r ? [{ t: part.targets[i]!, p: one(r, n) }] : [];
      });
      if (!each.length) return plain;
      const same = (a: Priced, b: Priced): boolean => a.n === b.n && a.none === b.none;
      if (each.every(x => same(x.p, each[0]!.p))) return each[0]!.p;
      const base = each.find(x => same(x.p, plain)) ? plain : each[0]!.p;
      return {
        n: base.n,
        why: [...base.why, ...each.filter(x => !same(x.p, base)).map(x => (x.p.none
          ? `${label(x.t)} takes none, prevented by ${x.p.none}` : `${label(x.t)} takes ${x.p.n}`))],
      };
    }
    // nobody named: the units on the table that would take otherwise, by kind
    const notes = new Set<string>();
    for (const u of unitsHit ? e.unitsIn(item.region) : []) {
      const p = one({ unit: u }, n);
      if (p.none) { notes.add(`${label({ unit: u.id })} takes none, prevented by ${p.none}`); continue; }
      if (p.n === plain.n) continue;
      const kind = srcPure || e.effAttrs(u).has('Pure') ? 'Pure' : 'Vulnerable';
      notes.add(`${kind} units take ${p.n}`);
    }
    // CT-412: the players it names by word ("each player", {opponent})
    if (players) {
      const seats = playerGroup(state, item.controller, players);
      for (const w of lossNote(seats, one({ player: seats[0] }, n).n)) notes.add(w);
    }
    return { n: plain.n, why: [...plain.why, ...notes] };
  }
}

/** CT-412: the seats a player group names, for the item's controller */
function playerGroup(state: GameState, controller: Seat, g: PlayerGroup): Seat[] {
  const all = state.players.map((_, i) => i as Seat);
  return g === 'you' ? [controller] : g === 'each' ? all : all.filter(s => s !== controller);
}

/**
 * CT-412: what a life, rot, debt or counter amount of the item will be when it
 * lands, asked of the engine (`E.amountPreview`: the same amount layer
 * `lifeAmount`, `gainRot`/`gainDebt` and `addCounters` commit with — Arbiter
 * of Vitality's doubling, Flux Resonator's and Proliferating Slime's "plus
 * one"). Each recipient is asked; when they agree the line says that number,
 * else the number a plain recipient gets and who gets otherwise.
 *
 * Counters are put by the item's controller (CR 708.8b: the resolving part's
 * controller). A group ("each of your units", "each enemy", "each unit") is
 * read as the units of that side in the item's region, as damagePricer reads
 * "each unit".
 *
 * NOT priced (CT-412's sweep): a redirect of counters (Counter Thief,
 * `replaceCounters`), prevention, {Piercing}/{Electric} overflow, and a clause
 * whose verb is inside a mode slot. Undefined when the engine cannot read the
 * state.
 */
export function amountPricer(item: StackItem, part: EffectPart, state: GameState,
  label: (t: TargetRef) => string, text: (s: string) => string = s => s): AmountPricer | undefined {
  let e: E;
  try { e = new E(state); } catch { return undefined; }
  const nameOf = (s: Seat): string => text(state.players[s]?.name ?? 'a player');
  const seatOfTarget = (t: TargetRef | undefined): Seat | null => {
    if (!t) return null;
    if ('player' in t) return t.player;
    if ('unit' in t) return state.entities[t.unit]?.controller ?? null;
    return null;
  };
  const seatsOf = (who: Who): Seat[] => {
    if (!('players' in who)) return [];
    if (who.players === 'controllerOf') { const s = seatOfTarget(part.targets[who.idx]); return s === null ? [] : [s]; }
    if (who.players === 'slot') {
      const ts = who.on ? part.targets.slice(who.idx) : [part.targets[who.idx]];
      return [...new Set(ts.map(seatOfTarget).filter((s): s is Seat => s !== null))];
    }
    return playerGroup(state, item.controller, who.players);
  };
  const unitsOf = (who: Who): Entity[] => {
    if (!('units' in who)) return [];
    if (who.units === 'me') {
      const u = item.sourceId !== undefined ? e.entity(item.sourceId) : undefined;
      return u ? [u] : [];
    }
    if (who.units === 'slot') {
      const t = part.targets[who.idx];
      const u = t && 'unit' in t ? e.entity(t.unit) : undefined;
      return u ? [u] : [];
    }
    return e.unitsIn(item.region).filter(u => who.units === 'each'
      || (who.units === 'yours') === (u.controller === item.controller));
  };
  const verb = (kind: AmountKind): string =>
    kind === 'counters' ? 'gets' : kind === 'lifeLoss' ? 'loses' : 'gains';
  // the reason, in the damage line's words: "+1 Flux Resonator", "Arbiter of Vitality"
  const reason = (kind: AmountKind, n: number, out: { n: number; by: string[] }): string => {
    const d = Math.abs(out.n) - Math.abs(n);
    const add = kind !== 'lifeGain' && kind !== 'lifeLoss';
    return text(add ? `${d > 0 ? '+' : ''}${d} ${out.by.join(', ')}` : out.by.join(', '));
  };
  function priced(kind: AmountKind, n: number, who: Who): Priced {
    const size = Math.abs(n);
    const each: { name: string; mine: boolean; n: number; why: string }[] = [];
    if ('units' in who) {
      for (const u of unitsOf(who)) {
        const out = e.amountPreview({ kind: 'counters', unit: u, n, by: item.controller });
        each.push({ name: label({ unit: u.id }), mine: u.controller === item.controller, n: Math.abs(out.n),
          why: out.n === n ? '' : reason(kind, n, out) });
      }
    } else {
      for (const s of seatsOf(who)) {
        const out = e.amountPreview({ kind: kind as Exclude<AmountKind, 'counters'>, seat: s, n: size });
        each.push({ name: nameOf(s), mine: s === item.controller, n: out.n, why: out.n === size ? '' : reason(kind, size, out) });
      }
    }
    if (!each.length) return { n: size, why: [] };
    const whys = [...new Set(each.map(x => x.why).filter(Boolean))];
    if (each.every(x => x.n === each[0]!.n)) return { n: each[0]!.n, why: whys };
    // they differ: the number a plain recipient gets, and who gets otherwise
    const base = each.some(x => x.n === size) ? size : each[0]!.n;
    const odd = each.filter(x => x.n !== base);
    const groupWord = 'units' in who && odd.length > 3
      ? (odd.every(x => !x.mine) ? 'enemy units' : odd.every(x => x.mine) ? 'your units' : null) : null;
    const notes = groupWord
      ? [...new Set(odd.map(x => `${groupWord} get ${x.n}`))]
      : odd.map(x => `${x.name} ${verb(kind)} ${x.n}`);
    return { n: base, why: [...notes, ...whys] };
  }
  return (kind, n, who) => {
    try { return priced(kind, n, who); } catch { return { n: Math.abs(n), why: [] }; }
  };
}

const TIMES = ['', '', 'twice', 'three times', 'four times'];
/**
 * A graft MULTIPLIER (Lost Guardian's two [Switch1], Amphivore's three —
 * `graftCopies`) puts every other graft on the item again, top to bottom and
 * then again (A, B, A, B: engine composeParts). When the copies read the same
 * — the same targets — say the run once and how many times.
 */
function repeats<L extends { text: string }>(lines: L[], join: (ls: L[]) => string): string {
  for (let period = 1; period <= lines.length / 2; period++) {
    if (lines.length % period) continue;
    const k = lines.length / period;
    if (lines.every((l, i) => l.text === lines[i % period]!.text)) {
      return `${join(lines.slice(0, period))} (${TIMES[k] ?? `${k} times`})`;
    }
  }
  return join(lines);
}
