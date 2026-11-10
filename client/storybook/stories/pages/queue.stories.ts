import { queueGlanceHtml, queueHtml, queueStripHtml, type QueueView } from '../../../ui/pages/queue.ts';
import { deckPickerHtml } from '../../../ui/pages/deckpicker.ts';
import { CHROME, DECKS, overlay, page } from './_page.ts';

function view(over: Partial<QueueView> = {}): QueueView {
  return {
    counts: { total: 1, byMode: { constructed: 0, draft: 1 } },
    error: '', pickMode: 'draft', pickRanked: true, signedIn: true, blocker: null, rating: 1512,
    deckPicker: '', searching: null, offer: null, chrome: CHROME,
    ...over,
  };
}
const SEARCH = { mode: 'draft' as const, ranked: true, since: 0, band: 150, waited: 47_000 };
const OFFER = { opponent: 'Rashi', opponentRating: 1490, mode: 'draft' as const, accepted: false, expiresIn: 9000, left: 9 };

export default {
  title: 'Pages/Matchmaking queue',
  parameters: { layout: 'fullscreen' },
};

export const Picker = { name: 'Picking a format', render: () => page(queueHtml(view())) };
export const Constructed = {
  name: 'Constructed, with the deck picker',
  render: () => page(queueHtml(view({
    pickMode: 'constructed',
    deckPicker: deckPickerHtml({ current: DECKS[0]!, signedIn: true, mine: DECKS, defaults: null, msg: '' }),
  }))),
};
export const SignedOutBlocked = {
  name: 'Signed out, constructed refused',
  render: () => page(queueHtml(view({ pickMode: 'constructed', signedIn: false, rating: null, blocker: 'constructed needs an account — you have to bring a deck' }))),
};
export const Searching = { render: () => page(queueHtml(view({ searching: SEARCH }))) };
export const Challenge = { name: 'Joining one open game', render: () => page(queueHtml(view({ searching: { ...SEARCH, vs: 'g1', vsName: 'Rashi' } }))) };
export const LostConnection = { name: 'An error', render: () => page(queueHtml(view({ error: 'lost the connection — try searching again' }))) };
export const Offer = { name: 'Match found', render: () => overlay(page(queueHtml(view({ offer: OFFER }))), 600) };
export const Accepted = { name: 'Match found, accepted', render: () => overlay(page(queueHtml(view({ offer: { ...OFFER, accepted: true, left: 4 } }))), 600) };
export const OfferRanOut = { name: 'Match found, time ran out', render: () => overlay(page(queueHtml(view({ offer: { ...OFFER, left: 0 } }))), 600) };
export const AcceptedRanOut = { name: 'Match found, accepted, they did not answer', render: () => overlay(page(queueHtml(view({ offer: { ...OFFER, accepted: true, left: 0 } }))), 600) };
export const HomeStrip = {
  name: 'The home strip, with open games',
  render: () => `<div style="max-width:1136px">${queueStripHtml({
    counts: { total: 2, byMode: { constructed: 1, draft: 1 } },
    openGames: [
      { id: 'g1', username: 'Rashi', mode: 'draft', ranked: true, rating: 1490, waitedMs: 42_000 },
      { id: 'g2', username: 'Cy', mode: 'constructed', ranked: false, rating: 1400, waitedMs: 130_000 },
    ],
  })}</div>`,
};
export const HomeStripEmpty = {
  name: 'The home strip, nobody waiting',
  render: () => `<div style="max-width:1136px">${queueStripHtml({ counts: { total: 0, byMode: { constructed: 0, draft: 0 } }, openGames: [] })}</div>`,
};

// the new home's Matchmaking card body (docs/24): the count and the open games, no Find a game
const card = (html: string): string => `<div style="max-width:320px;padding:12px;border:1px dashed var(--color-border)">${html}</div>`;
export const HomeGlance = {
  name: 'Home card glance, with open games',
  render: () => card(queueGlanceHtml({
    counts: { total: 2, byMode: { constructed: 1, draft: 1 } },
    openGames: [
      { id: 'g1', username: 'Rashi', mode: 'draft', ranked: true, rating: 1490, waitedMs: 42_000 },
      { id: 'g2', username: 'Cy', mode: 'constructed', ranked: false, rating: 1400, waitedMs: 130_000 },
    ],
  })),
};
export const HomeGlanceEmpty = {
  name: 'Home card glance, nobody waiting',
  render: () => card(queueGlanceHtml({ counts: { total: 0, byMode: { constructed: 0, draft: 0 } }, openGames: [] })),
};
export const HomeGlanceUnreachable = {
  name: 'Home card glance, the server not answering',
  render: () => card(queueGlanceHtml({ counts: null, openGames: [], unreachable: true })),
};
