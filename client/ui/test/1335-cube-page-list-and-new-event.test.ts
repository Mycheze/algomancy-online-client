/* 1335 — THE CUBE PAGE'S LIST AND ITS NEW-EVENT SHEET (docs/25 §10), DOM-free.
 *
 * §1 my events: signed out says sign in; none says so with New event; rows open their event
 * §2 the New-event sheet has every CubeConfig knob, each a button (no typing but the name and a list)
 * §3 the live pack line: the base five at 8 is "8 players · 3 packs of 13 · 320 cards"; too few cards says so
 * §4 the form is the config: formConfig / formFromConfig round trip; a pasted list is capped at 2 a card
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cubeHtml, defaultForm, formConfig, formFromConfig, formPool, packMath, parseList, type CubeForm,
} from '../pages/cube.ts';
import { btns, NOW, pageView, tagOf } from './cube-fixture.ts';
import type { CubeMine } from '../../server/cube-types.ts';

const MINE: CubeMine[] = [
  { code: 'QZXV', name: 'Friday <cube>', phase: 'lobby', isHost: true, players: 3, maxPlayers: 8, startAt: null, myMatch: null },
  { code: 'KPLM', name: 'Sunday league', phase: 'playing', isHost: false, players: 6, maxPlayers: 8, startAt: null,
    myMatch: { pairing: 'r2p1', round: 2, a: { user: 'u1', name: 'Ann' }, b: { user: 'u2', name: 'Bo' }, status: 'waiting', room: null, score: null, winner: null } },
];

function withForm(f: CubeForm, over = {}): ReturnType<typeof pageView> {
  const pool = formPool(f);
  return pageView({ code: null, list: [], sheet: { kind: 'new' }, form: f,
    formMath: { pool, full: packMath(pool, f.maxPlayers, f.packs, f.packSize), least: packMath(pool, f.minPlayers, f.packs, f.packSize) },
    days: [{ label: 'Today', offset: 0, on: true }, { label: 'Tomorrow', offset: 1, on: false }], startText: 'Sat 14 Nov, 19:00', ...over });
}

test('1335 §1 my events: signed out, none, some', () => {
  const out = cubeHtml(pageView({ code: null, signedIn: false }));
  assert.match(out, /Sign in to make a cube event/);
  assert.ok(tagOf(out, 'acct-open-auth'), 'a way to sign in');
  assert.ok(tagOf(out, 'cube-close'), 'the way home');
  assert.doesNotMatch(out, /cube-new/, 'no New event signed out');

  const none = cubeHtml(pageView({ code: null, list: [] }));
  assert.match(none, /No cube events yet/);
  assert.ok(tagOf(none, 'cube-new'), 'New event');

  const some = cubeHtml(pageView({ code: null, list: MINE }));
  assert.match(tagOf(some, 'cube-open', 'QZXV'), /data-code="QZXV"/);
  assert.match(some, /Friday &lt;cube&gt;/, 'names are escaped');
  assert.match(some, /3 of 8 joined/);
  assert.match(some, /Your match is ready/);
  assert.match(some, /data-scroll="cube-list"/, 'the list scrolls inside itself');
  assert.match(some, /class="[^"]*apppage[^"]*cubepage"/, 'drawn in the app frame, the page class last');
});

test('1335 §2 the New-event sheet: every knob, all buttons', () => {
  const f = defaultForm('Ann', NOW);
  assert.equal(f.name, "Ann's cube");
  const html = cubeHtml(withForm(f));
  for (const b of ['cube-f-set', 'cube-f-el', 'cube-f-step', 'cube-f-bots', 'cube-create', 'cube-sheet-close']) {
    assert.ok(btns(html).includes(b), `the sheet has ${b}`);
  }
  for (const k of ['source', 'tournament', 'rules', 'bestOf', 'start', 'packs', 'packSize']) {
    assert.ok(tagOf(html, 'cube-f-set', `data-k="${k}"`), `a choice for ${k}`);
  }
  for (const k of ['minPlayers', 'maxPlayers', 'swissRounds']) assert.ok(tagOf(html, 'cube-f-step', `data-k="${k}"`), `a stepper for ${k}`);
  // the base five, picked; light and dark offered but off
  assert.match(tagOf(html, 'cube-f-el', 'data-el="fire"'), /aria-pressed="true"/);
  assert.match(tagOf(html, 'cube-f-el', 'data-el="light"'), /aria-pressed="false"/);
  assert.match(html, /id="cube-f-name"[^>]*value="Ann&#39;s cube"|id="cube-f-name"[^>]*value="Ann's cube"/);
  assert.doesNotMatch(html, /cube-f-list/, 'the list box only when pasting');
  const pasting = cubeHtml(withForm({ ...f, source: 'list' }));
  assert.match(pasting, /<textarea id="cube-f-list"/);
  assert.doesNotMatch(pasting, /data-btn="cube-f-el"/);
  // a time to start: day buttons and time steps, no keyboard
  const later = cubeHtml(withForm({ ...f, start: 'time' }));
  assert.ok(tagOf(later, 'cube-f-day', 'data-d="1"'), 'Tomorrow');
  assert.ok(tagOf(later, 'cube-f-time', 'data-d="15"') && tagOf(later, 'cube-f-time', 'data-d="-60"'));
  assert.match(later, /Sat 14 Nov, 19:00/);
  // Swiss shows its rounds; Exhibition does not
  assert.doesNotMatch(cubeHtml(withForm({ ...f, tournament: 'exhibition' })), /data-k="swissRounds"/);
  // the edges: no fewer than 2, no more than 12, min never over max
  const edge = cubeHtml(withForm({ ...f, minPlayers: 2, maxPlayers: 12 }));
  assert.match(tagOf(edge, 'cube-f-step', 'data-k="minPlayers" data-d="-1"'), /disabled/);
  assert.match(tagOf(edge, 'cube-f-step', 'data-k="maxPlayers" data-d="1"'), /disabled/);
  const tight = cubeHtml(withForm({ ...f, minPlayers: 4, maxPlayers: 4 }));
  assert.match(tagOf(tight, 'cube-f-step', 'data-k="minPlayers" data-d="1"'), /disabled/);
  // Edit settings is the same form, saved
  assert.ok(tagOf(cubeHtml(withForm(f, { sheet: { kind: 'edit' } })), 'cube-save'));
});

test('1335 §3 the live pack line', () => {
  const f = defaultForm('Ann', NOW);
  assert.equal(formPool(f), 320, 'the base five: 320 deck-legal cards');
  assert.deepEqual(packMath(320, 8, null, null), { seats: 8, packs: 3, packSize: 13, ok: true });
  const html = cubeHtml(withForm(f));
  assert.match(html, /8 players · 3 packs of 13 · 320 cards/);
  assert.doesNotMatch(tagOf(html, 'cube-create'), /disabled/);
  // one element at 12 players cannot fill packs of 5
  const small = { ...f, elements: ['fire' as const], maxPlayers: 12 };
  const tooFew = cubeHtml(withForm(small));
  assert.match(tooFew, /Too few cards for 12 players/);
  assert.match(tagOf(tooFew, 'cube-create'), /disabled/);
  // no element at all
  assert.match(tagOf(cubeHtml(withForm({ ...f, elements: [] })), 'cube-create'), /disabled[^>]*title="Pick at least one element"|title="Pick at least one element"[^>]*disabled/);
  // a set pack size is used as given
  assert.match(cubeHtml(withForm({ ...f, packSize: 10 })), /8 players · 3 packs of 10 · 320 cards/);
});

test('1335 §4 the form is the config', () => {
  assert.deepEqual(parseList('2 Fire Spirit\n3x Water Wisp\n// side\nGolem\n\n# note\n1 Golem'),
    ['Fire Spirit', 'Fire Spirit', 'Water Wisp', 'Water Wisp', 'Golem', 'Golem'], 'copies capped at 2, comments skipped');
  const f = { ...defaultForm('Ann', NOW), start: 'time' as const, startAt: NOW + 3_600_000, tournament: 'roundrobin' as const, bestOf: 3 as const };
  const c = formConfig(f);
  assert.equal(c.startAt, NOW + 3_600_000);
  assert.deepEqual(c.source, { kind: 'elements', elements: ['fire', 'water', 'earth', 'wood', 'metal'] });
  assert.equal(formConfig({ ...f, start: 'host' }).startAt, null);
  assert.deepEqual(formConfig(formFromConfig(c, NOW)), c, 'a saved config edits back to itself');
  const listed = formConfig({ ...f, source: 'list', listText: '2 Fire Spirit\nGolem' });
  assert.deepEqual(listed.source, { kind: 'list', names: ['Fire Spirit', 'Fire Spirit', 'Golem'] });
  assert.deepEqual(formConfig(formFromConfig(listed, NOW)).source, listed.source);
});
