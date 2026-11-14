/* Cube-event messages as the bell shows them (docs/25).
 *
 * Every one is a row of the event's own notes (server/cube-store.ts addNote), sent under
 * `cube` by /api/inbox. Each is one short sentence, and its one button opens the event.
 *
 * Pure. `CUBE_LINES` is keyed by the server's `CubeNoteKind`, so a kind added there is a
 * type error here until it has a line; 1347 also reads the union off the source.
 */
import { esc } from './util.ts';
import type { CubeNote, CubeNoteKind } from '../server/cube-types.ts';

const ev = (n: CubeNote): string => `<b>${esc(n.eventName || 'the cube event')}</b>`;

const CUBE_LINES: Record<CubeNoteKind, (n: CubeNote) => string> = {
  starting: n => `The draft is starting — ${ev(n)}.`,
  // Swiss: the round and who you play (null = a bye); round robin: the whole schedule at once
  round: n => n.round === undefined
    ? `The schedule is posted — ${ev(n)}.`
    : n.opponent ? `Round ${esc(n.round)} is up: you play <b>${esc(n.opponent)}</b>.`
    : `Bye this round — ${ev(n)}.`,
  match: n => `Your match is ready: <b>${esc(n.opponent || 'your opponent')}</b>.`,
  done: n => `${ev(n)} is over.`,
};

/** every kind this page has a line for (the test compares it to the server's union) */
export const CUBE_NOTE_KINDS = Object.keys(CUBE_LINES) as CubeNoteKind[];

/** One note as a sentence of markup. A kind newer than this page still gets a line. */
export function cubeNoteLine(n: CubeNote): string {
  const f = (CUBE_LINES as Partial<Record<string, (n: CubeNote) => string>>)[n.kind];
  return f ? f(n) : `News from ${ev(n)}.`;
}
