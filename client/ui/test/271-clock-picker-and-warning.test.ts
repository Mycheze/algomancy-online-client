/* BL-26 / BL-27 — THE TWO ACCEPTANCE LINES THAT DID NOT LAND WITH THE SERVER.
 *
 * The server lane made the clock a real per-room setting and made running out
 * of it lose the game, and marked both entries `done` with the gaps stated
 * rather than hidden. Both gaps were in client/ui/:
 *
 *   BL-26 · "a room can be created with the 60-minute default, some other
 *            bank, or no clock at all" — the server accepts `clock` on the
 *            join and on the URL, and nothing OFFERED one, so every room a
 *            player created still got the default.
 *   BL-27 · "both players see the clock going critical before it happens — a
 *            loss on time must never be a surprise" — no warning existed.
 *
 * ── WHY THE THRESHOLD IS DERIVED AND NOT A CONSTANT
 *
 * This is the one part worth a guard rather than a reading. BL-26 gave the
 * bank a one-SECOND floor on purpose ("BL-27 is only testable at speed because
 * of it"), so a fixed one-minute warning would be lit before a ninety-second
 * game began — and a warning that is always on is not a warning. `clockWarnAt`
 * is `min(60_000, start / 10)`: a minute of warning on an hour, nine seconds
 * on ninety. §2's discriminating case is the short bank at ten seconds left —
 * critical under any constant threshold, correctly quiet under this one.
 *
 * ── AND WHY THE SHARE LINK MUST NOT CARRY IT
 *
 * The bank is read only by the join that CREATES the room (server/rooms.ts
 * joinableRoom ignores it afterwards), which is what stops the second player
 * handing their opponent a three-second game by editing the link they were
 * sent. The link the waiting screen hands the opponent must therefore not
 * carry `clock=` at all: the server would ignore it, so the only thing it
 * could change is what the joiner believes they are choosing. §3 derives that
 * from the link templates themselves.
 *
 * §1 a client that was told no clock draws no clocks
 * §2 the warning derives from the room's own bank
 * §3 no link built for the OTHER seat carries the setting
 * §4 the picker is on the home screen and remembers what was picked
 *
 * Seeds 27100-27199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const ui = await client();
const SEAT: Seat = 0;

const board = (seed: number): GameState => new Harness(seed).state;
const join = (s: GameState): string => ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));

/** the class list the seat's own clock cell is wearing right now */
function clockCls(html: string, seat: Seat): string | null {
  const m = new RegExp(`class="([^"]*)"[^>]*data-clkseat="${seat}"`).exec(html);
  return m ? m[1]! : null;
}

/** an authoritative push carrying a clock snapshot of this shape */
function withClock(s: GameState, start: number, ms: [number, number]): string {
  return ui.update(viewFor(s, SEAT), legalActions(s, SEAT), {
    clock: { ms, running: [false, false], at: Date.now(), start },
  });
}

/* ══ §1 — told nothing, draws nothing ══════════════════════════════════ */

test('BL-26 §1 a client that was never sent a clock draws no clocks at all', () => {
  // THIS RUNS FIRST ON PURPOSE. A room with the clock OFF sends no `clock`
  // field at all — the honest wire shape for "there is no clock" is silence —
  // so the client draws nothing because it was told nothing. In a browser that
  // is a fresh page load with `clockSnap` still null, which is exactly this
  // client before any clock has arrived; `clockSnap` is deliberately NOT
  // dropped by resetUi (a 'joined' sets it first), so a later test in this
  // file could not re-create the state and this one could not be moved down.
  const html = join(board(27100));
  assert.doesNotMatch(html, /class="clocks"/,
    'a clockless room is drawing a clock — BL-26 requires no clocks at all rather than a '
    + 'frozen 60:00, and the client must not invent one it was never sent');
  assert.equal(clockCls(html, SEAT), null, 'and no clock cell for either seat');
});

/* ══ §2 — the warning, derived from the bank ═══════════════════════════ */

test('BL-27 §2 a full bank is not critical, and a nearly-empty one is', () => {
  const s = board(27101);
  join(s);
  const HOUR = 60 * 60_000;
  assert.doesNotMatch(clockCls(withClock(s, HOUR, [HOUR, HOUR]), SEAT) ?? '', /\bwarn\b/,
    'positive control: a full hour is not a warning, or every clock in the client is lit and '
    + 'the class means nothing');
  assert.match(clockCls(withClock(s, HOUR, [30_000, HOUR]), SEAT) ?? '', /\bwarn\b/,
    'thirty seconds left on an hour is critical and the player was not told — BL-27 says a loss '
    + 'on time must never be a surprise');
  assert.doesNotMatch(clockCls(withClock(s, HOUR, [30_000, HOUR]), other(SEAT)) ?? '', /\bwarn\b/,
    'and it is the seat that is short of time that is marked, not both of them');
});

test('BL-27 §2 the threshold is a tenth of the ROOM\'S bank, not a constant', () => {
  // THE DISCRIMINATING CASE. Ten seconds left is critical under ANY fixed
  // threshold — one minute, thirty seconds, ten. It is correctly quiet only if
  // the threshold came from the bank: BL-26's floor is one SECOND, and a
  // ninety-second game whose clock is lit from the moment it starts has told
  // the player nothing.
  const s = board(27102);
  join(s);
  const SHORT = 90_000;
  assert.doesNotMatch(clockCls(withClock(s, SHORT, [10_000, SHORT]), SEAT) ?? '', /\bwarn\b/,
    'ten seconds left in a NINETY-SECOND game is being drawn as critical — the warning is a '
    + 'constant, so it fires at the same absolute time whatever the room agreed to play, and on '
    + 'a short bank it is on before the game begins');
  assert.match(clockCls(withClock(s, SHORT, [8_000, SHORT]), SEAT) ?? '', /\bwarn\b/,
    'and a tenth of the same bank IS critical — without this the test above would pass on a '
    + 'client that never warns at all');

  // …and the cap is real: a tenth of a very long bank would be a warning
  // nobody could act on, so it stops at a minute
  const LONG = 10 * 60 * 60_000;
  assert.doesNotMatch(clockCls(withClock(s, LONG, [5 * 60_000, LONG]), SEAT) ?? '', /\bwarn\b/,
    'five minutes left is being called critical because the bank is enormous — the threshold is '
    + 'uncapped, and "critical" now means "the last tenth" rather than "act now"');
});

/* ══ §3 — the setting rides the CREATING join and nothing else ═════════ */

/** every `?ws=1&room=…` link ui/main.ts builds, with its source line */
const LINKS = MAIN.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(l => l.line.includes('ws=1&room='));

test('BL-26 §3 no link built for the OTHER seat carries the clock setting', () => {
  assert.ok(LINKS.length >= 4,
    `only ${LINKS.length} room links found in ui/main.ts — the parse is not reading them, and `
    + 'this guard would be about nothing');

  // A SHARE link is one addressed to the seat that is NOT this client's: the
  // waiting banner and the two lobby links. Derived from the template, so a
  // fourth one added next round is checked without an edit here.
  const shares = LINKS.filter(l => /seat=\$\{(other\(|opp)/.test(l.line));
  assert.ok(shares.length >= 3,
    `only ${shares.length} share link(s) recognised — main.ts builds them differently now`);
  // any mention at all, not just the literal `&clock=`: the creating link
  // builds it from a variable, and a share link that did the same would slip
  // straight past a check for the literal
  const leaky = shares.filter(l => /clock/i.test(l.line));
  assert.deepEqual(leaky.map(l => l.n), [],
    `these links hand the opponent a clock setting: main.ts lines ${leaky.map(l => l.n).join(', ')}. `
    + 'The room already exists by then and the server ignores the field (joinableRoom), so the '
    + 'only thing it can change is what the joiner believes they are choosing.');

  // positive control: SOMETHING builds the parameter, or the check above is
  // green because nothing anywhere sets a clock and there is nothing to leak
  assert.match(MAIN, /`&clock=\$\{/,
    'nothing in ui/main.ts builds a clock parameter at all — the picker is not reaching the '
    + 'room it creates, and §3 is passing because there is nothing to leak');
});

test('BL-26 §3 the share banner on screen carries no clock parameter', () => {
  // the same claim, off the real markup rather than off the source
  const s = board(27103);
  const html = ui.push({
    t: 'joined', seat: SEAT, view: s, log: [], legal: legalActions(s, SEAT),
    peers: [true, false], names: ['Ann', 'Bo'],
  });
  const links = [...html.matchAll(/https?:\/\/[^"'\s<]*ws=1[^"'\s<]*/g)].map(m => m[0]);
  assert.ok(links.length, 'the waiting banner is not on screen — this guard has no link to read');
  for (const l of links) {
    assert.doesNotMatch(l, /clock=/, `the link handed to the opponent carries a clock: ${l}`);
  }
});

/* ══ §4 — the picker ═══════════════════════════════════════════════════ */

test('BL-26 §4 the home screen offers the owner\'s three banks, including no clock at all', () => {
  // Read from the source rather than driven: the home screen is a different
  // entry point (`renderHome`), and this client was started with `?room=` —
  // see ui-driver's header. What matters is the shape of the offer.
  //
  // ⚠ THE LIST IS NO LONGER A PLACEHOLDER. Q4 of docs/questions-round36.md is
  // answered: *"45m and 60m. Constructed games are shorter, so I'd say the
  // default for constructed is 45m and the default for live draft is 60m."*
  const presets = [...MAIN.matchAll(/^\s*\{ ms: ([^,]+), label: '([^']*)'/gm)]
    .map(m => ({ ms: m[1]!.trim(), label: m[2]! }));
  assert.deepEqual(presets.map(p => p.label), ['Off', '45m', '60m'],
    'the picker no longer offers exactly what the owner asked for. This is his answer, not a '
    + 'placeholder: adding a chip back means he changed his mind, and the comment above '
    + 'CLOCK_PRESETS should say so');
  assert.ok(presets.some(p => p.ms === '0'),
    'no clock at all is not on offer, and BL-26 says "off is a real setting, not a very large '
    + 'number"');
  assert.match(MAIN, /localStorage\.setItem\('algoClockMs'/,
    'the choice is not persisted, so it is re-made on every visit');
  assert.match(MAIN, /localStorage\.removeItem\('algoClockMs'\)/,
    '"Default" has to REMOVE the key, not write a number into it — a number cannot mean "45 '
    + 'for constructed and 60 for a draft", which is the answer');
});

test('BL-26 §4 the default follows the MODE, and the mode is only known at the New button', () => {
  // The half a single CLOCK_DEFAULT_MS could not express. Derived from the
  // source for the same reason as §4 above — the home screen is not this
  // client's entry point — but derived STRUCTURALLY: the table, and the fact
  // that the one call site which knows the mode passes it.
  const table = /const CLOCK_DEFAULT_BY_MODE: Record<string, number> = \{([^}]*)\}/.exec(MAIN);
  assert.ok(table, 'there is no per-mode default table at all');
  const rows = [...table[1]!.matchAll(/(\w+):\s*(\d+) \* 60_000/g)]
    .map(m => [m[1]!, Number(m[2])] as const);
  assert.deepEqual(Object.fromEntries(rows), { constructed: 45, shared: 45, draft: 60 },
    'the per-mode defaults are not the owner\'s: constructed 45, live draft 60. (`shared` is '
    + 'the quick shared-pool game — it deals rather than drafts, so it takes the short one.)');

  assert.match(MAIN, /`&clock=\$\{chosenClockMs\(mode\)\}`/,
    'the room-creating link no longer passes the mode, so every new room gets the same bank '
    + 'whichever New button was pressed — which is exactly the thing the answer distinguishes');
});

/** the other seat — local, because this file drives only one */
function other(s: Seat): Seat { return s === 0 ? 1 : 0; }
