/* THE MATCHMAKING QUEUE (BL-01): the queue screen, and the strip on the home
 * screen that says who is waiting.
 *
 * Moved out of ui/queue.ts in the design-system round, 2026-11-03, under the
 * page contract (pages/README.md): queueView() reads ui/queue.ts's state
 * through its queueSnapshot(), queueHtml(view) draws the screen and touches
 * nothing else, paintQueue() paints and wires it. queueStripView/Html is the
 * home screen's strip, a slot pages/home.ts fills. ui/queue.ts keeps
 * everything that is not drawing: the socket, the counts poll, the 1s tick
 * that rewrites the `data-qwait` / `data-qleft` texts in place (902), and the
 * `queue-` clicks.
 *
 * The constructed deck picker is the home screen's own (pages/deckpicker.ts):
 * one picker, one set of rules about which decks are offered.
 */
import { ICON_BASE } from '../assets.ts';
import { button, segmented, settingRow, statusMessage } from '../components/index.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';
import {
  bandLabel, countsSummary, MODE_LABEL, MODES, queueSnapshot, startCountsPoll, waitLabel,
  type MatchOffer, type OpenGame, type QueueCounts, type QueueMode, type Searching,
} from '../queue.ts';
import { esc } from '../util.ts';
import { deckPickerHtml, deckPickerView, wireDeckPicker } from './deckpicker.ts';

/* ── the home-screen strip ────────────────────────────────────────────── */

export interface QueueStripView {
  counts: QueueCounts | null;
  /** BL-42: the games on offer right now, newest last */
  openGames: readonly OpenGame[];
}

export function queueStripView(): QueueStripView {
  const s = queueSnapshot();
  return { counts: s.counts, openGames: s.openGames };
}

/**
 * The at-a-glance row, above the three home cards.
 *
 * Full width rather than a fourth card, because it answers a different
 * question from the three below it: those are "what would you like to play",
 * this is "is there anybody to play it with". A count buried as one line
 * inside one of three equal panels is a count nobody reads.
 */
export function queueStripHtml(v: QueueStripView): string {
  const counts = v.counts;
  return `<div class="queuestrip">
    <div class="qstripmain">
      <span class="qstriptitle"><img class="txticon" src="${ICON_BASE}battle.webp" alt="⚔" onerror="this.outerHTML=this.alt"> Matchmaking</span>
      <span class="qstripcount${counts && counts.total > 0 ? ' live' : ''}">${esc(countsSummary(counts))}</span>
    </div>
    <button class="cta primary qstripgo" data-btn="queue-open">Find a game</button>
    ${openListHtml(v.openGames)}
  </div>`;
}

/**
 * The new home's Matchmaking card body (docs/24, 2026-11-03): who is around,
 * and the open games with their own Join buttons. No "Find a game" — the
 * whole card is H1's `queue-open` button, the Join buttons sit inside it.
 */
export function queueGlanceHtml(v: QueueStripView): string {
  const counts = v.counts;
  return `<div class="qglance">
    <span class="qglcount${counts && counts.total > 0 ? ' live' : ''}">${esc(countsSummary(counts))}</span>
    ${openListHtml(v.openGames)}
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
function openListHtml(openGames: readonly OpenGame[]): string {
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

/* ── the queue screen ─────────────────────────────────────────────────── */

export interface QueueView {
  counts: QueueCounts | null;
  /** a refusal or a lost connection, or '' */
  error: string;
  pickMode: QueueMode;
  pickRanked: boolean;
  signedIn: boolean;
  /** why this player cannot queue for pickMode yet, or null */
  blocker: string | null;
  /** their rating in pickMode, or null */
  rating: number | null;
  /** pages/deckpicker.ts, drawn — a slot; '' unless constructed is picked */
  deckPicker: string;
  /** searching, and how long for (ms) */
  searching: (Searching & { waited: number }) | null;
  /** an offer on the table, and its whole seconds left */
  offer: (MatchOffer & { left: number }) | null;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

export function queueView(): QueueView {
  const s = queueSnapshot();
  return {
    counts: s.counts,
    error: s.error,
    pickMode: s.pickMode,
    pickRanked: s.pickRanked,
    signedIn: s.signedIn,
    blocker: s.blocker,
    rating: s.rating,
    deckPicker: s.pickMode === 'constructed' ? deckPickerHtml(deckPickerView()) : '',
    searching: s.searching ? { ...s.searching, waited: Date.now() - s.searching.since } : null,
    offer: s.offer ? { ...s.offer, left: s.offerLeft } : null,
    chrome: frameChromeView(),
  };
}

/** The queue screen: the picker, the searching line, or a match offer. Pure. */
/** The page, in the app frame (pages/frame.ts): one card in the middle of the
 * window, as the home's Play card is — who is around, then the form (or the
 * search, or the offer). */
export function queueHtml(v: QueueView): string {
  const body = v.offer ? offerHtml(v.offer) : v.searching ? searchingHtml(v.searching) : pickerHtml(v);
  return frameHtml({
    page: 'queuescreen', title: 'Matchmaking',
    back: { dataBtn: 'queue-home', label: 'Home' },
    chrome: v.chrome,
    mainHtml: `<section class="queuepanel" aria-label="Find a game">
      <div class="qcounts">${esc(countsSummary(v.counts))}</div>
      ${v.error ? statusMessage({ tone: 'error', text: v.error }) : ''}
      ${body}
    </section>`,
  });
}

function pickerHtml(v: QueueView): string {
  const { pickMode, pickRanked, rating, blocker } = v;
  const format = segmented({
    ariaLabel: 'Format', size: 'sm', className: 'qmodes',
    options: MODES.map(m => ({ label: MODE_LABEL[m], value: m, on: m === pickMode, dataBtn: 'queue-mode', attrs: { 'data-mode': m } })),
  });
  return `<div class="qrows">
    ${settingRow({ label: 'Format', controlHtml: format, hintHtml: pickMode === 'draft'
      ? 'Once matched you agree the elements in a lobby, then draft from shared packs.'
      : 'This deck is locked in — a matchmade game deals straight away.' })}
    ${pickMode === 'constructed' ? settingRow({ label: 'Deck', controlHtml: `<div class="qdeck">${v.deckPicker}</div>` }) : ''}
    ${settingRow({ label: 'Who you play', controlHtml: `<div class="qranked">
      ${[true, false].map(r => `<button class="qopt${r === pickRanked ? ' on' : ''}" data-btn="queue-ranked" data-ranked="${r}">
        <b>${r ? 'Ranked' : 'Whoever’s open'}</b>
        <span class="hint">${r
          ? `near your rating${rating === null ? '' : ` · ${rating}`} — the search widens the longer you wait`
          : 'anyone at all — and it still counts towards your rating'}</span>
      </button>`).join('')}
    </div>` })}
    </div>
    ${blocker ? statusMessage({ tone: 'note', text: blocker }) : ''}
    <button class="cta primary qgo" data-btn="queue-go" ${blocker ? 'disabled' : ''}>
      ${blocker ? 'Find a game' : `Find a ${MODE_LABEL[pickMode].toLowerCase()} game`}</button>
    ${v.signedIn ? '' : '<p class="hint">Signed out you can still play by room code from the home screen — it just is not recorded.</p>'}`;
}

function searchingHtml(s: Searching & { waited: number }): string {
  const waited = s.waited;
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
        <span class="hint">${esc(MODE_LABEL[s.mode].toLowerCase())} · <span data-qwait>${waitLabel(waited)}</span></span>
        <span class="hint">waiting for them to accept</span>
      </div>
    </div>
    ${button({ label: 'Stop', dataBtn: 'queue-cancel' })}`;
  }
  return `
    <div class="qsearching">
      <div class="qspin" aria-hidden="true"></div>
      <div class="qsearchtext">
        <b>Searching for a ${esc(MODE_LABEL[s.mode].toLowerCase())} game…</b>
        <span class="hint">${s.ranked
          ? `${esc(bandLabel(s.band))} · <span data-qwait>${waitLabel(waited)}</span>`
          : `anyone · <span data-qwait>${waitLabel(waited)}</span>`}</span>
        ${s.ranked && s.band !== null
          ? '<span class="hint">the search widens the longer you wait</span>'
          : s.ranked ? '<span class="hint">wide open now</span>' : ''}
      </div>
    </div>
    ${button({ label: 'Stop searching', dataBtn: 'queue-cancel' })}`;
}

function offerHtml(o: MatchOffer & { left: number }): string {
  const left = o.left;
  return `<div class="overlay qoverlay"><div class="overlaybox qofferbox">
    <h3>Match found</h3>
    <div class="qopponent">
      <b>${esc(o.opponent)}</b>
      <span class="hint">${esc(String(o.opponentRating))} · ${esc(MODE_LABEL[o.mode])}</span>
    </div>
    ${o.accepted
      ? `<div class="qwaiting">Waiting for ${esc(o.opponent)}… <b data-qleft>${left}</b></div>`
      : `<button class="cta primary qaccept" data-btn="queue-accept">Accept <span class="qcount" data-qleft>${left}</span></button>`}
    <button class="qdecline" data-btn="queue-decline">${o.accepted ? 'Cancel' : 'Decline'}</button>
    ${o.accepted ? '<p class="hint">If they do not answer in time you go back to the front of the queue.</p>' : ''}
  </div></div>`;
}

/** Paint the queue screen into `app` and wire it. `rerender` is main.ts's
 * router, which comes back here while the queue is open. */
export function paintQueue(app: HTMLElement, rerender: () => void): void {
  // ⚠ ALSO ARMED HERE, not only from the home screen. The router does not
  // reach the home screen once this screen is open, so a client that landed
  // straight on it (`?queue=1`, off the post-game button) would never have
  // started the poll and would sit on "checking who is around…" for ever.
  // Idempotent.
  startCountsPoll();
  const v = queueView();
  paintFrame(app, queueHtml(v));
  if (v.pickMode === 'constructed' && !v.searching && !v.offer) wireDeckPicker(rerender);
}
