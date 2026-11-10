/* BL-01 — the matchmaking queue, client side.
 *
 * The same contract every other non-game page here uses (account.ts,
 * decks.ts, cardindex.ts, meta.ts): init / screen / handleButton, with a
 * `queue-` button prefix. What it DRAWS — the queue screen and the home
 * screen's strip — is pages/queue.ts (design-system round, 2026-11-03), which
 * reads this module through queueSnapshot(); main.ts's router calls its
 * paintQueue() while screen() says the queue is open.
 *
 * ── THE ONE STRUCTURAL THING WORTH KNOWING ───────────────────────────
 *
 * ⚠ THE HOME SCREEN HAS NO WEBSOCKET. `NetBackend` is only constructed when
 * the URL carries a `room`, so a player sitting on the home page is not
 * connected to anything. The queue therefore opens its OWN socket, and only
 * while you are actually searching.
 *
 * That is deliberate rather than lazy. A socket that lives as long as the
 * search means "leaving the page removes you from the queue" is a property of
 * the transport rather than a rule the server has to remember to apply — see
 * the close handler in server/main.ts. And it means an idle home page costs
 * the server nothing, which the at-a-glance counter would otherwise change for
 * every visitor.
 *
 * The counter is the other half, and it goes over HTTP: `GET /api/queue`,
 * polled while the home screen is up. It is unauthenticated because "is
 * anybody around?" is the question somebody asks BEFORE deciding whether
 * signing in is worth it.
 */
import { playCue } from './audio.ts';
import { alertTab } from './tabalert.ts';

// ── types off the wire ────────────────────────────────────────────────

export type QueueMode = 'constructed' | 'draft';

export interface QueueCounts {
  total: number;
  byMode: Record<QueueMode, number>;
}

export interface Searching {
  mode: QueueMode;
  ranked: boolean;
  since: number;
  /** ⚠ the SERVER's current band, not one computed here — see queueStateFor */
  band: number | null;
  /** BL-42: whose open game this player clicked, if any. A direct challenge
   * ignores the band, so the searching line must NOT show a ± for it. */
  vs?: string | null;
  vsName?: string | null;
}

/** BL-42 — one game somebody is waiting in, as the home screen lists it. */
export interface OpenGame {
  id: string;
  username: string;
  mode: QueueMode;
  ranked: boolean;
  rating: number;
  waitedMs: number;
}

export interface MatchOffer {
  opponent: string;
  opponentRating: number;
  mode: QueueMode;
  /** have *I* accepted yet */
  accepted: boolean;
  expiresIn: number;
}

export interface QueueDeps {
  app: HTMLElement;
  rerender: () => void;
  chosenDeck: () => { id?: string; name: string; cards: string[] } | null;
  /** the signed-in player's session token, or null */
  token: () => string | null;
  /** their rating per format, if they are signed in */
  rating: (mode: QueueMode) => number | null;
  /** BL-42: a guest account was just minted — store the token as a login */
  onGuest: (token: string) => void;
}

// ── pure helpers (the bits worth a guard) ─────────────────────────────

export const MODES: readonly QueueMode[] = ['constructed', 'draft'];

export const MODE_LABEL: Record<QueueMode, string> = {
  constructed: 'Constructed',
  draft: 'Live draft',
};

/**
 * How the current search width reads.
 *
 * `null` is spelled out rather than rendered as a huge number, because the
 * state it names is a real one — the search has stopped refusing anybody — and
 * "±99999" would look like a bug.
 */
export const bandLabel = (band: number | null): string =>
  band === null ? 'anyone' : `±${band}`;

/** m:ss, for a wait that is usually under a minute and occasionally not. */
export function waitLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The at-a-glance line.
 *
 * ⚠ ZERO IS NOT RENDERED AS "0 waiting". An empty queue shown as a number
 * reads as a dead feature; shown as an invitation it reads as a thing to do,
 * and on a deploy this size the honest answer most of the time IS zero. The
 * count is still exact when there is one — this is a wording rule, not a
 * rounding one.
 */
export function countsSummary(counts: QueueCounts | null, unreachable = false): string {
  // before `counts`: a number we had before the server went quiet is a guess
  // about now, and the strip used to show it for as long as it stayed quiet
  if (unreachable) return UNREACHABLE_LINE;
  if (!counts) return 'checking…';
  if (counts.total === 0) return 'nobody waiting — be the first';
  const parts = MODES
    .filter(m => counts.byMode[m] > 0)
    .map(m => `${MODE_LABEL[m]} ${counts.byMode[m]}`);
  return `${counts.total} waiting · ${parts.join(' · ')}`;
}

/** What the counter says once the poll has gone unanswered (pollMisses). */
export const UNREACHABLE_LINE = 'could not reach the server — trying again…';

/** Why this player cannot queue for this format yet, or null if they can. */
export function queueBlocker(
  mode: QueueMode, signedIn: boolean, hasDeck: boolean,
): string | null {
  /* ⚠ DRAFT NO LONGER NEEDS AN ACCOUNT. It used to: "sign in to use the queue
   * — a rated game needs somebody to belong to". The owner's call on
   * 2026-09-02 was that a draft game should just start — "they can make an
   * account to save things after the game" — and the way that works without
   * any guest-shaped special case downstream is that the client silently makes
   * a real account first (POST /api/auth/guest). It has a rating, it plays
   * rated games, and claiming it afterwards is a rename, not a migration.
   *
   * CONSTRUCTED still does, and for a reason that is not about identity: the
   * queue needs a DECK at queue time, because a matchmade constructed game
   * deals the instant both sides accept and there is no deck-picker lobby to
   * fall back into. A guest has no decks. */
  if (mode === 'constructed') {
    if (!signedIn) return 'constructed needs an account — you have to bring a deck';
    if (!hasDeck) return 'pick one of your decks first';
  }
  return null;
}

// ── state ─────────────────────────────────────────────────────────────

let deps: QueueDeps | null = null;
let open = false;
let counts: QueueCounts | null = null;
/** BL-42: the games on offer right now, newest last */
let openGames: OpenGame[] = [];
let searching: Searching | null = null;
let offer: MatchOffer | null = null;
let error = '';
let ws: WebSocket | null = null;
let pollTimer = 0;
/** counts polls in a row that got no answer (offline, a 502 while the
 * server restarts); see UNREACHABLE_AFTER */
let pollMisses = 0;
let tickTimer = 0;
/** when the current offer was received, so the countdown is local and smooth */
let offerAt = 0;

/** what the player has selected on the queue screen but not yet submitted */
let pickMode: QueueMode = 'draft';
let pickRanked = true;

const RANKED_KEY = 'algoQueueRanked';
const MODE_KEY = 'algoQueueMode';

export function initQueue(d: QueueDeps): void {
  deps = d;
  const m = localStorage.getItem(MODE_KEY);
  if (m === 'constructed' || m === 'draft') pickMode = m;
  pickRanked = localStorage.getItem(RANKED_KEY) !== '0';
}

export const screen = (): 'queue' | null => (open ? 'queue' : null);

// ── the counts poll ───────────────────────────────────────────────────

const POLL_MS = 5000;
/** Two unanswered polls in a row (~10s) and the counter says it cannot reach
 * the server, rather than one blip flipping the line for five seconds. */
const UNREACHABLE_AFTER = 2;
const unreachable = (): boolean => pollMisses >= UNREACHABLE_AFTER;

/**
 * Keep the home screen's counter fresh.
 *
 * ⚠ Stops itself while the socket is open: a searching client is already being
 * pushed the counts on every change, and polling on top of that would make the
 * number flicker between a live value and a five-second-old one.
 */
export function startCountsPoll(): void {
  if (pollTimer) return;
  const tick = (): void => {
    if (ws) return;
    fetch('/api/queue')
      .then(r => r.json())
      .then((r: { ok?: boolean; counts?: QueueCounts; open?: OpenGame[] }) => {
        if (!r.counts) { missed(); return; }
        const before = JSON.stringify([counts, openGames, unreachable()]);
        counts = r.counts;
        openGames = r.open ?? [];
        pollMisses = 0;
        if (JSON.stringify([counts, openGames, unreachable()]) !== before) deps?.rerender();
      })
      // offline, or a page that is not JSON (Caddy's 502 while the server
      // restarts). The last number and the open games stay in memory, but
      // once UNREACHABLE_AFTER polls have missed, the snapshot stops showing
      // them: they were frozen at the moment the server went quiet, and their
      // Join buttons could not work (S16, docs/23-ui-inventory/01 §4).
      .catch(missed);
  };
  const missed = (): void => {
    const was = unreachable();
    pollMisses++;
    if (unreachable() !== was) deps?.rerender();
  };
  tick();
  pollTimer = window.setInterval(tick, POLL_MS);
}

/* There is deliberately no stopCountsPoll(). The poll suppresses itself while
 * the socket is open (a searching client is already being pushed the counts),
 * and every way OUT of the home screen is a full page navigation — so the
 * interval dies with the page rather than needing to be torn down. A stop
 * function nothing called would be machinery describing a lifecycle this
 * client does not have. */

// ── the socket ────────────────────────────────────────────────────────

function connect(then: () => void): void {
  if (ws && ws.readyState === WebSocket.OPEN) { then(); return; }
  // ⚠ CONNECTING, not just OPEN. Two quick clicks would otherwise open a
  // second socket and orphan the first, which the server would read as one
  // account queueing twice — the newer taking over and the older being told
  // it had been replaced, from a tab the player never opened.
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener('open', () => then(), { once: true });
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}`);
  ws = sock;
  sock.addEventListener('open', () => then(), { once: true });
  sock.addEventListener('message', ev => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(String(ev.data)) as Record<string, unknown>; } catch { return; }
    onMsg(m);
  });
  sock.addEventListener('close', () => {
    if (ws !== sock) return;
    ws = null;
    // Only complain if we thought we were still searching. A socket closed
    // because we were MATCHED is about to be replaced by a page navigation.
    if (searching || offer) {
      searching = null; offer = null;
      error = 'lost the connection — try searching again';
      deps?.rerender();
    }
  });
}

function onMsg(m: Record<string, unknown>): void {
  if (m['t'] === 'error') {
    error = String(m['msg'] ?? 'something went wrong');
    // a refusal is not a search: do not leave a spinner running behind it
    searching = null; offer = null;
    deps?.rerender();
    return;
  }
  if (m['t'] !== 'queue') return;

  const matched = m['matched'] as { room: string; seat: number; mode: string } | undefined;
  if (matched) {
    // Into the game the way every other game start here goes: a full
    // navigation with the room in the query string. Nothing else in this
    // client transitions from the home screen into a board in place, and this
    // is not the feature to invent that in.
    location.search = `?ws=1&room=${encodeURIComponent(matched.room)}`
      + `&seat=${matched.seat}&mode=${encodeURIComponent(matched.mode)}`;
    return;
  }

  if (m['counts']) { counts = m['counts'] as QueueCounts; pollMisses = 0; }
  searching = (m['searching'] as Searching | null) ?? null;
  const next = (m['offer'] as MatchOffer | null) ?? null;
  if (next && !offer) {
    playCue('decision');   // you are being asked something, and it expires
    alertTab('Match found!');   // …and the player may be in another tab
  }
  // EVERY message re-bases the countdown, not only the first. The server
  // sends what is left at the moment it sends (`OFFER_MS - (now - made)`), so
  // counting a later message's expiresIn from the FIRST message's arrival
  // took the elapsed time off twice: Accept 7 became "Waiting… 2" the moment
  // you pressed it.
  if (next) offerAt = Date.now();
  offer = next;
  error = '';
  ensureTick();
  deps?.rerender();
}

/** whole seconds left on an offer: `expiresIn` is what remained when the
 * message that carried it was SENT, so it counts from `offerAt`, the moment
 * that message arrived — see onMsg */
const offerSecondsLeft = (o: MatchOffer): number =>
  Math.max(0, Math.ceil((o.expiresIn - (Date.now() - offerAt)) / 1000));

/**
 * A 1s tick while something is counting.
 *
 * The wait timer and the accept countdown both change with no message
 * arriving, and a countdown that only moves when the server happens to say
 * something is worse than none — it is the accept prompt's whole job to look
 * like it is running out.
 *
 * ⚠ IT CHANGES THE NUMBERS, NOT THE PAGE. It used to repaint the whole screen
 * every second, which rebuilt the Accept button under the pointer: a press
 * that straddled a tick landed on one button and lifted off another, and the
 * click never happened. A state change (a message) still repaints; the tick
 * only rewrites the `data-qwait` / `data-qleft` texts in place, and repaints
 * only if they are not on screen to rewrite. test/902-queue-screen.test.ts.
 */
export function tickInPlace(root: ParentNode): boolean {
  const wait = root.querySelectorAll<HTMLElement>('[data-qwait]');
  const left = root.querySelectorAll<HTMLElement>('[data-qleft]');
  if (offer) {
    const secs = offerSecondsLeft(offer);
    // at 0 the box changes shape (pages/queue.ts offerHtml: no Accept, no
    // count) — repaint once into it, then leave the expired box alone
    if (secs <= 0) return !!root.querySelector('[data-qexpired]');
    if (!left.length) return false;
    const n = String(secs);
    for (const el of left) if (el.textContent !== n) el.textContent = n;
    return true;
  }
  if (searching) {
    if (!wait.length) return false;
    const w = waitLabel(Date.now() - searching.since);
    for (const el of wait) if (el.textContent !== w) el.textContent = w;
    return true;
  }
  return true;
}

function ensureTick(): void {
  const want = !!searching || !!offer;
  if (want && !tickTimer) {
    tickTimer = window.setInterval(() => {
      if (open && deps && !tickInPlace(deps.app)) deps.rerender();
    }, 1000);
  } else if (!want && tickTimer) {
    clearInterval(tickTimer);
    tickTimer = 0;
  }
}

function sendQueue(body: Record<string, unknown>): void {
  const token = deps?.token();
  if (token) {
    connect(() => ws?.send(JSON.stringify({ t: 'queue', token, ...body })));
    return;
  }
  /* BL-42 — no account, and the format does not need one: make a real one
   * silently and carry on. `queueBlocker` has already refused constructed by
   * the time we get here, so this only ever runs for draft.
   *
   * ⚠ THE TOKEN IS STORED THE SAME WAY A SIGNED-IN ONE IS, because that is
   * what it is. Everything after this point — the socket, the room, the saved
   * game, the post-game screen — sees an ordinary account, which is the whole
   * reason claiming it later is a rename rather than a migration. */
  const blocker = queueBlocker(
    (body['mode'] as QueueMode | undefined) ?? pickMode, false, false);
  if (blocker) { error = blocker; deps?.rerender(); return; }
  void (async () => {
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      const out = await res.json() as { ok: boolean; token?: string; error?: string };
      if (!out.ok || !out.token) {
        error = out.error ?? 'could not start a guest game';
        deps?.rerender();
        return;
      }
      deps?.onGuest(out.token);
      connect(() => ws?.send(JSON.stringify({ t: 'queue', token: out.token, ...body })));
    } catch {
      error = 'could not reach the server';
      deps?.rerender();
    }
  })();
}

// ── opening and closing the screen ────────────────────────────────────

/**
 * BL-42 — arrive from a link and join, without a further click.
 *
 * ⚠ IT GOES THROUGH THE SAME sendQueue AS THE BUTTON, so the guest mint, the
 * constructed deck gate and the "that game is gone" answer are all the ones
 * that already exist. A second join path would be a second place for those
 * three rules to drift.
 */
export function joinFromLink(mode: QueueMode, ranked: boolean, vs: string | null): void {
  pickMode = mode;
  pickRanked = ranked;
  open = true;
  const deck = deps?.chosenDeck() ?? null;
  const blocker = queueBlocker(mode, !!deps?.token(), !!deck);
  if (blocker) { error = blocker; deps?.rerender(); return; }
  sendQueue({
    q: 'join', mode, ranked,
    ...(vs ? { vs } : {}),
    ...(mode === 'constructed' && deck?.id ? { deckId: deck.id } : {}),
  });
  deps?.rerender();
}

export function openQueue(): void {
  open = true;
  error = '';
  deps?.rerender();
}

function closeQueue(): void {
  open = false;
  leave();
  deps?.rerender();
}

function leave(): void {
  if (ws && ws.readyState === WebSocket.OPEN) sendQueue({ q: 'leave' });
  searching = null; offer = null;
  ensureTick();
  // close the socket outright: the server drops a disconnected searcher, so
  // this is belt and braces rather than the mechanism
  ws?.close();
  ws = null;
}

// ── what the page draws (pages/queue.ts) ─────────────────────────────

/** Everything the queue screen and the home strip show, read off this
 * module's state and its deps in one go. pages/queue.ts draws it; this
 * module keeps the socket, the poll, the tick and the clicks. */
export interface QueueSnapshot {
  counts: QueueCounts | null;
  openGames: readonly OpenGame[];
  /** the counts poll has gone unanswered UNREACHABLE_AFTER times in a row:
   * `counts` and `openGames` are what the server said before it went quiet */
  unreachable: boolean;
  searching: Searching | null;
  offer: MatchOffer | null;
  /** whole seconds left on the offer (see offerSecondsLeft), or 0 */
  offerLeft: number;
  error: string;
  pickMode: QueueMode;
  pickRanked: boolean;
  signedIn: boolean;
  /** why this player cannot queue for pickMode yet, or null */
  blocker: string | null;
  /** their rating in pickMode, if signed in */
  rating: number | null;
}

export function queueSnapshot(): QueueSnapshot {
  const signedIn = !!deps?.token();
  const deck = deps?.chosenDeck() ?? null;
  return {
    counts, openGames, unreachable: unreachable(), searching, offer,
    offerLeft: offer ? offerSecondsLeft(offer) : 0,
    error, pickMode, pickRanked, signedIn,
    blocker: queueBlocker(pickMode, signedIn, !!deck),
    rating: deps?.rating(pickMode) ?? null,
  };
}

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('queue-')) return false;
  switch (b) {
    case 'queue-open':
      openQueue();
      return true;
    case 'queue-home':
      closeQueue();
      return true;
    case 'queue-mode': {
      const m = btn.dataset['mode'];
      if (m === 'constructed' || m === 'draft') {
        pickMode = m;
        localStorage.setItem(MODE_KEY, m);
      }
      // a refusal was about the OLD choice ("pick a deck first" on a format
      // that no longer needs one) and must not outlive it
      error = '';
      deps?.rerender();
      return true;
    }
    case 'queue-ranked':
      pickRanked = btn.dataset['ranked'] === 'true';
      localStorage.setItem(RANKED_KEY, pickRanked ? '1' : '0');
      error = '';
      deps?.rerender();
      return true;
    case 'queue-go': {
      const deck = deps?.chosenDeck() ?? null;
      const blocker = queueBlocker(pickMode, !!deps?.token(), !!deck);
      if (blocker) { error = blocker; deps?.rerender(); return true; }
      sendQueue({
        q: 'join', mode: pickMode, ranked: pickRanked,
        ...(pickMode === 'constructed' && deck?.id ? { deckId: deck.id } : {}),
      });
      return true;
    }
    /* BL-42 — join one specific open game. `vs` makes it a direct challenge:
     * the server pairs them with that person and nobody else, band ignored. */
    case 'queue-join-open': {
      const id = btn.dataset['id'] ?? '';
      const game = openGames.find(g => g.id === id);
      if (!game) { error = 'that game is gone'; deps?.rerender(); return true; }
      const deck = deps?.chosenDeck() ?? null;
      const blocker = queueBlocker(game.mode, !!deps?.token(), !!deck);
      if (blocker) {
        // Keep them on the screen with the format already switched, so the
        // fix ("pick a deck") is one click away rather than a dead end.
        pickMode = game.mode;
        error = blocker;
        open = true;
        deps?.rerender();
        return true;
      }
      pickMode = game.mode;
      open = true;
      sendQueue({
        q: 'join', mode: game.mode, ranked: game.ranked, vs: game.id,
        ...(game.mode === 'constructed' && deck?.id ? { deckId: deck.id } : {}),
      });
      deps?.rerender();
      return true;
    }
    case 'queue-cancel':
      leave();
      deps?.rerender();
      return true;
    case 'queue-accept':
      sendQueue({ q: 'accept' });
      return true;
    case 'queue-decline':
      sendQueue({ q: 'decline' });
      offer = null;
      searching = null;
      ensureTick();
      deps?.rerender();
      return true;
    default:
      return false;
  }
}
