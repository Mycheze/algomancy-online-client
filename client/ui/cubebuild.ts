/* A CUBE EVENT'S DECK — the builder (ui/tabletop.ts) pointed at what you
 * drafted (docs/25 §6).
 *
 * The same table as every deck: the pool band over the felt, the piles, the
 * Sideboard in the rail. What is different is all in the host below:
 *
 *  · the pool is ONLY your drafted cards (`owned`), and a tile's ceiling is the
 *    copies you drafted — place() refuses the second copy of a card you have
 *    one of, with a note, the same way it refuses a third at the copy cap;
 *  · it starts from the deck you last submitted, else empty; "Suggest"
 *    fills it (the event's autoBuild, through acts.suggest) as one undoable step,
 *    in the piles Re-sort makes (by cost);
 *  · "Submit deck" sends it (acts.submit); the server's refusal, if
 *    any, shows in the builder's note row;
 *  · the deck lives in the EVENT, never in the account's deck shelf — this
 *    module imports nothing that writes the collection (test 1346 reads it).
 *
 * The `?table=` key is `cube:<event code>`. A reload comes back through the
 * resolver registered here only while this tab still holds the event's view;
 * otherwise the table gives up and the event page shows — `cubeTableWanted()`
 * says which event's builder the page was loaded on, for the event page to
 * reopen it once its view lands.
 */
import type { CubeView } from '../server/cube-types.ts';
import { MATCH_COPY_CAP, SIDEBOARD_MAX, checkMatchDeck } from '../engine/src/matchdeck.ts';
import { button } from './components/index.ts';
import type { DeckPile } from './deckarrange.ts';
import * as tt from './tabletop.ts';

export interface CubeBuildActs {
  /** send the deck; the error text, or null when it was taken */
  submit(main: string[], side: string[]): Promise<string | null>;
  /** the event's suggested deck from my pool, or null */
  suggest(): Promise<{ main: string[]; side: string[] } | null>;
  /** Back: the event page */
  back(): void;
}

/** a deck's least: checkDeck's 30 */
const DECK_MIN = 30;

export interface Build {
  code: string;
  view: CubeView;
  acts: CubeBuildActs;
  main: string[];
  side: string[];
  piles: DeckPile[] | null;
  /** the note row: the server's answer, or what Suggest found */
  note: string | null;
  /** a submit or a suggestion is on its way */
  busy: boolean;
  /** the table is showing this build */
  open: boolean;
}

let cur: Build | null = null;

/** the copies of each card in `list` */
function tally(list: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

/** the same cards, order aside */
const sameCards = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** what is wrong with the deck as it stands, one plain line each */
export function cubeDeckProblems(main: readonly string[], side: readonly string[], pool: readonly string[]): string[] {
  const out: string[] = [];
  if (main.length < DECK_MIN) out.push(`${DECK_MIN - main.length} cards short of ${DECK_MIN}`);
  if (side.length > SIDEBOARD_MAX) out.push(`The sideboard holds ${SIDEBOARD_MAX} at most`);
  const have = tally(pool);
  const short = [...tally([...main, ...side])].filter(([n, c]) => c > (have.get(n) ?? 0)).map(([n]) => n);
  if (short.length) out.push(`Not in your pool: ${short.join(', ')}`);
  if (!out.length) {
    const r = checkMatchDeck(main, side);
    if (!r.ok) out.push(r.error.charAt(0).toUpperCase() + r.error.slice(1));
  }
  return out;
}

/** the toolbar's two buttons */
function toolsHtml(b: Build): string {
  const submitted = !!b.view.myDeck && sameCards(b.main, b.view.myDeck.main) && sameCards(b.side, b.view.myDeck.side);
  return button({ label: 'Suggest', size: 'sm', dataBtn: 'tt-cube-suggest', disabled: b.busy, className: 'cbtool',
    title: 'a deck from what you drafted' })
    + button({
      label: submitted ? 'Submitted' : 'Submit deck', variant: 'primary', size: 'sm', dataBtn: 'tt-cube-submit', className: 'cbtool',
      disabled: b.busy || submitted,
    });
}

async function suggest(h: tt.TableHost, b: Build): Promise<void> {
  b.busy = true;
  b.note = null;
  tt.tabletopChanged();
  let got: { main: string[]; side: string[] } | null = null;
  try { got = await b.acts.suggest(); } catch { got = null; }
  b.busy = false;
  if (cur !== b) return;
  if (!got) { b.note = 'No suggestion right now.'; tt.tabletopChanged(); return; }
  // one step through the one door, so Undo takes it back
  if (!tt.place(h, null, { at: 'arrange', edit: { op: 'set', cards: got.main, side: got.side, sort: 'cost' } })) tt.tabletopChanged();
}

async function submit(b: Build): Promise<void> {
  b.busy = true;
  b.note = null;
  tt.tabletopChanged();
  let err: string | null;
  try { err = await b.acts.submit([...b.main], [...b.side]); } catch { err = 'Could not send the deck. Try again.'; }
  b.busy = false;
  if (cur !== b) return;
  b.note = err ?? 'Deck submitted.';
  tt.tabletopChanged();
}

/** THE HOST for the build in `b` (exported for the tests) */
export function cubeHost(b: Build): tt.TableHost {
  const h: tt.TableHost = {
    kind: 'deck',
    key: `cube:${b.code}`,
    title: () => b.view.config.name,
    backLabel: 'Event',
    cards: () => b.main,
    side: () => b.side,
    sideMax: SIDEBOARD_MAX,
    cap: MATCH_COPY_CAP,
    owned: () => tally(b.view.myPool ?? []),
    // the cap across both boards (a new copy into the deck is place()'s own
    // check; one into the sideboard is the host's), the same words as a deck's
    refuse: next => {
      const was = tally([...b.main, ...b.side]);
      const side = next.sideboard ?? b.side;
      for (const [n, c] of tally([...(next.cards ?? b.main), ...side])) {
        if (c > MATCH_COPY_CAP && c > (was.get(n) ?? 0)) return `Max ${MATCH_COPY_CAP} of ${n} across the deck and sideboard.`;
      }
      return null;
    },
    piles: () => b.piles,
    pool: true,
    pill: () => {
      const problems = cubeDeckProblems(b.main, b.side, b.view.myPool ?? []);
      const n = b.main.length;
      return {
        text: n < DECK_MIN ? `${n} / ${DECK_MIN}` : `${n} cards`,
        tone: !problems.length ? 'ok' : n < DECK_MIN ? 'warn' : 'bad',
        problems,
      };
    },
    toolsHtml: () => toolsHtml(b),
    note: () => b.note,
    button: el => {
      const which = el.dataset['btn'];
      if (b.busy) return;
      if (which === 'tt-cube-suggest') void suggest(h, b);
      else if (which === 'tt-cube-submit') void submit(b);
    },
    commit: next => {
      if (next.cards) b.main = next.cards;
      if (next.sideboard) b.side = next.sideboard;
      if ('piles' in next) b.piles = next.piles ?? null;
      b.note = null;
      tt.tabletopChanged();
    },
    close: () => { b.open = false; b.acts.back(); },
  };
  return h;
}

/** a fresh build of `view`'s pool: the submitted deck, else nothing */
export function newBuild(view: CubeView, acts: CubeBuildActs): Build {
  return {
    code: view.code, view, acts,
    main: [...(view.myDeck?.main ?? [])], side: [...(view.myDeck?.side ?? [])],
    piles: null, note: null, busy: false, open: false,
  };
}

/**
 * Open the builder on my drafted pool. Called again for the same event while
 * it is open (a new view pushed), it keeps what is on the table and takes the
 * new view: the pool, the submitted deck, the name.
 */
export function openCubeBuilder(view: CubeView, acts: CubeBuildActs): void {
  if (cur && cur.code === view.code && cur.open) {
    cur.view = view;
    cur.acts = acts;
    tt.tabletopChanged();
    return;
  }
  // the same event reopened: the table as it was left, unless a newer deck was submitted since
  const keep = cur && cur.code === view.code
    && (!view.myDeck || (sameCards(cur.main, view.myDeck.main) && sameCards(cur.side, view.myDeck.side)));
  const b = keep && cur ? { ...cur, view, acts, note: null, busy: false } : newBuild(view, acts);
  b.open = true;
  cur = b;
  tt.openTabletop(cubeHost(b));
}

/** the build the table is showing, if it is a cube's (the tests read it) */
export const cubeBuild = (): Readonly<Build> | null => cur;

/** the event code of the `?table=cube:<code>` this page was loaded with */
const loadedWith: string | null = (() => {
  try {
    const t = new URLSearchParams(location.search).get('table');
    return t?.startsWith('cube:') ? t.slice(5) : null;
  } catch { return null; }
})();

/** Which event's builder the page was loaded on (a reload), or null — the
 * event page reopens it with openCubeBuilder once the view is in. */
export const cubeTableWanted = (): string | null => loadedWith;

// a reload on `?table=cube:<code>`: the build this tab still holds, if any
tt.registerTableResolver('cube', code => {
  if (!cur || cur.code !== code) return null;
  cur.open = true;
  return cubeHost(cur);
});
