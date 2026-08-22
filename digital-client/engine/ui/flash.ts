/* DOM-free logic for the VISUAL stack: what belongs on it right now.
 *
 * The real stack (GameState.stack) is only half the story. An item nobody may
 * respond to — a haste-step card, anything played during deployment, an
 * activation outside battle, a trigger between combat sub-steps — never
 * touches `state.stack` at all: engine.ts commitItem() resolves it on the
 * spot. On screen that is no journey at all, which is exactly the playtest
 * complaint ("they happen and resolve instantly so it's very hard to track").
 *
 * So the engine hands the client a snapshot of every such item as a
 * 'stackFlash' event (rules-inert, no log line), and this module decides when
 * each one is on the visual stack and when it has had its beat. Same split as
 * ui/motion.ts and ui/sfx.ts: the arithmetic is pure and tested here, the DOM
 * layer just draws whatever `stackRows()` returns.
 *
 * R80 widens the same idea from stack items to NARRATIVE BEATS — see the
 * second half of this file. A combat damage step is not a stack item and gets
 * no 'stackFlash', but it has exactly the same problem, and it gets the same
 * treatment out of the same three knobs.
 *
 * Time is a plain millisecond reading (Date.now()) passed in, never read here
 * — so a test can run a whole flash queue without a clock.
 */
import type { EngineEvent, EventType, Seat, StackItem } from '../src/types.ts';

/** how long one flashed item sits on the visual stack. The ask was "at least
 * a second so that it doesn't happen too fast" — long enough to read the art
 * and the name, short enough that a deployment of six cards is not a slideshow */
export const HOLD_MS = 1200;
/** gap between two items of the same batch, so a settle() cascade arrives as
 * a sequence you can follow rather than a fan of cards appearing at once */
export const STAGGER_MS = 280;
/** the queue never runs more than this far behind the board. Past it the
 * staggering stops and the rest of the batch shares one arrival — a long
 * chain should crowd the stack, not queue up for five seconds */
export const MAX_LEAD_MS = 2200;

export interface Flash {
  /** the item exactly as it stood a moment before it resolved */
  item: StackItem;
  /** clock reading at which it appears on the visual stack */
  at: number;
  /** clock reading at which it leaves again */
  until: number;
}

/**
 * R68: the stack ids a batch of events removed from the stack WITHOUT
 * resolving, in order.
 *
 * The 'negated' event is the engine's marker for "this item left the stack and
 * did nothing" — `E.negate()` fires it, and Dream Lapse fires it for a recall,
 * which is the same fact about the item even though the card goes somewhere
 * else. It carries only `{ id }`: the item itself is detached and dropped, so
 * a client that wants to draw the thing that just got answered has to have
 * kept its own copy (see `negatedFlashItems`).
 */
export function negatedIds(events: readonly EngineEvent[]): number[] {
  const out: number[] = [];
  for (const ev of events) {
    if (ev.type !== 'negated') continue;
    const id = ev.data?.['id'];
    if (typeof id === 'number') out.push(id);
  }
  return out;
}

/**
 * Snapshots of the items a batch of events negated, for their beat.
 *
 * Before R68, negating set `item.negated = true` and LEFT the item on the
 * stack, so it sat there greyed out until a later priority round popped it —
 * slow, but you could see that your spell had been answered. R68 removes it
 * the instant the negation resolves, which is the right rule and costs the
 * player the only picture they had of it.
 *
 * That is precisely the problem this module already exists to solve (docs/11):
 * an item the rules stack no longer holds still gets a beat on the VISUAL
 * stack. The engine hands over its own `structuredClone` for the items that
 * never reached the stack at all; a negated item DID reach it, and was on this
 * client's screen a render ago, so the snapshot comes from `seen` — the
 * client's memory of what it last drew. Remembering what you drew is not
 * inventing state: an id that is missing simply gets no beat, never a wrong one.
 *
 * `negated` is stamped on the COPY, exactly as `E.negate()` stamps its own
 * detached copy, and it is what the board greys. Nothing in `GameState` ever
 * carries it any more — so this is the one and only source of a negated item
 * anywhere in the client, and deleting it would take the grey-out with it.
 */
export function negatedFlashItems(
  events: readonly EngineEvent[], seen: ReadonlyMap<number, StackItem>,
): StackItem[] {
  const out: StackItem[] = [];
  for (const id of negatedIds(events)) {
    const item = seen.get(id);
    if (item) out.push({ ...item, negated: true });
  }
  return out;
}

/** every 'stackFlash' payload in one batch of engine events, in order */
export function flashItems(events: readonly EngineEvent[]): StackItem[] {
  const out: StackItem[] = [];
  for (const ev of events) {
    if (ev.type !== 'stackFlash') continue;
    const item = ev.data?.['item'] as StackItem | undefined;
    if (item && typeof item.id === 'number') out.push(item);
  }
  return out;
}

/**
 * Fold one action's events into the queue.
 *
 * New arrivals line up BEHIND whatever is already pending, so two clicks in
 * quick succession read as two beats rather than one pile — up to MAX_LEAD_MS,
 * after which they land together instead of drifting further from the board
 * they are supposed to be explaining.
 */
export function queueFlashes(
  existing: readonly Flash[], events: readonly EngineEvent[], now: number,
  remembered: ReadonlyMap<number, StackItem> = new Map(),
): Flash[] {
  // two sources, one queue: items that never reached the stack (the engine's
  // own snapshots) and items R68 took OFF it without resolving (ours)
  const items = [...flashItems(events), ...negatedFlashItems(events, remembered)];
  if (!items.length) return existing as Flash[];
  const out = existing.slice();
  const seen = new Set(out.map(f => f.item.id));
  let at = now;
  for (const f of out) at = Math.max(at, f.at + STAGGER_MS);
  for (const item of items) {
    if (seen.has(item.id)) continue;   // a resync must not replay a beat
    seen.add(item.id);
    at = Math.min(at, now + MAX_LEAD_MS);
    out.push({ item, at, until: at + HOLD_MS });
    at += STAGGER_MS;
  }
  return out;
}

/** the flashes on the visual stack at `now` */
export const visibleFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => f.at <= now && now < f.until);

/** the queue with everything that has had its beat dropped */
export const pruneFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => now < f.until);

/** The next clock reading at which the visible set changes — what the client
 * schedules its next repaint for. null when the queue is spent. */
export function nextFlashWake(list: readonly Flash[], now: number): number | null {
  let best: number | null = null;
  for (const f of list) {
    for (const t of [f.at, f.until]) {
      if (t > now && (best === null || t < best)) best = t;
    }
  }
  return best;
}

/** one card-shaped thing on the visual stack, bottom of the stack first */
export interface StackRow {
  item: StackItem;
  /** true: it has already resolved and is being replayed for the eye */
  flashing: boolean;
  /** true: the real top of the real stack — the thing that resolves next */
  top: boolean;
  /**
   * R78: true for the ONE item that is resolving right now — off `state.stack`
   * (nobody may respond to it, negate it or target it any more) but not
   * finished, because its resolution stopped on a mid-resolution choice.
   *
   * It is neither `flashing` (that is a replay of something already over) nor
   * `top` (that is the next item still WAITING). Those three are mutually
   * exclusive by construction and the board paints all three differently:
   * purple "resolved", red "answered", pending "resolving".
   */
  resolving: boolean;
}

/**
 * The visual stack: what is really on it, then whatever is having its beat,
 * and — last, because it is the thing actually happening — whatever is
 * resolving.
 *
 * A flash sits ABOVE the real items because that is where it would have gone
 * had the rules given it a stop, and only the real top of the real stack wears
 * the "resolves next" mark, because a flash resolves next to nothing.
 *
 * R78's `resolving` item goes RIGHTMOST — on top of the pile, overlapped by
 * nothing. It came off the top of the stack a moment ago, so it outranks
 * everything still waiting; and it is the only row whose chip must stay
 * legible whatever else is on the strip, because it is the answer to "why has
 * nothing happened yet?". A beat is a courtesy; this is the state.
 *
 * Passing `resolving` is optional so a pre-R78 saved state — or a caller that
 * only cares about the queue arithmetic — behaves exactly as before.
 */
export function stackRows(
  stack: readonly StackItem[], flashes: readonly Flash[], now: number,
  resolving: StackItem | null = null,
): StackRow[] {
  const rows: StackRow[] = stack.map((item, i) => ({
    item, flashing: false, top: i === stack.length - 1, resolving: false,
  }));
  for (const f of visibleFlashes(flashes, now)) {
    rows.push({ item: f.item, flashing: true, top: false, resolving: false });
  }
  if (!resolving) return rows;
  // one card per id, always: an item cannot be both waiting and resolving, but
  // a resync could hand us a stale beat for the very item that is now resolving
  // and drawing it twice would read as two copies of the spell.
  const out = rows.filter(r => r.item.id !== resolving.id);
  out.push({ item: resolving, flashing: false, top: false, resolving: true });
  return out;
}

/** the row the caption under the strip is about, or null on an empty strip.
 *
 * What is HAPPENING beats what is next: a resolving item is the reason the
 * board has not changed yet, so it leads even over the top of the stack. */
export function leadRow(rows: readonly StackRow[]): StackRow | null {
  return rows.find(r => r.resolving) ?? rows.find(r => r.top) ?? rows[rows.length - 1] ?? null;
}

/** the one line of prose under the strip: what is happening to the lead item */
export interface StackCaption {
  row: StackRow;
  /** the small uppercase verb chip ("resolves next", "Alice is resolving…") */
  verb: string;
  /** the controller's name for the trailing "by" clause, or null when `verb`
   * has already named them and repeating it would just be noise */
  by: string | null;
  /** R78: the lead item is mid-resolution. The caption must read as IN
   * PROGRESS — the whole playtest complaint was that a half-done effect looked
   * finished — so the board paints this row and this caption differently from
   * both "just resolved" and "was answered". */
  pending: boolean;
}

/**
 * R78: "Opponent is resolving [effect]", and the equivalents.
 *
 * `mySeat` is the seat this screen belongs to, or null in hotseat where both
 * seats are the player. Naming the controller is the whole point of the report
 * — "to my opponent, it looks like something already resolved" — so the
 * resolving verbs carry the name and drop the trailing `by`.
 *
 * Your OWN resolution says only "resolving now": the prompt bar directly above
 * is already asking you the question in your own name, and a second copy of
 * your name on the table is clutter. What the caption adds that the prompt bar
 * cannot is WHICH card the question belongs to, and the card is right there.
 */
export function stackCaption(
  rows: readonly StackRow[],
  opts: { mySeat?: Seat | null; names?: readonly string[] } = {},
): StackCaption | null {
  const row = leadRow(rows);
  if (!row) return null;
  const name = opts.names?.[row.item.controller] ?? '';
  if (row.resolving) {
    const mine = opts.mySeat !== null && opts.mySeat !== undefined && row.item.controller === opts.mySeat;
    return { row, verb: mine ? 'resolving now' : `${name} is resolving`, by: null, pending: true };
  }
  const verb = row.flashing
    ? (row.item.negated ? 'was answered' : 'just resolved')
    : rows.length > 1 ? 'resolves next' : 'on the stack';
  return { row, verb, by: name || null, pending: false };
}

/**
 * The beats that also belong in the MOTION census as phantom stack slots.
 *
 * A normal flash is an item that never touched `state.stack`, so its `s<id>`
 * key is born in the after-census and the card visibly flies onto the stack
 * (docs/11). A NEGATED beat is the mirror image: its key was really there a
 * frame ago and is really gone now, and its card is really travelling — to a
 * bin under R68, or out of existence. Handing the census a phantom would keep
 * that key alive across the diff, `stack>bin` would never pair, and the card
 * would pop into the bin instead of flying there.
 *
 * So the ghost stays on the strip and the card still makes its journey. The
 * board underneath is final either way — the beat is explanation, not a gate.
 *
 * R78: a RESOLVING row is a phantom for the opposite reason. Its `s<id>` key
 * really was in the census one render ago and is really gone from `state.stack`
 * now — but the card has gone NOWHERE, it is mid-resolution and still drawn on
 * the strip. Without the phantom the diff would see the key vanish and fly the
 * card off to a destination that does not exist yet. With it, the card sits
 * still until the resolution actually finishes, and only then flies to the bin.
 */
export const censusFlashes = (rows: readonly StackRow[]): StackRow[] =>
  rows.filter(r => r.resolving || (r.flashing && !r.item.negated));

// ── R80: narrative beats — a combat step told one stage at a time ─────
//
// Playtest UFAB: "Neither of us had anything to do during the end of that
// combat, but damage and all effects happened instantly. We should have been
// able to see, much slower, what happened and how much damage went through."
//
// The engine runs a whole damage step in ONE synchronous pump (engine.ts
// pumpCombatDamage: Swift → normal → Sluggish → after, checkDeaths between
// each), the server sends it as one batch and drains the forced steps into
// the same batch, and the client appends every line and paints once. With
// nothing to answer, an entire combat is a single frame.
//
// This is the same complaint docs/11 answered for unrespondable stack items,
// so it gets the same answer and the same three knobs: hold the story back and
// let it out a beat at a time. What is staged is the STORY — the log lines and
// a pulse on what the stage is about. THE BOARD UNDERNEATH IS FINAL AND
// CLICKABLE THE INSTANT render() RETURNS, exactly as docs/11 promises; a beat
// explains, it never gates input, and the whole queue is bounded by
// MAX_LEAD_MS so the log can never be more than 2.2s behind the table.
//
// Grouping is done WITHOUT any engine change. The damage events carry no
// sub-step tag, but the pump's own shape is legible in the event order:
// checkDeaths runs after every sub-step, so a batch reads as alternating runs
// of "damage landed" and "and then things died", and the header and
// 'afterCombat' bracket the whole thing. A run boundary is therefore just a
// change of event flavour, which is what `combatStages` reads.

/** events that say damage/life/counters LANDED */
const STRIKE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'combatDamage', 'damage', 'lifeLost', 'lifeGained',
  'countersChanged', 'statChanged', 'rotGained', 'debtGained',
]);
/** events that say what the strike COST — deaths and the tidy-up after them */
const FALLOUT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'died', 'despawned', 'erased', 'trashed', 'info',
]);

/** which half of the story a stage tells */
export type BeatKind = 'strike' | 'fallout' | 'after';

/** one stage of a batch: a run of consecutive log lines and what they are about */
export interface BeatStage {
  kind: BeatKind;
  /** how many of the batch's LOG LINES (events with a message) it releases */
  lines: number;
  /** ui/motion.ts keys the stage is about, for the pulse that draws the eye */
  keys: string[];
}

/** a stage with the clock reading it is told at */
export interface Beat extends BeatStage {
  at: number;
  /** the client has played this one (set by ui/main.ts when it paints it) */
  fired?: boolean;
}

/** the motion keys one event is about: the unit it hit, or the player it hit */
function beatKeys(ev: EngineEvent): string[] {
  const d = ev.data ?? {};
  const out: string[] = [];
  const unit = d['unit'];
  if (typeof unit === 'number') out.push(`e${unit}`);
  const seat = d['seat'];
  if (typeof seat === 'number') {
    if (ev.type === 'lifeLost' || ev.type === 'lifeGained'
      || ev.type === 'rotGained' || ev.type === 'debtGained') out.push(`@life:${seat}`);
    // a death's own `e<id>` is already off the board — the bin is where the
    // card actually went, and it is the thing still on screen to pulse
    if (ev.type === 'died' || ev.type === 'trashed') out.push(`@bin:${seat}`);
  }
  return out;
}

/**
 * Cut one action's events into the stages of a combat damage step, or [] when
 * the batch is not one (or is too small to be worth telling slowly).
 *
 * Only log-line events are counted, because lines are the unit the client
 * holds back — a signal-only 'stackFlash' is not in the log and must not shift
 * the arithmetic by one.
 *
 * Everything BEFORE the 'combatDamage' header is left out of the queue
 * entirely: it belongs to whatever the player just did, it is already on
 * screen, and holding it would be rewriting history rather than pacing it.
 *
 * Anything the pump did not emit itself — a trigger going on the stack, a
 * phase line from the server's forced-step drain — ends the staging: from
 * there to the end of the batch is one final 'after' stage. That is the honest
 * degradation. Nothing is ever lost, only grouped more coarsely.
 */
export function combatStages(events: readonly EngineEvent[]): BeatStage[] {
  const lines = events.filter(e => e.msg);
  const head = lines.findIndex(e => e.type === 'combatDamage');
  if (head < 0) return [];
  const stages: BeatStage[] = [];
  let cur: BeatStage = { kind: 'strike', lines: 0, keys: [] };
  stages.push(cur);
  const open = (kind: BeatKind): void => { cur = { kind, lines: 0, keys: [] }; stages.push(cur); };
  for (let i = head; i < lines.length; i++) {
    const ev = lines[i]!;
    const t = ev.type;
    if (cur.kind !== 'after') {
      if (t === 'afterCombat' || (!STRIKE_TYPES.has(t) && !FALLOUT_TYPES.has(t))) open('after');
      else if (cur.kind === 'fallout' && STRIKE_TYPES.has(t)) open('strike');
      else if (cur.kind === 'strike' && FALLOUT_TYPES.has(t)) open('fallout');
    }
    cur.lines++;
    for (const k of beatKeys(ev)) if (!cur.keys.includes(k)) cur.keys.push(k);
  }
  // one stage is not a sequence: there is nothing to pace, so pace nothing.
  // Nor is a combat in which nothing landed — an unblocked attack into an
  // empty board is a bare header and an 'afterCombat', and making the player
  // wait a beat to be told nothing happened is the opposite of the ask.
  const told = stages.reduce((n, s) => (s.kind === 'after' ? n : n + s.lines), 0);
  return stages.length > 1 && told > 1 ? stages : [];
}

/**
 * Stamp the stages with the moments they are told at.
 *
 * The first stage is told NOW — the board is already final under it and the
 * player must never wait to be told anything about a move they can already
 * see. The rest walk forward one HOLD_MS apart, squeezed towards STAGGER_MS
 * when there are enough of them that the staircase would otherwise run past
 * MAX_LEAD_MS, and hard-clamped there whatever happens. Same three knobs, same
 * meanings, as the flash queue above.
 *
 * A new batch REPLACES the queue rather than lining up behind it (the flash
 * queue's rule): the lines a superseded stage was holding are already in the
 * log the new batch was appended to, so making the player wait for them now
 * would hold the newest events hostage to the oldest.
 */
export function queueBeats(stages: readonly BeatStage[], now: number): Beat[] {
  if (stages.length < 2) return [];
  const gap = Math.max(STAGGER_MS, Math.min(HOLD_MS, MAX_LEAD_MS / (stages.length - 1)));
  return stages.map((s, i) => ({ ...s, at: now + Math.min(i * gap, MAX_LEAD_MS) }));
}

/** how many log lines at the TAIL of the log have not been told yet */
export const heldLines = (beats: readonly Beat[], now: number): number =>
  beats.reduce((n, b) => (b.at > now ? n + b.lines : n), 0);

/** the beats whose moment has come and which the client has not played yet */
export const dueBeats = (beats: readonly Beat[], now: number): Beat[] =>
  beats.filter(b => !b.fired && b.at <= now);

/** the next clock reading at which the log says something new, or null */
export function nextBeatWake(beats: readonly Beat[], now: number): number | null {
  let best: number | null = null;
  for (const b of beats) if (b.at > now && (best === null || b.at < best)) best = b.at;
  return best;
}
