/* THE CARD EDITOR (client/docs/card-editor.md §2): its state, its fetches, its clicks and its poll.
 * The drawing is pages/cardeditor.ts (the page contract, pages/README.md).
 *
 * Same contract as pages/judgereview.ts: screen() says whether this page owns #app, renderScreen()
 * paints it, handleButton() takes every `ce-` click. The way in is a button — the profile's Card
 * editor, or Edit on a card in the card browser, which this page sits on top of (Back returns to
 * it) — and `?cardedit=<card>` is the page after a reload. Whether anything shows is the server's
 * call: every /api/cardedit/ route 404s to an account that may not edit cards.
 *
 * THE POLL RUNS ONLY WHILE AN EDIT IS ON SCREEN. syncPoll() starts it from a paint that shows an
 * edit still moving, and stops it on any paint that does not, on close, and on a tick that finds
 * the page gone. Nothing here arms a timer at import or at boot: a timer a headless suite never
 * stops hangs it.
 */
import * as acct from './account.ts';
import { artUrl } from './assets.ts';
import { allRows, rowFor } from './cardindex.ts';
import { editorFields, type EditorField, type EditorFields } from './cardnotation.ts';
import { search } from './cardsearch.ts';
import { copyText } from './util.ts';
import { setCardEditSource } from './pages/cards.ts';
import {
  cardEditorView, paintCardEditor, patchCardEditor, settled,
  type CardEditorHooks, type CardEditorTab, type CardEditRow, type EditDetail, type EditSummary, type LivePart,
} from './pages/cardeditor.ts';

/** how often an edit on screen asks the server where it stands (§7) */
const POLL_MS = 5000;
/** how many cards the picker offers */
const PICKS = 8;

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let allowed: boolean | null = null;
let tabNow: CardEditorTab = 'edit';
let backTo = 'Home';
let q = '';
let found: string[] = [];
let cardNow: string | null = null;
let fetching = false;
let sending = false;
let rowNow: CardEditRow | null = null;
let typed: EditorFields = {};
let currentEdit: EditDetail | null = null;
let msg = '';
let list: EditSummary[] | null = null;
let opened: EditDetail | null = null;
/** FriendlyBot's pictures of the opened edit, fetched with the session (an <img> cannot send it) */
let pics: { id: string; before: string | null; after: string | null; afterAt: number } | null = null;
let pollId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const screen = (): 'cardeditor' | null => (open ? 'cardeditor' : null);

/** May this account edit cards? Its own view says so (designer or admin); the server decides. */
export function mayEdit(): boolean {
  const me = acct.currentUser();
  return !!(me?.designer || me?.admin);
}

/** what pages/cardeditor.ts cardEditorView reads */
export interface CardEditorState {
  access: boolean | null;
  tab: CardEditorTab;
  backLabel: string;
  isAdmin: boolean;
  query: string;
  picks: string[];
  card: string | null;
  loading: boolean;
  busy: boolean;
  row: CardEditRow | null;
  scanUrl: string | null;
  fields: EditorFields;
  current: EditDetail | null;
  msg: string;
  edits: EditSummary[] | null;
  detail: EditDetail | null;
  pictures: { before: string | null; after: string | null };
}

function state(): CardEditorState {
  const me = acct.currentUser();
  const r = cardNow ? rowFor(cardNow) : null;
  return {
    access: allowed, tab: tabNow, backLabel: backTo, isAdmin: me?.admin === true,
    query: q, picks: found, card: cardNow, loading: fetching, busy: sending, row: rowNow,
    scanUrl: r?.hasArt ? artUrl(r.image) : null, fields: typed, current: currentEdit, msg,
    edits: list, detail: opened, pictures: { before: pics?.before ?? null, after: pics?.after ?? null },
  };
}

/* ── talking to the server ────────────────────────────────────────────── */

interface Answer { ok: boolean; status: number; body: Record<string, unknown> | null }

/** One call. A bare 404 (not JSON) is the refusal every card-edit route gives a stranger. */
async function call(path: string, body?: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, body === undefined
      ? { headers: acct.authHeaders(false) }
      : { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body) });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.status === 404 && json === null) allowed = false;
    else if (json) allowed = true;
    return { ok: res.ok && json?.['ok'] === true, status: res.status, body: json };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const errorOf = (a: Answer): string =>
  typeof a.body?.['error'] === 'string' ? a.body['error'] as string : a.status ? `The server answered ${a.status}.` : 'Could not reach the server.';

async function loadList(): Promise<void> {
  const a = await call('/api/cardedit/edits');
  if (a.ok) list = (a.body!['edits'] as EditSummary[]) ?? [];
  else if (allowed !== false) msg = errorOf(a);
  paint();
}

async function loadCard(name: string, keepTyped = false): Promise<void> {
  const before = rowNow;
  cardNow = name; rowNow = null; currentEdit = null; msg = ''; fetching = true; q = ''; found = [];
  syncUrl(); paint();
  const a = await call(`/api/cardedit/row?card=${encodeURIComponent(name)}`);
  if (cardNow !== name) return;
  if (!a.ok) { fetching = false; msg = allowed === false ? '' : errorOf(a); paint(); return; }
  const row = a.body as unknown as CardEditRow;
  cardNow = row.card;
  typed = keepTyped && before?.rowHash === row.rowHash ? typed : editorFields(row.row);
  if (row.open) {
    const e = await fetchEdit(row.open);
    if (cardNow !== row.card) return;
    if (e) currentEdit = e;
    else rowNow = { ...row, readOnly: 'another edit to it is in progress' };
  }
  rowNow ??= row;
  fetching = false;
  syncUrl(); paint();
}

async function fetchEdit(id: string): Promise<EditDetail | null> {
  const a = await call(`/api/cardedit/edits/${encodeURIComponent(id)}`);
  return a.ok ? a.body as unknown as EditDetail : null;
}

async function submit(): Promise<void> {
  if (!rowNow || sending) return;
  sending = true; msg = ''; patch(['road']);
  const a = await call('/api/cardedit/edits', { card: rowNow.card, rowHash: rowNow.rowHash, fields: typed });
  sending = false;
  if (!a.ok) { msg = errorOf(a); paint(); return; }
  list = null;
  currentEdit = await fetchEdit(String(a.body!['id']));
  if (!currentEdit) msg = 'The edit was made, but could not be read back: open My edits.';
  paint();
}

async function cancel(): Promise<void> {
  if (!currentEdit || sending) return;
  sending = true; paint();
  const a = await call(`/api/cardedit/edits/${encodeURIComponent(currentEdit.id)}/cancel`, {});
  sending = false;
  if (a.ok) { currentEdit = a.body as unknown as EditDetail; list = null; } else msg = errorOf(a);
  paint();
}

async function openDetail(id: string): Promise<void> {
  const e = await fetchEdit(id);
  if (!open || tabNow !== 'mine') return;
  if (!e) { msg = 'That edit could not be read.'; paint(); return; }
  opened = e; msg = '';
  wantPictures(e);
  paint();
}

/* ── FriendlyBot's pictures ───────────────────────────────────────────── */

function dropPictures(): void {
  for (const u of [pics?.before, pics?.after]) if (u) URL.revokeObjectURL(u);
  pics = null;
}

function wantPictures(e: EditDetail): void {
  if (pics?.id !== e.id) { dropPictures(); pics = { id: e.id, before: null, after: null, afterAt: -1 }; }
  // a newer answer to any command is a newer "after"
  const answered = e.commands.filter(c => c.answered).length;
  if (e.pictures.before && !pics.before) void fetchPicture(e.id, 'before');
  if (e.pictures.after && pics.afterAt !== answered) { pics.afterAt = answered; void fetchPicture(e.id, 'after'); }
}

async function fetchPicture(id: string, which: 'before' | 'after'): Promise<void> {
  try {
    const res = await fetch(`/api/cardedit/edits/${encodeURIComponent(id)}/image/${which}`, { headers: acct.authHeaders(false) });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    if (pics?.id !== id) { URL.revokeObjectURL(url); return; }
    const old = pics[which];
    pics[which] = url;
    if (old) URL.revokeObjectURL(old);
    paint();
  } catch { /* the picture stays "No picture yet" */ }
}

/* ── the poll ─────────────────────────────────────────────────────────── */

/** the edit on screen, if one is */
const onScreen = (): EditDetail | null => (!open ? null : tabNow === 'edit' ? currentEdit : opened);

function stopPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null; pollId = null;
}

function syncPoll(): void {
  const e = onScreen();
  const want = e && !settled(e.status) ? e.id : null;
  if (want === pollId) return;
  stopPoll();
  if (want) { pollId = want; pollTimer = setInterval(() => void tick(want), POLL_MS); }
}

async function tick(id: string): Promise<void> {
  if (!open || !$app?.querySelector('.cepage')) { stopPoll(); return; }
  const e = await fetchEdit(id);
  if (!e || onScreen()?.id !== id) return;
  const was = onScreen();
  if (JSON.stringify(was) === JSON.stringify(e)) return;
  if (tabNow === 'edit') currentEdit = e; else { opened = e; wantPictures(e); }
  paint();
}

/* ── painting ─────────────────────────────────────────────────────────── */

/** the picker's cards: names that start with the words first, then any the search finds */
function findCards(text: string): string[] {
  const s = text.trim().toLowerCase();
  if (!s) return [];
  let rows: ReturnType<typeof allRows>;
  try { rows = search(text, { implicit: false }).rows; } catch { rows = []; }
  const named = allRows().filter(r => r.nameLc.includes(s));
  const ordered = [...named.filter(r => r.nameLc.startsWith(s)), ...named, ...rows];
  return [...new Set(ordered.map(r => r.name))].slice(0, PICKS);
}

const HOOKS: CardEditorHooks = {
  onQuery: value => { q = value; found = findCards(value); patch(['picks']); },
  onPickFirst: () => { if (found[0]) void loadCard(found[0]); },
  onField: (f: EditorField, value: string) => { typed = { ...typed, [f]: value }; patch(['pips', 'preview', 'road']); },
};

function paint(): void {
  if (!open || !$app) return;
  paintCardEditor($app, cardEditorView(state()), HOOKS);
  syncPoll();
}

function patch(parts: readonly LivePart[]): void {
  if (!open || !$app) return;
  patchCardEditor($app, cardEditorView(state()), parts);
}

export function renderScreen(): void { paint(); }

/* ── opening and closing ──────────────────────────────────────────────── */

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    if (open) url.searchParams.set('cardedit', cardNow ?? '1');
    else url.searchParams.delete('cardedit');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// and the like */ }
}

/** Open the editor, on `card` if given. `from` names where Back goes ("Cards" from the card browser). */
export function openCardEditor(card?: string, from = 'Home'): void {
  open = true; backTo = from; tabNow = 'edit'; msg = '';
  syncUrl();
  if (list === null) void loadList();
  if (card) void loadCard(card);
  else paint();
}

function close(): void {
  open = false;
  stopPoll(); dropPictures();
  cardNow = null; rowNow = null; currentEdit = null; opened = null; q = ''; found = []; msg = '';
  syncUrl();
  rerenderHost();
}

/** main.ts, once at boot: where to paint, and `?cardedit=` opens the page */
export function initCardEditor(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  // the card browser's Edit button is drawn for whoever may use this page
  setCardEditSource(mayEdit);
  try {
    const at = new URLSearchParams(location.search).get('cardedit');
    if (at) openCardEditor(at === '1' ? undefined : at, new URLSearchParams(location.search).has('cards') ? 'Cards' : 'Home');
  } catch { /* a URL we cannot parse is a page we do not open */ }
}

/* ── clicks ───────────────────────────────────────────────────────────── */

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('ce-')) return false;
  switch (b) {
    case 'ce-close': close(); break;
    case 'ce-tab':
      tabNow = btn.dataset['tab'] === 'mine' ? 'mine' : 'edit'; msg = '';
      if (tabNow === 'mine') void loadList();
      paint();
      break;
    case 'ce-pick': void loadCard(btn.dataset['card'] ?? ''); break;
    case 'ce-complexity': typed = { ...typed, complexity: btn.dataset['value'] ?? '' }; paint(); break;
    case 'ce-submit': void submit(); break;
    case 'ce-cancel': void cancel(); break;
    case 'ce-again': if (cardNow) void loadCard(cardNow, true); break;
    case 'ce-copy': {
      const c = currentEdit?.commands[Number(btn.dataset['i'])];
      if (c) copyText(c.text, null, btn);
      break;
    }
    case 'ce-copyall':
      if (currentEdit) copyText(currentEdit.commands.map(c => c.text).join('\n'), null, btn);
      break;
    case 'ce-row': void openDetail(btn.dataset['id'] ?? ''); break;
  }
  return true;
}
