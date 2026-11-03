import { DECK_LIST } from '../../../engine/src/cards/registry.ts';
import {
  competitiveCardHtml, matchRoomHtml, yourMatchesHtml, type MatchRoomView,
} from '../../../ui/pages/match.ts';
import type { MatchLobbyInfo } from '../../../ui/match.ts';
import { FRIENDS, page } from './_page.ts';

// real cards, two copies each: a preset is checked against the pool
const MAIN = Array.from({ length: 30 }, (_, i) => DECK_LIST[i % 15]!);
const SIDE = [DECK_LIST[20]!, DECK_LIST[21]!, DECK_LIST[22]!];
const CFG = { main: MAIN, side: SIDE };
const NOW = Date.UTC(2026, 10, 3, 20, 0);

function lobby(over: Partial<MatchLobbyInfo> = {}): MatchLobbyInfo {
  return {
    id: 'M1', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
    banks: [38 * 60_000, 41 * 60_000 + 5_000], clockStart: 45 * 60_000,
    phase: 'between', chooser: null, initiative: null, until: NOW + 95_000, locked: false, ready: [false, true],
    mine: { registered: CFG, current: CFG },
    ...over,
  };
}
function room(over: Partial<MatchRoomView> = {}): MatchRoomView {
  const w = over.w ?? lobby();
  return {
    room: 'CCRM', seat: 0, names: ['Ann', 'Bo'], peers: [true, true], ended: null,
    w, decks: null, pick: null, error: '', now: NOW,
    link: 'https://algomancy.online/?ws=1&room=CCRM&seat=1&mode=constructed&cc=1', friends: FRIENDS,
    shown: w.mine?.current ?? null, concedeAsk: false,
    ...over,
  };
}
const DECKS = [{ id: 'dOK', name: 'Ember Rush (Competitive)', error: null }, { id: 'dBAD', name: 'Big side', error: 'a sideboard holds at most 7 cards (got 8)' }];

export default {
  title: 'Pages/Competitive match',
  parameters: { layout: 'fullscreen' },
};

const homeCard = (html: string): string => `<div class="homegrid" style="max-width:340px">${html}</div>`;
export const CardSignedOut = { name: 'Home card: signed out', render: () => homeCard(competitiveCardHtml({ signedIn: false, decks: null, bestOf: 3, pick: null })) };
export const CardSignedIn = { name: 'Home card: a legal and an illegal deck', render: () => homeCard(competitiveCardHtml({ signedIn: true, decks: DECKS, bestOf: 3, pick: DECKS[0]! })) };
export const CardNoLegalDeck = { name: 'Home card: no legal deck', render: () => homeCard(competitiveCardHtml({ signedIn: true, decks: [DECKS[1]!], bestOf: 1, pick: null })) };
export const YourMatches = {
  name: 'Your matches (home)',
  render: () => `<div style="max-width:1136px">${yourMatchesHtml({ rows: [
    { room: 'PAUS', seat: 1, text: 'vs <b>Rashi</b> · you lead 1–0 · paused 2 days ago', button: 'Resume' },
    { room: 'LIVE', seat: 0, text: 'vs <b>Cy</b> · 1–1 · game 3 of 3 — sideboarding', button: 'Open' },
  ] })}</div>`,
};
export const Registration = {
  name: 'Game 1: register a deck',
  render: () => page(matchRoomHtml(room({ w: lobby({ game: 1, phase: 'game', score: [0, 0], mine: null, ready: [false, false] }), decks: DECKS, pick: DECKS[0]!, peers: [true, false] }))),
};
export const Between = { name: 'Between games: sideboarding', render: () => page(matchRoomHtml(room())) };
export const IllegalDraft = {
  name: 'Between games: a half-made swap',
  render: () => page(matchRoomHtml(room({ shown: { main: MAIN.slice(1), side: [...SIDE, MAIN[0]!] } }))),
};
export const LoserChooses = { name: 'Between games: you lost, you choose', render: () => page(matchRoomHtml(room({ w: lobby({ chooser: 0, score: [0, 1] }) }))) };
export const Locked = { name: 'Sideboarding over: who takes the initiative?', render: () => page(matchRoomHtml(room({ w: lobby({ chooser: 0, locked: true }) }))) };
export const PauseOffered = { name: 'They offer a pause', render: () => page(matchRoomHtml(room({ w: lobby({ pause: { offeredBy: 1, pausedAt: null, resume: [false, false] } }) }))) };
export const Paused = {
  render: () => page(matchRoomHtml(room({ w: lobby({ phase: 'paused', pause: { offeredBy: null, pausedAt: NOW - 2 * 86_400_000, resume: [false, true], voidAt: null } }) }))),
};
export const ConcedeAsked = { name: 'Concede match? (asked)', render: () => page(matchRoomHtml(room({ concedeAsk: true }))) };
export const Ended = {
  name: 'The match ended while you waited',
  render: () => page(matchRoomHtml(room({ ended: { id: 'M1', bestOf: 3, score: [1, 2], game: 3, phase: 'over', room: '', result: { winner: 1, how: 'conceded', at: 1, concededBy: 0 } } }))),
};
