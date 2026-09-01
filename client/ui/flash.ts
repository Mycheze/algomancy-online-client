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
import { PACE_MAX_HELD, PACE_MS } from './pace.ts';
import type { EngineEvent, EventType, Seat, StackItem } from '../engine/src/types.ts';

/*
 * ── R242: ONE TEMPO FOR THE WHOLE CLIENT ─────────────────────────────
 *
 * The owner, 2026-08-29:
 *
 *   "Sometimes, when no players have more actions they can take, the game
 *    instantly resolves everything and it's impossible to follow. Even during
 *    times like that, there should be a max speed. We should see all the
 *    triggers go onto the stack (in the right order, all at once) and then
 *    slowly resolve. Think about it from a human's perspective, especially
 *    someone who's learning the game and wants to see how things generally
 *    work and follow along."
 *
 * ⚠ THIS IS THE SECOND TIME HE HAS ASKED, and the first answer was only half
 * built. Report #94 (SMVJ) said *"We need a 'max speed' that the gamestate can
 * resolve/put things onto the stack […] at a max speed of 1 thing per second"*,
 * and R150 built `ui/pace.ts` for it — which throttles updates BETWEEN server
 * batches, at `PACE_MS` = 1 second, exactly as asked.
 *
 * But a cascade nobody can respond to is not several batches. `engine.ts`
 * `settle()` drains the whole thing inside ONE action (R144(a): outside battle
 * there are no priority windows, so the stack is drained at the settle point,
 * top down), and `pumpCombatDamage` runs Swift → normal → Sluggish in one
 * `while` loop. The client receives ONE update. `pace.ts` has nothing to space
 * out, and the WITHIN-batch pacing here was the only thing left running —
 * at 280ms a beat, three and a half times faster than the ceiling the same
 * owner had already asked for, and then giving up entirely 2.2 seconds in.
 *
 * That is the whole bug: two queues that pace the same table, holding two
 * different opinions about how fast a human reads, and the faster one owns
 * exactly the case the slower one cannot reach.
 *
 * So the tempo is now ONE number, imported. `ui/pace.ts` already declared
 * itself the home of it ("ONE named constant — the interval is not to be
 * spelled out anywhere else"); this file was the place that spelled it out
 * again.
 */

/** how long one flashed item sits on the visual stack. The ask was "at least
 * a second so that it doesn't happen too fast" — long enough to read the art
 * and the name. It must stay >= the gap below, or a beat would vanish before
 * its successor arrived and a cascade would flicker instead of hand over. */
export const HOLD_MS = 1200;
/**
 * The gap between two BEATS of one batch — R189's groups, not items, so a
 * batch that is simultaneous in the rules still arrives together ("all the
 * triggers go onto the stack, in the right order, all at once") and it is the
 * RESOLUTION that is paced ("and then slowly resolve").
 *
 * ⚠ It is the client-wide ceiling, not a number of its own. It was 280ms.
 */
export const STAGGER_MS = PACE_MS;
/**
 * How far behind the board the queue may run before the spacing collapses and
 * the rest of the batch arrives together.
 *
 * ⚠ EXPRESSED IN BEATS, NOT IN MILLISECONDS, and that is the fix rather than a
 * tidy-up. It was a flat 2200ms — which, once the gap is a full second, binds
 * after TWO beats and hands a long cascade straight back to the instant
 * resolution this exists to prevent. The bound is a real one and stays; it is
 * the same bound, and now the same arithmetic, as `pace.ts`'s own
 * `PACE_MAX_HELD` clamp on the update queue.
 */
export const MAX_LEAD_MS = PACE_MS * PACE_MAX_HELD;

export interface Flash {
  /** the item exactly as it stood a moment before it resolved */
  item: StackItem;
  /** clock reading at which it appears on the visual stack */
  at: number;
  /** clock reading at which it leaves again */
  until: number;
  /** R271 / CT-142: it did not resolve — it fizzled. See `fizzledIds`. */
  fizzled?: boolean;
  /**
   * R271: this beat was reconstructed from `seen` because the item has LEFT
   * the stack — the client's `s<id>` key really was in the census a render ago
   * and really is gone now, and the CARD is really travelling (to a bin, to
   * the erased pile, out of existence).
   *
   * That is the whole question `censusFlashes` asks, and it used to ask it as
   * `!item.negated` — true only while negation was the one way an item could
   * leave without resolving. A fizzled item leaves the same way, so a phantom
   * slot for it would keep its key alive across the diff, `stack>bin` would
   * never pair, and the card would pop into the bin instead of flying there.
   */
  detached?: boolean;
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

/**
 * R271 / CT-142 — the stack ids a batch of events took off the stack because
 * the item FIZZLED: it reached its resolution and had nothing left to do.
 *
 * `negated` and `fizzled` are the same SHAPE of fact — "this item left the
 * stack and did nothing" — and the engine emits them the same way, `{ id }`
 * and nothing else (engine.ts's two fizzle sites). They are not the same fact:
 * a negation is something an opponent DID, a fizzle is something that happened
 * TO the item, and the client used to call the second one "resolved", which is
 * the opposite of the truth about it.
 */
export function fizzledIds(events: readonly EngineEvent[]): number[] {
  const out: number[] = [];
  for (const ev of events) {
    if (ev.type !== 'fizzled') continue;
    const id = ev.data?.['id'];
    if (typeof id === 'number') out.push(id);
  }
  return out;
}

/**
 * Snapshots of the items a batch of events fizzled, for their beat — the same
 * `seen` reconstruction `negatedFlashItems` does, and for the same reason.
 *
 * ⚠ THE TWO PATHS ARE NOT THE SAME, which is why this only covers one of them.
 * An item that fizzles on the REAL stack emits no `stackFlash` — nothing
 * snapshotted it, so before R271 it simply vanished from the strip with no
 * beat at all. An item nobody could respond to emits `stackFlash` FIRST
 * (engine.ts commitItem) and then fizzles inside the same batch, so the engine
 * has already handed over a copy and this must NOT hand over a second one.
 * `flashBatches` skips an id it has already drawn; the fizzled MARK is stamped
 * on the queue entry either way (`queueFlashes`), because the label is about
 * what happened, not about where the copy came from.
 *
 * Nothing is stamped on the item itself: `StackItem.negated` is an engine
 * field and there is no `fizzled` beside it. A fizzle is a fact about a BEAT,
 * so it rides on `Flash` and `StackRow` — the client's own model — and
 * `rowState` is the one place that reads it.
 */
export function fizzledFlashItems(
  events: readonly EngineEvent[], seen: ReadonlyMap<number, StackItem>,
): StackItem[] {
  const out: StackItem[] = [];
  for (const id of fizzledIds(events)) {
    const item = seen.get(id);
    if (item) out.push({ ...item });
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
 * R189 — playtest report #105 (GYSR, 2026-08-25): *"All triggers from death
 * (and after combat) should go onto the stack VISUALLY at the same time. The
 * Geode's trigger did, but not visually."*
 *
 * ONE BATCH IS ONE BEAT. `queueFlashes` used to stamp every item of an
 * arriving batch STAGGER_MS apart, unconditionally, which draws a death sweep
 * — several triggers queued together and drained back to back — as several
 * separate things happening one after another. It is ONE thing happening, and
 * the screen said otherwise.
 *
 * The instructive counterpart is report #53 (*"damage and all effects happened
 * instantly"*), which asked for the opposite. So the rule here is neither
 * "stage more" nor "stage less": **a batch that is simultaneous in the rules
 * must LOOK simultaneous, and a sequence must look sequential.** Both halves
 * fall out of the same fixture — a Swift sub-step's death and the normal
 * sub-step's two deaths arrive in ONE server update and must be TWO beats, the
 * second of which shows two cards at once.
 *
 * ── HOW A BATCH IS RECOGNISED ────────────────────────────────────────
 *
 * A trigger that is QUEUED (`triggered`) leaves the queue exactly one of two
 * ways: onto the real stack (`stackPushed`), or — nobody may respond to it —
 * resolving on the spot (`stackFlash`). Everything queued before the drain
 * starts is simultaneous; anything queued after it has started is the next
 * generation. That is the whole test, and it is legible in the event ORDER
 * with no engine change at all. From the real corpus (SMVJ, one action each):
 *
 *     died · triggered · FLASH(12) · resolved                    ← one beat
 *     died · triggered · died · triggered · FLASH(14) · FLASH(16)
 *                                             ← one LATER beat, two cards
 *
 * ⚠ POSITIVE EVIDENCE ONLY. A flash joins its neighbours only when THIS batch
 * carries the `triggered` marker that put it in the queue — `armed` below is
 * that unspent-marker count. Three consequences, all wanted:
 *
 *   · a spell, a unit or an activation is never grouped. It is not a trigger,
 *     and a deployment reveal of six cards stays the six beats docs/11 asked
 *     for.
 *   · a trigger whose marker arrived in an EARLIER update gets its own beat.
 *     That is GYSR's own moment: three death triggers were queued together at
 *     action 135 and each stopped on a decision, so each reached the client in
 *     an update of its own. They were not simultaneous ON THE WIRE and no
 *     pacing rule can honestly make them so.
 *   · a batch this module can read nothing about behaves exactly as it did
 *     before R189.
 *
 * R68's negated items are appended after, one group each, exactly as before:
 * they are not trigger drains and nothing here knows whether two negations
 * were one act.
 */
export function flashBatches(
  events: readonly EngineEvent[], remembered: ReadonlyMap<number, StackItem> = new Map(),
): StackItem[][] {
  const groups: StackItem[][] = [];
  let cur: StackItem[] = [];
  /** triggers queued in this batch that have not yet left the queue */
  let armed = 0;
  const close = (): void => { if (cur.length) { groups.push(cur); cur = []; } };
  for (const ev of events) {
    if (ev.type === 'triggered') {
      // a new arrival in the queue AFTER this generation began draining ends
      // it: that is a cascade, and a cascade is a sequence
      close();
      armed++;
      continue;
    }
    if (ev.type === 'stackPushed') { if (armed > 0) armed--; continue; }
    if (ev.type !== 'stackFlash') continue;
    const item = ev.data?.['item'] as StackItem | undefined;
    if (!item || typeof item.id !== 'number') continue;
    if (item.kind !== 'triggered' || armed === 0) { close(); groups.push([item]); continue; }
    armed--;
    cur.push(item);
  }
  close();
  for (const item of negatedFlashItems(events, remembered)) groups.push([item]);
  // R271: …and the same for a fizzle, EXCEPT that the engine may already have
  // snapshotted this one (an unrespondable item flashes and then fizzles in
  // one batch). Drawing it twice would put two copies of the spell on the
  // strip, which is the bug `stackRows` guards against one layer down.
  const drawn = new Set(groups.flat().map(i => i.id));
  for (const item of fizzledFlashItems(events, remembered)) {
    if (!drawn.has(item.id)) { drawn.add(item.id); groups.push([item]); }
  }
  return groups;
}

/**
 * Fold one action's events into the queue.
 *
 * New arrivals line up BEHIND whatever is already pending, so two clicks in
 * quick succession read as two beats rather than one pile — up to MAX_LEAD_MS,
 * after which they land together instead of drifting further from the board
 * they are supposed to be explaining.
 *
 * R189: the unit of spacing is a `flashBatches` GROUP, not an item. Everything
 * inside one group shares an arrival; groups are STAGGER_MS apart, as items
 * used to be.
 */
export function queueFlashes(
  existing: readonly Flash[], events: readonly EngineEvent[], now: number,
  remembered: ReadonlyMap<number, StackItem> = new Map(),
): Flash[] {
  // two sources, one queue: items that never reached the stack (the engine's
  // own snapshots) and items R68 took OFF it without resolving (ours)
  const groups = flashBatches(events, remembered);
  if (!groups.length) return existing as Flash[];
  // R271: which of these beats is a fizzle, and which had to be dug out of the
  // client's own memory. Both are read off the SAME batch the groups came
  // from, so nothing here has to be threaded through `flashBatches` — an item
  // the engine snapshotted is in `flashItems`, and one that was not is a beat
  // this module reconstructed and whose card is on its way somewhere.
  const fizzled = new Set(fizzledIds(events));
  const snapshotted = new Set(flashItems(events).map(i => i.id));
  const out = existing.slice();
  const seen = new Set(out.map(f => f.item.id));
  let at = now;
  for (const f of out) at = Math.max(at, f.at + STAGGER_MS);
  for (const group of groups) {
    // a resync must not replay a beat — and a group whose every item has
    // already had one must not spend a stagger step either
    const fresh = group.filter(i => !seen.has(i.id));
    if (!fresh.length) continue;
    at = Math.min(at, now + MAX_LEAD_MS);
    /**
     * R242 — ONE ARRIVAL, N DEPARTURES. The owner's sentence is the spec:
     * *"We should see all the triggers go onto the stack (in the right order,
     * all at once) and then slowly resolve."*
     *
     * A group is simultaneous in the rules (R189), so every item of it SHARES
     * an arrival — that is the "all at once", and it was already true. What
     * was not is the second half: the group also shared a DEPARTURE, so three
     * simultaneous triggers appeared together and then vanished together, and
     * the resolution nobody could respond to was never shown at all.
     *
     * They leave one tempo-step apart instead, in the order they resolved
     * (`stackFlash` fires AT the resolution, so event order is resolution
     * order). The stack visibly drains, which is the thing a person learning
     * the game is trying to watch.
     */
    fresh.forEach((item, i) => {
      seen.add(item.id);
      // R271: a negation is never also a fizzle — an item that left the stack
      // because someone answered it never reached the resolution that could
      // fizzle — so the two marks are exclusive at the source, not just at the
      // renderer. `rowState` relies on that.
      const fizz = fizzled.has(item.id) && !item.negated;
      out.push({
        item, at, until: at + HOLD_MS + i * STAGGER_MS,
        fizzled: fizz,
        detached: item.negated || (fizz && !snapshotted.has(item.id)),
      });
    });
    // …and the next group starts once this one has finished draining, or the
    // two would overlap and the sequence would read as a pile again
    at += STAGGER_MS * fresh.length;
  }
  return out;
}

/** the flashes on the visual stack at `now` */
export const visibleFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => f.at <= now && now < f.until);

/** the queue with everything that has had its beat dropped */
export const pruneFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => now < f.until);

/**
 * R242 — THE ESCAPE HATCH, which the ⏭ chip did not previously reach.
 *
 * `paceskip` flushed `ui/pace.ts`'s update queue and nothing else, because
 * before this change the beat queues emptied themselves inside 2.2 seconds and
 * there was nothing worth skipping. Now a cascade can legitimately hold the
 * table for a dozen beats, so the player must be able to end it — a ceiling
 * you cannot opt out of is not a courtesy, it is a wait.
 *
 * Skipping drops the pending beats outright rather than replaying them fast:
 * the board underneath is ALREADY the live state (a beat is a replay for the
 * eye, never a state), so there is nothing to catch up to.
 */
export const flushFlashes = (): Flash[] => [];

/** how many beats are still to come — what the ⏭ chip counts, so it can offer
 * itself during a cascade and not only during an update backlog */
export const pendingFlashes = (list: readonly Flash[], now: number): number =>
  list.reduce((n, f) => (f.at > now ? n + 1 : n), 0);

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
  /** R271 / CT-142: this beat is a FIZZLE — it left the stack at its own
   * resolution with nothing left to do. Never true unless `flashing` is. */
  fizzled: boolean;
  /** R271: the beat was reconstructed from `seen`, so the card itself is
   * really travelling. See `Flash.detached` and `censusFlashes`. */
  detached: boolean;
}

/**
 * R271 / CT-142 — WHAT ONE ROW IS, as one word, computed in ONE place.
 *
 * The board used to spell the question out at each of the three places that
 * asked it (`stackBoardHtml`'s marks, its chip, and `stackCaption`), as nested
 * ternaries over `resolving` / `flashing` / `negated`. Report CT-142: a FIZZLE
 * is none of those, so it fell through the last branch and the strip said
 * "resolved" about a spell that had just done nothing — the client asserting
 * the opposite of the truth.
 *
 * Adding a fourth state to three separate ternaries is how they drift, and
 * "the states are mutually exclusive" is not a property three ternaries can
 * have — it is a property of a function with one return. So this is that
 * function, every caller reads it, and a new state is added here once.
 *
 *   resolving  R78 — off the stack, past every response window, NOT finished
 *   answered   R68 — an opponent negated it (or recalled it: same fact)
 *   fizzled    R271 — it resolved into nothing: no legal target left, or the
 *              host it was riding has gone
 *   resolved   it did what it said
 *   waiting    it is still on the stack with its turn to come
 */
export type RowState = 'resolving' | 'answered' | 'fizzled' | 'resolved' | 'waiting';

export function rowState(row: StackRow): RowState {
  if (row.resolving) return 'resolving';
  if (!row.flashing) return 'waiting';
  if (row.item.negated) return 'answered';
  if (row.fizzled) return 'fizzled';
  return 'resolved';
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
    fizzled: false, detached: false,
  }));
  // R286: ONE CARD PER ID, the same rule the `resolving` fold applies below.
  // Every push onto a stack with no response window now flashes (see
  // `E.pushItem`), which is the only way the reader gets a beat for an item
  // that is pushed and drained inside one action. In the one case where the
  // drain stopped on a decision the item is ALSO a live row, and drawing both
  // would read as two copies of the spell — which is exactly the objection
  // R144(a) raised against flashing a deployment trigger at all. The live row
  // wins: it is the real thing, still standing there.
  const live = new Set(stack.map(i => i.id));
  for (const f of visibleFlashes(flashes, now)) {
    if (live.has(f.item.id)) continue;
    rows.push({
      item: f.item, flashing: true, top: false, resolving: false,
      fizzled: !!f.fizzled, detached: !!f.detached,
    });
  }
  if (!resolving) return rows;
  // one card per id, always: an item cannot be both waiting and resolving, but
  // a resync could hand us a stale beat for the very item that is now resolving
  // and drawing it twice would read as two copies of the spell.
  const out = rows.filter(r => r.item.id !== resolving.id);
  out.push({
    item: resolving, flashing: false, top: false, resolving: true,
    fizzled: false, detached: false,
  });
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
  const state = rowState(row);
  if (state === 'resolving') {
    const mine = opts.mySeat !== null && opts.mySeat !== undefined && row.item.controller === opts.mySeat;
    return { row, verb: mine ? 'resolving now' : `${name} is resolving`, by: null, pending: true };
  }
  // R271: one word per state, off the one classifier — the caption cannot hold
  // a different opinion from the chip above it about the same row.
  const VERB: Record<Exclude<RowState, 'resolving' | 'waiting'>, string> = {
    answered: 'was answered', fizzled: 'fizzled — it did nothing', resolved: 'just resolved',
  };
  const verb = state === 'waiting'
    ? (rows.length > 1 ? 'resolves next' : 'on the stack')
    : VERB[state];
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
 *
 * R271: `!item.negated` was the way this asked "has the card LEFT?", and it
 * was right only while negation was the one way to leave without resolving. A
 * FIZZLED item leaves exactly the same way and its card makes exactly the same
 * journey, so the question is now asked of the beat (`detached`) rather than
 * of one of the two answers to it. The negated check stays beside it: a
 * pre-R271 queue entry carries no `detached` flag and must still behave.
 */
export const censusFlashes = (rows: readonly StackRow[]): StackRow[] =>
  rows.filter(r => r.resolving || (r.flashing && !r.item.negated && !r.detached));

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

/**
 * The motion keys one event is about: the unit it hit, or the player it hit.
 *
 * R266 exports it. It is the client's own answer to "does this announcement
 * pulse anything on the board?", and `test/244-log-is-not-the-only-surface`
 * derives the log-only inventory by asking it rather than by keeping a second
 * copy of the rule — so widening the rule here narrows that inventory, which
 * is the direction the ruling wants and the direction a hand-typed list would
 * have missed.
 */
export function beatKeys(ev: EngineEvent): string[] {
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

/**
 * R242 — the same escape hatch for the NARRATIVE beats.
 *
 * ⚠ NOT the same implementation as `flushFlashes`, and the difference matters:
 * a beat is holding back real LOG LINES, so dropping the queue would drop the
 * story. Every beat is brought forward to `now` instead, which releases its
 * lines on the next paint. Nothing is lost — the player asked to stop waiting,
 * not to stop being told.
 */
export const flushBeats = (beats: readonly Beat[], now: number): Beat[] =>
  beats.map(b => (b.at > now ? { ...b, at: now } : b));

/** the beats whose moment has come and which the client has not played yet */
export const dueBeats = (beats: readonly Beat[], now: number): Beat[] =>
  beats.filter(b => !b.fired && b.at <= now);

/** the next clock reading at which the log says something new, or null */
export function nextBeatWake(beats: readonly Beat[], now: number): number | null {
  let best: number | null = null;
  for (const b of beats) if (b.at > now && (best === null || b.at < best)) best = b.at;
  return best;
}
