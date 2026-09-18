/* R297 — LEARN TO PLAY: THE LESSON WINDOW.
 *
 * A layer beside #app, the ui/report.ts and ui/helplayer.ts pattern, with one
 * difference that matters: it is FOR the board, so it stays up when one comes
 * up. Everything else follows those two:
 *
 *   · its scrim is `.lessonscrim`, never the board's overlay class — 269 reads
 *     every scrim with that class as a board overlay
 *   · its clicks are `data-lbtn`, claimed in the capture phase and stopped, so
 *     main.ts's global handler never acts on a click meant for a lesson
 *   · while a lesson is open (not minimised) no key reaches the board: Space
 *     must not pass priority behind a page the learner is still reading
 *
 * The window renders ui/lessons.ts's pages: markdown with card-text icons,
 * card names that show their SCAN on hover (the board's #preview does not
 * exist off the rail, and a tutorial wants the picture, not the text box),
 * rule quotes, figures, and a judge box whose questions carry the lesson's
 * text as context.
 *
 * The HTML builders are pure and exported (the ui-driver cannot hover or query
 * the DOM); `installLessonLayer` is the only DOM code.
 */
import { esc } from './util.ts';
import { mdToHtml } from './markdown.ts';
import { iconizeText } from './cardtext.ts';
import { rowFor } from './cardindex.ts';
import { artHtml } from './cardpanel.ts';
import { setHoverArrows } from './anim.ts';
import {
  dueLesson, lessonContext, pageBody, pageCallout, pageFigures,
  type FigCard, type Figure, type Lesson, type LessonCtx, type LessonPage,
} from './lessonflow.ts';

// ── pure HTML ─────────────────────────────────────────────────────────

const LINK = /\[\[(?:([^\]|]+)\|)?([^\]]+)\]\]|\{\{part:([\w-]+)\|([^}]+)\}\}/g;

/** The inline hook: [[Card]] / [[text|Card]] become hover links, {{part:id|words}}
 * an anatomy pointer, and everything else goes through iconizeText (which
 * escapes first). */
export function lessonInline(src: string): string {
  let out = '';
  let at = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(src); m; m = LINK.exec(src)) {
    out += iconizeText(src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[3] !== undefined) {
      out += `<span class="lpart" data-lpart="${esc(m[3])}">${iconizeText(m[4]!)}</span>`;
      continue;
    }
    const name = m[2]!.trim();
    const text = (m[1] ?? m[2])!.trim();
    const row = rowFor(name);
    out += row
      ? `<a class="lcard" data-lcard="${esc(row.name)}">${esc(text)}</a>`
      : esc(text);
  }
  return out + iconizeText(src.slice(at));
}

const card = (c: FigCard): Exclude<FigCard, string> => (typeof c === 'string' ? { name: c } : c);

/** a caption: a line of markdown without its paragraph */
const captionHtml = (s: string): string => mdToHtml(s, { inline: lessonInline }).replace(/^<p>|<\/p>$/g, '');

/** one card in a figure: the scan (or a back), greyed or crossed, with a chip and a line */
export function figCardHtml(fc: FigCard): string {
  const c = card(fc);
  const r = rowFor(c.name);
  const img = c.back || !r ? `<div class="lfigimg lfigback"></div>` : artHtml(r, 'lfigimg');
  const cls = ['lfigcard', c.dim ? 'dim' : '', c.cross ? 'cross' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}"${r && !c.back ? ` data-lcard="${esc(r.name)}"` : ''}>${img}${
    c.badge ? `<b class="lbadge">${lessonInline(c.badge)}</b>` : ''}${
    c.label ? `<span class="lfiglabel">${lessonInline(c.label)}</span>` : ''}</span>`;
}

let figSeq = 0;

export function figureHtml(f: Figure): string {
  let inner: string;
  switch (f.kind) {
    case 'cards':
      inner = `<div class="lfigcards">${f.cards.map(figCardHtml).join('')}</div>`;
      break;
    case 'flow':
      inner = `<div class="lfigcards lflow">${f.steps.map(figCardHtml).join('<i class="lflowarrow">➜</i>')}</div>`;
      break;
    case 'anatomy': {
      const r = rowFor(f.card);
      inner = `<div class="lanat">${r ? artHtml(r, 'lanatimg') : ''}${Object.entries(f.parts).map(([id, [x, y]]) =>
        `<i class="lanchor" id="lanc-${esc(id)}" style="left:${x}%;top:${y}%"></i>`).join('')}</div>`;
      break;
    }
    case 'formation': {
      // one grid, every cell the size of a card, so a column lines up across
      // the middle line whatever is or is not standing in it
      const n = Math.max(f.theirs.length, f.yours.length);
      const depth = (side: (FigCard | null)[][]): number => Math.max(1, ...side.map(c => c.length));
      const td = depth(f.theirs), yd = depth(f.yours);
      const cell = (fc: FigCard | null | undefined, empty: string): string =>
        `<div class="lfcell">${fc ? figCardHtml(fc) : `<span class="lfempty">${empty}</span>`}</div>`;
      const role = (side: 'theirs' | 'yours'): string => (f.attacker === side ? 'attacking' : 'blocking');
      const rows: string[] = [];
      for (let r = td - 1; r >= 0; r--) {   // their back row at the top, their front at the line
        rows.push(Array.from({ length: n }, (_, i) => cell(f.theirs[i]?.[r], r === 0 ? (f.attacker === 'theirs' ? '' : 'no blocker') : '')).join(''));
      }
      const top = rows.join('');
      rows.length = 0;
      for (let r = 0; r < yd; r++) {        // your front at the line, your back row below
        rows.push(Array.from({ length: n }, (_, i) => cell(f.yours[i]?.[r], r === 0 ? (f.attacker === 'yours' ? '' : 'no blocker') : '')).join(''));
      }
      const notes = f.notes?.length
        ? `<div class="lfgrid" style="--cols:${n}">${Array.from({ length: n }, (_, i) => `<div class="lfnote">${lessonInline(f.notes![i] ?? '')}</div>`).join('')}</div>` : '';
      inner = `<div class="lform">
        <div class="lfside">your opponent — ${role('theirs')}</div>
        <div class="lfgrid" style="--cols:${n}">${top}</div>
        <div class="lfline"></div>
        <div class="lfgrid" style="--cols:${n}">${rows.join('')}</div>
        <div class="lfside">you — ${role('yours')}</div>
        ${notes}
      </div>`;
      break;
    }
    case 'modded': {
      const host = rowFor(f.host);
      const mods = f.mods.map(n => rowFor(n)).filter(r => !!r);
      inner = `<div class="lmodwrap"><div class="lmodded" style="--mods:${mods.length}">
        ${mods.map((m, i) => `<span class="lmod" style="--i:${i + 1}" data-lcard="${esc(m!.name)}">${artHtml(m!, 'lfigimg')}</span>`).reverse().join('')}
        ${host ? `<span class="lmodhost" data-lcard="${esc(host.name)}">${artHtml(host, 'lfigimg')}</span>` : ''}
      </div>${f.reads ? `<div class="lreads"><div class="lreadslabel">It now reads</div>${mdToHtml(f.reads, { inline: lessonInline })}</div>` : ''}</div>`;
      break;
    }
    case 'frames': {
      const id = `lfr${++figSeq}`;
      inner = `<div class="lframes" id="${id}" data-play="${f.play}" data-playing="${f.play === 'loop' ? '1' : '0'}" data-i="0" data-n="${f.frames.length}">
        ${f.frames.map((fr, i) => `<div class="lframe${i === 0 ? ' on' : ''}">${figureHtml(fr.figure)}<div class="lframecap">${
          f.play === 'step' ? `<b>${i + 1}.</b> ` : ''}${captionHtml(fr.caption)}</div></div>`).join('')}
        <div class="lframebtns">
          <button data-lbtn="frame-prev" data-fr="${id}" title="step back">⏮</button>
          <button data-lbtn="frame-play" data-fr="${id}" class="lplay" title="play / pause">${f.play === 'loop' ? '⏸' : '▶'}</button>
          <button data-lbtn="frame-next" data-fr="${id}" title="step forward"${f.play === 'step' ? ' class="lprimary"' : ''}>⏭</button>
          <span class="lframepos">1 / ${f.frames.length}</span>
        </div>
      </div>`;
      break;
    }
    case 'html':
      inner = f.html;
      break;
  }
  return `<figure class="lfig lfig-${f.kind}">${inner}${f.caption ? `<figcaption>${captionHtml(f.caption)}</figcaption>` : ''}</figure>`;
}

export function pageHtml(p: LessonPage, c: LessonCtx | null): string {
  const quotes = p.quotes ?? [];
  const cites = quotes.length
    ? `<details class="lcites"><summary>📖 from the rulebook</summary>${quotes.map(q =>
      `<blockquote class="lquote">${lessonInline(q.text)}<cite>${esc(q.source)}</cite></blockquote>`).join('')}</details>`
    : '';
  const callout = pageCallout(p, c);
  const figs = pageFigures(p, c);
  // an anatomy card stands BESIDE the words that point at it, so an arrow
  // from any line reaches it without scrolling
  const side = figs.filter(f => f.kind === 'anatomy');
  return `<h4 class="lptitle">${esc(p.title)}</h4>
    ${side.length ? `<div class="lside">${side.map(figureHtml).join('')}</div>` : ''}
    <div class="lbody">${mdToHtml(pageBody(p, c), { inline: lessonInline })}</div>
    ${callout ? `<div class="lcallout">${mdToHtml(callout, { inline: lessonInline })}</div>` : ''}
    ${figs.filter(f => f.kind !== 'anatomy').map(figureHtml).join('')}${cites}`;
}

export interface JudgeTurn { q: string; a: string; cards: string[] }

export interface WindowModel {
  lesson: Lesson;
  page: number;
  ctx: LessonCtx | null;
  judge: JudgeTurn[];
  judgeBusy: boolean;
  judgeDraft: string;
  /** extra buttons in the footer (the end-of-game choices) */
  actions?: { btn: string; label: string; primary?: boolean }[];
}

export function windowHtml(m: WindowModel): string {
  const { lesson: l, page } = m;
  const last = page >= l.pages.length - 1;
  const compact = !!l.compact;
  const dots = l.pages.length > 1
    ? `<span class="ldots">${l.pages.map((_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const judge = m.judge.map(t => `<div class="ljq">${esc(t.q)}</div>
    <div class="lja">${mdToHtml(t.a, { inline: lessonInline })}${t.cards.length
      ? `<div class="ljcards">${t.cards.map(n => `[[${n}]]`).map(lessonInline).join(' · ')}</div>` : ''}</div>`).join('');
  const extra = (m.actions ?? []).map(a =>
    `<button data-lbtn="${esc(a.btn)}" class="${a.primary ? 'lprimary' : ''}">${esc(a.label)}</button>`).join('');
  return `<div class="lessonscrim${compact ? ' compact' : ''}" id="lessonscrim"><div class="lessonbox${compact ? ' compact' : ''}" role="dialog" aria-label="${esc(l.n ? `Lesson ${l.n}: ` : '')}${esc(l.title)}">
    <div class="lhead">
      ${l.n ? `<span class="lnum">${/^\d/.test(l.n) ? `Lesson ${esc(l.n)}` : esc(l.n)}</span>` : ''}<h3>${esc(l.title)}</h3>
      <span class="lheadbtns"><button data-lbtn="min" title="Hide the lesson and look at the board (reopen it from the 📘 pill)">▁ hide</button></span>
    </div>
    <div class="lscroll">${pageHtml(l.pages[page]!, m.ctx)}</div>
    ${compact ? '' : `<div class="ljudge">
      ${judge ? `<div class="ljlog">${judge}</div>` : ''}
      <div class="ljask"><input id="ljudge-q" type="text" maxlength="400" autocomplete="off"
        placeholder="Still unsure? Ask the judge about this lesson…" value="${esc(m.judgeDraft)}">
        <button data-lbtn="ask" ${m.judgeBusy ? 'disabled' : ''}>${m.judgeBusy ? 'asking…' : '⚖ ask'}</button></div>
    </div>`}
    <div class="lfoot">
      ${dots}
      <span class="lfootbtns">
        ${page > 0 ? '<button data-lbtn="back">← back</button>' : ''}
        ${extra}
        ${last
          ? (m.actions?.length ? '' : '<button data-lbtn="done" class="lprimary">Got it (enter)</button>')
          : '<button data-lbtn="next" class="lprimary">Next → (enter)</button>'}
      </span>
    </div>
  </div></div>`;
}

export function pillHtml(label: string): string {
  return `<button class="lessonpill" data-lbtn="reopen">📘 ${esc(label)}</button>`;
}

// ── the layer ─────────────────────────────────────────────────────────

export interface LessonHost {
  lessons: readonly Lesson[];
  /** the learner's view and legal list, or null when no game is up */
  ctx: () => LessonCtx | null;
  seen: () => readonly string[];
  markSeen: (id: string) => void;
  /** POST the question to the judge with the lesson as context */
  judge: (question: string, context: string) => Promise<{ answer: string; cards: string[] }>;
  /** the end-of-game footer, on the last page of the 'end' lesson */
  endActions?: (ctx: LessonCtx) => { btn: string; label: string; primary?: boolean }[];
  onAction?: (btn: string) => void;
}

/** the lesson whose last page offers the end-of-game choices (lessons.ts END) */
const END_LESSON = 'end';

let host: LessonHost | null = null;
let layer: HTMLElement | null = null;
let prev: HTMLElement | null = null;
let open: { lesson: Lesson; page: number } | null = null;
let minimised = false;
const judgeLogs = new Map<string, JudgeTurn[]>();
let judgeBusy = false;
let judgeDraft = '';

let lit: Element[] = [];
/** the page's highlights glow while it is open, and only then */
function highlight(sels: readonly string[]): void {
  for (const el of lit) el.classList.remove('lhl');
  lit = [];
  for (const sel of sels) {
    try { document.querySelectorAll(sel).forEach(el => { el.classList.add('lhl'); lit.push(el); }); } catch { /* a bad selector lights nothing */ }
  }
}

function paint(): void {
  if (!layer || !host) return;
  setHoverArrows(null);
  document.body.classList.toggle('lessonreading', !!open && !minimised);
  if (!open) { highlight([]); layer.innerHTML = ''; return; }
  if (minimised) { highlight([]); layer.innerHTML = pillHtml(`${open.lesson.n ? `Lesson ${open.lesson.n}: ` : ''}${open.lesson.title}`); return; }
  highlight(open.lesson.pages[open.page]?.highlight ?? []);
  const ctx = host.ctx();
  const last = open.page >= open.lesson.pages.length - 1;
  layer.innerHTML = windowHtml({
    lesson: open.lesson, page: open.page, ctx,
    judge: judgeLogs.get(open.lesson.id) ?? [], judgeBusy, judgeDraft,
    actions: last && ctx && host.endActions && open.lesson.id === END_LESSON ? host.endActions(ctx) : undefined,
  });
  const box = layer.querySelector('.ljlog');
  if (box) box.scrollTop = box.scrollHeight;
}

/** open a lesson now (the lesson list, or the flow) */
export function openLesson(l: Lesson, page = 0): void {
  open = { lesson: l, page };
  minimised = false;
  paint();
}

/** close without marking it seen (a rewind puts the game before its moment) */
export function closeLesson(): void {
  open = null;
  hidePreview();
  paint();
}

/** Called after every board paint: open the lesson that is due, if any. */
export function lessonTick(): void {
  // a board paint replaces #app's markup, and the glow with it: put it back
  if (open && !minimised) highlight(open.lesson.pages[open.page]?.highlight ?? []);
  if (!host || open) return;
  const ctx = host.ctx();
  if (!ctx) return;
  const due = dueLesson(host.lessons, { seen: host.seen() }, ctx);
  if (due) openLesson(due);
}

function finish(): void {
  if (!open || !host) return;
  host.markSeen(open.lesson.id);
  open = null;
  paint();
  lessonTick();   // two lessons can be due at once (the start of the game)
}

function ask(): void {
  if (!open || !host || judgeBusy) return;
  const input = layer?.querySelector('#ljudge-q') as HTMLInputElement | null;
  const q = (input?.value ?? judgeDraft).trim();
  if (!q) return;
  const l = open.lesson;
  judgeBusy = true;
  judgeDraft = '';
  paint();
  host.judge(q, lessonContext(l, host.ctx()))
    .then(r => { const log = judgeLogs.get(l.id) ?? []; log.push({ q, a: r.answer, cards: r.cards }); judgeLogs.set(l.id, log); })
    .catch(err => { const log = judgeLogs.get(l.id) ?? []; log.push({ q, a: `could not reach the judge: ${err}`, cards: [] }); judgeLogs.set(l.id, log); })
    .finally(() => { judgeBusy = false; paint(); });
}

/** start or stop a frames figure playing by itself */
function playing(el: HTMLElement, on: boolean): void {
  el.dataset['playing'] = on ? '1' : '0';
  const b = el.querySelector(':scope > .lframebtns .lplay');
  if (b) b.textContent = on ? '⏸' : '▶';
}

/** step or loop a frames figure */
function frame(el: HTMLElement, delta: number): void {
  const n = Number(el.dataset['n']);
  const i = (Number(el.dataset['i']) + delta + n) % n;
  el.dataset['i'] = String(i);
  el.querySelectorAll(':scope > .lframe').forEach((f, k) => f.classList.toggle('on', k === i));
  const pos = el.querySelector(':scope > .lframebtns .lframepos');
  if (pos) pos.textContent = `${i + 1} / ${n}`;
}

function showPreview(name: string, x: number, y: number): void {
  const r = rowFor(name);
  if (!prev || !r) return;
  prev.innerHTML = artHtml(r, 'lprevimg');
  prev.style.display = 'block';
  const w = 250, hgt = 350;
  prev.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + 18))}px`;
  prev.style.top = `${Math.max(8, Math.min(innerHeight - hgt - 8, y - hgt / 2))}px`;
}
function hidePreview(): void { if (prev) prev.style.display = 'none'; }

export function installLessonLayer(h: LessonHost): void {
  if (host) return;
  if (!document.body || typeof document.body.appendChild !== 'function') return;
  host = h;
  layer = document.createElement('div');
  layer.id = 'lessonlayer';
  document.body.appendChild(layer);
  prev = document.createElement('div');
  prev.id = 'lessonprev';
  document.body.appendChild(prev);

  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    if (!layer || !target || !layer.contains(target)) return;
    e.stopPropagation();
    const cardEl = target.closest('[data-lcard]') as HTMLElement | null;
    if (cardEl && !target.closest('[data-lbtn]')) {
      // a tap is the finger's hover: toggle the scan
      const r = cardEl.getBoundingClientRect();
      if (prev?.style.display === 'block') hidePreview(); else showPreview(cardEl.dataset['lcard']!, r.right, r.top + r.height / 2);
      return;
    }
    const btnEl = target.closest('[data-lbtn]') as HTMLElement | null;
    const btn = btnEl?.dataset['lbtn'];
    if (!btn || !open) return;
    if (btn === 'frame-prev' || btn === 'frame-next' || btn === 'frame-play') {
      const fr = document.getElementById(btnEl!.dataset['fr'] ?? '');
      if (!fr) return;
      if (btn === 'frame-play') { playing(fr, fr.dataset['playing'] !== '1'); return; }
      playing(fr, false);   // stepping by hand pauses it
      frame(fr, btn === 'frame-next' ? 1 : -1);
      return;
    }
    const input = layer.querySelector('#ljudge-q') as HTMLInputElement | null;
    if (input) judgeDraft = input.value;
    switch (btn) {
      case 'next': open.page = Math.min(open.lesson.pages.length - 1, open.page + 1); hidePreview(); paint(); return;
      case 'back': open.page = Math.max(0, open.page - 1); hidePreview(); paint(); return;
      case 'done': hidePreview(); finish(); return;
      case 'min': minimised = true; hidePreview(); paint(); return;
      case 'reopen': minimised = false; paint(); return;
      case 'ask': ask(); return;
      default: host?.onAction?.(btn);
    }
  }, { capture: true });

  document.addEventListener('mouseover', e => {
    const el = e.target as HTMLElement | null;
    const part = el?.closest?.('[data-lpart]') as HTMLElement | null;
    if (part && layer?.contains(part)) {
      // one anatomy arrow at a time: from the words to the part of the card
      const id = part.dataset['lpart']!;
      layer.querySelectorAll('.lanchor.on').forEach(a => a.classList.remove('on'));
      layer.querySelector(`#lanc-${CSS.escape(id)}`)?.classList.add('on');
      setHoverArrows([{ from: [`.lpart[data-lpart="${id}"]`], to: [`#lanc-${id}`], cls: 'tgt' }]);
      return;
    }
    const t = el?.closest?.('[data-lcard]') as HTMLElement | null;
    if (!t || !layer?.contains(t)) return;
    showPreview(t.dataset['lcard']!, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', e => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('[data-lpart]')) {
      setHoverArrows(null);
      layer?.querySelectorAll('.lanchor.on').forEach(a => a.classList.remove('on'));
      return;
    }
    if (el?.closest?.('[data-lcard]')) hidePreview();
  });

  // looping figures advance on their own while a lesson is open
  setInterval(() => {
    if (!open || minimised || !layer) return;
    layer.querySelectorAll<HTMLElement>('.lframes[data-playing="1"]').forEach(f => frame(f, 1));
  }, 1700);

  document.addEventListener('keydown', e => {
    if (!open || minimised) return;
    const el = e.target as HTMLElement | null;
    e.stopPropagation();   // nothing reaches the board while a lesson is read
    if (el?.id === 'ljudge-q') {
      if (e.key === 'Enter') { e.preventDefault(); judgeDraft = (el as HTMLInputElement).value; ask(); }
      return;   // typing types
    }
    if (e.key === 'Escape') { minimised = true; hidePreview(); paint(); return; }
    if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (open.page < open.lesson.pages.length - 1) { open.page++; paint(); return; }
      // the last page: Enter is "Got it" — unless the page's footer is a choice
      if (!layer?.querySelector('.lfootbtns [data-lbtn]:not([data-lbtn="back"]):not([data-lbtn="done"])')) finish();
      return;
    }
    if (e.key === 'ArrowLeft' && open.page > 0) { open.page--; paint(); return; }
    if (e.key === ' ') e.preventDefault();
  }, { capture: true });
}
