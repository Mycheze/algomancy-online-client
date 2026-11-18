/* BL-10 — the post-game screen says what the game did to your rating
 * (docs/23-ui-inventory/05 §18.20: "post-game shows no rating delta").
 *
 *   §1 a rated game draws "<format> rating before → after (±n)" under the
 *      recorded note, the sign in the words and the colour only repeating it
 *   §2 no move, no line
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';
import { readStyles } from './read-styles.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: { 'Ignis Sprite': 2 }, unitsPlayed: 5, spellsPlayed: 3, tokensCast: 1, modsApplied: 2,
  cardElements: { fire: 4 }, recycled: {}, resourcesActivated: 6, abilitiesActivated: 1,
  attacksDeclared: 4, unitsAttackedWith: 6, damageDealt: 14, lifeLost: 9,
  unitsLost: 3, unitsKilled: 2, cardsDrafted: 30, lifeLeft: 11,
});
const over = (o: Partial<GameOver> = {}): PostGameView => ({
  over: {
    seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 9,
    seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true, ...o,
  },
  modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '',
});
const line = (html: string): string => /<div class="pgnote pgrating">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
const words = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('BL-10 §1: a rated game says the rating before, after and the change', () => {
  const won = line(postGameHtml(over({ rating: { mode: 'draft', before: 1000, after: 1020 } })));
  assert.equal(words(won), 'Live draft rating 1000 → 1020 (+20)');
  assert.match(won, /class="pgdelta up"/);
  const lost = line(postGameHtml(over({ winner: 1, mode: 'constructed', rating: { mode: 'constructed', before: 1000, after: 995 } })));
  assert.equal(words(lost), 'Constructed rating 1000 → 995 (−5)');
  assert.match(lost, /class="pgdelta down"/);
  const even = line(postGameHtml(over({ rating: { mode: 'draft', before: 1400, after: 1400 } })));
  assert.equal(words(even), 'Live draft rating 1400 → 1400 (±0)');
  const html = postGameHtml(over({ rating: { mode: 'draft', before: 1000, after: 1020 } }));
  assert.ok(html.indexOf('Recorded to your profile.') < html.indexOf('pgrating'), 'under the recorded note');
  const css = readStyles();
  assert.match(css, /\.pgdelta\.up\s*\{[^}]*color:\s*var\(--color-success\)/);
  assert.match(css, /\.pgdelta\.down\s*\{[^}]*color:\s*var\(--color-danger\)/);
});

test('BL-10 §2: a game that moved no rating draws no rating line', () => {
  assert.equal(line(postGameHtml(over())), '');
  assert.doesNotMatch(postGameHtml(over({ recorded: false })), /rating \d/);
});
