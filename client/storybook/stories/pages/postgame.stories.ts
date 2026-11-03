import { postGameHtml, type PostGameView } from '../../../ui/pages/postgame.ts';
import { matchResultHtml } from '../../../ui/pages/match.ts';
import type { GameOver } from '../../../ui/postgame.ts';
import { overlay } from './_page.ts';

const seat = (name: string, over: Partial<GameOver['seats'][0]> = {}): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0, ...over,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 9, matchMs: 47 * 60_000,
  seats: [
    seat('Ann', { lifeLeft: 12, damageDealt: 30, unitsPlayed: 6, spellsPlayed: 4, unitsKilled: 5, unitsLost: 3, attacksDeclared: 5, cardsDrafted: 24, cards: { 'Ignis Sprite': 3 }, cardElements: { fire: 6, wood: 2 } }),
    seat('Bo', { damageDealt: 18, unitsPlayed: 7, spellsPlayed: 2, unitsKilled: 3, unitsLost: 5, attacksDeclared: 4, cardsDrafted: 24, cards: { Overwhelm: 2 }, cardElements: { water: 5 } }),
  ],
  rematch: [false, false], rematchRoom: null, recorded: true,
};
const ELEMENTS = '<span class="elchip fire on">fire</span><span class="elchip wood on">wood</span><span class="elchip water on">water</span>';

function view(over: Partial<GameOver> = {}, v: Partial<PostGameView> = {}): PostGameView {
  return { over: { ...OVER, ...over }, modeLabel: 'live draft', elements: ELEMENTS, guest: false, signup: null, matchResult: '', ...v };
}
const screen = (v: PostGameView): string => overlay(postGameHtml(v), 900);

export default {
  title: 'Pages/Post-game',
  parameters: { layout: 'fullscreen' },
};

export const Won = { render: () => screen(view()) };
export const Lost = { render: () => screen(view({ winner: 1 })) };
export const Draw = { render: () => screen(view({ winner: null })) };
export const RematchAsked = { name: 'They want a rematch', render: () => screen(view({ rematch: [false, true], disputable: true, disputed: [false, false] })) };
export const Waiting = { name: 'Waiting for their answer', render: () => screen(view({ rematch: [true, false] })) };
export const Disputed = { name: 'Disputed by the other seat', render: () => screen(view({ disputable: true, disputed: [true, true] })) };
export const EarlyConcession = {
  name: 'An early concession',
  render: () => screen(view({ turns: 2, concession: { seat: 1, turn: 2, weight: 'early' } })),
};
export const MatchGoesOn = {
  name: 'Competitive: game 1 of 3 done',
  render: () => screen(view({ match: { id: 'M', bestOf: 3, score: [1, 0], game: 2, phase: 'between', room: 'NEXT' } })),
};
export const MatchOver = {
  name: 'Competitive: the match is over',
  render: () => {
    const match = { id: 'M', bestOf: 3 as const, score: [2, 1] as [number, number], game: 3, phase: 'over' as const, room: '', result: { winner: 0 as const, how: 'games' as const, at: 1 } };
    return screen(view({ match }, { matchResult: matchResultHtml(match, 0, ['Ann', 'Bo']) }));
  },
};
export const GuestKeepIt = { name: 'A guest: keep this account', render: () => screen(view({}, { guest: true })) };
export const SignedOutKeepIt = { name: 'Signed out: keep this game', render: () => screen(view({ recorded: false }, { signup: { form: true } })) };
export const SingleCardDuel = {
  render: () => screen(view({ mode: 'constructed', els: [], single: ['Ignis Sprite', 'Overwhelm'] }, { modeLabel: 'single card duel', elements: null })),
};
