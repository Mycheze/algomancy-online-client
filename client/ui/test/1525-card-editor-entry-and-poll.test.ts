/* 1525 — the ways into the card editor, and its poll.
 *
 * §1 the card browser's pinned card has Edit only for an account that may edit cards
 * §2 main.ts routes the profile's Card editor and the browser's Edit to the page, draws it over the
 *    card browser, and keeps the browser's keys off while it is on top
 * §3 the poll: nothing armed at import or at boot; armed by a paint that shows an edit still moving;
 *    stopped once it settles, on another tab, and on leaving; a tick with nothing new paints nothing
 *    (ui/cardeditor.ts, with stand-in fetch and timers and no DOM)
 * §4 the page has its story
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { search } from '../cardsearch.ts';
import { allRows } from '../cardindex.ts';
import { CHUNK, cardsHtml, facets, type CardsView } from '../pages/cards.ts';

const CARD = allRows().find(r => r.cls === 'card' && r.playable)!;
function cards(canEdit: boolean | undefined): string {
  const v: CardsView = {
    q: '', res: search(''), cardCount: 450, facets: facets(false), railOpen: {}, hints: [], saved: [], helpOpen: false,
    focus: CARD.name, focusRow: CARD, played: 0, rulings: null, cursor: -1, shown: CHUNK, chrome: { signedIn: true, alerts: 0 },
    ...(canEdit === undefined ? {} : { canEdit }),
  };
  return cardsHtml(v);
}

test('1525 §1 Edit beside Copy link, for an account that may edit cards only', () => {
  const html = cards(true);
  assert.match(html, /data-btn="cards-copylink"[^>]*>Copy link<\/button>\s*<button data-btn="cards-edit" data-card="([^"]+)">Edit<\/button>/);
  assert.equal(/data-btn="cards-edit" data-card="([^"]+)"/.exec(html)?.[1], CARD.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
  assert.doesNotMatch(cards(false), /cards-edit/);
  assert.doesNotMatch(cards(undefined), /cards-edit/, 'nobody may until the source says so');
});

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

test('1525 §2 main.ts routes both buttons, and draws the editor over the card browser', () => {
  assert.match(MAIN, /btn\.dataset\['btn'\] === 'nav-cardeditor'\) \{ acct\.leaveScreen\(\); ce\.openCardEditor\(\); return; \}/);
  assert.match(MAIN, /btn\.dataset\['btn'\] === 'cards-edit'\) \{ ce\.openCardEditor\(btn\.dataset\['card'\], 'Cards'\); return; \}/);
  assert.ok(MAIN.indexOf("=== 'cards-edit'") < MAIN.indexOf('if (cb.handleButton(btn)) return;'), 'claimed before the browser takes every cards- click');
  assert.match(MAIN, /if \(ce\.handleButton\(btn\)\) return;/);
  const render = MAIN.slice(MAIN.indexOf('function renderHome(): void {'));
  assert.ok(render.indexOf('if (ce.screen())') > 0 && render.indexOf('if (ce.screen())') < render.indexOf('if (cb.screen())'),
    'the editor is checked before the card browser it sits on');
  assert.match(MAIN, /if \(!ce\.screen\(\) && cb\.handleKey\(e\)\) return;/, 'the browser keys stay off under the editor');
  assert.match(MAIN, /\nce\.initCardEditor\(\{ app: \$app, rerender: /);
});

/* -- the poll ------------------------------------------------------------- */

const ID = 'ce-20261127-murkstalker-7f3a';
const ROW = { name: 'Murkstalker', power: '2', toughness: '2', cost: 'ld', total_cost: '2', type: 'Cosmic Horror Unit',
  text: 'x', image: 'm.png', complexity: 'Complex' };
const detail = (status: string): Record<string, unknown> => ({
  ok: true, id: ID, card: 'Murkstalker', by: { name: 'Caleb' }, createdAt: '2026-11-27T10:00:00Z', summary: 'cost 2 → 3', road: 'fast',
  status, note: null, edit: { 'total cost': '3' }, diff: [], why: [],
  commands: [{ text: '$modify murkstalker|total cost|3', field: 'total cost', posted: null, answered: false }], pictures: { before: false, after: false },
});

test('1525 §3 the poll runs only while a moving edit is on screen', async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { setInterval: g['setInterval'], clearInterval: g['clearInterval'], fetch: g['fetch'], localStorage: g['localStorage'] };
  const live = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  g['setInterval'] = (fn: () => void, ms: number) => { live.set(++next, { fn, ms }); return next; };
  g['clearInterval'] = (id: number) => { live.delete(id); };
  g['localStorage'] = { getItem: () => 'token', setItem: () => {}, removeItem: () => {} };
  let status = 'submitted';
  let asked = 0;
  g['fetch'] = async (url: string) => {
    asked++;
    const body = url.startsWith('/api/cardedit/row') ? { ok: true, card: 'Murkstalker', row: ROW, rowHash: 'h', readOnly: null, open: ID }
      : url === '/api/cardedit/edits' ? { ok: true, edits: [] }
        : detail(status);
    return { ok: true, status: 200, json: async () => body };
  };
  const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  try {
    const ce = await import('../cardeditor.ts');
    assert.equal(live.size, 0, 'nothing armed at import');
    let html = '', paints = 0;
    const app = { get innerHTML() { return html; }, set innerHTML(v: string) { html = v; paints++; }, className: '',
      querySelector: (s: string) => (s === '.cepage' ? {} : null), querySelectorAll: () => [] };
    let home = 0;
    ce.initCardEditor({ app: app as unknown as HTMLElement, rerender: () => { home++; } });
    assert.equal(live.size, 0, 'nothing armed at boot');
    assert.equal(ce.screen(), null);

    ce.openCardEditor('Murkstalker');
    await settle();
    assert.equal(ce.screen(), 'cardeditor');
    assert.match(app.innerHTML, /\$modify murkstalker\|total cost\|3/, 'the open edit is on screen');
    assert.equal(live.size, 1, 'one poll while it is on screen');
    assert.equal([...live.values()][0]!.ms, 5000);

    // a tick that finds nothing new paints nothing
    const painted = paints;
    [...live.values()][0]!.fn();
    await settle();
    assert.equal(paints, painted, 'an unchanged edit is not repainted');
    // a tick that finds the edit settled stops the poll
    status = 'live';
    const before = asked;
    [...live.values()][0]!.fn();
    await settle();
    assert.equal(asked, before + 1, 'the tick asked the server once');
    assert.match(app.innerHTML, /cestep--now" aria-current="step">Live</);
    assert.equal(live.size, 0, 'nothing to poll for once live');

    // still moving, then another tab, then back, then leaving
    status = 'waiting';
    ce.openCardEditor('Murkstalker');
    await settle();
    assert.equal(live.size, 1);
    ce.handleButton({ dataset: { btn: 'ce-tab', tab: 'mine' } } as unknown as HTMLElement);
    await settle();
    assert.equal(live.size, 0, 'My edits with nothing opened: no poll');
    ce.handleButton({ dataset: { btn: 'ce-tab', tab: 'edit' } } as unknown as HTMLElement);
    assert.equal(live.size, 1, 'back on the edit: polling again');
    ce.handleButton({ dataset: { btn: 'ce-close' } } as unknown as HTMLElement);
    assert.equal(live.size, 0, 'stopped on leaving');
    assert.equal(ce.screen(), null);
    assert.equal(home, 1, 'Back repaints whatever is under the page');
  } finally {
    Object.assign(g, saved);
  }
});

test('1525 §4 the page has its story', () => {
  const story = readFileSync(new URL('../../storybook/stories/pages/cardeditor.stories.ts', import.meta.url), 'utf8');
  assert.match(story, /from '\.\.\/\.\.\/\.\.\/ui\/pages\/cardeditor\.ts'/);
  assert.match(story, /render: \(args: CardEditorView\) => cardEditorHtml\(args\)/);
});
