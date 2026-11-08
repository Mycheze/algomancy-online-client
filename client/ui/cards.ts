/* THE CARD BROWSER: look at the whole pool, ask it a real question.
 *
 * Same contract as ui/decks.ts and ui/account.ts, which main.ts already knows
 * how to drive: screen() says whether this page owns the app element,
 * renderScreen() paints it, handleButton() is offered every click first
 * (everything here is prefixed `cards-`), and the page's state lives in this
 * file and nowhere else. The markup is pages/cards.ts (cardsView / cardsHtml /
 * paintCards, the page contract); paint() hands it the state.
 *
 * TWO EDITORS, ONE STATE. The query string in the box IS the page: the facet
 * chips down the left do not hold state of their own, they rewrite that string
 * (ui/cardsearch.ts `withChip`), and typing in the box re-derives which chips
 * look pressed. So a chip can never disagree with the box, the URL can carry
 * the whole page, and a search is a link. The alternative — chips holding
 * booleans, with the box as a shortcut — has two representations of one thing
 * and they drift the first time somebody types a paren.
 *
 * NO RESULT CAP. The drawer this replaces showed the first 60 and said so;
 * 537 rows is nothing to filter, so the only limit here is how many tiles are
 * PAINTED at once (CHUNK), and the button that reveals the rest says how many
 * are left. A count that is the truth is the whole point of a search.
 *
 * NO DECKBUILDING MODE (BL-65, 2026-11-04). The browser used to have one: a
 * deck lent it a bridge (`useDeck`), and every tile grew add/cut buttons. Decks
 * are built on the builder now (ui/tabletop.ts), whose pool searches with the
 * same ui/cardsearch.ts, so the browser went back to being only a browser.
 */
import { similarQuery } from './cardpanel.ts';
import { allRows, rowFor } from './cardindex.ts';
import {
  chipState, nextChipState, search,
  withChip, withDisplay, type SearchResult,
} from './cardsearch.ts';
import { copyText } from './util.ts';
import { CHUNK, cardsView, paintCards, type CardsHooks } from './pages/cards.ts';


/* An empty box means "the cards", not "everything" — see the implicit class
 * filter in ui/cardsearch.ts. There is no seeded default query any more:
 * clearing the box has to actually clear it. */
const QUERY_KEY = 'algoCardQuery';
const SAVED_KEY = 'algoCardSearches';

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let q = '';
let focus: string | null = null;
let shown = CHUNK;
let helpOpen = false;
/** which facet sections are unfolded — the rail is long and most of it is not
 * what you came for */
const railOpen: Record<string, boolean> = { element: true, cost: true, kind: true };
let rulings: { name: string; lines: string[] } | null = null;
/**
 * How many PUBLISHED decks play each card, or null until it has been asked
 * for. Fetched once per page open rather than per card: it is one small object
 * for the whole pool, and a request per pinned card would be a request per
 * click. Null means "not asked yet", `{}` means "asked, nobody has published
 * anything" — the difference decides whether the line is printed at all.
 */
let playedIn: Record<string, number> | null = null;
/** focus the query box on the NEXT paint only. Focusing on every paint means a
 * chip click yanks the caret out of wherever you were, and the page under it
 * jumps — the drawer in ui/decks.ts gets away with it because it paints once
 * when it opens; this page repaints on every chip. */
let wantFocus = true;
/** the keyboard cursor into the painted results, or -1 for none */
let cursor = -1;

export const screen = (): 'cards' | null => (open ? 'cards' : null);

export function initCards(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  // a query in the URL wins: that is what makes a search a shareable link
  const url = new URLSearchParams(location.search);
  const fromUrl = url.get('q');
  if (fromUrl !== null) q = fromUrl;
  else q = load(QUERY_KEY, '');
  if (url.has('cards')) open = true;
  // a card's own link, `?card=<name>` (owner, 2026-11-01): the search page
  // with that card pinned — and a preview of the card itself when the link is
  // pasted somewhere (server/linkpreview.ts)
  const pin = url.get('card');
  if (pin) {
    const r = rowFor(pin) ?? allRows().find(x => x.nameLc === pin.trim().toLowerCase()) ?? null;
    if (r) { focus = r.name; open = true; }
  }
}

/** the link that opens the search page with `name` pinned */
export const cardLink = (name: string): string => `${location.origin}/?card=${encodeURIComponent(name)}`;

/** Ask once, when the page opens. A failure is silence, not an error: the
 * count is a nicety and the browser works without the server. */
function fetchPlayed(): void {
  if (playedIn) return;
  void fetch('/api/deck/played')
    .then(r => r.json() as Promise<{ ok: boolean; counts?: Record<string, number> }>)
    .then(r => { playedIn = r.ok && r.counts ? r.counts : {}; paint(); })
    .catch(() => { playedIn = {}; });
}

/** Open the browser. `query` seeds the box. */
export function openBrowser(query?: string): void {
  if (query !== undefined) q = query;
  open = true;
  shown = CHUNK;
  focus = null;
  wantFocus = true;
  // the address bar has to say what the page is showing FROM THE START. It was
  // only written on the next edit, so opening the page with a remembered query
  // showed 18 cards behind a URL that meant "all of them" — and copying that
  // link sent someone a different search.
  syncUrl();
  fetchPlayed();
  renderScreen();
}

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
};
const save = (key: string, v: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ }
};

const savedSearches = (): { name: string; q: string }[] => load(SAVED_KEY, [] as { name: string; q: string }[]);

/* ── running the query ─────────────────────────────────────────────────── */

function run(): SearchResult {
  return search(q, { ctx: {} });
}

/* ── the page ──────────────────────────────────────────────────────────── */

/** The state the page is drawn from — pages/cards.ts cardsView() gathers it,
 * cardsHtml() draws it. */
export interface CardsState {
  q: string;
  res: SearchResult;
  focus: string | null;
  shown: number;
  helpOpen: boolean;
  railOpen: Readonly<Record<string, boolean>>;
  rulings: { name: string; lines: string[] } | null;
  playedIn: Readonly<Record<string, number>> | null;
  saved: { name: string; q: string }[];
  cursor: number;
}

const state = (): CardsState => ({
  q, res: run(), focus, shown, helpOpen, railOpen, rulings, playedIn, saved: savedSearches(), cursor,
});

/** what paintCards wires the query box and the sort menu to */
const HOOKS: CardsHooks = {
  onSort: value => {
    q = withDisplay(q, 'sort', value || 'name');
    save(QUERY_KEY, q);
    syncUrl();
    paint();
  },
  onInput: value => {
    q = value;
    save(QUERY_KEY, q);
    shown = CHUNK;
    cursor = -1;
    syncUrl();
    scheduleRepaint();
  },
  takeFocus: () => {
    if (!wantFocus) return false;
    wantFocus = false;
    return true;
  },
};

function paint(): void {
  if (!$app) return;
  paintCards($app, cardsView(state()), HOOKS);
}

/**
 * Repaint after a keystroke, on a short debounce.
 *
 * THE WHOLE PAGE, not just the results. The first version repainted only
 * `.cbresults` and `.cbrail` so the `<input>` would survive under the caret,
 * and everything else in the bar silently stopped following what you typed:
 * the clear button never appeared, the syntax error never showed, and the
 * "did you mean `attr:deadly`" hint — the entire point of ui/cardsynonyms.ts —
 * only ever rendered if you happened to click something afterwards. Live
 * feedback that is not live is worse than none, because you stop looking.
 *
 * `repaintKeepingCaret` puts the caret back, so the input surviving is no
 * longer a reason to leave half the page stale. The debounce is what keeps
 * that affordable: one paint per pause, not one per keystroke.
 */
const REPAINT_MS = 90;
let repaintTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRepaint(): void {
  if (repaintTimer) clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    repaintKeepingCaret();
  }, REPAINT_MS);
}

/**
 * Repaint without throwing the user out of the query box.
 *
 * The page repaints by replacing `#app.innerHTML`, which destroys the input —
 * so anything that repaints while you are typing (a keystroke, an arrow key)
 * would silently drop focus, and the next letter would go nowhere. Nothing
 * looks broken; the box just stops accepting letters.
 */
function repaintKeepingCaret(): void {
  const before = document.getElementById('cb-q') as HTMLInputElement | null;
  const had = document.activeElement === before;
  const at = before ? [before.selectionStart, before.selectionEnd] as const : null;
  paint();
  if (!had) return;
  const after = document.getElementById('cb-q') as HTMLInputElement | null;
  if (!after) return;
  after.focus();
  if (at) [after.selectionStart, after.selectionEnd] = [at[0], at[1]];
}

/** The query in the address bar, so a search is a link. Replaces rather than
 * pushes: one back-button step per search would bury the rest of the app. */
function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set('cards', '1');
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    if (focus) url.searchParams.set('card', focus); else url.searchParams.delete('card');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// and the like */ }
}

function clearUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('cards');
    url.searchParams.delete('q');
    url.searchParams.delete('card');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

export function renderScreen(): void {
  paint();
}

/* ── clicks ────────────────────────────────────────────────────────────── */

/** Ask the game server (which proxies the rules bot) what has been ruled about
 * a card. The bot is often not running; that is a missing section, not an
 * error the page should shout about. */
function fetchRulings(name: string): void {
  rulings = { name, lines: ['loading…'] };
  paint();
  fetch(`/api/cardinfo?name=${encodeURIComponent(name)}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((info: { rulings?: unknown[] }) => {
      rulings = {
        name,
        lines: (info.rulings ?? []).map(x => (typeof x === 'string' ? x : JSON.stringify(x))),
      };
      paint();
    })
    .catch(() => {
      rulings = { name, lines: [] };
      paint();
    });
}

/** main.ts offers every button here. Returns true when it was ours. */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('cards-')) return false;
  const card = btn.dataset['card'] ?? '';

  switch (b) {
    case 'cards-openpage':
      openBrowser();
      return true;

    case 'cards-close':
      open = false;
      helpOpen = false;
      focus = null;
      clearUrl();
      rerenderHost();
      return true;

    case 'cards-chip': {
      const key = btn.dataset['key'] ?? '';
      const value = btn.dataset['value'] ?? '';
      q = withChip(q, key, value, nextChipState(chipState(q, key, value)));
      shown = CHUNK;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;
    }

    case 'cards-section': {
      const s = btn.dataset['section'] ?? '';
      railOpen[s] = !railOpen[s];
      paint();
      return true;
    }

    case 'cards-try':
      q = btn.dataset['q'] ?? '';
      helpOpen = false;
      shown = CHUNK;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-similar': {
      const sim = similarQuery(card);
      if (sim) {
        q = sim;
        shown = CHUNK;
        focus = null;
        save(QUERY_KEY, q);
        syncUrl();
        paint();
      }
      return true;
    }

    case 'cards-focus':
      focus = card;
      rulings = null;
      syncUrl();
      paint();
      return true;

    case 'cards-unfocus':
      focus = null;
      syncUrl();
      paint();
      return true;

    // the pinned card's own link, to paste anywhere (it unfurls as the card)
    case 'cards-copylink':
      copyText(cardLink(card), null, btn, 'Link copied \u2713');
      return true;

    case 'cards-rulings':
      fetchRulings(card);
      return true;

    case 'cards-help':
      helpOpen = !helpOpen;
      paint();
      return true;

    case 'cards-clear':
      q = '';
      shown = CHUNK;
      wantFocus = true;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-more':
      shown += CHUNK;
      paint();
      return true;

    case 'cards-view':
      q = withDisplay(q, 'view', btn.dataset['view'] ?? 'grid');
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-dir':
      q = withDisplay(q, 'dir', run().query.dir === 'asc' ? 'desc' : 'asc');
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-save': {
      const name = q.length > 24 ? `${q.slice(0, 24)}…` : q;
      const list = savedSearches().filter(s => s.q !== q);
      save(SAVED_KEY, [{ name, q }, ...list].slice(0, 8));
      paint();
      return true;
    }

    case 'cards-forget':
      save(SAVED_KEY, []);
      paint();
      return true;

    default:
      return false;
  }
}

/**
 * The keys.
 *
 * `/` focuses the box, Escape backs out of whatever is on top, and the arrows
 * walk the results so you can scan without the mouse. Enter opens the detail
 * pane. main.ts owns the keydown
 * listener and offers it here first — before its own `if (!inGame) return`,
 * since this is a pre-game page.
 */
export function handleKey(e: KeyboardEvent): boolean {
  if (!open) return false;
  const el = e.target as HTMLElement | null;
  const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';

  if (e.key === 'Escape') {
    if (helpOpen) { helpOpen = false; paint(); return true; }
    if (focus) { focus = null; syncUrl(); paint(); return true; }
    if (typing) { (el as HTMLInputElement).blur(); return true; }
    return false;
  }
  if (e.key === '/' && !typing) {
    wantFocus = true;
    (document.getElementById('cb-q') as HTMLInputElement | null)?.focus();
    return true;
  }
  // the arrows belong to the caret while you are typing in the box
  if (typing && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const rows = run().rows.slice(0, shown);
  if (!rows.length) return false;
  const step = (by: number): boolean => {
    cursor = Math.max(0, Math.min(rows.length - 1, cursor + by));
    e.preventDefault();
    repaintKeepingCaret();
    return true;
  };
  switch (e.key) {
    case 'ArrowDown': return step(cursor < 0 ? 0 : 1);
    case 'ArrowUp': return cursor <= 0 ? false : step(-1);
    case 'ArrowRight': return typing ? false : step(cursor < 0 ? 0 : 1);
    case 'ArrowLeft': return typing || cursor <= 0 ? false : step(-1);
    case 'Enter': {
      if (cursor < 0) return false;
      focus = rows[cursor]!.name;
      rulings = null;
      syncUrl();
      paint();
      return true;
    }
    default: return false;
  }
}
