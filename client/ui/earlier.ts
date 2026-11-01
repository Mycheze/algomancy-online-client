/* ── WHAT THE EARLIER CHOOSERS PICKED (CR 102.3a, 102.3b) ─────────────────
 *
 * When one effect asks each player in turn, the initiative player picks
 * first. The owner, 2026-11-01, relaying the rules channel: "So the INT player
 * picks their thing and, if it's open information, it should be highlighted
 * and clear what they've chosen, then NIT picks their thing. If it's hidden
 * information, no indication needs to be given, other than who's turn it is
 * to pick."
 *
 * The engine decides what is open (`EarlierPick`, engine/src/types.ts) and the
 * server serves it: on the asked seat's own `decision.earlier`, and on the
 * waiting seat's view as `earlierPicks` (server/view.ts). A hidden pick
 * arrives as `{ seat, open: false }` and nothing else, so there is nothing
 * here that could show more than that. Whose turn it is stays where it was:
 * the asked seat's prompt, and the waiting seat's "Waiting for …" line.
 *
 * Display only. Nothing here answers anything.
 */
import type { EarlierPick, EntityId, GameState, Seat } from '../engine/src/types.ts';
import { optionSubjects } from './boardpick.ts';

type WithPicks = GameState & { earlierPicks?: EarlierPick[]; pendingAsk?: { seat: Seat } };

/** the seat being asked right now, by whichever half of the wire says so */
function askerOf(s: GameState): Seat | null {
  return s.decision?.seat ?? (s as WithPicks).pendingAsk?.seat ?? null;
}

/** the earlier picks of the effect that is asking now, made by someone OTHER
 * than the seat being asked (its own earlier answers are its own business) */
export function earlierPicks(s: GameState): EarlierPick[] {
  const all = s.decision?.earlier ?? (s as WithPicks).earlierPicks ?? [];
  const asker = askerOf(s);
  return all.filter(p => p.seat !== asker);
}

/** the board units the earlier OPEN picks name, with who picked each */
export function earlierUnits(s: GameState): Map<EntityId, Seat> {
  const out = new Map<EntityId, Seat>();
  for (const p of earlierPicks(s)) {
    if (!p.open || !p.option || !p.kind) continue;
    const [sub] = optionSubjects({ id: 0, seat: p.seat, kind: p.kind, prompt: '', options: [p.option] }, s);
    if (sub?.at === 'unit') out.set(sub.id, p.seat);
  }
  return out;
}

const list = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * One short sentence per earlier chooser: "Gember chose Tidal Menace" for an
 * open pick, "Gember has chosen" for a hidden one. `viewer` is the seat looking
 * (null on a screen that is nobody's in particular); its own picks read "You".
 */
export function earlierNote(s: GameState, viewer: Seat | null): string {
  const bySeat = new Map<Seat, EarlierPick[]>();
  for (const p of earlierPicks(s)) (bySeat.get(p.seat) ?? bySeat.set(p.seat, []).get(p.seat)!).push(p);
  const out: string[] = [];
  for (const [seat, picks] of bySeat) {
    const who = seat === viewer ? 'You' : (s.players[seat]?.name ?? `Player ${seat + 1}`);
    const open = picks.filter(p => p.open && p.option).map(p => p.option!.label);
    const hidden = picks.length - open.length;
    if (open.length) out.push(`${who} chose ${list(open)}`);
    if (hidden) out.push(open.length ? `${who} also made a hidden choice` : `${who} ${seat === viewer ? 'have' : 'has'} chosen`);
  }
  return out.join(' · ');
}
