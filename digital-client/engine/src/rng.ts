/* Seeded RNG (mulberry32). The generator state is a plain number stored in
 * GameState.rngState, so replaying seed + action log reproduces every shuffle. */

/** One step: returns [float in [0,1), next state]. */
export function rngNext(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Fisher-Yates over a copy; returns [shuffled, next rng state]. */
export function rngShuffle<T>(items: readonly T[], state: number): [T[], number] {
  const a = items.slice();
  let s = state;
  for (let i = a.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = rngNext(s);
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return [a, s];
}
