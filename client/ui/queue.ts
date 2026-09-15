/* BL-01 — the matchmaking queue, client side.
 *
 * The same four-function contract every other non-game page here uses
 * (account.ts, decks.ts, cardindex.ts, meta.ts): init / screen / renderScreen
 * / handleButton, with a `queue-` button prefix. main.ts wires it in three
 * lines and otherwise does not know this exists.
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
import { esc } from './util.ts';
import { ICON_BASE } from './assets.ts';
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
  /** the constructed deck picker, borrowed from the home screen rather than
   * rebuilt — one picker, one set of rules about which decks are offered */
  deckPickerHtml: () => string;
  wireDeckPicker: (rerender: () => void) => void;
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
export function countsSummary(counts: QueueCounts | null): string {
  if (!counts) return 'checking who is around…';
  if (counts.total === 0) return 'nobody waiting — be the first';
  const parts = MODES
    .filter(m => counts.byMode[m] > 0)
    .map(m => `${MODE_LABEL[m]} ${counts.byMode[m]}`);
  return `${counts.total} waiting · ${parts.join(' · ')}`;
}

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
        if (!r.counts) return;
        const before = JSON.stringify([counts, openGames]);
        counts = r.counts;
        openGames = r.open ?? [];
        if (JSON.stringify([counts, openGames]) !== before) deps?.rerender();
      })
      .catch(() => { /* offline: keep the last number rather than blanking it */ });
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

  if (m['counts']) counts = m['counts'] as QueueCounts;
  searching = (m['searching'] as Searching | null) ?? null;
  const next = (m['offer'] as MatchOffer | null) ?? null;
  if (next && !offer) {
    offerAt = Date.now();
    playCue('decision');   // you are being asked something, and it expires
    alertTab('Match found!');   // …and the player may be in another tab
  }
  offer = next;
  error = '';
  ensureTick();
  deps?.rerender();
}

/**
 * A 1s repaint while something is counting.
 *
 * The wait timer and the accept countdown both change with no message
 * arriving, and a countdown that only moves when the server happens to say
 * something is worse than none — it is the accept prompt's whole job to look
 * like it is running out.
 */
function ensureTick(): void {
  const want = !!searching || !!offer;
  if (want && !tickTimer) {
    tickTimer = window.setInterval(() => { if (open) deps?.rerender(); }, 1000);
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

// ── the home-screen strip ─────────────────────────────────────────────

/**
 * The at-a-glance row, above the three home cards.
 *
 * Full width rather than a fourth card, because it answers a different
 * question from the three below it: those are "what would you like to play",
 * this is "is there anybody to play it with". A count buried as one line
 * inside one of three equal panels is a count nobody reads.
 */
export function stripHtml(signedIn: boolean): string {
  return `<div class="queuestrip">
    <div class="qstripmain">
      <span class="qstriptitle"><img class="txticon" src="${ICON_BASE}battle.webp" alt="⚔" onerror="this.outerHTML=this.alt"> Find a game</span>
      <span class="qstripcount${counts && counts.total > 0 ? ' live' : ''}">${esc(countsSummary(counts))}</span>
    </div>
    <button class="cta primary qstripgo" data-btn="queue-open">Find a game</button>
    ${openListHtml()}
  </div>`;
}

/**
 * BL-42 — the games actually on offer, each one clickable.
 *
 * The owner's reason for this replacing a bare count: *"if you don't really
 * care what you play, you can see 'Oh, that person is waiting for ranked live
 * draft. I'd do that, sure' then just click on it and go."* A number cannot be
 * clicked and does not say whether it is a format you want.
 *
 * ⚠ NAMES ARE SHOWN TO LOGGED-OUT VISITORS, which /api/queue used to refuse in
 * capitals. Deliberate, and the same information Discord already publishes.
 */
function openListHtml(): string {
  if (!openGames.length) return '';
  return `<ul class="qopen">${openGames.map(g => `
    <li class="qopenrow">
      <span class="qopenwho">${esc(g.username)}</span>
      <span class="qopenwhat">${esc(MODE_LABEL[g.mode])} · ${g.ranked ? 'ranked' : 'open'}${
        g.ranked ? ` · ${g.rating}` : ''}</span>
      <span class="qopenwait">${esc(waitLabel(g.waitedMs))}</span>
      <button class="qopenjoin" data-btn="queue-join-open" data-id="${esc(g.id)}"
        >Join${g.mode === 'constructed' ? ' →' : ' →'}</button>
    </li>`).join('')}</ul>`;
}


// ── the queue screen ──────────────────────────────────────────────────

export function renderScreen(): void {
  if (!deps) return;
  // ⚠ ALSO ARMED HERE, not only from renderHome. renderHome returns early
  // once this screen is open, so a client that landed straight on it
  // (`?queue=1`, off the post-game button) would never have started the poll
  // and would sit on "checking who is around…" for ever. Idempotent.
  startCountsPoll();
  deps.app.innerHTML = screenHtml();
  if (pickMode === 'constructed' && !searching && !offer) deps.wireDeckPicker(deps.rerender);
}

function screenHtml(): string {
  const signedIn = !!deps?.token();
  const deck = deps?.chosenDeck() ?? null;
  const blocker = queueBlocker(pickMode, signedIn, !!deck);

  const body = offer ? offerHtml() : searching ? searchingHtml() : pickerHtml(signedIn, blocker);

  return `<div class="joinscreen home queuescreen">
    <div class="queuepanel">
      <div class="queuehead">
        <h2>Find a game</h2>
        <button class="qback" data-btn="queue-home">← home</button>
      </div>
      <div class="qcounts">${esc(countsSummary(counts))}</div>
      ${error ? `<div class="deckmsg qerr">${esc(error)}</div>` : ''}
      ${body}
    </div>
  </div>`;
}

function pickerHtml(signedIn: boolean, blocker: string | null): string {
  const rating = deps?.rating(pickMode) ?? null;
  return `
    <div class="zonelabel">Format</div>
    <div class="elrow qmodes">${MODES.map(m =>
      `<button class="elchip${m === pickMode ? ' on' : ''}" data-btn="queue-mode" data-mode="${m}">${
        MODE_LABEL[m]}</button>`).join('')}</div>
    <p class="cardsub">${pickMode === 'draft'
      ? 'You will agree the three elements together in a lobby once you are matched, then draft from shared packs. Nothing is dealt before that.'
      : 'The deck below is the one you will play. A matchmade constructed game deals straight away — there is no deck picker afterwards.'}</p>

    ${pickMode === 'constructed' ? `<div class="qdeck">${deps?.deckPickerHtml() ?? ''}</div>` : ''}

    <div class="zonelabel">Who you play</div>
    <div class="qranked">
      ${[true, false].map(r => `<button class="qopt${r === pickRanked ? ' on' : ''}" data-btn="queue-ranked" data-ranked="${r}">
        <b>${r ? 'Ranked' : 'Whoever’s open'}</b>
        <span class="hint">${r
          ? `near your rating${rating === null ? '' : ` · ${rating}`} — the search widens the longer you wait`
          : 'anyone at all — and it still counts towards your rating'}</span>
      </button>`).join('')}
    </div>

    ${blocker ? `<div class="deckmsg">${esc(blocker)}</div>` : ''}
    <button class="cta primary qgo" data-btn="queue-go" ${blocker ? 'disabled' : ''}>
      ${blocker ? 'Find a game' : `Find a ${MODE_LABEL[pickMode].toLowerCase()} game`}</button>
    ${signedIn ? '' : '<p class="hint">Playing signed out still works — start a game from the home screen and send the code. It just does not count for anything.</p>'}`;
}

function searchingHtml(): string {
  const s = searching!;
  const waited = Date.now() - s.since;
  /* ⚠ A DIRECT CHALLENGE HAS NO BAND, so it must not show one. Printing
   * "within ±100" next to a search that is deliberately ignoring the band is
   * exactly the kind of promise-the-server-is-not-keeping that queueStateFor's
   * own comment exists to prevent. */
  if (s.vs) {
    return `
    <div class="qsearching">
      <div class="qspin" aria-hidden="true"></div>
      <div class="qsearchtext">
        <b>Joining ${esc(s.vsName ?? 'their')} game…</b>
        <span class="hint">${esc(MODE_LABEL[s.mode].toLowerCase())} · ${waitLabel(waited)}</span>
        <span class="hint">waiting for them to accept</span>
      </div>
    </div>
    <button data-btn="queue-cancel">Stop</button>`;
  }
  return `
    <div class="qsearching">
      <div class="qspin" aria-hidden="true"></div>
      <div class="qsearchtext">
        <b>Searching for a ${esc(MODE_LABEL[s.mode].toLowerCase())} game…</b>
        <span class="hint">${s.ranked
          ? `${esc(bandLabel(s.band))} · ${waitLabel(waited)}`
          : `anyone · ${waitLabel(waited)}`}</span>
        ${s.ranked && s.band !== null
          ? '<span class="hint">the search widens the longer you wait</span>'
          : s.ranked ? '<span class="hint">wide open now — anybody will do</span>' : ''}
      </div>
    </div>
    <button data-btn="queue-cancel">Stop searching</button>`;
}

function offerHtml(): string {
  const o = offer!;
  const left = Math.max(0, Math.ceil((o.expiresIn - (Date.now() - offerAt)) / 1000));
  return `<div class="overlay qoverlay"><div class="overlaybox qofferbox">
    <h3>Match found</h3>
    <div class="qopponent">
      <b>${esc(o.opponent)}</b>
      <span class="hint">${esc(String(o.opponentRating))} · ${esc(MODE_LABEL[o.mode])}</span>
    </div>
    ${o.accepted
      ? `<div class="qwaiting">Waiting for ${esc(o.opponent)}… <b>${left}</b></div>`
      : `<button class="cta primary qaccept" data-btn="queue-accept">Accept <span class="qcount">${left}</span></button>`}
    <button class="qdecline" data-btn="queue-decline">${o.accepted ? 'Cancel' : 'Decline'}</button>
    <p class="hint">${o.accepted
      ? 'If they do not answer in time you go back to the front of the queue.'
      : 'Nobody is dropped into a game they did not click into.'}</p>
  </div></div>`;
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
