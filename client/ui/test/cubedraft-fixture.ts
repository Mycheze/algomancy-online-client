/* Made-up pick-screen views for the DOM-free tests (1343, 1350, 1351, 1360…) and the story
 * (storybook/stories/pages/cubedraft.stories.ts): the deck table under the pack, as ui/tabletop.ts
 * hands it to the builder for the draft's host — the main deck's piles, the Sideboard and Maybe.
 * Not a test: no `.test.ts`. */
import { seedPiles } from '../deckarrange.ts';
import type { CubeDraftPageView, CubeDraftTable } from '../pages/cubedraft.ts';

export const CW = 132, CH = 183;

/** the deck table of a draft: `picks` in piles by cost, `side` and `maybe` in the rail */
export function draftTable(picks: readonly string[], side: readonly string[] = [], maybe: readonly string[] = []): CubeDraftTable {
  const piles = seedPiles(picks, 'cost');
  return {
    title: 'Friday cube', backLabel: 'Event', pill: null, stripHtml: '', hostToolsHtml: '', canUndo: false, canRedo: false,
    stats: true, note: null, split: 0.4, head: { label: 'Main deck', count: picks.length, tools: true },
    table: {
      cw: CW, ch: CH, newPiles: { emptyText: '' },
      piles: piles.map(p => ({
        zone: `pile|${p.id}`, name: p.name, rename: p.id, head: p.id, ch: CH, S: 30,
        cards: p.cards.map((name, k) => ({ name, src: `pile|${p.id}|${k}|${name}` })),
      })),
      rail: {
        side: { zone: 'side', name: 'Sideboard', cls: 'ttsidepile', limit: 7, slot: true, ch: CH, S: 30, cards: side.map((name, k) => ({ name, src: `side|${k}|${name}` })) },
        maybe: { zone: 'maybe', name: 'Maybe', cls: 'ttmaybepile', ch: CH, S: 30, cards: maybe.map((name, k) => ({ name, src: `maybe|${k}|${name}` })) },
      },
      menu: null, holding: false,
    },
    statsStripHtml: '', sheet: null, hostSheetHtml: '', readOnly: false, chrome: { signedIn: true, alerts: 0 },
  };
}

/** a page view of the pack band, with what is not given made up */
export function packView(over: Partial<CubeDraftPageView> = {}): CubeDraftPageView {
  return {
    event: 'Friday cube', packNo: 2, pickNo: 5, direction: 'right', seats: [], pack: null, reserved: null, taken: null,
    suggest: null, msLeft: 30_000, split: 0.55, pw: 132, ...over,
  };
}
