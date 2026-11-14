/* 1134 — UI-SHOTS PHOTOGRAPHS THE REBUILT DECK SCREENS (BL-65, 2026-11-04).
 *
 * The deck page's tabs, drawer and modals, the old tabletop and the card
 * browser's Building mode are gone, so their ui-shots states could only fail
 * (a ✗ line per state, per viewport). These are the new screens' states, and
 * the window they are held to.
 *
 * §1 the Decks page and the builder are app-frame pages: every state of
 *    theirs is noScroll and checks its page's root class
 * §2 every screen the plan names has a state: the shelf, a selected deck, each
 *    of the page's sheets, a not-legal deck, signed out; the builder and each
 *    of its sheets, the card menu; the challenge table, the shared deck, the
 *    Competitive sideboarding table
 * §3 the retired states are gone (decks__curve, the drawer, tabletop__*,
 *    cards__deckbuilding), and nothing clicks a retired button
 * §4 an upright iPad (768×1024) is a viewport, held to the window, shot only
 *    for the states that name it — every deck screen does
 * §5 the states that WRITE (a new deck) come after every state that shows a
 *    deck list, so no other picture shows the deck they made
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_SCROLL_VIEWPORTS, OPT_IN_VIEWPORTS, shotAt } from '../../server/e2e/ui-shots-overflow.mjs';
import { FRAME_PAGES, SCENARIOS } from '../../server/e2e/ui-shots-states.mjs';

const FX = {
  seasons: { running: 's1' }, challenge: { current: 'c1', past: 'c0' }, sharedDeck: 'd1',
  decks: { pub: 'dp', unlisted: 'du', maybe: 'dm' }, cc: { deck: 'd2', room: 'R', seat: 0 },
};
const S = SCENARIOS(FX);
const name = (s: { page: string; state: string }): string => `${s.page}__${s.state}`;
const of = (page: string): typeof S => S.filter(s => s.page === page);

test('1134 §1 the Decks page and the builder are frame pages: one window, their root checked', () => {
  assert.ok(FRAME_PAGES.includes('decks') && FRAME_PAGES.includes('builder'));
  for (const [page, root] of [['decks', '.deckpage'], ['builder', '.ttpage']] as const) {
    assert.ok(of(page).length >= 6, `${page}: non-vacuous`);
    for (const s of of(page)) {
      assert.equal(s.noScroll, true, `${name(s)} is held to the window`);
      assert.ok(s.check === root || (page === 'builder' && s.check === '.ttpop'), `${name(s)} checks ${root}, not ${s.check}`);
    }
  }
});

test('1134 §2 every screen of the plan has a state', () => {
  const have = new Set(S.map(name));
  for (const want of [
    'decks__shelf', 'decks__selected', 'decks__import', 'decks__share', 'decks__export', 'decks__delete', 'decks__games',
    'decks__not-legal', 'decks__signed-out', 'decks__cc-deck',
    'builder__deck', 'builder__deck-info', 'builder__stats', 'builder__whats-wrong', 'builder__more-filters',
    'builder__card-menu', 'builder__cc-sideboard',
    'challenge__builder', 'meta__shared-deck', 'match__between-paused',
  ]) assert.ok(have.has(want), `${want} is not photographed`);
  const out = S.find(s => name(s) === 'decks__signed-out')!;
  assert.equal(out.as, undefined, 'signed out is signed out');
  for (const [state, btn] of [['import', 'deck-import-open'], ['share', 'deck-share'], ['export', 'deck-export'],
    ['delete', 'deck-delete'], ['games', 'deck-games']]) {
    const s = S.find(x => name(x) === `decks__${state}`)!;
    assert.match(JSON.stringify(s.steps), new RegExp(`data-btn=\\\\"${btn}\\\\"`), `decks__${state} opens its sheet with ${btn}`);
  }
  for (const [state, btn] of [['deck-info', 'deck-settings'], ['stats', 'tt-stats'], ['whats-wrong', 'tt-problems'], ['more-filters', 'tt-filters']]) {
    const s = S.find(x => name(x) === `builder__${state}`)!;
    assert.match(JSON.stringify(s.steps), new RegExp(`data-btn=\\\\"${btn}\\\\"`), `builder__${state} opens its sheet with ${btn}`);
  }
});

test('1134 §3 the retired states and buttons are gone', () => {
  for (const s of S) {
    assert.notEqual(s.page, 'tabletop', `${name(s)}: the tabletop is the builder now`);
    assert.doesNotMatch(name(s), /^cards__deckbuilding$|^decks__(curve|maybeboard|group-cost|add-drawer|settings|describe|first|public-deck)$/,
      `${name(s)} is a retired state`);
    assert.doesNotMatch(JSON.stringify(s.steps ?? []), /deck-tab|deck-group|deck-adding|deck-browse|deck-stop/,
      `${name(s)} clicks a retired button`);
  }
  const src = readFileSync(new URL('../../server/e2e/ui-shots-states.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /not in the app frame yet/, 'the challenge table is in the frame now');
});

test('1134 §4 an upright iPad: held to the window, shot only where a state asks', () => {
  assert.deepEqual([...OPT_IN_VIEWPORTS], ['portrait']);
  assert.ok(NO_SCROLL_VIEWPORTS.includes('portrait'));
  const shots = readFileSync(new URL('../../server/e2e/ui-shots.mjs', import.meta.url), 'utf8');
  assert.match(shots, /portrait: \{ w: 768, h: 1024, touch: true, mobile: true \}/);
  assert.match(shots, /opt\('viewports', 'desktop,tablet,phone,portrait'\)/, 'a full run includes it');
  assert.match(shots, /if \(!shotAt\(s, vpName\)\) continue;/, 'the run asks shotAt');
  assert.equal(shotAt({}, 'desktop'), true);
  assert.equal(shotAt({}, 'portrait'), false, 'a page nobody laid out for it is not shot there');
  assert.equal(shotAt({ also: ['portrait'] }, 'portrait'), true);
  assert.equal(shotAt({ viewports: ['desktop'], also: ['portrait'] }, 'portrait'), false, '`viewports` wins');
  for (const s of [...of('decks'), ...of('builder')]) assert.ok(shotAt(s, 'portrait'), `${name(s)} is shot upright`);
  for (const n of ['challenge__builder', 'meta__shared-deck', 'match__between-paused']) {
    assert.ok(shotAt(S.find(s => name(s) === n)!, 'portrait'), `${n} is shot upright`);
  }
  assert.ok(!shotAt(S.find(s => name(s) === 'home__signed-in')!, 'portrait'), 'and the home is not (yet)');
});

test('1134 §5 the states that make a deck come after every state that lists decks', () => {
  const writes = S.map((s, i) => [s, i] as const).filter(([s]) => /deck-new/.test(JSON.stringify(s.steps ?? [])));
  assert.deepEqual(writes.map(([s]) => name(s)).sort(), ['builder__whats-wrong', 'decks__not-legal']);
  const first = Math.min(...writes.map(([, i]) => i));
  const listsDecks = /deck-openpage|acct-tab|h-deck|ch-import|\?table=|\?queue/;
  const before = S.slice(0, first);
  assert.ok(before.some(s => listsDecks.test(JSON.stringify(s.steps ?? []) + s.url)), 'non-vacuous');
  // only the waiting room, the Competitive block (which builds its own decks), the cube
  // pick screen (last of all: it starts a draft; no deck list on it) and the home that
  // counts those events come after
  for (const s of S.slice(first)) {
    if (writes.some(([w]) => w === s)) continue;
    assert.ok(s.page === 'waiting' || /cc|between|registration/.test(s.state) || (s.page === 'cube' && /^draft-/.test(s.state))
      || (s.page === 'home' && s.state === 'cube-events'),
      `${name(s)} runs after a deck was made`);
  }
});
