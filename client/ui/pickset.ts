/*
 * THE PICK-SET DIALOG — Wake the Dead, Tides of the Cosmos, and Big Glimpse
 * Card's split.
 *
 * The owner, 2026-09-28: *"UI for Wake the Dead kinda sucks. We should not be
 * using a 'search' for that. It should show a modal, with oppo's binned units
 * on one side, yours on the other side. Selecting units highlights them … and
 * there's a count of the remaining mana above. We should probably have a
 * similar UI for the other big 8 mana 'choose 2 among with cost 8 or less'
 * cards."*
 *
 * ⚠ UI-ONLY, AND THAT IS THE WHOLE DESIGN. The engine still asks one question
 * per pick ("play a unit … (8 cost left)", then again with what is left), and
 * each answer is still an option INDEX. This dialog collects the whole set,
 * then answers the questions in a row: the first pick's index now, and — once
 * the follow-up question has ARRIVED — the second pick found in it BY VALUE.
 * Never by index: the engine rebuilds the options for the second question (the
 * first pick is gone from them, and so is anything over the new budget), so
 * index 2 on the first question is a different card, or nothing, on the
 * second. Nothing new reaches the action log, so no saved game drifts.
 *
 * The values are stable across the two questions by construction: neither
 * card removes anything from a bin or the deck until both are answered.
 *
 * If the follow-up does not carry the card the player chose (something moved
 * under it), nothing is sent: the dialog comes back up over the question that
 * is really open. A wrong pick is never sent.
 *
 * What is decided here is the budget arithmetic for GREYING only — the engine
 * is still the judge of what is offered, and a card the dialog wrongly thought
 * fits lands in that fallback rather than in a wrong play.
 *
 * BIG GLIMPSE CARD (CT-539, report #349 — invi: *"make a view where you can
 * reorder the cards between two piles until happy"*). The engine asks the
 * splitter for pile 1 one card at a time, then "Done splitting", and a pick
 * could not be taken back. Group 'split' draws the seven as two piles: a tap
 * moves a card from one to the other, as often as the player likes, and
 * Confirm answers the engine's questions in a row — every pile-1 card, each
 * found by value in its own question, then "Done splitting". No mana cap
 * (`budget` absent); the order cards were ticked in does not matter (the
 * piles keep the revealed order).
 */
import type { Decision, Seat } from '../engine/src/types.ts';
import { getCard } from '../engine/src/cards/dsl.ts';
import type { Badge } from './inspect.ts';

/** one card on offer: the option it answers with, and what it costs */
export interface PickCard { i: number; name: string; cost: number; seat: Seat | null }

/** everything the dialog draws, read off one decision */
export interface PickSetView {
  key: string;
  seat: Seat;
  /** the card asking ("Wake the Dead") */
  title: string;
  group: 'bins' | 'reveal' | 'split';
  /** mana left for this question, before anything is ticked in the dialog;
   * null when the set has no mana cap (the split) */
  budget: number | null;
  /** already chosen on an earlier question */
  picked: number;
  max: number;
  cards: PickCard[];
  /** the option that plays nothing more ("Done") */
  done: number;
  /** the cards an earlier question of this same set already took (CR 102.3b:
   * `Decision.earlier`), drawn in pile 1 and fixed there — only the split
   * draws them, for a dialog reopened part-way through its answers */
  locked: string[];
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** a card's cost as the two cards count it (an X card counts 0, `manaOf`) */
const costOf = (name: string): number => {
  try {
    const m = getCard(name).mana;
    return typeof m === 'number' ? m : 0;
  } catch { return 0; }
};

/** "<seat>:<binIndex>" — Wake the Dead's value, which names the bin */
const seatOf = (value: unknown): Seat | null => {
  const m = typeof value === 'string' ? /^(\d+):\d+$/.exec(value) : null;
  return m ? Number(m[1]) as Seat : null;
};

/** the dialog's reading of a decision, or null when it is not one of these
 * (then the ordinary decision bar draws it, exactly as before) */
export function pickSetView(dec: Decision | null | undefined): PickSetView | null {
  const ps = dec?.pickSet;
  if (!dec || !ps) return null;
  const done = dec.options.filter(o => !o.card);
  if (done.length !== 1) return null;           // not the shape this dialog knows
  const cards = dec.options.flatMap((o, i) => o.card
    ? [{ i, name: o.card, cost: costOf(o.card), seat: seatOf(o.value) }] : []);
  if (ps.group === 'bins' && cards.some(c => c.seat === null)) return null;
  return {
    key: `${dec.id}|${dec.prompt}|${dec.options.map(o => `${JSON.stringify(o.value)}${o.card ?? ''}`).join(',')}`,
    seat: dec.seat, title: dec.prompt.split(':')[0]!.trim(), group: ps.group,
    budget: ps.budget ?? null, picked: ps.picked, max: ps.max, cards,
    done: dec.options.indexOf(done[0]!),
    locked: ps.group === 'split'
      ? (dec.earlier ?? []).flatMap(e => e.seat === dec.seat && e.open && e.option?.card ? [e.option.card] : [])
      : [],
  };
}

// ── the state: one selection per question, and the answer in flight ──────

interface Sel {
  key: string;
  /** option indices, in the order they were ticked */
  chosen: number[];
  hidden: boolean;
  /** the follow-up did not offer what was chosen — say so once */
  note: string;
}
const NO_SEL: Sel = { key: '', chosen: [], hidden: false, note: '' };
let sel: Sel = { ...NO_SEL };

/** the second answer, waiting for its question to arrive */
interface Chain {
  /** the question the first answer went to */
  from: string;
  /** the actionCount it was sent against — a new state is what "arrived" means */
  at: number;
  /** the values still to send, one per follow-up question, in order; once
   * they are all sent, a follow-up still asking is answered "Done" */
  want: { value: unknown; name: string }[];
  /** how many of the set will have been chosen once the answer in flight
   * lands — when that reaches `max` the engine asks no more */
  count: number;
  max: number;
}
let chain: Chain | null = null;

function selFor(v: PickSetView): Sel {
  if (sel.key !== v.key) sel = { ...NO_SEL, key: v.key };
  sel.chosen = sel.chosen.filter(i => v.cards.some(c => c.i === i));
  return sel;
}

const costAt = (v: PickSetView, i: number): number => v.cards.find(c => c.i === i)?.cost ?? 0;

/** mana left once the ticked cards are paid for (null: no mana cap) */
function left(v: PickSetView, chosen: number[]): number | null {
  return v.budget === null ? null : v.budget - chosen.reduce((n, i) => n + costAt(v, i), 0);
}

/** can this card be clicked right now? A ticked card always can (to untick) */
function canTick(v: PickSetView, chosen: number[], i: number): boolean {
  if (chosen.includes(i)) return true;
  if (v.picked + chosen.length >= v.max) return false;
  const l = left(v, chosen);
  return l === null || costAt(v, i) <= l;
}

/** is the dialog up over this question? Not while the second answer is on
 * its way to it — that frame belongs to the chain, not to the player. */
export function pickSetUp(dec: Decision | null | undefined): boolean {
  const v = pickSetView(dec);
  if (!v) return false;
  if (chain && chain.from !== v.key) return false;
  return !selFor(v).hidden;
}

/** the dialog's buttons: 'pspick' (data-i), 'pshide', 'psshow', 'psconfirm'.
 * Returns the option index to send now, or null. `actionCount` is the state
 * the send is made against — the follow-up is whatever state comes after it. */
export function pickSetButton(dec: Decision | null | undefined, btn: string, i: number, actionCount: number): number | null {
  const v = pickSetView(dec);
  if (!v) return null;
  const s = selFor(v);
  if (btn === 'pshide') { s.hidden = true; return null; }
  if (btn === 'psshow') { s.hidden = false; chain = null; return null; }
  if (btn === 'pspick') {
    if (!canTick(v, s.chosen, i)) return null;
    s.chosen = s.chosen.includes(i) ? s.chosen.filter(x => x !== i) : [...s.chosen, i];
    s.note = '';
    return null;
  }
  if (btn !== 'psconfirm') return null;
  if (!s.chosen.length) { chain = null; return v.done; }
  const [first, ...rest] = s.chosen as [number, ...number[]];
  const opts = dec!.options;
  // the rest go to the follow-ups, by value; a question that could still ask
  // for another once they are all in is answered "Done"
  chain = v.picked + 1 < v.max
    ? {
      from: v.key, at: actionCount,
      want: rest.map(i => ({ value: opts[i]!.value, name: opts[i]!.card ?? '' })),
      count: v.picked + 1, max: v.max,
    }
    : null;
  return first;
}

/**
 * Once per received state: if the first answer has landed and its follow-up
 * is open, the index of the second answer in it — found by VALUE. Null means
 * send nothing (still waiting, or the chain is over). When the follow-up does
 * not offer what was chosen, the chain ends, nothing is sent, and 'reopen'
 * asks for the repaint that puts the dialog back up over the real question.
 */
export function pickSetFollowUp(dec: Decision | null | undefined, actionCount: number): number | 'reopen' | null {
  // no question of this kind open and nothing in flight: forget the last
  // one's picks, so a later question can never inherit them
  if (!chain && !pickSetView(dec)) { sel = { ...NO_SEL }; return null; }
  if (!chain) return null;
  if (actionCount === chain.at) return null;               // still waiting on the first
  const v = pickSetView(dec);
  // the same question is still open: the first answer has not landed (CR D2.1b
  // lets the other seat act meanwhile, so a new state is not proof it has).
  // Keep waiting; a refusal leaves the dialog up, and Confirm starts again.
  if (v && v.key === chain.from) return null;
  const c = chain;
  chain = null;
  // the question moved on without a follow-up (nothing else fits), or this
  // is a new set altogether: nothing to send
  if (!v || v.picked === 0) return null;
  const [next, ...rest] = c.want;
  if (!next) return v.done;
  const want = JSON.stringify(next.value);
  const hit = v.cards.find(k => JSON.stringify(dec!.options[k.i]!.value) === want);
  if (hit) {
    // more of the set to send, or a "Done" still owed: wait for the next one
    if (c.count + 1 < c.max) chain = { ...c, from: v.key, at: actionCount, want: rest, count: c.count + 1 };
    return hit.i;
  }
  const s = selFor(v);
  s.hidden = false;
  s.note = `${esc(next.name || 'That card')} can't be chosen now. Pick again.`;
  return 'reopen';
}

/** how the dialog draws one card — ui/main.ts's cardHtml */
type CardFn = (name: string, opts: {
  playable?: boolean; selected?: boolean; badges?: Badge[]; data?: string;
}) => string;

/** the dialog. `iconize` turns "[6]" into the mana orb the rest of the board uses. */
export function pickSetHtml(dec: Decision | null | undefined, card: CardFn, iconize: (s: string) => string): string {
  const v = pickSetView(dec);
  if (!v) return '';
  const s = selFor(v);
  const scan = (c: PickCard): string => {
    const on = s.chosen.includes(c.i);
    const ok = canTick(v, s.chosen, c.i);
    const face = card(c.name, {
      playable: ok && !on, selected: on,
      badges: [{ t: iconize(`[${c.cost}]`), html: true, cls: 'pscost' }],
      ...(ok ? { data: `data-btn="pspick" data-i="${c.i}"` } : {}),
    });
    return `<div class="pscard${on ? ' on' : ok ? '' : ' off'}">${face}</div>`;
  };
  const pane = (label: string, cards: PickCard[]): string => `<div class="pspane">
      <div class="zonelabel">${label}</div>
      <div class="zone">${cards.map(scan).join('') || '<span class="binempty">none</span>'}</div></div>`;
  const n = s.chosen.length;
  const panes = v.group === 'bins'
    ? pane('Their bin', v.cards.filter(c => c.seat !== v.seat)) + pane('Your bin', v.cards.filter(c => c.seat === v.seat))
    : pane('Revealed', v.cards);
  // one scrim for every layout (269's overlay census counts where it is written)
  const body = v.group === 'split' ? splitHtml(v, s, card) : `
    <div class="psbar"><span class="pstitle">${esc(v.title)}</span>
      <span class="pscount">${left(v, s.chosen)} mana left · ${v.picked + n} of ${v.max} chosen</span>
      <button data-btn="pshide" title="your picks are kept (Esc)">▁ look at the board</button></div>
    ${s.note ? `<div class="psnote">${s.note}</div>` : ''}
    <div class="pspanes">${panes}</div>
    <div class="psfoot"><button class="primary" data-btn="psconfirm">${n ? `Play ${n}` : 'Play none'}</button></div>`;
  return `<div class="overlay psover"><div class="overlaybox psbox">${body}
  </div></div>`;
}

/**
 * CT-539 — Big Glimpse Card's split as two piles. Every card is a button that
 * moves it to the other pile (ticked = pile 1), as often as the player likes;
 * nothing is sent until Confirm. A card an earlier answer already put in pile
 * 1 (`locked`) is drawn there and cannot move — that answer is in the log.
 */
/** the box's contents; pickSetHtml wraps them in the one scrim */
function splitHtml(v: PickSetView, s: Sel, card: CardFn): string {
  const scan = (c: PickCard): string => {
    // no ring: which pile a card sits in already says it is chosen
    const face = card(c.name, {
      playable: true,
      data: `data-btn="pspick" data-i="${c.i}"`,
    });
    return `<div class="pscard">${face}</div>`;
  };
  const fixed = (name: string): string =>
    `<div class="pscard locked" title="already in pile 1">${card(name, {})}</div>`;
  const one = [...v.locked.map(fixed), ...v.cards.filter(c => s.chosen.includes(c.i)).map(scan)];
  const two = v.cards.filter(c => !s.chosen.includes(c.i)).map(scan);
  const pane = (label: string, faces: string[]): string => `<div class="pspane">
      <div class="zonelabel">${label}</div>
      <div class="zone">${faces.join('') || '<span class="binempty">empty</span>'}</div></div>`;
  return `
    <div class="psbar"><span class="pstitle">${esc(v.title)}: split the cards into two piles</span>
      <span class="pscount">${one.length} in pile 1 · ${two.length} in pile 2</span>
      <button data-btn="pshide" title="your piles are kept (Esc)">▁ look at the board</button></div>
    ${s.note ? `<div class="psnote">${s.note}</div>` : ''}
    <div class="pshint">Tap a card to move it to the other pile. Your opponent caches one pile and recycles the other.</div>
    <div class="pspanes">${pane('Pile 1', one)}${pane('Pile 2', two)}</div>
    <div class="psfoot"><button class="primary" data-btn="psconfirm">Confirm the piles</button></div>`;
}
