/* 1333 — THE CUBE PAGE IN SEALED (docs/25 §14), DOM-free.
 *
 * §1 the New-event sheet: a Format choice; Sealed swaps bots and packs for pool size, repeats
 *    and same/unique pools, with the live dealing line; too few cards says what to change
 * §2 the form is the config: format and the sealed numbers round trip
 * §3 the lobby: the facts say Sealed, empty seats are Open (no bots), Start is "Open the pools"
 *    and waits on the server's sealed math; building says "your sealed pool"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml, defaultForm, formConfig, formFromConfig, formMathOf, type CubeForm } from '../pages/cube.ts';
import { CONFIG, eventView, NOW, pageView, tagOf } from './cube-fixture.ts';
import { cubeNoteLine } from '../cubenotes.ts';

const withForm = (f: CubeForm): ReturnType<typeof pageView> => pageView({
  code: null, list: [], sheet: { kind: 'new' }, form: f, formMath: formMathOf(f),
  days: [{ label: 'Today', offset: 0, on: true }], startText: 'Sat 14 Nov, 19:00',
});
const sealedForm = (over: Partial<CubeForm> = {}): CubeForm => ({ ...defaultForm('Ann', NOW), format: 'sealed', ...over });
const SEALED = { ...CONFIG, format: 'sealed' as const, sealed: { cards: 75, copies: 2 as const, same: false } };

test('1333 §1 the New-event sheet: Draft or Sealed, and Sealed\'s own knobs', () => {
  const draft = cubeHtml(withForm(defaultForm('Ann', NOW)));
  assert.match(tagOf(draft, 'cube-f-set', 'data-v="draft"'), /aria-pressed="true"/, 'Draft by default');
  assert.match(tagOf(draft, 'cube-f-set', 'data-v="sealed"'), /data-k="format"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-k="format"/, 'Sealed offered');
  assert.ok(tagOf(draft, 'cube-f-bots'), 'a draft has bots');

  const html = cubeHtml(withForm(sealedForm({ maxPlayers: 4 })));
  assert.equal(tagOf(html, 'cube-f-bots'), '', 'sealed has no bots');
  assert.equal(tagOf(html, 'cube-f-set', 'data-k="packs"'), '', 'nor packs');
  assert.ok(tagOf(html, 'cube-f-step', 'data-k="sealedCards"'), 'a pool-size stepper');
  assert.match(html, /75 cards/);
  assert.ok(tagOf(html, 'cube-f-set', 'data-k="sealedCopies"'), 'singleton or two of each');
  assert.ok(tagOf(html, 'cube-f-set', 'data-v="same"'), 'everyone the same pool');
  assert.match(html, /4 pools of 75 · 300 of the cube's 320 cards/, 'the live dealing line');
  assert.doesNotMatch(tagOf(html, 'cube-create'), /disabled/);

  // the default table of 8 cannot be dealt 75 each from 320 singletons: it says what to change
  const small = cubeHtml(withForm(sealedForm()));
  assert.match(small, /Too few cards for 8 pools of 75: the cube has 320, they need 600/);
  assert.match(small, /Enough for 4 players/);
  assert.match(tagOf(small, 'cube-create'), /disabled/);
  assert.match(cubeHtml(withForm(sealedForm({ sealedCopies: 2 }))), /8 pools of 75 · 600 of the cube's 640 cards/, 'repeats double the cube');
  assert.match(cubeHtml(withForm(sealedForm({ sealedSame: true }))), /Everyone opens the same 75 of 320 cards/);
});

test('1333 §2 the form is the config', () => {
  const f = sealedForm({ sealedCards: 90, sealedCopies: 2, sealedSame: true });
  const c = formConfig(f);
  assert.equal(c.format, 'sealed');
  assert.deepEqual(c.sealed, { cards: 90, copies: 2, same: true });
  const back = formFromConfig(c, NOW);
  assert.equal(back.format, 'sealed');
  assert.equal(back.sealedCards, 90);
  assert.equal(back.sealedCopies, 2);
  assert.equal(back.sealedSame, true);
  assert.equal(formFromConfig(CONFIG, NOW).format, 'draft', 'an event from before sealed is a draft');
});

test('1333 §3 the lobby and building of a sealed event', () => {
  const ok = [{ seats: 3, cards: 75, need: 225, have: 640, ok: true }, { seats: 8, cards: 75, need: 600, have: 640, ok: true }];
  const lobby = cubeHtml(pageView({ event: eventView('lobby', { config: SEALED, sealedMath: ok }) }));
  assert.match(lobby, /Sealed · 75 cards each · a different pool each · two of each card/);
  assert.doesNotMatch(lobby, /bots fill/);
  assert.doesNotMatch(lobby, />Bot</, 'empty seats are open, never bots');
  assert.match(lobby, /Open the pools/);
  assert.doesNotMatch(tagOf(lobby, 'cube-start'), /disabled/);
  assert.match(lobby, /3 pools of 75 · 225 of the cube's 640 cards/);

  const short = [{ ...ok[0]!, need: 900, have: 640, ok: false }, ok[1]!];
  const no = cubeHtml(pageView({ event: eventView('lobby', { config: SEALED, sealedMath: short }) }));
  assert.match(tagOf(no, 'cube-start'), /disabled/, 'Start waits on the server\'s math');

  const building = cubeHtml(pageView({ event: eventView('building', { config: SEALED, myPool: Array(75).fill('Fire Spirit') }) }));
  assert.match(building, /from the 75 in your sealed pool/);

  assert.match(cubeNoteLine({ id: 'Q:1', event: 'Q', eventName: 'Night', kind: 'starting', at: 0, read: false, sealed: true }), /sealed pool is ready/);
});
