/* THE JUDGE BOT'S ENGINE CALCULATOR — /api/bot/simulate.
 *
 * The owner, 2026-11-01: "let the system do some sort of calculation in the
 * engine, using tools, rather than try to force it to think." The judge bot
 * (bot/, Python) fills a small JSON board-and-script, this module builds that
 * board on a real engine game, plays the script through the real `apply`, and
 * hands back what the CLIENT does. It is a pure function of (spec, engine):
 * no room, no reserved code, no var/ file, no journal line. It runs only in
 * simulate-worker.ts, never on the main thread.
 *
 * ⚠ WHAT THE ANSWER IS. "In the online client, X happens" — never "the rules
 * say X". Where a CR record says engineDiffers, the engine is the side that is
 * wrong; the bot's prompt (bot/core.py) carries that rule, this file only
 * carries the engine.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE CONTRACT — FROZEN 2026-11-01. bot/gameserver.py codes against this.
 *  Change it only additively, and say so here with a date.
 * ════════════════════════════════════════════════════════════════════════
 *
 *  POST /api/bot/simulate   header X-Algo-Bot: <ALGO_BOT_TOKEN>
 *    Direct loopback only, no X-Forwarded-For (Caddy always adds one), else
 *    404 like every bot route. Body ≤ 16 KB (413 over it, 400 unparseable).
 *    Every other failure is HTTP 200 with { ok:false, error, … }.
 *
 *  REQUEST — strict: an unknown key anywhere is refused by name.
 *  {
 *    "id":       "s1",                 // optional, [a-z0-9]{1,8}, echoed
 *    "you":      SIDE,                 // seat 0
 *    "opponent": SIDE,                 // seat 1
 *    "initiative": "you"|"opponent",   // default "you"; round-1 attacker
 *    "start":    "deployment"|"battle",// default: "battle" if `attack`, else "deployment"
 *    "attack":   [["you.0","you.1"]],  // start=battle: columns, front first, of the
 *                                      //   INITIATIVE side's units; [] = attack with nobody
 *    "blocks":   {"opponent.0":"you.0"},// blocker → an attacker in the column it blocks;
 *                                      //   several blockers on one column stack front→back
 *                                      //   in listed order. Default: no blocks.
 *    "steps":    [STEP…],              // ≤ 30
 *    "until":    "stackEmpty"|"endOfCombat"|"regroup"|"endOfTurn",  // default stackEmpty
 *    "showOffered": true               // default false: return every menu that opened
 *  }
 *  SIDE = { "hand":[card…≤10], "play":[UNIT…≤12], "resources":{fire:3,…} (all open;
 *           fire water earth wood metal light dark prismite shard; ≤20 each, ≤40 total),
 *           "life":30 (1–999), "bin":[card…≤10], "deckTop":[card…≤10] (top first) }
 *  UNIT = "Card Name"  or
 *         { "card":"Towering Colossus", "token":false, "counters":0 (−20..20, net +1/+1),
 *           "damage":0 (0..99), "mods":[{"card":"Lithoghul","as":"augment"|"graft"}] (≤4),
 *           "temp":{"power":0,"toughness":0,"attrs":["Balanced","Inverted"]} }
 *         `temp` and `damage` are applied AT THE START POSITION (the attack
 *         declaration, or deployment — a deployment start walks through a regroup,
 *         which would wipe them). `temp` is "until regroup", applied in the object's
 *         own key order (so its timestamps follow that order), units in `play` order.
 *  REF  = "you.0" (index into that side's `play`, stable even after it dies;
 *         a unit that was not on the built board reads "you+0", "you+1"… in
 *         answers — menus tag every option that names a unit or stack item)
 *       | "you:Card Name" (the one unit of that name that side controls now)
 *       | "you" | "opponent" (a player)       — as a target only
 *       | "stack.0" (bottom first) | "stack:Card Name" (topmost) — targets / hosts
 *  STEP = { "seat":"you"|"opponent", "do": … } where `seat` defaults to "you" for
 *         play/augment/graft/activate/pass, and to whoever is asked for choose/assign:
 *    {"do":"play","card":C,"targets":[REF…≤6],"x":N?,"mode":"ambush"|"discardMe"?}
 *    {"do":"augment","card":C,"host":REF}     {"do":"graft","card":C,"host":REF,"position":N?}
 *    {"do":"activate","unit":REF,"ability":N,"targets":[…]?,"x":N?}
 *    {"do":"pass"}            pass priority (or, outside a window, the passive "done"). The
 *                             other seat passes first if it holds priority, so a bare
 *                             "pass" by you lets the top of the stack resolve.
 *    {"do":"choose","option":"<label substring>"}   a number for a type-a-number question.
 *                             Waits (everyone passing) while something is on the stack,
 *                             for the first question put to `seat` (or to anyone); refused
 *                             once the stack is empty with no question open.
 *    {"do":"assign","to":{"opponent.0":5}}          combat-damage split, per victim; waits
 *                             through the battle round for the split question. A victim
 *                             not in `to` takes the engine's default (listed under auto).
 *    {"do":"advance"}         everyone plays the silent defaults to the next step/phase
 *
 *  SILENT DEFAULTS, whenever the script does not say: the seat that must act
 *  plays scenarios.ts `passiveMove` (pass, no blocks, attack with nobody,
 *  done); a question nobody scripted takes option 0 (a number question: its
 *  minimum), and every such answer is listed under `auto`. A step waits by
 *  letting the OTHER seat play its defaults; when its own seat must act and
 *  the action is illegal, the step is REFUSED with the engine's own reason and
 *  the run stops there (later steps and `until` do not run).
 *
 *  RESPONSE (≤ 6 KB, HTTP 200)
 *  { ok:true, engine:"<sha>", id:"s1",
 *    board:"…one line per side, as built…",
 *    patched:["opponent.0 Static Courier: Balanced, Inverted until regroup — directly, not by a card", …],
 *    steps:[{i, ok:true, did:"you play Luminous Arc → Towering Colossus"},
 *           {i, ok:false, refused:"<engine message>", legal:["≤8 summarised"], options?:[…]}],
 *    offered:[{at:"step 3", seat, kind, prompt, options:[labels ≤12]}],   // showOffered only
 *    log:["≤60 lines, seat 0's redacted log from the walk on"],
 *    final:{ phase, life:{you,opponent}, mana:{you:"6 open → 3 open",…},
 *            units:[{ref, card, stats:"3/1", printed:"3/2", damage, counters, attrs, mods?, zone}],
 *            stack:[…], hands:{…}, bins:{…}, pending:"<open question / who holds priority>"|null },
 *    auto:["opponent passed ×3", "decision 'order triggers' (you): option 0 — …"],
 *    limit:null | "<why the run stopped early>", truncated?:true }
 *    (hands/bins fold repeats: "Luminous Arc ×2". A truncated answer trims the log,
 *    menus and board line first, then leaves out unit fields that say nothing —
 *    zero damage/counters, no attrs, printed = stats, zone "play".)
 *  { ok:false, error:"…", errors?:[{at, error, didYouMean?:[≤3]}], busy?:true, limit?:"time" }
 *    — a bad spec (every problem named), a board that cannot be built or reach
 *    `start` (e.g. "the attack was refused: …"), busy, or the worker's wall clock.
 *
 *  LIMITS: ≤ 400 engine actions per run including every auto-pass; 2 s wall
 *  clock (simulate-worker.ts kills and replaces the worker past it; this file
 *  stops itself a little earlier and returns what it has); ≤ 4 queued, then busy.
 *
 *  CANNOT MODEL (the bot's tool description says so): the rules as written
 *  (this is what the client does); hidden information and real opponent
 *  choices beyond the script and the passive defaults; more than 2 seats, and
 *  the draft; random deck contents beyond `deckTop` (the rest is filler);
 *  the UI (screens, controls, auto-pass pacing — Annex D lives in ui/ and
 *  server/); tabletop conventions; cards the card ledger lists as broken;
 *  history (today's engine only). Also: units start in play without having
 *  been played (no "when played" history, no spawn-time choices), resources
 *  are all open, and the game is turn 1 of a constructed game whose decks are
 *  30 × Tidal Menace (a vanilla unit) under `deckTop`.
 * ════════════════════════════════════════════════════════════════════════
 */
import type {
  Action, Attr, CardName, Decision, EngineEvent, Entity, EntityId, GameState, ResourceKind, Seat,
} from '../engine/src/types.ts';
import { apply, createGame, IllegalAction, legalActions } from '../engine/src/apply.ts';
import { E, Suspended } from '../engine/src/engine.ts';
import { allCardNames, canonicalCardName, getCard } from '../engine/src/cards/dsl.ts';
import { closeHasteStep, patchSide, type BoardSide } from './board.ts';
import { passiveMove } from './scenarios.ts';
import { redactLog } from './view.ts';

// ── limits ─────────────────────────────────────────────────────────────

export const LIMITS = {
  bodyBytes: 16 * 1024,
  hand: 10, play: 12, bin: 10, deckTop: 10, mods: 4, attrs: 8,
  resEach: 20, resTotal: 40, steps: 30, targets: 6, attackUnits: 12,
  actions: 400,
  /** the worker's hard wall clock; the run stops itself at `selfStopMs` */
  wallMs: 2000, selfStopMs: 1600,
  outBytes: 6 * 1024, logLines: 60, legal: 8, offeredOptions: 12,
} as const;

/** the fixed seed: a simulation is a pure function of its spec */
const SEED = 20261101;
/** the decks only matter past `deckTop`. Thirty of the pool's one vanilla
 * unit (no text, no attributes) — a single-card deck, the one shape besides a
 * real decklist that a constructed deal accepts. (The challenge filler,
 * Training Construct, is lesson-only and refused here.) Two of them make the
 * game a Single Card Duel (CR D8.2), which changes only the draw step. */
const FILLER: CardName[] = Array.from({ length: 30 }, () => 'Tidal Menace');
const NAMES: [string, string] = ['You', 'Opponent'];
const SIDES = ['you', 'opponent'] as const;
type Side = typeof SIDES[number];
const seatOf = (s: Side): Seat => (s === 'you' ? 0 : 1);
const sideOf = (s: Seat): Side => SIDES[s]!;

const RESOURCE_KINDS: readonly ResourceKind[] =
  ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark', 'prismite', 'shard'];
/** every attribute the engine knows (types.ts `Attr`) — `satisfies` makes a
 * misspelling here a type error; a NEW attribute is simply refused until it
 * is added, which is the safe direction */
const ATTRS = [
  'Flying', 'Deadly', 'Swift', 'Sluggish', 'Tough', 'Balanced', 'Inverted', 'Unaware', 'Powerful',
  'Vulnerable', 'Feeble', 'Evasive', 'Sneaky', 'Alluring', 'Piercing', 'Electric', 'Poisonous',
  'Resonant', 'Thieving', 'Reaping', 'Blessed', 'Afflicting', 'Lethal', 'Pure', 'Modular',
] as const satisfies readonly Attr[];
const UNTIL = ['stackEmpty', 'endOfCombat', 'regroup', 'endOfTurn'] as const;
type Until = typeof UNTIL[number];
const DOS = ['play', 'augment', 'graft', 'activate', 'pass', 'choose', 'assign', 'advance'] as const;
type Do = typeof DOS[number];

// ── the normalised spec ────────────────────────────────────────────────

type TempOp = { power: number; toughness: number } | { attr: Attr };
interface NUnit {
  card: CardName; token: boolean; counters: number; damage: number;
  mods: { card: CardName; as: 'augment' | 'graft' }[]; temp: TempOp[];
}
interface NSide {
  hand: CardName[]; play: NUnit[]; resources: Partial<Record<ResourceKind, number>>;
  life: number | null; bin: CardName[]; deckTop: CardName[];
}
interface NStep {
  i: number; seat: Seat | null; do: Do;
  card?: CardName; targets?: string[]; x?: number; mode?: 'ambush' | 'discardMe';
  host?: string; position?: number; unit?: string; ability?: number;
  option?: string; to?: [string, number][];
}
export interface NSpec {
  id: string; you: NSide; opponent: NSide; initiative: Seat; start: 'deployment' | 'battle';
  attack: string[][]; blocks: [string, string][]; steps: NStep[]; until: Until; showOffered: boolean;
}

// ── output types ───────────────────────────────────────────────────────

export interface StepOut {
  i: number; ok: boolean; did?: string; refused?: string; legal?: string[]; options?: string[];
}
export interface OfferedOut { at: string; seat: Side; kind: string; prompt: string; options: string[] }
export interface UnitOut {
  ref: string; card: CardName; stats: string; printed: string; damage: number; counters: number;
  attrs: string[]; mods?: string[]; zone: string;
}
export interface SimOk {
  ok: true; engine: string; id: string; board: string; patched: string[]; steps: StepOut[];
  offered: OfferedOut[]; log: string[];
  final: {
    phase: string; life: Record<Side, number>; mana: Record<Side, string>; units: UnitOut[];
    stack: string[]; hands: Record<Side, string[]>; bins: Record<Side, string[]>; pending: string | null;
  };
  auto: string[]; limit: string | null; truncated?: true;
}
export interface SpecError { at: string; error: string; didYouMean?: string[] }
export interface SimFail {
  ok: false; error: string; errors?: SpecError[]; id?: string; busy?: true; limit?: string;
}
export type SimResult = SimOk | SimFail;

// ── card names ─────────────────────────────────────────────────────────

let lowerIndex: Map<string, CardName> | null = null;
const squash = (s: string): string =>
  s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function index(): Map<string, CardName> {
  if (!lowerIndex) {
    lowerIndex = new Map();
    for (const n of allCardNames()) lowerIndex.set(squash(n), n);
  }
  return lowerIndex;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The registered card a name means: exact, alias, or the same letters in any
 * case/punctuation. Otherwise up to three "did you mean" names — substring
 * hits first, then the nearest spellings. */
export function resolveCard(raw: string): { name: CardName } | { didYouMean: string[] } {
  const canon = canonicalCardName(raw);
  try { getCard(canon); if (allCardNames().includes(canon)) return { name: canon }; } catch { /* fall through */ }
  const key = squash(raw);
  const hit = index().get(key);
  if (hit) return { name: hit };
  const scored: [number, CardName][] = [];
  for (const [k, n] of index()) {
    const sub = key.length >= 3 && (k.includes(key) || key.includes(k)) ? -100 : 0;
    scored.push([sub + editDistance(key, k), n]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  const cap = Math.max(3, Math.floor(key.length / 3));
  return { didYouMean: scored.filter(([d]) => d <= cap).slice(0, 3).map(([, n]) => n) };
}

// ── validation ─────────────────────────────────────────────────────────

class Bad {
  errs: SpecError[] = [];
  add(at: string, error: string, didYouMean?: string[]): void {
    if (this.errs.length < 20) this.errs.push({ at, error, ...(didYouMean ? { didYouMean } : {}) });
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function keysOnly(bad: Bad, at: string, o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) bad.add(`${at}.${k}`, `unknown key "${k}" (allowed: ${allowed.join(', ')})`);
  }
}

function int(bad: Bad, at: string, v: unknown, lo: number, hi: number, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
    bad.add(at, `must be a whole number from ${lo} to ${hi}`);
    return dflt;
  }
  return v;
}

function card(bad: Bad, at: string, v: unknown): CardName | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 80) { bad.add(at, 'must be a card name'); return null; }
  const r = resolveCard(v.trim());
  if ('name' in r) return r.name;
  bad.add(at, `unknown card "${v}"`, r.didYouMean);
  return null;
}

function cards(bad: Bad, at: string, v: unknown, max: number): CardName[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { bad.add(at, 'must be a list of card names'); return []; }
  if (v.length > max) { bad.add(at, `at most ${max} cards`); return []; }
  return v.map((c, i) => card(bad, `${at}[${i}]`, c)).filter((c): c is CardName => c !== null);
}

const REF_RE = /^(you|opponent)(?:\.(\d{1,2})|:(.{1,80}))$|^(you|opponent)$|^stack(?:\.(\d{1,2})|:(.{1,80}))$/;

function ref(bad: Bad, at: string, v: unknown, spec: { you: NSide; opponent: NSide } | null,
  kinds: { unit?: boolean; player?: boolean; stack?: boolean }): string | null {
  if (typeof v !== 'string') { bad.add(at, 'must be a reference like "you.0", "opponent:Card Name" or "stack:Card Name"'); return null; }
  const m = REF_RE.exec(v.trim());
  if (!m) { bad.add(at, `"${v}" is not a reference (use "you.0", "opponent:Card Name", "you", "stack.0" or "stack:Card Name")`); return null; }
  if (m[4]) {
    if (!kinds.player) { bad.add(at, `"${v}" names a player; a unit is needed here`); return null; }
    return m[4];
  }
  if (m[5] !== undefined || m[6] !== undefined) {
    if (!kinds.stack) { bad.add(at, `"${v}" names a stack item; a unit is needed here`); return null; }
    if (m[6] !== undefined) { const c = card(bad, at, m[6]); return c ? `stack:${c}` : null; }
    return `stack.${Number(m[5])}`;
  }
  if (!kinds.unit) { bad.add(at, `"${v}" names a unit; that is not allowed here`); return null; }
  const side = m[1] as Side;
  if (m[2] !== undefined) {
    const n = Number(m[2]);
    if (spec && n >= spec[side].play.length) {
      bad.add(at, `"${v}": ${side} has only ${spec[side].play.length} unit(s) in play (refs count from 0)`);
      return null;
    }
    return `${side}.${n}`;
  }
  const c = card(bad, at, m[3]);
  return c ? `${side}:${c}` : null;
}

function unit(bad: Bad, at: string, v: unknown): NUnit | null {
  if (typeof v === 'string') v = { card: v };
  if (!isObj(v)) { bad.add(at, 'must be a card name or {card, …}'); return null; }
  keysOnly(bad, at, v, ['card', 'token', 'counters', 'damage', 'mods', 'temp']);
  const c = card(bad, `${at}.card`, v['card']);
  if (c) {
    const k = getCard(c).kind;
    if (k !== 'unit' && k !== 'spellUnit') bad.add(`${at}.card`, `${c} is a ${k}, not a unit — only units stand in play`);
  }
  if (v['token'] !== undefined && typeof v['token'] !== 'boolean') bad.add(`${at}.token`, 'must be true or false');
  const mods: NUnit['mods'] = [];
  if (v['mods'] !== undefined) {
    if (!Array.isArray(v['mods']) || v['mods'].length > LIMITS.mods) bad.add(`${at}.mods`, `must be a list of at most ${LIMITS.mods} {card, as}`);
    else v['mods'].forEach((m, i) => {
      const mat = `${at}.mods[${i}]`;
      if (!isObj(m)) { bad.add(mat, 'must be {card, as}'); return; }
      keysOnly(bad, mat, m, ['card', 'as']);
      const mc = card(bad, `${mat}.card`, m['card']);
      if (m['as'] !== 'augment' && m['as'] !== 'graft') bad.add(`${mat}.as`, 'must be "augment" or "graft"');
      else if (mc) mods.push({ card: mc, as: m['as'] });
    });
  }
  const temp: TempOp[] = [];
  if (v['temp'] !== undefined) {
    const t = v['temp'];
    if (!isObj(t)) bad.add(`${at}.temp`, 'must be {power, toughness, attrs}');
    else {
      keysOnly(bad, `${at}.temp`, t, ['power', 'toughness', 'attrs']);
      let ptDone = false;
      for (const k of Object.keys(t)) {   // the object's own key order is the timestamp order
        if ((k === 'power' || k === 'toughness') && !ptDone) {
          ptDone = true;
          temp.push({
            power: int(bad, `${at}.temp.power`, t['power'], -30, 30, 0),
            toughness: int(bad, `${at}.temp.toughness`, t['toughness'], -30, 30, 0),
          });
        } else if (k === 'attrs') {
          const a = t['attrs'];
          if (!Array.isArray(a) || a.length > LIMITS.attrs) { bad.add(`${at}.temp.attrs`, `must be a list of at most ${LIMITS.attrs} attributes`); continue; }
          a.forEach((x, i) => {
            const hit = typeof x === 'string' ? ATTRS.find(n => n.toLowerCase() === x.trim().replace(/[{}]/g, '').toLowerCase()) : undefined;
            if (!hit) bad.add(`${at}.temp.attrs[${i}]`, `unknown attribute ${JSON.stringify(x)} (known: ${ATTRS.join(', ')})`);
            else temp.push({ attr: hit });
          });
        }
      }
    }
  }
  if (!c) return null;
  return {
    card: c, token: v['token'] === true,
    counters: int(bad, `${at}.counters`, v['counters'], -20, 20, 0),
    damage: int(bad, `${at}.damage`, v['damage'], 0, 99, 0),
    mods, temp,
  };
}

function side(bad: Bad, at: string, v: unknown): NSide {
  const out: NSide = { hand: [], play: [], resources: {}, life: null, bin: [], deckTop: [] };
  if (v === undefined) return out;
  if (!isObj(v)) { bad.add(at, 'must be {hand, play, resources, life, bin, deckTop}'); return out; }
  keysOnly(bad, at, v, ['hand', 'play', 'resources', 'life', 'bin', 'deckTop']);
  out.hand = cards(bad, `${at}.hand`, v['hand'], LIMITS.hand);
  out.bin = cards(bad, `${at}.bin`, v['bin'], LIMITS.bin);
  out.deckTop = cards(bad, `${at}.deckTop`, v['deckTop'], LIMITS.deckTop);
  if (v['play'] !== undefined) {
    if (!Array.isArray(v['play']) || v['play'].length > LIMITS.play) bad.add(`${at}.play`, `must be a list of at most ${LIMITS.play} units`);
    else v['play'].forEach((u, i) => { const n = unit(bad, `${at}.play[${i}]`, u); if (n) out.play.push(n); else out.play.push(null as unknown as NUnit); });
  }
  if (v['resources'] !== undefined) {
    const r = v['resources'];
    if (!isObj(r)) bad.add(`${at}.resources`, 'must be like {"fire":3,"earth":2}');
    else {
      let total = 0;
      for (const [k, n] of Object.entries(r)) {
        if (!(RESOURCE_KINDS as readonly string[]).includes(k)) { bad.add(`${at}.resources.${k}`, `unknown resource "${k}" (known: ${RESOURCE_KINDS.join(', ')})`); continue; }
        const c = int(bad, `${at}.resources.${k}`, n, 0, LIMITS.resEach, 0);
        total += c;
        if (c) out.resources[k as ResourceKind] = c;
      }
      if (total > LIMITS.resTotal) bad.add(`${at}.resources`, `at most ${LIMITS.resTotal} resources in all`);
    }
  }
  if (v['life'] !== undefined) out.life = int(bad, `${at}.life`, v['life'], 1, 999, 30);
  return out;
}

function seatField(bad: Bad, at: string, v: unknown): Seat | null {
  if (v === undefined) return null;
  if (v !== 'you' && v !== 'opponent') { bad.add(at, 'must be "you" or "opponent"'); return null; }
  return seatOf(v);
}

const STEP_KEYS: Record<Do, readonly string[]> = {
  play: ['card', 'targets', 'x', 'mode'],
  augment: ['card', 'host'],
  graft: ['card', 'host', 'position'],
  activate: ['unit', 'ability', 'targets', 'x'],
  pass: [], choose: ['option'], assign: ['to'], advance: [],
};

function step(bad: Bad, i: number, v: unknown, sides: { you: NSide; opponent: NSide }): NStep | null {
  const at = `steps[${i}]`;
  if (!isObj(v)) { bad.add(at, 'must be {seat?, do, …}'); return null; }
  const d = v['do'];
  if (typeof d !== 'string' || !(DOS as readonly string[]).includes(d)) {
    bad.add(`${at}.do`, `must be one of ${DOS.join(', ')}`);
    return null;
  }
  const kind = d as Do;
  keysOnly(bad, at, v, ['seat', 'do', ...STEP_KEYS[kind]]);
  const s: NStep = { i, seat: seatField(bad, `${at}.seat`, v['seat']), do: kind };
  if (kind === 'play' || kind === 'augment' || kind === 'graft') {
    const c = card(bad, `${at}.card`, v['card']);
    if (c) s.card = c;
  }
  if (kind === 'play' || kind === 'activate') {
    if (v['targets'] !== undefined) {
      if (!Array.isArray(v['targets']) || v['targets'].length > LIMITS.targets) bad.add(`${at}.targets`, `must be a list of at most ${LIMITS.targets} references`);
      else s.targets = v['targets'].map((t, j) => ref(bad, `${at}.targets[${j}]`, t, sides, { unit: true, player: true, stack: true }))
        .filter((t): t is string => t !== null);
    }
    if (v['x'] !== undefined) s.x = int(bad, `${at}.x`, v['x'], 0, 30, 0);
  }
  if (kind === 'play' && v['mode'] !== undefined) {
    if (v['mode'] !== 'ambush' && v['mode'] !== 'discardMe') bad.add(`${at}.mode`, 'must be "ambush" or "discardMe"');
    else s.mode = v['mode'];
  }
  if (kind === 'augment' || kind === 'graft') {
    const h = ref(bad, `${at}.host`, v['host'], sides, { unit: true, stack: kind === 'augment' });
    if (h) s.host = h;
  }
  if (kind === 'graft' && v['position'] !== undefined) s.position = int(bad, `${at}.position`, v['position'], 0, 8, 0);
  if (kind === 'activate') {
    const u = ref(bad, `${at}.unit`, v['unit'], sides, { unit: true });
    if (u) s.unit = u;
    s.ability = int(bad, `${at}.ability`, v['ability'], 0, 9, 0);
  }
  if (kind === 'choose') {
    const o = v['option'];
    if (typeof o === 'number' && Number.isInteger(o)) s.option = String(o);
    else if (typeof o !== 'string' || !o.trim() || o.length > 120) bad.add(`${at}.option`, 'must be a piece of the option\'s label (or a number)');
    else s.option = o.trim();
  }
  if (kind === 'assign') {
    const to = v['to'];
    if (!isObj(to) || Object.keys(to).length === 0 || Object.keys(to).length > LIMITS.play) bad.add(`${at}.to`, 'must be like {"opponent.0": 5}');
    else {
      s.to = [];
      for (const [k, n] of Object.entries(to)) {
        const r = ref(bad, `${at}.to`, k, sides, { unit: true });
        const amt = int(bad, `${at}.to.${k}`, n, 0, 99, 0);
        if (r) s.to.push([r, amt]);
      }
    }
  }
  return s;
}

/** Strict validation. Unknown keys, unknown cards and out-of-range numbers are
 * all refused, every one by name, so the bot can fix the spec in one go. */
export function validateSpec(raw: unknown): { ok: true; spec: NSpec } | SimFail {
  const bad = new Bad();
  if (!isObj(raw)) return { ok: false, error: 'the spec must be a JSON object' };
  keysOnly(bad, 'spec', raw, ['id', 'you', 'opponent', 'initiative', 'start', 'attack', 'blocks', 'steps', 'until', 'showOffered']);
  let id = 's1';
  if (raw['id'] !== undefined) {
    if (typeof raw['id'] !== 'string' || !/^[a-z0-9]{1,8}$/.test(raw['id'])) bad.add('id', 'must be 1–8 lowercase letters or digits');
    else id = raw['id'];
  }
  const you = side(bad, 'you', raw['you']);
  const opponent = side(bad, 'opponent', raw['opponent']);
  const sides = { you, opponent };
  const initiative = seatField(bad, 'initiative', raw['initiative']) ?? 0;
  let start: NSpec['start'] = raw['attack'] !== undefined ? 'battle' : 'deployment';
  if (raw['start'] !== undefined) {
    if (raw['start'] !== 'deployment' && raw['start'] !== 'battle') bad.add('start', 'must be "deployment" or "battle"');
    else start = raw['start'];
  }
  const attack: string[][] = [];
  if (raw['attack'] !== undefined) {
    const a = raw['attack'];
    const att = sideOf(initiative);
    if (start !== 'battle') bad.add('attack', 'an attack needs "start": "battle"');
    if (!Array.isArray(a) || a.some(c => !Array.isArray(c) || c.length === 0) || a.flat().length > LIMITS.attackUnits) {
      bad.add('attack', `must be a list of columns, each a non-empty list of unit references (at most ${LIMITS.attackUnits} units)`);
    } else {
      a.forEach((col, ci) => {
        const out: string[] = [];
        (col as unknown[]).forEach((r, ri) => {
          const x = ref(bad, `attack[${ci}][${ri}]`, r, sides, { unit: true });
          if (x && !x.startsWith(att)) bad.add(`attack[${ci}][${ri}]`, `the attacker is ${att} (the initiative side); ${String(r)} is not theirs`);
          else if (x) out.push(x);
        });
        attack.push(out);
      });
    }
  }
  const blocks: [string, string][] = [];
  if (raw['blocks'] !== undefined) {
    const b = raw['blocks'];
    if (start !== 'battle') bad.add('blocks', 'blocks need "start": "battle"');
    if (!isObj(b)) bad.add('blocks', 'must be like {"opponent.0": "you.0"} (blocker → attacker)');
    else for (const [k, v] of Object.entries(b)) {
      const bl = ref(bad, 'blocks', k, sides, { unit: true });
      const at = ref(bad, `blocks.${k}`, v, sides, { unit: true });
      if (bl && at) blocks.push([bl, at]);
    }
  }
  const steps: NStep[] = [];
  if (raw['steps'] !== undefined) {
    const st = raw['steps'];
    if (!Array.isArray(st) || st.length > LIMITS.steps) bad.add('steps', `must be a list of at most ${LIMITS.steps} steps`);
    else st.forEach((s, i) => { const n = step(bad, i, s, sides); if (n) steps.push(n); });
  }
  let until: Until = 'stackEmpty';
  if (raw['until'] !== undefined) {
    if (typeof raw['until'] !== 'string' || !(UNTIL as readonly string[]).includes(raw['until'])) bad.add('until', `must be one of ${UNTIL.join(', ')}`);
    else until = raw['until'] as Until;
  }
  if (raw['showOffered'] !== undefined && typeof raw['showOffered'] !== 'boolean') bad.add('showOffered', 'must be true or false');
  if (bad.errs.length) {
    const first = bad.errs[0]!;
    return {
      ok: false, id,
      error: `${first.at}: ${first.error}${first.didYouMean?.length ? ` — did you mean ${first.didYouMean.join(', ')}?` : ''}`,
      errors: bad.errs.slice(0, 8),
    };
  }
  return { ok: true, spec: { id, you, opponent, initiative, start, attack, blocks, steps, until, showOffered: raw['showOffered'] === true } };
}

// ── the run ────────────────────────────────────────────────────────────

/** a step the engine (or the board) would not take: the run stops here */
class Refusal {
  msg: string; legal?: string[]; options?: string[];
  constructor(msg: string, extra: { legal?: string[]; options?: string[] } = {}) {
    this.msg = msg;
    if (extra.legal) this.legal = extra.legal;
    if (extra.options) this.options = extra.options;
  }
}
/** a cap was hit: the run stops and says which */
class Limit { why: string; constructor(why: string) { this.why = why; } }

const short = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clockMs = (): number => performance.now();

class Sim {
  state!: GameState;
  events: EngineEvent[] = [];
  actions = 0;
  ids: Record<Side, EntityId[]> = { you: [], opponent: [] };
  auto: string[] = [];
  offered: OfferedOut[] = [];
  seen = new Set<string>();
  at = 'setup';
  blocksUsed = false;
  readonly deadline: number;
  readonly spec: NSpec;
  constructor(spec: NSpec, budgetMs: number) {
    this.spec = spec;
    this.deadline = clockMs() + budgetMs;
  }

  // ── bookkeeping ──────────────────────────────────────────────────

  note(line: string): void {
    // consecutive repeats fold into "×n"
    const last = this.auto[this.auto.length - 1];
    const m = last ? /^(.*) ×(\d+)$/.exec(last) : null;
    if (last === line) this.auto[this.auto.length - 1] = `${line} ×2`;
    else if (m && m[1] === line) this.auto[this.auto.length - 1] = `${line} ×${Number(m[2]) + 1}`;
    else this.auto.push(line);
  }

  noteDecision(): void {
    const d = this.state.decision;
    if (!d) return;
    const key = `${d.id}:${d.prompt}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (!this.spec.showOffered) return;
    this.offered.push({ at: this.at, seat: sideOf(d.seat), kind: d.kind, prompt: short(d.prompt, 160), options: this.labels(d) });
  }

  labels(d: Decision): string[] {
    if (d.kind === 'number' && d.numeric) {
      return [`a number from ${d.numeric.min} to ${d.numeric.max ?? 'any'} (suggested ${d.numeric.suggest})`];
    }
    const all = d.options.map(o => {
      const r = this.refOfValue(o.value, d.kind === 'electricPath');
      return short(o.label) + (r ? ` [${r}]` : '');
    });
    return all.length > LIMITS.offeredOptions
      ? [...all.slice(0, LIMITS.offeredOptions), `… ${all.length - LIMITS.offeredOptions} more`]
      : all;
  }

  do(a: Action): void {
    if (this.actions >= LIMITS.actions) throw new Limit(`stopped after ${LIMITS.actions} engine actions`);
    if (clockMs() > this.deadline) throw new Limit(`stopped after ${LIMITS.selfStopMs} ms (${this.actions} engine actions)`);
    const r = apply(this.state, a);
    this.state = r.state;
    this.events.push(...r.events);
    this.actions++;
    this.noteDecision();
  }

  // ── refs ─────────────────────────────────────────────────────────

  inPlay(id: EntityId): Entity | undefined {
    const u = this.state.entities[id];
    return u && u.kind === 'unit' && !u.absent ? u : undefined;
  }

  unitId(r: string): EntityId {
    const dot = /^(you|opponent)\.(\d+)$/.exec(r);
    if (dot) {
      const id = this.ids[dot[1] as Side][Number(dot[2])];
      if (id === undefined) throw new Refusal(`${r} is not on the board`);
      if (!this.inPlay(id)) throw new Refusal(`${r} (${this.cardOfRef(r)}) is no longer in play`);
      return id;
    }
    const named = /^(you|opponent):(.+)$/.exec(r)!;
    const seat = seatOf(named[1] as Side);
    const hits = Object.values(this.state.entities)
      .filter(u => u.kind === 'unit' && !u.absent && u.controller === seat && u.card === named[2]);
    if (hits.length === 1) return hits[0]!.id;
    throw new Refusal(hits.length
      ? `${r} is ambiguous: ${named[1]} controls ${hits.length} of them — use "${named[1]}.<n>"`
      : `${named[1]} controls no ${named[2]} in play`);
  }

  /** "opponent.0 (Towering Colossus)", "opponent (the player)", "stack.1" */
  describeRef(r: string): string {
    if (r === 'you' || r === 'opponent') return `${r} (the player)`;
    if (r.startsWith('stack')) return r;
    return /^(you|opponent)\.\d+$/.test(r) ? `${r} (${this.cardOfRef(r)})` : r;
  }

  cardOfRef(r: string): string {
    const dot = /^(you|opponent)\.(\d+)$/.exec(r);
    return dot ? (this.spec[dot[1] as Side].play[Number(dot[2])]?.card ?? '?') : r.replace(/^[a-z]+:/, '');
  }

  stackId(r: string): number {
    const s = this.state.stack;
    const dot = /^stack\.(\d+)$/.exec(r);
    if (dot) {
      const it = s[Number(dot[1])];
      if (!it) throw new Refusal(`${r}: the stack holds only ${s.length} item(s)`);
      return it.id;
    }
    const name = r.slice('stack:'.length);
    for (let i = s.length - 1; i >= 0; i--) if (s[i]!.card === name || s[i]!.label.includes(name)) return s[i]!.id;
    throw new Refusal(`nothing called ${name} is on the stack (stack: ${s.map(i => i.label).join(' | ') || 'empty'})`);
  }

  /** the decision-option values that would name this ref */
  targetValues(r: string): unknown[] {
    if (r === 'you' || r === 'opponent') return [{ player: seatOf(r) }];
    if (r.startsWith('stack')) return [{ stack: this.stackId(r) }];
    const id = this.unitId(r);
    return [{ unit: id }, id];
  }

  /** the REF a decision option's value names, so two "Luminous Arc" options
   * can be told apart: "stack.1", "opponent.0", "you+0" (a unit that was not
   * on the built board), "you"/"opponent" */
  refOfValue(v: unknown, rawIds = false): string | null {
    // only an electricPath question's values are RAW entity ids (types.ts)
    if (!isObj(v)) return rawIds && typeof v === 'number' ? this.refOfEntity(v) : null;
    if (typeof v['stack'] === 'number') {
      const i = this.state.stack.findIndex(it => it.id === v['stack']);
      return i >= 0 ? `stack.${i}` : null;
    }
    if (typeof v['unit'] === 'number') return this.refOfEntity(v['unit']);
    if (typeof v['player'] === 'number') return sideOf(v['player'] as Seat);
    return null;
  }

  refOfEntity(id: EntityId): string | null {
    for (const s of SIDES) {
      const i = this.ids[s].indexOf(id);
      if (i >= 0) return `${s}.${i}`;
    }
    const u = this.state.entities[id];
    if (!u || u.kind !== 'unit') return null;
    const listed = new Set([...this.ids.you, ...this.ids.opponent]);
    const extras = Object.values(this.state.entities)
      .filter(x => x.kind === 'unit' && !x.absent && !listed.has(x.id) && x.controller === u.controller);
    const n = extras.findIndex(x => x.id === id);
    return n >= 0 ? `${sideOf(u.controller)}+${n}` : null;
  }

  /** "you.0 Towering Colossus" for an entity we placed, else its card */
  nameOf(id: EntityId): string {
    for (const s of SIDES) {
      const i = this.ids[s].indexOf(id);
      if (i >= 0) return `${this.state.entities[id]?.card ?? this.spec[s].play[i]?.card} (${s}.${i})`;
    }
    return this.state.entities[id]?.card ?? `#${id}`;
  }

  // ── what a seat may do, in words ─────────────────────────────────

  say(a: Action): string {
    const s = this.state;
    switch (a.type) {
      case 'playCard': return `play ${s.players[a.seat]!.hand[a.handIndex] ?? '?'}${a.mode ? ` (${a.mode})` : ''}`;
      case 'playCached': return `play from cache #${a.index}`;
      case 'playFromBin': return `play ${s.players[a.seat]!.bin[a.binIndex] ?? '?'} from bin`;
      case 'augment': {
        const c = a.from === 'hand' ? s.players[a.seat]!.hand[a.index] : a.from === 'bin' ? s.players[a.seat]!.bin[a.index] : `cache #${a.index}`;
        const host = a.hostId !== undefined ? this.nameOf(a.hostId) : `stack item ${s.stack.find(i => i.id === a.hostStack)?.label ?? a.hostStack}`;
        return `augment ${c ?? '?'} onto ${host}`;
      }
      case 'graft': return `graft ${a.from === 'hand' ? s.players[a.seat]!.hand[a.index] : a.from} onto ${this.nameOf(a.hostId)}`;
      case 'activateAbility': return `activate ${this.nameOf(a.entityId)} ability ${a.abilityIndex}`;
      case 'passPriority': return 'pass';
      case 'declareAttack': return a.columns.length ? `attack with ${a.columns.map(c => c.map(id => this.nameOf(id)).join('+')).join(' | ')}` : 'attack with nobody';
      case 'declareBlocks': return Object.keys(a.blocks).length ? 'declare blocks' : 'no blocks';
      case 'decide': {
        const d = s.decision;
        if (!d) return 'answer';
        if (typeof a.choice === 'number') return `choose "${short(d.kind === 'number' ? String(a.choice) : d.options[a.choice]?.label ?? String(a.choice), 60)}"`;
        return `order ${a.choice.join(',')}`;
      }
      case 'donePlanning': return 'done planning';
      case 'doneHaste': return 'done with the haste step';
      case 'doneDeploying': return 'done deploying';
      case 'recycleForResource': return `recycle ${s.players[a.seat]!.hand[a.handIndex] ?? '?'} for ${a.element}`;
      case 'activateResource': return `activate resource #${a.index} (${s.players[a.seat]!.resources[a.index]?.kind ?? '?'})`;
      case 'castSpellToken': return `cast spell token ${this.nameOf(a.entityId)}`;
      case 'prophesy': return `prophesy ${a.from === 'hand' ? s.players[a.seat]!.hand[a.index] : a.from}`;
      default: return a.type;
    }
  }

  legalSummary(seat: Seat): string[] {
    const out: string[] = [];
    for (const a of legalActions(this.state, seat)) {
      const t = this.say(a);
      if (!out.includes(t)) out.push(t);
    }
    return out.length > LIMITS.legal ? [...out.slice(0, LIMITS.legal - 1), `(+${out.length - LIMITS.legal + 1} more)`] : out;
  }

  // ── the silent defaults ──────────────────────────────────────────

  /** who must act next: the open question's seat, the priority holder, or
   * the first seat (initiative first) with anything to do */
  actor(): Seat | null {
    const s = this.state;
    if (s.phase === 'gameover') return null;
    if (s.decision) return s.decision.seat;
    if (s.priority !== null && s.priority !== undefined) return s.priority;
    for (const seat of [s.initiative, (1 - s.initiative) as Seat]) {
      if (legalActions(s, seat).length) return seat;
    }
    return null;
  }

  autoDecide(): void {
    const d = this.state.decision!;
    let choice: number | number[] = 0;
    let what: string;
    if (d.kind === 'number' && d.numeric) { choice = d.numeric.min; what = String(choice); }
    else if (d.pickOrder) { choice = d.options.map((_, i) => i); what = 'the listed order'; }
    else what = `option 0 — ${short(d.options[0]?.label ?? '?', 60)}`;
    this.note(`decision '${short(d.prompt, 60)}' (${sideOf(d.seat)}): ${what}`);
    this.do({ type: 'decide', seat: d.seat, choice });
  }

  silent(seat: Seat): void {
    const s = this.state;
    if (s.decision?.seat === seat) { this.autoDecide(); return; }
    const legal = legalActions(s, seat);
    if (this.spec.blocks.length && !this.blocksUsed && s.battle?.defender === seat
      && legal.some(a => a.type === 'declareBlocks')) {
      this.blocksUsed = true;
      this.declareBlocks(seat);
      this.note(`${sideOf(seat)} blocked as scripted`);
      return;
    }
    const mv = passiveMove(legal);
    if (!mv) throw new Limit(`${sideOf(seat)} has no passive move here (${this.where()}): ${this.legalSummary(seat).join('; ')}`);
    if (mv.type === 'decide') { this.autoDecide(); return; }
    this.note(`${sideOf(seat)} ${({
      passPriority: 'passed', declareBlocks: 'declared no blocks', declareAttack: 'attacked with nobody',
      donePlanning: 'finished planning', doneHaste: 'finished the haste step', doneDeploying: 'finished deploying',
    } as Record<string, string>)[mv.type] ?? mv.type}`);
    this.do(mv);
  }

  declareBlocks(seat: Seat): void {
    const b = this.state.battle!;
    const blocks: Record<number, EntityId[]> = {};
    for (const [bl, at] of this.spec.blocks) {
      const blocker = this.unitId(bl);
      const attacker = this.unitId(at);
      const col = b.columns.findIndex(c => c.includes(attacker));
      if (col < 0) throw new Refusal(`blocks: ${at} is not attacking`);
      (blocks[col] ??= []).push(blocker);
    }
    try {
      this.do({ type: 'declareBlocks', seat, blocks });
    } catch (err) {
      if (err instanceof IllegalAction) throw new Refusal(`the blocks were refused: ${err.message}`, { legal: this.legalSummary(seat) });
      throw err;
    }
  }

  where(): string {
    const s = this.state;
    return s.battle && s.phase === 'battle' ? `battle round ${s.battle.round}, ${s.battle.step}` : s.phase;
  }

  /** a position key: changes when the phase, turn, battle round or step does */
  notch(): string {
    const s = this.state;
    return `${s.turn}|${s.phase}|${s.battle?.round ?? ''}|${s.battle?.step ?? ''}`;
  }

  // ── setup ────────────────────────────────────────────────────────

  build(): string[] {
    const sp = this.spec;
    this.state = createGame(SEED, NAMES, 'constructed', [], [[...FILLER], [...FILLER]]).state;
    const s = this.state;
    s.initiative = sp.initiative;
    const e = new E(s);
    for (const side of SIDES) {
      const seat = seatOf(side);
      const n = sp[side];
      const board: BoardSide = {
        hand: n.hand, resources: n.resources,
        play: n.play.map(u => ({
          card: u.card,
          ...(u.token ? { token: true } : {}),
          ...(u.counters ? { counters: u.counters } : {}),
          ...(u.mods.length ? { mods: u.mods } : {}),
        })),
      };
      patchSide(e, seat, board, this.ids[side]);
      const p = e.player(seat);
      if (n.life !== null) p.life = n.life;
      if (n.bin.length) p.bin = [...n.bin];
      if (n.deckTop.length) s.decks![seat]!.unshift(...n.deckTop);
    }
    try {
      e.settle();
    } catch (sig) {
      if (!(sig instanceof Suspended)) throw sig;
    }
    this.state = e.s;
    this.events.push(...e.events);
    // a spawn trigger that asks a question is answered like any unscripted one
    for (let g = 0; g < 10 && this.state.decision; g++) this.autoDecide();
    return this.patchedLines();
  }

  /** what the board has that no card put there — one line per side/unit, so
   * the model can tell the reader which parts of the setup were assumed */
  patchedLines(): string[] {
    const out: string[] = [];
    const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    for (const side of SIDES) {
      const n = this.spec[side];
      if (n.life !== null) out.push(`${side} life set to ${n.life}`);
      n.play.forEach((u, i) => {
        const parts: string[] = [];
        if (u.counters) parts.push(`${Math.abs(u.counters)} ${u.counters > 0 ? '+1/+1' : '-1/-1'} counter(s)`);
        for (const m of u.mods) parts.push(`${m.card} attached as ${m.as}, not played`);
        const temps = u.temp.map(t => ('attr' in t ? t.attr : `${sign(t.power)}/${sign(t.toughness)}`));
        if (temps.length) parts.push(`${temps.join(', ')} until regroup`);
        if (u.damage) parts.push(`${u.damage} damage marked`);
        if (parts.length) out.push(`${side}.${i} ${u.card}: ${parts.join('; ')} — directly, not by a card`);
      });
    }
    return out;
  }

  /**
   * `temp` and `damage`, applied AT THE START POSITION — after the walk has
   * reached the attack declaration or deployment. Both are "until regroup",
   * and a deployment start walks THROUGH a regroup, which would wipe them.
   */
  applyTemp(): void {
    const e = new E(this.state);
    for (const side of SIDES) {
      this.spec[side].play.forEach((u, i) => {
        const r = `${side}.${i}`;
        const ent = e.s.entities[this.ids[side][i]!];
        if (!ent || ent.kind !== 'unit') {
          if (u.temp.length || u.damage) throw new Refusal(`${r} (${u.card}) left play before the start position, so its temp/damage cannot be applied`);
          return;
        }
        for (const t of u.temp) {
          if ('attr' in t) e.addTempAttr(ent, t.attr);
          else e.addTemp(ent, t.power, t.toughness);
        }
        if (u.damage) ent.damage = u.damage;
      });
    }
    try {
      e.settle();
    } catch (sig) {
      if (!(sig instanceof Suspended)) throw sig;
    }
    this.state = e.s;
    this.events.push(...e.events);
    this.noteDecision();
  }

  boardLine(): string {
    const q = new E(structuredClone(this.state));
    return SIDES.map(side => {
      const p = this.state.players[seatOf(side)]!;
      const open = p.resources.filter(r => r.state === 'open');
      const res = RESOURCE_KINDS.map(k => [k, open.filter(r => r.kind === k).length] as const)
        .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' ');
      const units = this.ids[side].map((id, i) => {
        const u = q.s.entities[id];
        if (!u || u.kind !== 'unit') return `${side}.${i} ${this.spec[side].play[i]?.card} (gone)`;
        const [pw, tg] = q.effStats(u);
        const mods = u.mods.map(m => q.s.entities[m]?.card).filter(Boolean);
        const own = [...q.ownAttrs(u)];
        return `${side}.${i} ${u.card} ${pw}/${tg}${u.token ? ' token' : ''}${mods.length ? ` +${mods.join('+')}` : ''}`
          + `${own.length ? ` [${own.join(',')}]` : ''}${u.damage ? ` dmg ${u.damage}` : ''}`;
      });
      return `${side} (life ${p.life}; ${open.length} open${res ? `: ${res}` : ''}): `
        + `${units.join('; ') || 'no units'} · hand: ${p.hand.join(', ') || '—'}`
        + `${p.bin.length ? ` · bin: ${p.bin.join(', ')}` : ''}`;
    }).join(' || ');
  }

  /** reach the start position, apply `temp`/`damage` there, and (battle)
   * declare the attack. Returns the board line, as built. */
  walk(): string {
    const sp = this.spec;
    this.at = 'walk';
    let board = '';
    this.do({ type: 'donePlanning', seat: 0 });
    this.do({ type: 'donePlanning', seat: 1 });
    // CR 504.5: the unconditional haste step, walked through exactly as the
    // scenario deal walks it (board.ts)
    const open = this.state.hasteDone?.filter(d => !d).length ?? 0;
    this.state = closeHasteStep(this.state, this.events);
    this.actions += open;
    if (sp.start === 'battle') {
      for (let g = 0; g < 40 && !(this.state.phase === 'battle' && this.state.battle?.step === 'declare'); g++) {
        const a = this.actor();
        if (a === null) break;
        this.silent(a);
      }
      const b0 = this.state.battle;
      if (!b0 || b0.step !== 'declare') throw new Refusal(`could not reach the attack declaration (${this.where()})`);
      this.applyTemp();
      board = this.boardLine();
      const b = this.state.battle!;
      const columns = sp.attack.map(c => c.map(r => this.unitId(r)));
      try {
        this.do({ type: 'declareAttack', seat: b.attacker, columns });
      } catch (err) {
        if (err instanceof IllegalAction) throw new Refusal(`the attack was refused: ${err.message}`, { legal: this.legalSummary(b.attacker) });
        throw err;
      }
    } else {
      for (let g = 0; g < 60 && this.state.phase !== 'deploy'; g++) {
        const a = this.actor();
        if (a === null) break;
        this.silent(a);
      }
      if (this.state.phase !== 'deploy') throw new Refusal(`could not reach deployment (${this.where()})`);
      this.applyTemp();
      board = this.boardLine();
    }
    return board;
  }

  // ── steps ────────────────────────────────────────────────────────

  /** let the other seat play its defaults until `seat` must act; answer a
   * question of `seat`'s own that nobody scripted */
  waitFor(seat: Seat): void {
    for (let g = 0; g < 100; g++) {
      const a = this.actor();
      if (a === null) throw new Refusal(`nobody can act (${this.where()})`);
      if (a !== seat) { this.silent(a); continue; }
      if (this.state.decision?.seat === seat) { this.autoDecide(); continue; }
      return;
    }
    throw new Refusal(`${sideOf(seat)} never got to act`);
  }

  /** every seat plays its defaults until `done()`; refuse once the position
   * moves past `bound` (a phase or turn change) */
  advanceUntil(done: () => boolean, stopIf: () => string | null, takeOwn: (d: Decision) => boolean): void {
    for (let g = 0; g < 120; g++) {
      if (done()) return;
      const why = stopIf();
      if (why) throw new Refusal(why);
      const a = this.actor();
      if (a === null) throw new Refusal(`nobody can act (${this.where()})`);
      const d = this.state.decision;
      if (d && takeOwn(d)) return;
      this.silent(a);
    }
    throw new Refusal('gave up waiting');
  }

  hand(seat: Seat, c: CardName): number {
    const h = this.state.players[seat]!.hand;
    const i = h.indexOf(c);
    if (i < 0) throw new Refusal(`${c} is not in ${sideOf(seat)}'s hand (hand: ${h.join(', ') || 'empty'})`);
    return i;
  }

  runAct(st: NStep): StepOut {
    const seat = st.seat ?? 0;
    this.waitFor(seat);
    const legal = legalActions(this.state, seat);
    let want: Action;
    if (st.do === 'play') {
      const idx = this.hand(seat, st.card!);
      want = legal.find(a => a.type === 'playCard' && a.handIndex === idx && (st.mode ? a.mode === st.mode : !a.mode))
        ?? { type: 'playCard', seat, handIndex: idx, ...(st.mode ? { mode: st.mode } : {}) };
    } else if (st.do === 'augment') {
      const idx = this.hand(seat, st.card!);
      const onStack = st.host!.startsWith('stack');
      const host = onStack ? this.stackId(st.host!) : this.unitId(st.host!);
      want = legal.find(a => a.type === 'augment' && a.from === 'hand' && a.index === idx
        && (onStack ? a.hostStack === host : a.hostId === host))
        ?? { type: 'augment', seat, from: 'hand', index: idx, ...(onStack ? { hostStack: host } : { hostId: host }) };
    } else if (st.do === 'graft') {
      const idx = this.hand(seat, st.card!);
      const host = this.unitId(st.host!);
      want = legal.find(a => a.type === 'graft' && a.from === 'hand' && a.index === idx && a.hostId === host
        && (st.position === undefined || a.position === st.position))
        ?? { type: 'graft', seat, from: 'hand', index: idx, hostId: host, position: st.position ?? 0 };
    } else {
      const id = this.unitId(st.unit!);
      want = legal.find(a => a.type === 'activateAbility' && a.entityId === id && a.abilityIndex === st.ability)
        ?? { type: 'activateAbility', seat, entityId: id, abilityIndex: st.ability ?? 0 };
    }
    let did = `${sideOf(seat)} ${this.say(want)}`;
    try {
      this.do(want);
    } catch (err) {
      if (err instanceof IllegalAction) throw new Refusal(err.message, { legal: this.legalSummary(seat) });
      throw err;
    }
    // the cast's own questions: X, then the targets, in whatever order they come
    const targets = st.targets ?? [];
    let ti = 0, xUsed = false;
    const picked: string[] = [];
    for (let g = 0; g < 20; g++) {
      const d = this.state.decision;
      if (!d || d.seat !== seat) break;
      // X comes as a type-a-number question or as an "X = n" menu
      const xIdx = d.options.findIndex(o => o.label === `X = ${st.x}`);
      const xMenu = d.kind !== 'number' && d.options.some(o => /^X = \d+$/.test(o.label));
      if (st.x !== undefined && !xUsed && (d.kind === 'number' || xMenu)) {
        xUsed = true;
        if (xMenu && xIdx < 0) throw new Refusal(`X=${st.x} is not offered`, { options: this.labels(d) });
        try { this.do({ type: 'decide', seat, choice: xMenu ? xIdx : st.x }); } catch (err) {
          if (err instanceof IllegalAction) throw new Refusal(`X=${st.x} was refused: ${err.message}`, { options: this.labels(d) });
          throw err;
        }
        did += ` (X=${st.x})`;
        continue;
      }
      if (d.kind === 'targets' && ti < targets.length) {
        const r = targets[ti++]!;
        const want2 = this.targetValues(r).map(v => JSON.stringify(v));
        const idx = d.options.findIndex(o => want2.includes(JSON.stringify(o.value)));
        if (idx < 0) {
          throw new Refusal(`${this.describeRef(r)} is not offered as a target for "${short(d.prompt, 80)}"`,
            { options: this.labels(d) });
        }
        picked.push(d.options[idx]!.label);
        this.do({ type: 'decide', seat, choice: idx });
        continue;
      }
      break;
    }
    if (picked.length) did += ` → ${picked.map(l => short(l, 50)).join(', ')}`;
    if (ti < targets.length) did += ` (only ${ti} of ${targets.length} targets were asked for)`;
    return { i: st.i, ok: true, did };
  }

  runPass(st: NStep): StepOut {
    const seat = st.seat ?? 0;
    this.waitFor(seat);
    const legal = legalActions(this.state, seat);
    const mv = legal.find(a => a.type === 'passPriority') ?? passiveMove(legal.filter(a => a.type !== 'decide'));
    if (!mv) throw new Refusal(`${sideOf(seat)} cannot pass here (${this.where()})`, { legal: this.legalSummary(seat) });
    const did = `${sideOf(seat)} ${this.say(mv)}`;
    this.do(mv);
    return { i: st.i, ok: true, did };
  }

  boundAt(): () => string | null {
    const s0 = this.state;
    const turn = s0.turn, phase = s0.phase, round = s0.battle?.round;
    return () => {
      const s = this.state;
      if (s.phase === 'gameover') return 'the game ended';
      if (s.turn !== turn || s.phase !== phase || s.battle?.round !== round) return `the ${phase === 'battle' ? `battle round ${round}` : phase} ended`;
      return null;
    };
  }

  runChoose(st: NStep): StepOut {
    // waits only while something is on the stack: a question comes from a
    // resolving effect (or one already open). Use "advance" to walk into a
    // later step first.
    const mine = (d: Decision): boolean => st.seat === null || d.seat === st.seat;
    const who = st.seat !== null ? ` of ${sideOf(st.seat)}` : '';
    this.advanceUntil(() => !!this.state.decision && mine(this.state.decision),
      () => (this.state.phase === 'gameover' ? `no question was asked${who} before the game ended`
        : this.state.stack.length === 0 && !this.state.decision
          ? `no question was asked${who}: nothing is on the stack and no question is open (${this.where()})` : null),
      mine);
    const d = this.state.decision!;
    const opt = st.option!;
    let choice: number | number[];
    let label: string;
    if (d.kind === 'number') {
      const n = Number(opt);
      if (!Number.isInteger(n)) throw new Refusal(`this question wants a number: "${short(d.prompt, 80)}"`, { options: this.labels(d) });
      choice = n; label = String(n);
    } else {
      const low = opt.toLowerCase();
      let idx = d.options.findIndex(o => o.label.toLowerCase() === low);
      if (idx < 0) idx = d.options.findIndex(o => o.label.toLowerCase().includes(low));
      if (idx < 0) throw new Refusal(`no option matching "${opt}" for "${short(d.prompt, 80)}"`, { options: this.labels(d) });
      label = d.options[idx]!.label;
      choice = d.pickOrder ? [idx, ...d.options.map((_, i) => i).filter(i => i !== idx)] : idx;
    }
    try { this.do({ type: 'decide', seat: d.seat, choice }); } catch (err) {
      if (err instanceof IllegalAction) throw new Refusal(err.message, { options: this.labels(d) });
      throw err;
    }
    return { i: st.i, ok: true, did: `${sideOf(d.seat)} chose "${short(label, 70)}" for "${short(d.prompt, 70)}"` };
  }

  runAssign(st: NStep): StepOut {
    const bound = this.boundAt();
    const isAssign = (d: Decision): boolean => d.kind === 'assignDamage' && (st.seat === null || d.seat === st.seat);
    this.advanceUntil(() => !!this.state.decision && isAssign(this.state.decision),
      () => { const w = bound(); return w ? `no damage split was asked before ${w} (a forced split is not asked: one victim, or too little damage to reach past the front)` : null; },
      isAssign);
    const parts: string[] = [];
    for (let g = 0; g < 12; g++) {
      const d = this.state.decision;
      if (!d || !isAssign(d)) break;
      const m = /how much of (\d+) to (.+?)\? /.exec(d.prompt);
      const victim = m?.[2];
      const hit = st.to!.find(([r]) => {
        try { return this.state.entities[this.unitId(r)]?.card === victim; } catch { return false; }
      });
      let idx: number;
      if (hit) {
        idx = d.options.findIndex(o => o.value === hit[1]);
        if (idx < 0) throw new Refusal(`${hit[1]} to ${victim} is not a legal split here`, { options: this.labels(d) });
        parts.push(`${hit[1]} to ${victim}`);
      } else {
        idx = Math.max(0, d.options.findIndex(o => o.value === 'default'));
        this.note(`decision '${short(d.prompt, 60)}' (${sideOf(d.seat)}): ${short(d.options[idx]!.label, 60)}`);
      }
      this.do({ type: 'decide', seat: d.seat, choice: idx });
    }
    return { i: st.i, ok: true, did: `damage assigned: ${parts.join(', ') || 'the default'}` };
  }

  runAdvance(st: NStep): StepOut {
    const k = this.notch();
    this.advanceUntil(() => this.notch() !== k || this.state.phase === 'gameover', () => null, () => false);
    return { i: st.i, ok: true, did: `advanced to ${this.where()}` };
  }

  runUntil(): string | null {
    const u = this.spec.until;
    const turn = this.state.turn, round = this.state.battle?.round;
    const done = (): boolean => {
      const s = this.state;
      if (s.phase === 'gameover') return true;
      switch (u) {
        case 'stackEmpty': return s.stack.length === 0 && !s.decision;
        case 'endOfCombat': return s.phase !== 'battle' || s.battle?.round !== round;
        case 'regroup': return s.phase !== 'battle' && s.phase !== 'planning';
        case 'endOfTurn': return s.turn !== turn;
      }
    };
    for (let g = 0; g < LIMITS.actions; g++) {
      if (done()) return null;
      const a = this.actor();
      if (a === null) return `nobody can act (${this.where()}) before ${u}`;
      this.silent(a);
    }
    return null;
  }

  // ── the answer ───────────────────────────────────────────────────

  final(mana0: Record<Side, number>): SimOk['final'] {
    const s = this.state;
    const q = new E(structuredClone(s));
    const units: UnitOut[] = [];
    const listed = new Set<EntityId>();
    const unitOut = (ref: string, u: Entity): UnitOut => {
      const [p, t] = q.effStats(u);
      const [pp, pt] = q.printedStats(u);
      const mods = u.mods.map(m => q.s.entities[m]?.card).filter((c): c is CardName => !!c);
      return {
        ref, card: u.card, stats: `${p}/${t}`, printed: `${pp}/${pt}`, damage: u.damage, counters: u.counters,
        attrs: [...q.effAttrs(u)].sort(), ...(mods.length ? { mods } : {}),
        zone: u.controller === u.owner ? 'play' : `play (controlled by ${sideOf(u.controller)})`,
      };
    };
    for (const side of SIDES) {
      this.ids[side].forEach((id, i) => {
        listed.add(id);
        const u = q.s.entities[id];
        const r = `${side}.${i}`;
        if (u && u.kind === 'unit' && !u.absent) { units.push(unitOut(r, u)); return; }
        const c = this.spec[side].play[i]!.card;
        const p = s.players[seatOf(side)]!;
        const zone = u?.absent ? 'absent' : p.bin.includes(c) ? 'bin' : p.hand.includes(c) ? 'hand'
          : (p.cache ?? []).some(x => (x as { card?: string }).card === c) ? 'cache' : 'gone';
        units.push({ ref: r, card: c, stats: '-', printed: '-', damage: 0, counters: 0, attrs: [], zone });
      });
    }
    const extra = [0, 0];
    for (const u of Object.values(q.s.entities)) {
      if (u.kind !== 'unit' || u.absent || listed.has(u.id)) continue;
      units.push(unitOut(`${sideOf(u.controller)}+${extra[u.controller]!++}`, u));
    }
    const open = (seat: Seat): number => s.players[seat]!.resources.filter(r => r.state === 'open').length;
    const d = s.decision;
    return {
      phase: this.where(),
      life: { you: s.players[0]!.life, opponent: s.players[1]!.life },
      mana: { you: `${mana0.you} open → ${open(0)} open`, opponent: `${mana0.opponent} open → ${open(1)} open` },
      units,
      stack: s.stack.map(i => `${i.label}${i.negated ? ' (negated)' : ''} [${sideOf(i.controller)}]`),
      hands: { you: fold(s.players[0]!.hand), opponent: fold(s.players[1]!.hand) },
      bins: { you: fold(s.players[0]!.bin), opponent: fold(s.players[1]!.bin) },
      pending: d ? `${sideOf(d.seat)}: ${short(d.prompt, 140)}`
        : s.phase === 'gameover' ? `game over — ${s.winner === null ? 'a draw' : `${sideOf(s.winner)} won`}`
        : s.priority !== null && s.priority !== undefined ? `${sideOf(s.priority)} holds priority (${this.where()})` : null,
    };
  }

  log(from: number): string[] {
    const lines = redactLog(this.events.slice(from), 0, NAMES).map(l => short(l, 200));
    if (lines.length <= LIMITS.logLines) return lines;
    const head = 20, tail = LIMITS.logLines - head - 1;
    return [...lines.slice(0, head), `… ${lines.length - head - tail} lines omitted …`, ...lines.slice(-tail)];
  }
}

/** ["Luminous Arc", "Luminous Arc", "Lithoghul"] → ["Luminous Arc ×2", "Lithoghul"] */
function fold(names: readonly string[]): string[] {
  const out: [string, number][] = [];
  for (const n of names) {
    const hit = out.find(([m]) => m === n);
    if (hit) hit[1]++; else out.push([n, 1]);
  }
  return out.map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

/** Keep the answer under LIMITS.outBytes, trimming the least useful first. */
export function fit(out: SimOk): SimOk {
  const size = (): number => Buffer.byteLength(JSON.stringify(out));
  if (size() <= LIMITS.outBytes) return out;
  out.truncated = true;
  while (size() > LIMITS.outBytes && out.log.length > 12) {
    out.log = [...out.log.slice(0, 6), '… (trimmed to fit) …', ...out.log.slice(-Math.floor(out.log.length / 2) + 7)];
  }
  for (const o of out.offered) if (size() > LIMITS.outBytes && o.options.length > 6) o.options = [...o.options.slice(0, 6), '…'];
  if (size() > LIMITS.outBytes && out.auto.length > 10) out.auto = [...out.auto.slice(0, 9), `… ${out.auto.length - 9} more`];
  if (size() > LIMITS.outBytes && out.patched.length > 8) out.patched = [...out.patched.slice(0, 8), `… ${out.patched.length - 8} more`];
  if (size() > LIMITS.outBytes) out.log = out.log.slice(-8);
  if (size() > LIMITS.outBytes) out.offered = out.offered.slice(-4);
  // a truncated answer leaves out a unit's fields that say nothing:
  // zero damage/counters, no attributes, printed equal to current
  if (size() > LIMITS.outBytes) {
    out.final.units = out.final.units.map(u => {
      const v: Partial<UnitOut> = { ...u };
      if (!v.damage) delete v.damage;
      if (!v.counters) delete v.counters;
      if (!v.attrs?.length) delete v.attrs;
      if (v.printed === v.stats) delete v.printed;
      if (v.zone === 'play') delete v.zone;
      return v as UnitOut;
    });
  }
  if (size() > LIMITS.outBytes) out.board = short(out.board, 900);
  if (size() > LIMITS.outBytes) { out.log = []; out.offered = out.offered.slice(-2); }
  if (size() > LIMITS.outBytes) out.final.units = out.final.units.filter(u => u.zone === undefined || u.zone.startsWith('play'));
  for (let n = out.steps.length; size() > LIMITS.outBytes && n > 4; n--) {
    out.steps = out.steps.map(st => (st.did ? { ...st, did: short(st.did, 60) } : st));
  }
  if (size() > LIMITS.outBytes) out.final.units = out.final.units.slice(0, 12);
  return out;
}

/**
 * Run one simulation. Never throws: every failure is a `{ ok:false }`.
 * `engine` is the SHA the caller stamps (the worker has no git to ask).
 */
export function simulate(raw: unknown, opts: { engine?: string; budgetMs?: number } = {}): SimResult {
  const v = validateSpec(raw);
  if (!v.ok) return v;
  const spec = v.spec;
  const sim = new Sim(spec, opts.budgetMs ?? LIMITS.selfStopMs);
  let board = '', patched: string[] = [];
  try {
    patched = sim.build();
  } catch (err) {
    return { ok: false, id: spec.id, error: `the board could not be built: ${err instanceof Error ? err.message : String(err)}` };
  }
  const from = sim.events.length;
  const steps: StepOut[] = [];
  let limit: string | null = null;
  try {
    board = sim.walk();
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, id: spec.id, error: err.msg };
    if (err instanceof Limit) return { ok: false, id: spec.id, error: err.why, limit: err.why };
    return { ok: false, id: spec.id, error: `engine error while reaching ${spec.start}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const mana0 = {
    you: sim.state.players[0]!.resources.filter(r => r.state === 'open').length,
    opponent: sim.state.players[1]!.resources.filter(r => r.state === 'open').length,
  };
  let refused = false;
  for (const st of spec.steps) {
    sim.at = `step ${st.i}`;
    try {
      steps.push(
        st.do === 'pass' ? sim.runPass(st)
        : st.do === 'choose' ? sim.runChoose(st)
        : st.do === 'assign' ? sim.runAssign(st)
        : st.do === 'advance' ? sim.runAdvance(st)
        : sim.runAct(st));
    } catch (err) {
      if (err instanceof Refusal) {
        steps.push({ i: st.i, ok: false, refused: err.msg, ...(err.legal ? { legal: err.legal } : {}), ...(err.options ? { options: err.options } : {}) });
        const left = spec.steps.length - st.i - 1;
        limit = `stopped at step ${st.i} (refused)${left ? `; ${left} later step(s) not run` : ''}`;
        refused = true;
        break;
      }
      if (err instanceof Limit) { limit = err.why; refused = true; break; }
      steps.push({ i: st.i, ok: false, refused: `engine error: ${err instanceof Error ? err.message : String(err)}` });
      limit = `engine error at step ${st.i}`;
      refused = true;
      break;
    }
  }
  if (!refused) {
    sim.at = 'until';
    try {
      limit = sim.runUntil();
    } catch (err) {
      limit = err instanceof Limit ? err.why : err instanceof Refusal ? err.msg
        : `engine error while running to ${spec.until}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return fit({
    ok: true, engine: opts.engine ?? '', id: spec.id, board, patched, steps,
    offered: sim.offered, log: sim.log(from), final: sim.final(mana0), auto: sim.auto, limit,
  });
}
