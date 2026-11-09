/* A SAVED DECK IS PLAYED AS IT IS NOW — EDITS MADE SINCE IT WAS CHOSEN COUNT.
 *
 * The owner, 2026-11-07 (#steward): *"Some users have complained about editing
 * decks and then not seeing those edits in their next constructed match with
 * the deck … when a deck is tweaked or tuned, it should be the list that's
 * used in the next game with that deck."*
 *
 * The mechanism: "Play this deck" (ui/decks.ts `deck-play`) stores a COPY of
 * the list in the browser (ui/util.ts chooseDeck), and every join sends that
 * copy as `deck` beside the saved deck's `deckId`. server/main.ts dealt from
 * the copy. Edit the deck afterwards and the copy never changed, so the game
 * was the old list. The queue had the same shape one step later: it read the
 * deck when you queued, and an edit made while searching was not in the game.
 *
 *   §1 ⭐ a constructed room is dealt the saved deck as edited, not the stale
 *      list the join carried — for the creator and for the joiner
 *   §2 a saved deck edited into an illegal one is refused by name, rather than
 *      quietly dealing the old list
 *   §3 ⭐ a queued player who edits while searching plays the edit
 *
 * Over the wire, against the real server (cc-wire.ts), with the edits made the
 * way the builder makes them: POST /api/decks/update.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ccWire, type Client, type Msg } from './cc-wire.ts';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

type Wire = Awaited<ReturnType<typeof ccWire>>;

async function editDeck(w: Wire, token: string, id: string, cards: string[]): Promise<void> {
  const res = await fetch(`http://localhost:${w.port}/api/decks/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, cards }),
  });
  const body = await res.json() as { ok: boolean; error?: string };
  assert.ok(body.ok, `the edit saved: ${body.error ?? ''}`);
}

/** the dealt room's two decks, off its saved game file */
async function dealtDecks(w: Wire, code: string): Promise<[string[], string[]]> {
  const file = join(w.env.ALGO_GAMES_DIR, `${code}.json`);
  for (let i = 0; i < 50; i++) {
    if (existsSync(file)) {
      const g = JSON.parse(readFileSync(file, 'utf8')) as { decks?: [string[] | null, string[] | null] };
      if (g.decks?.[0] && g.decks?.[1]) return [g.decks[0], g.decks[1]];
    }
    await sleep(100);
  }
  throw new Error(`room ${code} was never dealt two decks`);
}

const errors = (c: Client): Msg[] => c.msgs.filter(m => m.t === 'error');

test('§1-§3 a saved deck is played as it is now, not as the browser last copied it', async () => {
  const w = await ccWire('t1161');
  const [ann, bo, cy] = w.people as [typeof w.people[0], typeof w.people[0], typeof w.people[0]];
  try {
    // ── §1 ── both players pressed "Play this deck" on their saved list
    // (`main`), then edited it in the builder (`swap.main`: two cards out, two in)
    await editDeck(w, ann.token, ann.deckId, ann.swap.main);
    await editDeck(w, bo.token, bo.deckId, bo.swap.main);
    const code = await w.mint();
    const a = await w.client(), b = await w.client();
    // exactly what ui/main.ts sendJoin sends: the browser's copy + the id —
    // the creating join, then the joiner's "Play this deck" in the waiting
    // room (CT-542: a friend's arrival alone registers nothing)
    await a.ask({ t: 'join', room: code, seat: 0, mode: 'constructed', deck: ann.main, deckId: ann.deckId, token: ann.token, name: 'x' },
      m => m.t === 'joined');
    await b.ask({ t: 'join', room: code, mode: 'constructed', deck: bo.main, deckId: bo.deckId, token: bo.token, pick: true },
      m => m.t === 'joined' && !!m['view']);
    const [d0, d1] = await dealtDecks(w, code);
    assert.deepEqual(sorted(d0), sorted(ann.swap.main), '⭐ the creator plays the deck as edited');
    assert.deepEqual(sorted(d1), sorted(bo.swap.main), '⭐ the joiner too');
    assert.deepEqual(errors(a), []);
    assert.deepEqual(errors(b), []);
    a.close(); b.close();

    // ── §2 ── cut to 29: the saved deck is no longer playable, and the
    // stale 30 the browser still holds must not be dealt in its place
    await editDeck(w, ann.token, ann.deckId, ann.swap.main.slice(1));
    const code2 = await w.mint();
    const a2 = await w.client();
    const refused = await a2.ask(
      { t: 'join', room: code2, seat: 0, mode: 'constructed', deck: ann.main, deckId: ann.deckId, token: ann.token, name: 'x' },
      m => m.t === 'error' || m.t === 'joined');
    assert.equal(refused.t, 'error', 'the join is refused');
    assert.match(refused.msg ?? '', /Ann CC/, 'naming the deck');
    assert.match(refused.msg ?? '', /at least 30/, 'and what is wrong with it');
    a2.close();

    // ── §3 ── the queue: Bo and Cy queue with their saved decks, Bo edits
    // while searching, both accept — Bo's game has the edit
    await editDeck(w, bo.token, bo.deckId, bo.main);   // back to the original
    const qb = await w.client(), qc = await w.client();
    qb.send({ t: 'queue', token: bo.token, q: 'join', mode: 'constructed', deckId: bo.deckId, ranked: false });
    await sleep(200);
    await editDeck(w, bo.token, bo.deckId, bo.swap.main);
    qc.send({ t: 'queue', token: cy.token, q: 'join', mode: 'constructed', deckId: cy.deckId, ranked: false });
    await qb.next(m => m.t === 'queue' && !!m['offer']);
    qb.send({ t: 'queue', token: bo.token, q: 'accept' });
    qc.send({ t: 'queue', token: cy.token, q: 'accept' });
    const matched = await qb.next(m => !!m['matched']);
    const room = (matched['matched'] as { room: string }).room;
    const decks = await dealtDecks(w, room);
    const mine = decks.find(d => d.some(n => bo.main.includes(n as never)))!;
    assert.deepEqual(sorted(mine), sorted(bo.swap.main), '⭐ the edit made while searching is in the game');
    const theirs = decks.find(d => d !== mine)!;
    assert.deepEqual(sorted(theirs), sorted(cy.main), 'and the other seat plays its own deck');
  } finally {
    await w.stop();
  }
});
