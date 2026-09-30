/* CT-179 — A `joined` OR AN `update` CARRIES A GAME OR A LOBBY, AND THE SERVER
 * SAYS SO.
 *
 * ui/main.ts assumed it: `this.state = m.view!` on a join, and an update's
 * `noteHasteAnswered(this.state, …)` / `noteCast(this.state, …)` with no board
 * under them. It was true only because every server site that built one
 * happened to spread `baseView` or `waitingInfo` into it — an accident of the
 * server that neither side stated.
 *
 * THE OWNER IS THE SERVER. server/seatmsg.ts builds every `joined` and
 * `update`; its type cannot express a body with both or neither of `view` and
 * `waiting`, and it throws on one that gets round the type. The client CHECKS
 * rather than assumes: a join with neither, or an update with no view before
 * any board exists, is refused with a sentence on screen instead of a board
 * painted over null.
 *
 * The invariant, stated precisely: every `joined` and every `update` carries
 * EXACTLY ONE of `view` and `waiting`. (A view-less update is legitimate
 * today in exactly one form — the lobby's, which carries `waiting` and never
 * reaches applyUpdate. There is no log-only or clock-only update: the clock
 * rides on a view.)
 *
 * §1 the builder: a lobby and a game are built; neither and both are refused,
 *    at the type AND at runtime
 * §2 the census: no `joined`/`update` is spelled as a literal anywhere in
 *    server/, so no site can bypass the builder — and both kinds really go
 *    through it
 * §3 the client, connecting screen: an update with no view does not throw and
 *    paints no board
 * §4 the client, connecting screen: a join with neither does not throw, paints
 *    no board, and does not latch the seat as joined — a real join after it
 *    still paints the board
 * §5 the client, with a board: an update with no view leaves the board standing
 *
 * Seeds 35600-35699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { seatMsg } from '../../server/seatmsg.ts';
import { client } from './ui-driver.ts';
import type { Seat } from '../../engine/src/types.ts';

const ui = await client();
const SEAT: Seat = 0;
const SERVER = new URL('../../server/', import.meta.url);

/** what a board looks like in the markup: the live slots render() emits */
const BOARD = /id="presenceslot"/;
const REFUSED = /The server sent a game with nothing in it/;

/* ══ §1 the builder ═══════════════════════════════════════════════════ */

test('CT-179 §1 the builder makes a lobby message and a game message', () => {
  const h = new Harness(35600);
  const lobby = seatMsg('joined', { room: 'QXZZ', seat: 0, waiting: { have: [true, false] } });
  assert.equal(lobby.t, 'joined');
  assert.deepEqual(lobby.waiting, { have: [true, false] });
  const game = seatMsg('update', { view: viewFor(h.state, SEAT), legal: [] });
  assert.equal(game.t, 'update');
  assert.ok(game.view, 'the game message lost its view');
});

test('CT-179 §1 the builder refuses a message with neither a view nor a waiting', () => {
  // @ts-expect-error — neither: the type cannot express it
  assert.throws(() => seatMsg('joined', { room: 'QXZZ', seat: 0, peers: [true, true] }),
    /'joined' must carry exactly one of view and waiting; this one carries neither/);
  // @ts-expect-error — neither, on an update (a log-only push is not a shape the wire has)
  assert.throws(() => seatMsg('update', { legal: [] }),
    /'update' must carry exactly one of view and waiting; this one carries neither/);
  // and the runtime refusal holds when the type is got round (an optional spread, an `as`)
  const view = undefined as unknown as ReturnType<typeof viewFor>;
  assert.throws(() => seatMsg('update', { view }), /carries neither/);
});

test('CT-179 §1 the builder refuses a message with both a view and a waiting', () => {
  const h = new Harness(35601);
  // @ts-expect-error — both: the type cannot express it
  assert.throws(() => seatMsg('joined', { view: viewFor(h.state, SEAT), waiting: { have: [true, true] } }),
    /carries both/);
});

/* ══ §2 the census ════════════════════════════════════════════════════ */

test('CT-179 §2 no joined or update is spelled as a literal in server/, and both go through the builder', () => {
  const files = readdirSync(SERVER).filter(f => f.endsWith('.ts') && f !== 'seatmsg.ts');
  assert.ok(files.includes('main.ts'), 'the census read the wrong directory — server/main.ts is not in it');
  const literal = /\bt:\s*['"](joined|update)['"]/g;
  const bypasses: string[] = [];
  let built = { joined: 0, update: 0 };
  for (const f of files) {
    const src = readFileSync(new URL(f, SERVER), 'utf8');
    for (const m of src.matchAll(literal)) bypasses.push(`${f}: ${m[0]}`);
    built = {
      joined: built.joined + [...src.matchAll(/seatMsg\('joined'/g)].length,
      update: built.update + [...src.matchAll(/seatMsg\('update'/g)].length,
    };
  }
  assert.deepEqual(bypasses, [],
    'a joined/update is built by hand, around server/seatmsg.ts — nothing checks that it carries '
    + 'a view or a waiting, and the client is back to assuming it');
  assert.ok(built.joined >= 2 && built.update >= 2,
    `server/ builds ${built.joined} joined and ${built.update} update through seatMsg — `
    + 'the census found no builder calls, so it is reading something that is not the server');
});

/* ══ §3 / §4 the client, before any board ═════════════════════════════ */

test('CT-179 §3 an update with no view before any board does not throw and paints no board', () => {
  assert.match(ui.html(), /Connecting to the server/, 'the fixture is not on the connecting screen');
  let html = '';
  assert.doesNotThrow(() => {
    html = ui.push({ t: 'update', legal: [], peers: [true, true] });
    ui.tick();   // anything the throttle booked
  }, 'a view-less update before any board threw — applyUpdate handed a null state on');
  html = ui.html();
  assert.doesNotMatch(html, BOARD, 'a board was painted with no state under it');
  assert.match(html, REFUSED, 'the refusal was silent — the player is left on Connecting with no reason');
});

test('CT-179 §4 a join with neither a view nor a waiting does not throw and paints no board', () => {
  let html = '';
  assert.doesNotThrow(() => {
    html = ui.push({ t: 'joined', seat: SEAT, room: 'QXZZ', peers: [true, true], names: ['Ann', 'Bo'] });
  }, 'a join with neither threw — renderNow was handed a board over a null state');
  assert.doesNotMatch(html, BOARD, 'a board was painted over a null state');
  assert.match(html, REFUSED, 'the refused join said nothing');
});

test('CT-179 §4 the refused join did not latch the seat, and a real join still paints the board', () => {
  const h = new Harness(35602);
  const html = ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  assert.match(html, BOARD, 'the real join after a refused one painted no board');
  assert.doesNotMatch(html, REFUSED, 'the refusal outlived the join that superseded it');
});

/* ══ §5 with a board ══════════════════════════════════════════════════ */

test('CT-179 §5 an update with no view on a board leaves the board standing', () => {
  assert.match(ui.html(), BOARD, 'the fixture has no board on screen');
  let html = '';
  assert.doesNotThrow(() => {
    html = ui.push({ t: 'update', legal: [] });
    ui.tick();
  });
  html = ui.html();
  assert.match(html, BOARD, 'the board went away under a view-less update');
  assert.doesNotMatch(html, REFUSED, 'a board existed, so there was nothing to refuse');
});
