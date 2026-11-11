/* A PLAYER'S LIFE CHANGES, OFF THE LIFE TOTAL (report #380, BL-75).
 *
 * The owner, 2026-11-11: *"When you hover over a player's life total, it'd be
 * nice to show a simple "log" of the life total changes."* Hovering the total
 * (or tapping it on a touch screen when no pick wants the tap) opens the info
 * window (ui/infotip.ts) with that seat's changes this game, newest first:
 * the turn, the amount, the total after it, and what did it.
 *
 * BUILT FROM THE LOG LINES, NOT FROM EVENTS SEEN LIVE. A join, a reconnect, an
 * undo's resync and a spectator's payload all hand the client the whole log
 * as text, with no event types beside it (main.ts NetBackend: `logTypes` is
 * all `undefined` after one) — so the only record every one of them shares is
 * the sentence. The engine prints every life change in one of four fixed
 * shapes, and those four are the whole class (nothing else assigns a life
 * total — engine.ts gainLife / loseLife, apply.ts doSandboxLife and the agreed
 * fix, whose sentence is amend.ts amendText):
 *
 *   "<name> loses <n> life (<why>) → <total>."            E.loseLife
 *   "<name> gains <n> life (<why>) → <total>."            E.gainLife
 *   "[test mode] <name> set their life to <t> (was <w>)"  the sandbox
 *   "🛠 Agreed fix: set <name>'s life to <t> (it was <w>) — …"
 *
 * and "— Turn <n> (initiative: …) —" heads every turn.
 *
 * FOLDED THE WAY THE HIDDEN-TURN SUMMARY FOLDS (ui/reveal.ts foldLifeRuns,
 * owner 2026-09-05 on eleven one-point Flesh Tithe lines: "That's
 * unreadable"): a run of changes to one seat, in one direction, from one
 * cause, with nothing but the "pays N life — the cost of X" narration between
 * them, is ONE row — the amounts summed, the last total kept.
 *
 * The seat is told by its NAME at the start of the line. Two seats with the
 * same name cannot be told apart that way, so then there is no list rather
 * than a wrong one.
 */

/** one row of a seat's list */
export interface LifeRow {
  /** the turn it happened in; 0 before the first turn header */
  turn: number;
  /** signed: −3 lost, +2 gained (a set by a fix: the difference) */
  delta: number;
  /** the life total right after it */
  after: number;
  /** what did it, as the engine said it ("combat", "Bloated Manablub") */
  why: string;
}

const TURN = /^— Turn (\d+) \(/;
const PAY_LIFE = /^.+? pays \d+ life — the cost of .+\.$/;
const CHANGE = /^(loses|gains) (\d+) life \((.*)\) → (-?\d+)\.$/;
const SANDBOX = /^set their life to (-?\d+) \(was (-?\d+)\)$/;
const AMEND = /^🛠 Agreed fix: set (.+)'s life to (-?\d+) \(it was (-?\d+)\)/;

/** the one life change a log line says, if it says one */
function readLine(line: string, names: readonly string[]): { seat: number; ch: Omit<LifeRow, 'turn'> } | null {
  for (let seat = 0; seat < names.length; seat++) {
    const name = names[seat]!;
    if (line.startsWith(`${name} `)) {
      const m = CHANGE.exec(line.slice(name.length + 1));
      if (m) {
        const n = Number(m[2]);
        return { seat, ch: { delta: m[1] === 'loses' ? -n : n, after: Number(m[4]), why: m[3]! } };
      }
    }
    const sandbox = `[test mode] ${name} `;
    if (line.startsWith(sandbox)) {
      const m = SANDBOX.exec(line.slice(sandbox.length));
      if (m) return { seat, ch: { delta: Number(m[1]) - Number(m[2]), after: Number(m[1]), why: 'test mode' } };
    }
  }
  const fix = AMEND.exec(line);
  if (fix) {
    const seat = names.indexOf(fix[1]!);
    if (seat >= 0) return { seat, ch: { delta: Number(fix[2]) - Number(fix[3]), after: Number(fix[2]), why: 'an agreed fix' } };
  }
  return null;
}

/** every seat's life changes in the log, oldest first, runs folded. Pure. */
export function lifeHistory(log: readonly string[], names: readonly string[]): LifeRow[][] {
  const out: LifeRow[][] = names.map(() => []);
  if (new Set(names).size !== names.length) return out;
  let turn = 0;
  // the row a next line may still fold into: its seat, and nothing between but pay lines
  let open: { seat: number; row: LifeRow } | null = null;
  for (const line of log) {
    const t = TURN.exec(line);
    if (t) { turn = Number(t[1]); open = null; continue; }
    if (PAY_LIFE.test(line)) continue;
    const hit = readLine(line, names);
    if (!hit) { open = null; continue; }
    const { seat, ch } = hit;
    if (open && open.seat === seat && open.row.why === ch.why && Math.sign(open.row.delta) === Math.sign(ch.delta)
      && ch.why !== 'test mode' && ch.why !== 'an agreed fix') {
      open.row.delta += ch.delta;
      open.row.after = ch.after;
      continue;
    }
    const row: LifeRow = { turn, ...ch };
    out[seat]!.push(row);
    open = { seat, row };
  }
  return out;
}

/** how the cause reads in the list */
function whyText(why: string): string {
  const cost = /^(.+) \(cost\)$/.exec(why);
  return cost ? `paid for ${cost[1]}` : why;
}

/** the most rows the window lists; older ones are counted under it */
export const LIFE_ROWS = 12;

/** the window's inner HTML for one seat. `name` is already escaped; `esc`
 *  escapes the causes. Pure — test/1230 reads it. */
export function lifeTipHtml(name: string, life: number, rows: readonly LifeRow[], esc: (s: string) => string): string {
  const head = `<div class="tiphead">${name} · ${life} life</div>`;
  if (!rows.length) return `${head}<div class="tipline dim">no change to their life yet</div>`;
  const shown = rows.slice(-LIFE_ROWS).reverse();
  const older = rows.length - shown.length;
  const tr = (r: LifeRow): string =>
    `<tr><th>${r.turn ? `turn ${r.turn}` : 'start'}</th><td class="${r.delta < 0 ? 'lifedown' : 'lifeup'}">${
      r.delta < 0 ? '−' : '+'}${Math.abs(r.delta)}</td><td>→ ${r.after}</td><td class="lifewhy">${esc(whyText(r.why))}</td></tr>`;
  return `${head}<table class="tiptab lifelog"><tbody>${shown.map(tr).join('')}</tbody></table>${
    older ? `<div class="tipfoot">and ${older} earlier change${older === 1 ? '' : 's'} — the game log has them all</div>` : ''}`;
}
