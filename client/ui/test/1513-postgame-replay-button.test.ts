// The post-game screen's Watch the replay: drawn when the payload offers a replay, hidden while a match is open; the click opens the viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import { handlePostGameButton, type GameOver } from '../postgame.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: [], turns: 7,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
};
const html = (over: Partial<GameOver>): string => postGameHtml({
  over: { ...OVER, ...over }, modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '',
} satisfies PostGameView);
const REPLAY = /data-btn="pg-replay" type="button">Watch the replay</;

test('1513 Watch the replay is in the button row exactly when the game offers it', () => {
  assert.match(html({ replay: 'ABCD' }), REPLAY);
  assert.doesNotMatch(html({}), /pg-replay/, 'no replay offered (signed out, a scenario): no button');
  const row = /<div class="pgbtns">([\s\S]*?)<\/div>/.exec(html({ replay: 'ABCD' }))![1]!;
  assert.ok(row.indexOf('pg-replay') < row.indexOf('pg-home'), 'beside the other ways out, before home');
});

test('1513 not while a Competitive match is open, and back once it is over', () => {
  const match = { id: 'M', bestOf: 3 as const, score: [1, 0] as [number, number], game: 2, phase: 'between' as const, room: 'NEXT' };
  assert.doesNotMatch(html({ replay: 'ABCD', match }), /pg-replay/, 'the route refuses a game of an open match');
  assert.match(html({ replay: 'ABCD', match: { ...match, phase: 'over' } }), REPLAY);
  assert.match(html({ replay: 'ABCD', match: { ...match, phase: 'void' } }), REPLAY);
});

test('1513 the click opens this game in the replay viewer', () => {
  const g = globalThis as Record<string, unknown>;
  const was = g['location'];
  const loc = { pathname: '/', href: '' };
  g['location'] = loc;
  try {
    const btn = { dataset: { btn: 'pg-replay' } } as unknown as HTMLElement;
    const a = { over: { ...OVER, replay: 'AB CD' }, send: () => {}, rerender: () => {}, dismiss: () => {}, dispute: () => {} };
    assert.equal(handlePostGameButton(btn, a), true);
    assert.equal(loc.href, '/?replay=AB%20CD');
  } finally {
    g['location'] = was;
  }
});
