/* BL-46 / CT-323 / CT-325 — WHAT A REWIND TAKES BACK, IN WORDS A PLAYER CAN CHECK.
 *
 * The first rewind dialog offered bare counts ("take back the last 1 action")
 * counted across BOTH seats, with the first one preselected. In the 2026-10-21
 * round 15 of 36 rewind rows existed only because players stepped back one at
 * a time to a point the first dialog had already offered, and in 9 runs "the
 * last 1" took back only the OPPONENT's reply. So every option now names what
 * it cuts: whose action, and which card or what kind ("your Fireball", "their
 * pass").
 *
 * CT-325: a count read across both seats also LEAKED, in a hidden step, how
 * many hidden actions the opponent had taken — the proposal's "(10 logged
 * actions)" went to both seats. Naming is per viewer, so the same cut is told
 * three ways: to the proposer, to the seat asked to agree, and to the public
 * log line. An action taken inside the step that is still hidden is never
 * named to the other seat, and its count never shows. `record` is the fourth
 * telling — every action named — for the game file and the bug report, which
 * no player reads.
 *
 * Pure, engine types only: server/rooms.ts builds the options with it and
 * server/replay-room.ts names a rewound branch's cut actions with it, and
 * replay-room must never import rooms.ts (it pulls in the socket layer).
 */
import type { Action, GameState, Seat } from '../engine/src/types.ts';

/** one logged action of a cut, as the options and the triage tool need it */
export interface CutItem {
  /** index in the log */
  i: number;
  seat: Seat;
  /** taken inside the hidden step that is still open, so the other seat has
   * not seen it (PUBLIC_IN_HIDDEN excepted: done planning, done deploying and
   * an agreed fix are public) */
  hidden: boolean;
  /** what it was, without a card: "pass", "choice", "attack", "play" */
  word: string;
  /** the card it names, when the action itself shows that card to the table
   * (a play, an activation) — null when it names none or the card is private */
  card: string | null;
  /** the owner-only detail of a choice (the option label) — never shown to the other seat */
  detail: string | null;
}

/** who reads a description */
export type Viewer = Seat | 'public' | 'record';

const WORDS: Record<string, string> = {
  passPriority: 'pass', decide: 'choice', declareAttack: 'attack', declareBlocks: 'blocks',
  donePlanning: 'done planning', doneHaste: 'done with haste', doneDeploying: 'done deploying',
  recycleForResource: 'recycle', activateResource: 'resource', exchangePrismite: 'prismite exchange',
  prophesy: 'prophecy', bottomCards: 'cards to the bottom', draftCommit: 'draft pick',
  augment: 'augment', graft: 'graft', amend: 'agreed fix', concede: 'concession',
  playCard: 'play', playCached: 'play from cache', playFromBin: 'play from bin',
  activateAbility: 'ability', castSpellToken: 'spell token',
};

/**
 * The actions inside a hidden step the other seat has already been shown, so a
 * cut inside the step may take them back (CR D4.5d: "their public ones, such
 * as finishing planning or deployment, may be taken back"):
 *  - donePlanning, doneDeploying: planningDone and deployDone are served live
 *    to both seats (server/view.ts viewFor);
 *  - amend: an agreed fix is shown to both players at once (CR D4.5c).
 * NOT here, and so hidden: doneHaste (hasteDone is redacted for the other
 * seat), and draftCommit and bottomCards — their done-flags are served live,
 * but the action is the private pick itself. Pinned by server/test/679.
 */
const PUBLIC_IN_HIDDEN = new Set(['donePlanning', 'doneDeploying', 'amend']);

const clip = (s: string, n = 32): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Describe action `a`, taken on board `s` (the board BEFORE it). */
export function describe(a: Action, s: GameState, i: number, hidden: boolean): CutItem {
  const seat = a.seat as Seat;
  const word = WORDS[a.type] ?? a.type.replace(/([A-Z])/g, ' $1').toLowerCase();
  let card: string | null = null;
  let detail: string | null = null;
  try {
    const P = s.players[seat];
    if (a.type === 'playCard') card = P?.hand[a.handIndex] ?? null;
    else if (a.type === 'playCached') card = P?.cache?.[a.index]?.card ?? null;
    else if (a.type === 'playFromBin') card = P?.bin[a.binIndex] ?? null;
    else if (a.type === 'activateAbility' || a.type === 'castSpellToken') card = s.entities[a.entityId]?.card ?? null;
    else if (a.type === 'decide' && s.decision) {
      const ch = Array.isArray(a.choice) ? a.choice : [a.choice];
      detail = s.decision.options.length
        ? clip(ch.map(c => s.decision!.options[c]?.label ?? `#${c}`).join(' + '))
        : `${a.choice}`;
    }
  } catch { /* a description is best-effort; the cut itself is not */ }
  return { i, seat, hidden: hidden && !PUBLIC_IN_HIDDEN.has(a.type), word, card, detail };
}

/** "your", "their", or a name — as `viewer` reads `seat`'s actions */
export function whose(seat: Seat, viewer: Viewer, names: readonly string[]): string {
  if (viewer === seat) return 'your';
  if (viewer === 0 || viewer === 1) return 'their';
  return `${names[seat] ?? `seat ${seat}`}'s`;
}

/** what `viewer` may read of one item: null when it is hidden from them */
export function itemText(it: CutItem, viewer: Viewer, names: readonly string[]): string | null {
  const own = viewer === it.seat || viewer === 'record';
  if (it.hidden && !own) return null;
  const body = it.card ? cardBody(it.word, it.card)
    : own && it.detail ? `${it.word}: ${it.detail}` : it.word;
  return `${whose(it.seat, viewer, names)} ${body}`;
}

function cardBody(word: string, card: string): string {
  switch (word) {
    case 'play': return card;
    case 'play from cache': return `${card} from the cache`;
    case 'play from bin': return `${card} from the bin`;
    case 'ability': return `${card}'s ability`;
    default: return `${card} ${word}`;
  }
}

/**
 * A rewind as offered: where it cuts, why it is a natural place to cut, and
 * what it takes back. Told per viewer by `cutText`.
 */
export interface CutPlan {
  to: number;
  /** 'before': just before item `items[0]`; 'start' / 'prev': the start of this step / the one before */
  kind: 'before' | 'start' | 'prev';
  /** 'before' only: items[0] is the proposer's own last action */
  lastOwn?: boolean;
  /** 'start' / 'prev': the step's public label ("turn 3, planning") */
  step?: string;
  /** a 'before' cut that also lands on the start of a step */
  alsoStart?: string;
  /** every NON-FORCED action the cut takes back, in log order */
  items: CutItem[];
  /** the board now is inside a hidden step: a cut to its start (or before)
   * takes back whatever the other seat did there, unseen and uncounted */
  hiddenStep: boolean;
  /** the proposer */
  seat: Seat;
}

const LIST_MAX = 4;

/** One plan in words for `viewer`, lower-case first letter. */
export function cutText(p: CutPlan, viewer: Viewer, names: readonly string[]): string {
  const { head, takes } = cutParts(p, viewer, names);
  return takes ? `${head} — takes back ${takes}` : head;
}

/** the same, in two parts: where it goes back to, and what it takes back */
export function cutParts(p: CutPlan, viewer: Viewer, names: readonly string[]): { head: string; takes: string | null } {
  const first = p.items[0];
  let head: string;
  if (p.kind === 'before' && first) {
    const t = itemText(first, viewer, names);
    // the cut point is named by the action it goes back before; why it is a
    // natural place to stop rides along in brackets
    const notes = [
      ...(p.lastOwn && t ? [`${whose(p.seat, viewer, names)} last action`] : []),
      ...(p.alsoStart ? [`the start of ${p.alsoStart}`] : []),
    ];
    head = t ? `back to before ${t}`
      : p.lastOwn ? `back to before ${whose(p.seat, viewer, names)} last action`
        : `back to earlier in ${whose(first.seat, viewer, names)} part of this step`;
    if (notes.length) head += ` (${notes.join('; ')})`;
  } else {
    head = `back to the start of ${p.kind === 'start' ? 'this step' : 'the step before'}${p.step ? ` (${p.step})` : ''}`;
  }
  // the list: what this viewer may read, in order; what they may not, as one
  // phrase per seat with no count
  const shown: string[] = [];
  const unseen = new Set<Seat>();
  for (const it of p.items) {
    const t = itemText(it, viewer, names);
    if (t === null) unseen.add(it.seat); else shown.push(t);
  }
  // in a hidden step, a cut to its start takes back the other side's hidden
  // actions too — said ALWAYS, whether or not there were any, so the
  // sentence carries no count and no "they did nothing"
  if (p.hiddenStep && p.kind !== 'before') {
    for (const s of [0, 1] as Seat[]) if (viewer !== 'record' && viewer !== s) unseen.add(s);
  }
  const parts = shown.length > LIST_MAX
    ? [...shown.slice(0, LIST_MAX), `${shown.length - LIST_MAX} more`]
    : shown;
  // a cut to the start of the step takes all of it; a cut inside it, some
  const amount = p.kind === 'before' ? 'some of what' : 'anything';
  const hiddenParts = unseen.size === 2 ? [`${amount} either player did this step`]
    : [...unseen].map(s => `${amount} ${viewer === 'public' || viewer === 'record' ? (names[s] ?? `seat ${s}`) : 'they'} did this step`);
  const all = [...parts, ...hiddenParts];
  return { head, takes: all.length ? joinList(all) : null };
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
