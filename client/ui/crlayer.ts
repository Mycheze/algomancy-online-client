/* THE RULES REVIEW PAGE: THE SELECTION CHIP, THE COMPOSER AND THE SHEET.
 *
 * Everything on the review page that holds a text box, or floats over the
 * document, lives HERE, in a layer of its own beside `#app` — the model is
 * ui/report.ts. `#app` is repainted with innerHTML by whoever owns the screen
 * (and by the host's rerender, a profile refresh, the queue ticker), and a
 * comment half-written in a box inside it would be eaten by the next paint.
 * This layer is painted only when its own state changes, and the draft is
 * module state, so nothing can lose it.
 *
 *   · the CHIP: select text inside a commentable item (`[data-crt]` in
 *     `.crdoc`) and a 💬 Comment chip appears at the selection's end — below
 *     it on a touch screen, where the system's own callout sits above.
 *   · the COMPOSER: the quoted words, a textarea, Cancel / Comment. It has
 *     its own scrim, `.crscrim`, and never the board's modal class (269 counts
 *     that class across ui/ and this is not a board dialog).
 *   · the SHEET: on a narrow screen the margin is hidden, so a rule's 💬 count
 *     opens its threads here instead. It holds no inputs; its buttons are
 *     ordinary `data-btn="cr-…"` buttons that main.ts hands to crreview.ts.
 *
 * Own clicks are `data-crl`, never `data-btn`, taken in the capture phase with
 * stopPropagation, so main.ts never sees them. Escape closes the composer or
 * the sheet and goes no further.
 *
 * The layer knows nothing about comments or the server: crreview.ts registers
 * a host (setCrLayerHost) that says whether the page is open, labels a
 * target, and sends what was written.
 */
import { esc } from './util.ts';
import { QUOTE_MAX, makeAnchor } from './cranchor.ts';
import { rangeOffsets } from './crdom.ts';
import type { CrAnchor } from './crtypes.ts';

/** what the composer is writing */
export interface CrCompose {
  mode: 'add' | 'reply' | 'edit' | 'answer';
  target: string;
  /** add: the passage (null = the whole item) */
  anchor?: CrAnchor | null;
  /** reply: the root it answers */
  parent?: string;
  /** edit: the comment being changed */
  id?: string;
  /** answer: the reading chosen, or 'other' */
  reading?: string;
  /** what the header says: "608.2b", "D-U02-4" */
  label: string;
  /** the text the box starts with (an edit) */
  draft?: string;
  /** a one-line note under the quote, e.g. that a selection was cut short */
  note?: string;
}

export interface CrLayerHost {
  /** is the review page on screen? The chip appears only while it is */
  active(): boolean;
  /** may this reader write? If not, the composer says why instead */
  canComment(): { ok: boolean; why?: 'signed-out' | 'guest' };
  /** the edition a new anchor is made against */
  edition(): string;
  /** the label for a target: a rule's number, a discrepancy id */
  label(target: string): string;
  /** send it; resolves to an error to show, or null when it went through */
  submit(c: CrCompose, body: string): Promise<string | null>;
}

/** a selection inside one item, ready to become an anchor. `clamped`: it ran
 * on past the item and was cut at its end. `cut`: it was longer than a quote
 * may be */
interface Pick { target: string; anchor: CrAnchor; label: string; clamped: boolean; cut: boolean; x: number; y: number }

let host: CrLayerHost | null = null;
let layer: HTMLElement | null = null;
let chip: Pick | null = null;
/** the selection as it was when the pointer went down — a click on the ＋
 * may clear it before the click handler runs */
let pickAtDown: Pick | null = null;
let compose: (CrCompose & { quote: string }) | null = null;
let draft = '';
let busy = false;
let error = '';
/** Cancel and Escape keep what was typed, keyed by what it was for, so an
 * accidental Escape costs nothing; a sent comment clears it */
const stash = new Map<string, string>();
let sheet: { title: string; html: string } | null = null;
let debounce = 0;

const keyOf = (c: CrCompose): string =>
  [c.mode, c.target, c.parent ?? '', c.id ?? '', c.reading ?? '', c.anchor?.quote ?? ''].join('|');

export const isComposerOpen = (): boolean => compose !== null;
export const isSheetOpen = (): boolean => sheet !== null;

export function setCrLayerHost(h: CrLayerHost): void { host = h; }

/* ── the selection ───────────────────────────────────────────────────────── */

/** the current selection, if it starts inside a commentable item */
function currentPick(): Pick | null {
  if (!host?.active() || typeof window.getSelection !== 'function') return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startEl = range.startContainer.nodeType === 1
    ? range.startContainer as Element : range.startContainer.parentElement;
  const item = startEl?.closest('[data-crt]');
  if (!item || !item.closest('.crdoc')) return null;
  const target = item.getAttribute('data-crt') ?? '';
  const { m, start, end, clamped } = rangeOffsets(item, range);
  const label = host.label(target);
  const anchor = makeAnchor(m.text, start, end, host.edition(), /^\d|^D\d/.test(label) ? label : undefined);
  if (!anchor) return null;
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  const touch = document.documentElement.classList.contains('touch');
  return {
    target, anchor, label, clamped, cut: anchor.quote.length >= QUOTE_MAX,
    x: Math.min(last.right, window.innerWidth - 150),
    y: touch ? last.bottom + 30 : last.bottom + 6,
  };
}

function checkSelection(): void {
  if (compose) return;
  const next = currentPick();
  const changed = (next?.anchor.quote ?? null) !== (chip?.anchor.quote ?? null)
    || (next?.target ?? null) !== (chip?.target ?? null);
  chip = next;
  if (changed || chip) paint();
}

/** the selection inside `target` at the moment the pointer went down, for
 * the ＋ button: comment on what is selected there, else on the whole item */
export function pickFor(target: string): { anchor: CrAnchor; note?: string } | null {
  const p = pickAtDown && pickAtDown.target === target ? pickAtDown : null;
  if (!p) return null;
  const note = pickNote(p);
  return note ? { anchor: p.anchor, note } : { anchor: p.anchor };
}

/** what the composer says about a selection it had to shorten */
function pickNote(p: Pick): string | undefined {
  if (p.cut) return `Only the first ${QUOTE_MAX} characters are quoted.`;
  if (p.clamped) return `Only the part inside ${p.label} is quoted.`;
  return undefined;
}

/* ── the composer and the sheet ──────────────────────────────────────────── */

export function openComposer(c: CrCompose): void {
  compose = { ...c, quote: c.anchor?.quote ?? '' };
  draft = c.draft ?? stash.get(keyOf(c)) ?? '';
  error = '';
  busy = false;
  chip = null;
  sheet = null;
  paint();
}

export function closeComposer(): void {
  if (compose && !busy) {
    if (draft.trim()) stash.set(keyOf(compose), draft); else stash.delete(keyOf(compose));
  }
  compose = null;
  error = '';
  paint();
}

/** a narrow screen's threads for one item; `html` is crreview's thread cards */
export function showSheet(title: string, html: string): void {
  sheet = { title, html };
  paint();
}

export function closeSheet(): void {
  if (!sheet) return;
  sheet = null;
  paint();
}

/** the page closed: nothing of the layer stays on screen */
export function resetCrLayer(): void {
  chip = null;
  sheet = null;
  if (compose) closeComposer(); else paint();
}

function send(): void {
  if (!compose || busy || !host) return;
  const body = draft.trim();
  if (!body) { error = 'write something first'; paint(); return; }
  const c = compose;
  busy = true;
  error = '';
  paint();
  void host.submit(c, body).then(err => {
    busy = false;
    if (err) { error = err; paint(); return; }
    stash.delete(keyOf(c));
    compose = null;
    draft = '';
    paint();
  });
}

/* ── painting ────────────────────────────────────────────────────────────── */

const HEAD: Record<CrCompose['mode'], string> = {
  add: 'Comment on', reply: 'Reply on', edit: 'Edit your comment on', answer: 'Answer',
};

function composerHtml(): string {
  const c = compose!;
  const can = host?.canComment() ?? { ok: false };
  const quote = c.quote
    ? `<blockquote class="crquote">${esc(c.quote)}</blockquote>`
    : c.mode === 'add' ? '<div class="crnote">On the whole item.</div>' : '';
  const reading = c.mode === 'answer' ? '<div class="crnote">Your answer: the reading you choose, in your own words.</div>' : '';
  const inner = can.ok
    ? `<textarea id="cr-draft" rows="5" maxlength="4000" placeholder="${c.mode === 'reply' ? 'Write a reply' : 'Write a comment'}" ${busy ? 'disabled' : ''}></textarea>
      <div class="crnote">Visible to everyone who opens this page, under your name.</div>
      <div class="crrow">
        <button data-crl="cancel">Cancel <span class="kh">(esc)</span></button>
        <span class="crgrow"></span>
        <button class="primary" data-crl="send" ${busy ? 'disabled' : ''}>${busy ? 'sending…' : c.mode === 'edit' ? 'Save' : 'Comment'}</button>
      </div>`
    : `<div class="crnote">${can.why === 'guest'
      ? 'Name your account to comment: guests cannot. Your profile has the button.'
      : 'Sign in to comment. Anyone can read this page; writing needs an account.'}</div>
      <div class="crrow">
        <button data-crl="cancel">Cancel</button>
        <span class="crgrow"></span>
        ${can.why === 'guest'
      ? '<button class="primary" data-btn="acct-open-profile">Open my profile</button>'
      : '<button class="primary" data-btn="cr-signin">Sign in</button>'}
      </div>`;
  return `<div class="crscrim" id="crscrim"><div class="crcomposer" role="dialog" aria-label="Comment">
    <div class="crhead">${HEAD[c.mode]} <b>${esc(c.label)}</b></div>
    ${quote}${c.note ? `<div class="crnote">${esc(c.note)}</div>` : ''}${reading}
    ${inner}
    ${error ? `<div class="crerr">${esc(error)}</div>` : ''}
  </div></div>`;
}

function chipHtml(): string {
  const p = chip!;
  return `<button class="crchip" data-crl="chip" style="left:${Math.round(p.x)}px;top:${Math.round(p.y)}px">💬 Comment${
    p.clamped ? ` <span class="crnote">on ${esc(p.label)} only</span>` : ''}</button>`;
}

function sheetHtml(): string {
  const s = sheet!;
  return `<div class="crscrim crsheetscrim" id="crsheetscrim"><div class="crsheet" role="dialog" aria-label="Comments">
    <div class="crrow"><b>${esc(s.title)}</b><span class="crgrow"></span><button data-crl="sheetclose">Close</button></div>
    ${s.html}
  </div></div>`;
}

function paint(): void {
  if (!layer) return;
  layer.innerHTML = compose ? composerHtml() : sheet ? sheetHtml() : chip ? chipHtml() : '';
  const box = document.getElementById('cr-draft') as HTMLTextAreaElement | null;
  if (!box) return;
  box.value = draft;
  if (!busy) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  box.addEventListener('input', () => { draft = box.value; });
  // Ctrl+Enter sends, from inside the box (as the report form does)
  box.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); }
  });
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

function onLayerButton(what: string): void {
  switch (what) {
    case 'chip': {
      const p = chip;
      if (!p) return;
      const note = pickNote(p);
      openComposer({ mode: 'add', target: p.target, anchor: p.anchor, label: p.label, ...(note ? { note } : {}) });
      window.getSelection?.()?.removeAllRanges();
      return;
    }
    case 'cancel': closeComposer(); return;
    case 'send': send(); return;
    case 'sheetclose': closeSheet(); return;
    default: return;
  }
}

let installed = false;

/** Mount the layer beside #app. Safe in a document with no body (the headless
 * harness): nothing here is load-bearing for anything else. */
export function installCrLayer(): void {
  if (installed) return;
  if (typeof document === 'undefined' || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'crlayer';
  document.body.appendChild(layer);

  document.addEventListener('pointerdown', () => { pickAtDown = currentPick(); }, { capture: true });

  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    const t = target?.closest?.('[data-crl]') as HTMLElement | null;
    // a page button inside the composer (Sign in, Open my profile) goes to
    // main.ts as any button does, and takes the composer down first — the
    // draft is stashed, so signing in and coming back finds it again
    if (!t && compose && target?.closest?.('[data-btn]') && layer?.contains(target)) { closeComposer(); return; }
    if (!t) {
      if (target?.id === 'crscrim' && compose) {
        e.stopPropagation();
        if (busy) return;
        // a click beside the box with words in it asks before throwing them away
        if (draft.trim() && !window.confirm('Discard this comment?')) return;
        draft = '';
        stash.delete(keyOf(compose));
        closeComposer();
      } else if (target?.id === 'crsheetscrim' && sheet) {
        e.stopPropagation();
        closeSheet();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onLayerButton(t.dataset['crl'] ?? '');
  }, { capture: true });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (compose) { e.stopPropagation(); closeComposer(); } else if (sheet) { e.stopPropagation(); closeSheet(); }
  }, { capture: true });

  // the chip follows the selection: a mouse lifts once, a finger's handles
  // only ever fire selectionchange (iOS included), so both are watched
  const later = (): void => {
    clearTimeout(debounce);
    debounce = window.setTimeout(checkSelection, 150);
  };
  document.addEventListener('mouseup', later);
  document.addEventListener('selectionchange', later);
  // the chip is fixed to the viewport, so a scroll moves it with the words
  window.addEventListener('scroll', () => { if (chip) later(); }, { passive: true });
}
