/* SEALED — a cube event's pools dealt at once, no draft (docs/25-cube-draft.md §14).
 *
 * PURE: randomness comes from the event's seed.
 *
 *   sealedCube  the cube the pools are dealt from: each distinct card of the event's pool,
 *               `copies` times (1 singleton, 2 repeats), in the pool's order
 *   sealedMath  can that cube deal `seats` pools of `cards`? Unique pools are dealt without
 *               replacement, so they need seats × cards; one shared pool needs only cards
 *   dealSealed  shuffle the cube and deal: the same slice to every seat, or one slice each
 */
import type { SealedMath } from './cube-types.ts';
import { rng } from './league.ts';

/** a pool must hold at least a deck (main ≥ 30) */
export const SEALED_MIN = 30;
export const SEALED_MAX = 150;
export const SEALED_DEFAULT = 75;

/** every distinct name of `pool`, `copies` times each, in first-seen order */
export function sealedCube(pool: readonly string[], copies: 1 | 2): string[] {
  return [...new Set(pool)].flatMap(n => (copies === 2 ? [n, n] : [n]));
}

export function sealedMath(cube: number, seats: number, cards: number, same: boolean): SealedMath {
  const need = same ? cards : seats * cards;
  return { seats, cards, need, have: cube, ok: seats >= 1 && cards >= SEALED_MIN && need <= cube };
}

/** one pool per seat, `cards` each. Throws if the cube is too small (check sealedMath first). */
export function dealSealed(cube: readonly string[], seats: number, cards: number, same: boolean, seed: number): string[][] {
  if (!sealedMath(cube.length, seats, cards, same).ok) {
    throw new Error(`dealSealed: ${cube.length} cards cannot deal ${seats} ${same ? 'copies of one pool' : 'pools'} of ${cards}`);
  }
  const rand = rng(seed);
  const xs = [...cube];
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return Array.from({ length: seats }, (_, s) => (same ? xs.slice(0, cards) : xs.slice(s * cards, (s + 1) * cards)));
}
