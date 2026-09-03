/* The helpers the card-todo proofs are written against — one module so the
 * open half and the closed half of the ledger read the same ones. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../engine/src/cards/registry.ts';
import { getCard } from '../engine/src/cards/dsl.ts';
import { Harness } from '../engine/src/harness.ts';
import { E } from '../engine/src/engine.ts';
import { spawn, toDeployment } from '../engine/test/util.ts';
import type { Seat } from '../engine/src/types.ts';
import { stripCode } from '../engine/test/stripcode.ts';

export const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'src');
export const ENGINE_SRC = fs.readFileSync(path.join(SRC_DIR, 'engine.ts'), 'utf8');
/** a card-batch file's source, comments and strings stripped (R148) */
export const setSrc = (file: string): string =>
  stripCode(fs.readFileSync(path.join(SRC_DIR, 'cards', 'sets', file), 'utf8'));


/** the source of a card's spell effect, comments and strings stripped */
export function runSrc(card: string): string {
  const f = getCard(card).spellEffect?.run;
  return stripCode(f ? f.toString() : '');
}

/** a two-unit board; returns the engine, the seats and the spawned ids */
export function board(seed: number, mine: string, theirs?: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const a = spawn(h, A, mine);
  const d = theirs ? spawn(h, D, theirs) : undefined;
  return { h, A, D, a, d };
}

/** run one card's spell effect against chosen targets and count what it SAID */
export function eventsFrom(
  card: string, seed: number, build: (g: E, A: Seat, D: Seat) => { targets: unknown[]; x?: number },
): number {
  const { h, A, D } = board(seed, 'Tidal Menace', 'The Foretold');
  const g = new E(h.state);
  const { targets, x } = build(g, A, D);
  const before = g.events.length;
  const def = getCard(card).spellEffect!;
  try {
    def.run(g, {
      controller: A, sourceName: card, region: g.homeRegion(A),
      targets: targets as never, x, event: null,
      choose: () => { throw new Error('choice'); },
    } as never);
  } catch { return -1; }        // suspended or threw: not a completed silent run
  return g.events.length - before;
}

