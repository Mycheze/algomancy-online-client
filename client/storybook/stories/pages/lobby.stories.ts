import { lobbyHtml, revealHtml, type LobbyView } from '../../../ui/pages/lobby.ts';
import { FRIENDS, overlay, page, CHROME } from './_page.ts';

const METHODS = [
  { id: 'pick-one', label: 'One each', blurb: 'Each of you names an element; the server adds a third.' },
  { id: 'rank', label: 'Rank them', blurb: 'Rank all seven; shared top picks are likelier.' },
  { id: 'fresh', label: 'Something new', blurb: 'A trio the two of you have never played.' },
];

function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    lobby: { method: 'pick-one', methods: METHODS, locked: [false, false], mine: {} },
    seat: 0, names: ['Ann', 'Bo'], peers: [true, true], room: 'QXZZ',
    link: 'https://algomancy.online/?ws=1&room=QXZZ&seat=1&mode=draft', friends: FRIENDS,
    pick: null, ranking: [], ready: false,
    chrome: CHROME,
    ...over,
  };
}

export default {
  title: 'Pages/Draft lobby',
  parameters: { layout: 'fullscreen' },
};

export const OpponentAway = { name: 'Waiting for the opponent', render: () => page(lobbyHtml(view({ peers: [true, false] }))) };
export const PickOne = { name: 'One each: an element named', render: () => page(lobbyHtml(view({ pick: 'fire', ready: true }))) };
export const Rank = {
  name: 'Rank them: part-way',
  render: () => page(lobbyHtml(view({ lobby: { method: 'rank', methods: METHODS, locked: [false, false], mine: {} }, ranking: ['wood', 'fire'] }))),
};
export const LockedIn = {
  name: 'Locked in, the opponent still choosing',
  render: () => page(lobbyHtml(view({ lobby: { method: 'pick-one', methods: METHODS, locked: [true, false], mine: {} }, pick: 'fire', ready: true }))),
};
export const CustomRules = {
  name: 'A custom live draft (pair)',
  render: () => page(lobbyHtml(view({
    lobby: { method: 'fresh', count: 2, methods: METHODS, locked: [false, false], mine: {} }, ready: true,
    custom: { summary: ['2 elements', 'Packs of 5', 'Simple cards only'], excluded: 216 },
  }))),
};
export const LeagueMatch = {
  name: 'A league match',
  render: () => page(lobbyHtml(view({ peers: [true, false], lobby: { method: 'random', methods: [], locked: [false, false], mine: {} }, ready: true }))),
};
export const Reconnecting = {
  name: 'The connection dropped',
  render: () => page(lobbyHtml(view({ pick: 'fire', ready: true, error: 'disconnected from the server — reconnecting in 2s…' }))),
};
export const TrioReveal = {
  name: 'The trio reveal',
  render: () => overlay(`<div class="overlay trioover">${revealHtml({
    els: ['fire', 'wood', 'water'], how: 'You both named fire; the server drew the third.',
    detail: ['Ann named fire', 'Bo named fire', 'wood and water drawn from the five left'],
  })}</div>`, 520),
};
