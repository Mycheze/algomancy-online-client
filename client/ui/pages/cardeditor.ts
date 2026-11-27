/* THE CARD EDITOR, DRAWN (client/docs/card-editor.md §2): Caleb opens one of his cards, changes its
 * fields in his own notation, and gets the FriendlyBot commands to post, over the edit's status.
 *
 * Two tabs in the toolbar's centre. Edit: a card picker, the scan as it is now, the form, the live
 * preview through the game's text renderer, and the road the edit will take — or, once the card has
 * an edit in progress, that edit's commands and status instead of the form. My edits: one list, and
 * the chosen edit's pictures, commands and status beside it.
 *
 * The page contract (pages/README.md): ui/cardeditor.ts keeps the state, the fetches, the clicks
 * and the poll; cardEditorView() gathers it; cardEditorHtml() and the part renderers draw it and
 * touch nothing else; paintCardEditor() paints and wires the boxes, and patchCardEditor() redraws
 * the live parts in place while he types, so the caret never leaves the box.
 *
 * The road line runs the server's own functions (ui/cardnotation.ts) on what is on screen, so the
 * road shown is the road the server takes.
 */
import { boxClean, iconizeText } from '../cardtext.ts';
import {
  changedFields, diffRow, isUnitType, oracleValues, road, validateEdit,
  type DiffEntry, type EditorField, type EditorFields, type OracleRow, type Road,
} from '../cardnotation.ts';
import { esc } from '../util.ts';
import { button, chip, emptyState, field, segmented, statusMessage, type ChipTone } from '../components/index.ts';
import type { CardEditorState } from '../cardeditor.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

/* ── what the server sends (client/server/api-cardedit.ts) ─────────────── */

export type EditStatus = 'submitted' | 'waiting' | 'applying' | 'steward' | 'live' | 'cancelled';

/** GET /api/cardedit/row */
export interface CardEditRow {
  card: string;
  row: OracleRow;
  rowHash: string;
  /** why the card opens read-only, or null */
  readOnly: string | null;
  /** the id of the card's edit in progress, or null */
  open: string | null;
}

/** one row of GET /api/cardedit/edits */
export interface EditSummary {
  id: string;
  card: string;
  by: { name: string };
  createdAt: string;
  summary: string;
  road: Road;
  status: EditStatus;
  note: string | null;
}

/** GET /api/cardedit/edits/<id> */
export interface EditDetail extends EditSummary {
  edit: EditorFields;
  diff: DiffEntry[];
  why: string[];
  commands: { text: string; field: EditorField; posted: string | null; answered: boolean }[];
  pictures: { before: boolean; after: boolean };
}

/* ── the view ─────────────────────────────────────────────────────────── */

export type CardEditorTab = 'edit' | 'mine';

export interface CardEditorView {
  /** null: not asked yet; false: the server refused (not a designer) */
  access: boolean | null;
  tab: CardEditorTab;
  /** where Back goes: "Home", or "Cards" when the card browser opened it */
  backLabel: string;
  /** an admin sees every designer's edits, with the author's name */
  isAdmin: boolean;
  /** the bot knows his posts by his linked Discord account */
  discordLinked: boolean;
  chrome: FrameChrome;
  /** the picker's box and the cards it finds (none while the box is empty) */
  query: string;
  picks: string[];
  card: string | null;
  isLoading: boolean;
  busy: boolean;
  row: CardEditRow | null;
  /** the scan as it is now */
  scanUrl: string | null;
  /** the fields as they stand on screen, in his notation */
  fields: EditorFields;
  /** the card's edit on the Edit tab: its commands and status replace the form */
  current: EditDetail | null;
  errorMsg: string;
  edits: EditSummary[] | null;
  /** when each listed edit was made, as the viewer reads a date */
  whenOf: Readonly<Record<string, string>>;
  /** the edit opened on My edits */
  detail: EditDetail | null;
  /** FriendlyBot's pictures of the opened edit, as URLs the page can show */
  pictures: { before: string | null; after: string | null };
}

/** Gather the page from ui/cardeditor.ts's state. */
export function cardEditorView(st: CardEditorState): CardEditorView {
  const when: Record<string, string> = {};
  for (const e of st.edits ?? []) when[e.id] = whenText(e.createdAt);
  if (st.detail) when[st.detail.id] = whenText(st.detail.createdAt);
  return {
    access: st.access, tab: st.tab, backLabel: st.backLabel, isAdmin: st.isAdmin, discordLinked: st.discordLinked,
    chrome: frameChromeView(), query: st.query, picks: st.picks, card: st.card, isLoading: st.loading, busy: st.busy,
    row: st.row, scanUrl: st.scanUrl, fields: { ...st.fields }, current: st.current, errorMsg: st.msg,
    edits: st.edits, whenOf: when, detail: st.detail, pictures: st.pictures,
  };
}

function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ── the road ─────────────────────────────────────────────────────────── */

export interface LiveRoad { problems: string[]; road: Road; why: string[] }

/** What the server would say to these fields: its objections, else the road it takes. */
export function liveRoad(row: OracleRow, fields: EditorFields): LiveRoad {
  const r = road(diffRow(row, oracleValues(changedFields(row, fields))));
  return { problems: validateEdit(row, fields), ...r };
}

/** the road in a few words */
export function roadLine(l: LiveRoad): string {
  if (l.problems.length) return l.problems.join(' ');
  return l.road === 'fast' ? 'Live after the tests pass.' : `Goes to the steward: ${l.why.join(', ')}.`;
}

/* ── the parts redrawn while he types ─────────────────────────────────── */

export type LivePart = 'picks' | 'pips' | 'preview' | 'road';
export const LIVE_PARTS: readonly LivePart[] = ['picks', 'pips', 'preview', 'road'];

/** the cost and affinity as the card prints them */
function pipsHtml(f: EditorFields): string {
  const total = f['total cost'] ?? '';
  const pips = oracleValues({ cost: f.cost ?? '' }).cost ?? '';
  const mana = /^\d+$/.test(total) ? `[${total}]` : total === 'X' ? '[x]' : '';
  return iconizeText(mana + (/^[emrgbld]+$/.test(pips) ? `[${pips}]` : ''));
}

/** the text as the game draws it: the renderer reads our notation */
function previewHtml(f: EditorFields): string {
  const text = oracleValues({ text: f.text ?? '' }).text ?? '';
  return iconizeText(boxClean(text));
}

function picksHtml(v: CardEditorView): string {
  if (!v.query || !v.picks.length) return '';
  return `<ul class="cepicklist">${v.picks.map(name =>
    `<li><button type="button" class="cepickrow" data-btn="ce-pick" data-card="${esc(name)}">${esc(name)}</button></li>`).join('')}</ul>`;
}

function submitHtml(v: CardEditorView): string {
  const row = v.row?.row;
  if (!row) return '';
  const l = liveRoad(row, v.fields);
  const unchanged = l.problems.length === 1 && l.problems[0] === 'Nothing changed.';
  const tone = l.problems.length && !unchanged ? 'cebad' : l.road === 'steward' ? 'cesteward' : '';
  return `${v.discordLinked ? '' : statusMessage({ tone: 'warn', text: 'Link your Discord on your profile first: the bot knows your posts by it.' })}
    <p class="ceroadline ${tone}">${esc(roadLine(l))}</p>
    ${button({ label: v.busy ? 'Sending…' : 'Make the commands', variant: 'primary', dataBtn: 'ce-submit',
    disabled: l.problems.length > 0 || !v.discordLinked || v.busy })}`;
}

/** One live part of the Edit tab, as patchCardEditor puts it in place. */
export function cardEditorPartHtml(v: CardEditorView, part: LivePart): string {
  switch (part) {
    case 'picks': return picksHtml(v);
    case 'pips': return pipsHtml(v.fields);
    case 'preview': return previewHtml(v.fields);
    case 'road': return submitHtml(v);
  }
}

/* ── the Edit tab ─────────────────────────────────────────────────────── */

const FIELD_ID = (f: EditorField): string => `ce-f-${f.replace(' ', '-')}`;

function input(v: CardEditorView, f: EditorField, label: string, extra: { textarea?: boolean; className?: string } = {}): string {
  return field({
    id: FIELD_ID(f), label, control: extra.textarea ? 'textarea' : 'input', rows: extra.textarea ? 4 : undefined,
    value: v.fields[f] ?? '', className: extra.className,
    attrs: { 'data-ce-field': f, spellcheck: extra.textarea ? 'true' : 'false', autocomplete: 'off' },
  });
}

function formHtml(v: CardEditorView): string {
  const row = v.row!.row;
  const unit = isUnitType(row.type);
  const complexity = v.fields.complexity ?? '';
  return `<div class="ceform">
    <div class="cerow">
      ${input(v, 'total cost', 'Cost', { className: 'cenum' })}
      ${input(v, 'cost', 'Affinity', { className: 'cepipsbox' })}
      <span class="cepips" data-ce-live="pips">${pipsHtml(v.fields)}</span>
      ${unit ? input(v, 'power', 'Power', { className: 'cenum' }) + input(v, 'toughness', 'Toughness', { className: 'cenum' }) : ''}
    </div>
    ${input(v, 'type', 'Type')}
    ${input(v, 'text', 'Text', { textarea: true })}
    <div class="ceprev"><span class="celabel">Preview</span><div class="ceprevbox" data-ce-live="preview">${previewHtml(v.fields)}</div></div>
    <div class="cerow">
      ${input(v, 'image', 'Art', { className: 'ceart' })}
      <div class="cecomplex"><span class="celabel">Complexity</span>${segmented({
    ariaLabel: 'Complexity', size: 'sm',
    options: ['Simple', 'Complex'].map(c => ({ label: c, value: c, on: complexity === c, dataBtn: 'ce-complexity', attrs: { 'data-value': c } })),
  })}</div>
    </div>
    <div class="ceroad" data-ce-live="road">${submitHtml(v)}</div>
  </div>`;
}

const STATUS_WORD: Readonly<Record<EditStatus, string>> = {
  submitted: 'Submitted', waiting: 'Waiting for FriendlyBot', applying: 'Applying',
  steward: 'Queued for the steward', live: 'Live', cancelled: 'Cancelled',
};
const STATUS_TONE: Readonly<Record<EditStatus, ChipTone>> = {
  submitted: 'neutral', waiting: 'info', applying: 'accent', steward: 'warning', live: 'success', cancelled: 'neutral',
};

/** an edit that will not move again on its own: nothing to poll for */
export const settled = (s: EditStatus): boolean => s === 'live' || s === 'cancelled';

/** Submitted · Waiting for FriendlyBot · Applying (or Queued for the steward) · Live */
function trackHtml(e: EditDetail): string {
  if (e.status === 'cancelled') return `<div class="cetrack">${chip({ label: 'Cancelled', shape: 'pill' })}</div>`;
  const third: EditStatus = e.status === 'steward' || (e.road === 'steward' && e.status !== 'applying') ? 'steward' : 'applying';
  const steps: EditStatus[] = ['submitted', 'waiting', third, 'live'];
  const at = steps.indexOf(e.status);
  return `<ol class="cetrack">${steps.map((s, i) =>
    `<li class="cestep cestep--${i < at ? 'done' : i === at ? 'now' : 'todo'}"${i === at ? ' aria-current="step"' : ''}>${esc(STATUS_WORD[s])}</li>`).join('')}</ol>
    ${e.note ? `<p class="cenote">${esc(e.note)}</p>` : ''}`;
}

/** the commands, one block each; `copy` adds the Copy buttons (the Edit tab), else they are as posted */
function commandsHtml(e: EditDetail, copy: boolean): string {
  const rows = e.commands.map((c, i) => {
    const said = copy ? c.text : c.posted ?? c.text;
    const mark = c.answered ? chip({ label: 'Done', tone: 'success', shape: 'pill' })
      : c.posted ? chip({ label: 'Posted', tone: 'info', shape: 'pill' }) : '';
    return `<li class="cecmd"><code class="cecmdtext">${esc(said)}</code>${mark}${
      copy && !c.answered ? button({ label: 'Copy', size: 'sm', dataBtn: 'ce-copy', attrs: { 'data-i': i } }) : ''}</li>`;
  }).join('');
  return `<ol class="cecmds">${rows}</ol>`;
}

/** the card's edit, on the Edit tab: what to post, and where it stands */
function currentHtml(v: CardEditorView, e: EditDetail): string {
  const open = e.status === 'submitted';
  const acts = [
    e.commands.length > 1 && !settled(e.status) ? button({ label: 'Copy all', size: 'sm', dataBtn: 'ce-copyall' }) : '',
    open ? button({ label: 'Cancel this edit', size: 'sm', variant: 'ghost', dataBtn: 'ce-cancel', disabled: v.busy }) : '',
    settled(e.status) || e.status === 'steward' ? button({ label: 'Edit again', size: 'sm', dataBtn: 'ce-again' }) : '',
  ].filter(Boolean).join('');
  return `<div class="cecurrent">
    ${settled(e.status) ? '' : '<p class="celead">Post these in #card-changes, one message each:</p>'}
    ${commandsHtml(e, !settled(e.status))}
    ${trackHtml(e)}
    ${acts ? `<div class="ceacts">${acts}</div>` : ''}
  </div>`;
}

function scanHtml(v: CardEditorView): string {
  return v.scanUrl
    ? `<img class="cescan" data-zoom src="${esc(v.scanUrl)}" alt="${esc(v.card ?? '')}" onerror="this.style.visibility='hidden'">`
    : '';
}

function editTabHtml(v: CardEditorView): string {
  const bar = `<div class="framebar cebar">
    <h2 class="cename">${esc(v.row?.card ?? v.card ?? '')}</h2>
    <span class="framespacer"></span>
    <div class="cepick">
      <input id="ce-q" class="dksearch cepickq" type="search" aria-label="Find a card" placeholder="Find a card"
        autocomplete="off" spellcheck="false" value="${esc(v.query)}">
      <div class="cepicks" data-ce-live="picks">${picksHtml(v)}</div>
    </div>
  </div>`;
  const err = v.errorMsg ? statusMessage({ tone: 'error', text: v.errorMsg }) : '';
  if (!v.card) return bar + err + emptyState({ text: 'Find a card to edit.', className: 'ceempty' });
  const body = v.isLoading && !v.row && !v.current ? '<p class="framenote">loading…</p>'
    : v.current ? currentHtml(v, v.current)
      : !v.row ? ''
        : v.row.readOnly ? statusMessage({ tone: 'warn', text: `Read-only: ${v.row.readOnly}.` })
          : formHtml(v);
  return `${bar}${err}<div class="cework">
    <div class="ceside">${scanHtml(v)}</div>
    <div class="cemain" data-scroll="ce-edit">${body}</div>
  </div>`;
}

/* ── My edits ─────────────────────────────────────────────────────────── */

function editRowHtml(v: CardEditorView, e: EditSummary): string {
  const on = v.detail?.id === e.id;
  return `<button type="button" class="cerowbtn${on ? ' on' : ''}" data-btn="ce-row" data-id="${esc(e.id)}"${on ? ' aria-pressed="true"' : ''}>
    <b class="cerowcard">${esc(e.card)}</b>
    <span class="cerowwhat">${esc(e.summary)}</span>
    ${chip({ label: STATUS_WORD[e.status], tone: STATUS_TONE[e.status], shape: 'pill' })}
    <span class="cerowwhen">${esc(v.whenOf[e.id] ?? '')}${v.isAdmin ? ` · ${esc(e.by.name)}` : ''}</span>
  </button>`;
}

function pictureHtml(url: string | null, label: string): string {
  return `<figure class="cepic"${url ? ' data-zoom' : ''}>${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : '<div class="cepicnone">No picture yet</div>'}
    <figcaption>${esc(label)}</figcaption></figure>`;
}

/** FriendlyBot answers $simple/$complex with one line and no picture */
export const drawsPictures = (e: { commands: readonly { field: string }[] }): boolean =>
  e.commands.some(c => c.field !== 'complexity');

function detailHtml(v: CardEditorView): string {
  const e = v.detail;
  if (!e) return emptyState({ text: 'Pick an edit to see it.', bare: true });
  return `<h3 class="cedetailcard">${esc(e.card)}</h3>
    <p class="cedetailwhat">${esc(e.summary)}${v.isAdmin ? ` · ${esc(e.by.name)}` : ''} · ${esc(v.whenOf[e.id] ?? '')}</p>
    ${drawsPictures(e) ? `<div class="cepics">${pictureHtml(v.pictures.before, 'Before')}${pictureHtml(v.pictures.after, 'After')}</div>` : ''}
    ${commandsHtml(e, false)}
    ${trackHtml(e)}`;
}

function mineTabHtml(v: CardEditorView): string {
  const err = v.errorMsg ? statusMessage({ tone: 'error', text: v.errorMsg }) : '';
  if (!v.edits) return `${err}<p class="framenote">loading…</p>`;
  if (!v.edits.length) return err + emptyState({ text: 'No edits yet.' });
  return `${err}<div class="cemine">
    <div class="framelist celist" data-scroll="ce-mine">${v.edits.map(e => editRowHtml(v, e)).join('')}</div>
    <div class="cedetail" data-scroll="ce-detail-${esc(v.detail?.id ?? 'none')}">${detailHtml(v)}</div>
  </div>`;
}

/* ── the page ─────────────────────────────────────────────────────────── */

/** The card editor in the app frame: Edit | My edits in the toolbar's centre. */
export function cardEditorHtml(v: CardEditorView): string {
  const back = { dataBtn: 'ce-close', label: v.backLabel, icon: v.backLabel === 'Home' ? 'home' as const : 'back' as const };
  if (v.access === false) {
    return frameHtml({ page: 'cepage', title: 'Card editor', back, chrome: v.chrome,
      mainHtml: '<p class="framenote">This page is for the card designers.</p>' });
  }
  return frameHtml({
    page: 'cepage', title: 'Card editor', back, chrome: v.chrome, fill: true,
    centerHtml: segmented({
      ariaLabel: 'Card editor', className: 'cetabs',
      options: ([['edit', 'Edit'], ['mine', 'My edits']] as const).map(([t, label]) =>
        ({ label, value: t, on: v.tab === t, dataBtn: 'ce-tab', attrs: { 'data-tab': t } })),
    }),
    mainHtml: v.tab === 'edit' ? editTabHtml(v) : mineTabHtml(v),
  });
}

/* ── painting ─────────────────────────────────────────────────────────── */

/** what paintCardEditor wires the boxes to */
export interface CardEditorHooks {
  onQuery(value: string): void;
  /** Enter in the picker: the first card it found */
  onPickFirst(): void;
  /** a field typed into: the value exactly as it stands, never trimmed */
  onField(f: EditorField, value: string): void;
}

export function paintCardEditor(app: HTMLElement, v: CardEditorView, hooks: CardEditorHooks): void {
  const q = app.querySelector?.('#ce-q') as HTMLInputElement | null;
  const typingIn = q && document.activeElement === q ? [q.selectionStart, q.selectionEnd] as const : null;
  app.className = 'cardeditor';
  paintFrame(app, cardEditorHtml(v));
  const box = app.querySelector('#ce-q') as HTMLInputElement | null;
  if (box) {
    box.addEventListener('input', () => hooks.onQuery(box.value));
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); hooks.onPickFirst(); } });
    if ((typingIn && v.query) || !v.card) {
      box.focus();
      if (typingIn) [box.selectionStart, box.selectionEnd] = [typingIn[0], typingIn[1]];
    }
  }
  for (const el of Array.from(app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-ce-field]'))) {
    el.addEventListener('input', () => hooks.onField(el.dataset['ceField'] as EditorField, el.value));
  }
}

/** Redraw the live parts in place: the boxes, and the caret in them, are left alone. */
export function patchCardEditor(app: HTMLElement, v: CardEditorView, parts: readonly LivePart[] = LIVE_PARTS): void {
  for (const p of parts) {
    const el = app.querySelector(`[data-ce-live="${p}"]`);
    if (el) el.innerHTML = cardEditorPartHtml(v, p);
  }
}
