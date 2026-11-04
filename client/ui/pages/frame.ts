/* THE APP FRAME: what every page after the home is drawn in (client/docs/24-redesign/,
 * the owner's principles, applied to the other pages 2026-11-04).
 *
 * One window, no page scroll, the same toolbar everywhere:
 *
 *   [⌂ Home] Title          [ the page's tabs ]          [page tools] | Rules Alerts Report
 *   ─────────────────────────────────────────────────────────────────────────────────────
 *   the page                                   (scrolls inside itself, or its regions do)
 *   ─────────────────────────────────────────────────────────────────────────────────────
 *   (i) Algomancy Online (Unofficial Client)
 *
 * The slim bottom bar is the legal footer's stand-in (test 267, BL-15: a
 * signed-out visitor sees that this client is unofficial without hunting for
 * it — and a shared `?card=` link lands on a page in the frame, not on the
 * home). Its button is the home's own caption and opens the About page, which
 * carries the notice, the attribution and the way to buy the game.
 *
 * The frame is the app shell (components/app-shell.ts, `contained`) with one
 * bar along the top. Its root carries `apppage` — which is what hides the
 * floating Report pill, the floating bell and the legal footer
 * (shared/13-report-and-inbox.css, pages/48-legal.css, test 1020): a page in
 * the frame has those in its toolbar — and the page's own class LAST, which
 * is what report.ts names the page from (287).
 *
 * THE TOOLS ARE DEFINED ONCE, HERE. The home screen's toolbar draws its Learn,
 * Test, Rules, Alerts and Report from `toolsHtml` too, so a tool changed here
 * changes on every page. A page adds its own tools before the shared ones
 * (`toolsHtml` in FrameProps), after a divider.
 *
 * Scroll: the client repaints a page by replacing #app's markup, which used
 * to keep the WINDOW's scroll. Under the no-page-scroll rule the scroll lives
 * in regions inside the page, which a repaint would rebuild at the top — a
 * filter chip clicked two screens down the card grid would throw you back to
 * the first row. So a region that scrolls carries `data-scroll="<key>"`, and
 * paintFrame puts every one back where it was (and the shell's main region
 * too). A key names WHAT is scrolled: a page that swaps one list for another
 * (a different tab) gives it another key, and the new list starts at the top.
 *
 * Contract (pages/README.md): frameChromeView() is the one impure part (who
 * is signed in, the unread count — from the source main.ts sets at boot);
 * frameHtml() and toolsHtml() are pure.
 */
import { appShell, icon, iconButton, shellBar } from '../components/index.ts';
import type { IconName } from '../components/icon.ts';
import { esc } from '../util.ts';

/* ── the shared tools ─────────────────────────────────────────────────── */

/** what every toolbar needs from outside: the account and the bell */
export interface FrameChrome {
  signedIn: boolean;
  /** the bell's unread count (inbox.ts inboxUnread) */
  alerts: number;
}

/* Where the chrome comes from: main.ts hands it in at boot (setChromeSource),
 * so this module imports no state of its own. It used to import account.ts
 * and inbox.ts, and that pulled ui/cards.ts in through account.ts before
 * pages/cards.ts had finished evaluating (a TDZ on CHUNK in test 980) — and
 * "a page imports only modules main.ts already imported" is the boot-order
 * rule (pages/README.md). Until it is set — a test, a story — the toolbar is
 * drawn signed out, with nothing unread. */
let chromeSource: () => FrameChrome = () => ({ signedIn: false, alerts: 0 });

/** main.ts, once at boot: who is signed in, and the bell's unread count */
export function setChromeSource(source: () => FrameChrome): void { chromeSource = source; }

export function frameChromeView(): FrameChrome {
  return chromeSource();
}

export const TOOL_NAMES = ['learn', 'test', 'rules', 'alerts', 'report'] as const;
export type ToolName = typeof TOOL_NAMES[number];
/** the tools a page in the frame carries (the home carries all five) */
export const PAGE_TOOLS: readonly ToolName[] = ['rules', 'alerts', 'report'];

export interface ToolsOptions {
  /** signed out there is no bell: the markup to draw in its place ('' or
   * absent: nothing — the home passes a button that opens its sign-in sheet) */
  alertsSignedOutHtml?: string;
}

/** One shared tool. Each opens its layer through its own data attribute
 * (help.ts data-help, learnmenu.ts data-learn, sandbox.ts data-sbx, inbox.ts
 * data-inbox, report.ts data-report), so it works on any page. */
function toolHtml(name: ToolName, c: FrameChrome, o: ToolsOptions): string {
  switch (name) {
    case 'learn':
      return iconButton({ label: 'Learn', icon: 'learn', attrs: { 'data-learn': 'menu' }, title: 'Learn to Play: lessons against a bot' });
    case 'test':
      // test mode (ui/sandbox.ts): its click handler writes "dealing…" or what
      // went wrong into the [data-sbx-label] span — a small note under the
      // button — so the icon and caption are never overwritten
      return iconButton({ label: 'Test', iconHtml: `${icon('test')}<span class="homesbxnote" data-sbx-label></span>`, attrs: { 'data-sbx': 'open' },
        title: 'test mode: a solo sandbox — any card, any mana, 1000 life — and the rules still apply' });
    case 'rules':
      return iconButton({ label: 'Rules', icon: 'rules', attrs: { 'data-help': 'rules' }, title: 'how to play: the rules, the rulebook, the interface' });
    case 'alerts':
      return c.signedIn
        ? iconButton({ label: 'Alerts', icon: 'alerts', badge: c.alerts, className: 'homealerts', attrs: { 'data-inbox': 'bell' },
          title: 'friend invites, match alerts and league notices' })
        : o.alertsSignedOutHtml ?? '';
    case 'report':
      return iconButton({ label: 'Report', icon: 'report', attrs: { 'data-report': 'open' }, title: 'report a bug or say something' });
  }
}

/** The shared tools, in the order given. Pure. */
export function toolsHtml(c: FrameChrome, names: readonly ToolName[], o: ToolsOptions = {}): string {
  return names.map(n => toolHtml(n, c, o)).join('');
}

/* ── the frame ────────────────────────────────────────────────────────── */

export interface FrameBack {
  /** the page's own close button (`cards-close`, `meta-close` …), kept as it was */
  dataBtn: string;
  /** the caption under the icon: "Home", or where it goes back to ("Deck") */
  label: string;
  /** 'home' (the default) or 'back' for a page that returns somewhere else */
  icon?: Extract<IconName, 'home' | 'back'>;
  title?: string;
}

export interface FrameProps {
  /** the page's own class — LAST on the root (report.ts pageOf) */
  page: string;
  title: string;
  /** trusted markup instead of the escaped title (a count beside it) */
  titleHtml?: string;
  back: FrameBack;
  /** trusted markup in the toolbar's centre: the page's tabs */
  centerHtml?: string;
  /** trusted markup: the page's own tools, before the shared ones */
  toolsHtml?: string;
  chrome: FrameChrome;
  /** trusted markup: the page */
  mainHtml: string;
  /** the page lays out its own scrolling regions (the shell's `fill`) */
  fill?: boolean;
  /** a wider column than the home's (the card browser's grid) */
  wide?: boolean;
}

/** A page in the frame. Pure. */
export function frameHtml(p: FrameProps): string {
  const start = iconButton({ label: p.back.label, icon: p.back.icon ?? 'home', dataBtn: p.back.dataBtn, className: 'frameback',
    title: p.back.title })
    + `<h1 class="frametitle">${p.titleHtml ?? esc(p.title)}</h1>`;
  const end = (p.toolsHtml ? `<div class="frametools">${p.toolsHtml}</div><span class="framesep" aria-hidden="true"></span>` : '')
    + toolsHtml(p.chrome, PAGE_TOOLS);
  return appShell({
    contained: true,
    fill: p.fill,
    className: `apppage${p.wide ? ' framewide' : ''} ${p.page}`,
    topHtml: shellBar({ className: 'frametop', startHtml: start, centerHtml: p.centerHtml, endHtml: end }),
    mainHtml: p.mainHtml,
    bottomHtml: shellBar({ className: 'framebottom', startHtml: CLIENT_INFO }),
  });
}

/** the bottom bar's one button: what this client is (legal.ts's About page) */
export const CLIENT_INFO = iconButton({ label: 'Algomancy Online (Unofficial Client)', icon: 'info', layout: 'inline', className: 'frameinfo',
  attrs: { 'data-legal': 'about' }, title: 'about this client: the game, the notice, buying it, privacy' });

/* ── painting ─────────────────────────────────────────────────────────── */

/** the shell's main region's key among the carried scrolls */
const MAIN_KEY = '__main';

type Scroller = { scrollTop: number; scrollLeft: number; dataset?: Record<string, string | undefined> };

/** where every scrolling region of `app` is now, by its key */
export function scrollsIn(app: { querySelectorAll?: (s: string) => ArrayLike<Scroller>; querySelector?: (s: string) => Scroller | null }): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const main = app.querySelector?.('.ui-app-shell__main');
  if (main) out.set(MAIN_KEY, [main.scrollTop, main.scrollLeft]);
  for (const el of Array.from(app.querySelectorAll?.('[data-scroll]') ?? [])) {
    const k = el.dataset?.['scroll'];
    if (k) out.set(k, [el.scrollTop, el.scrollLeft]);
  }
  return out;
}

/** put the regions back (a key the new markup no longer has is dropped) */
export function restoreScrolls(app: { querySelector?: (s: string) => Scroller | null }, kept: Map<string, [number, number]>): void {
  for (const [k, [top, left]] of kept) {
    // a key may hold a card's name: quote what an attribute selector needs quoted
    const el = app.querySelector?.(k === MAIN_KEY ? '.ui-app-shell__main' : `[data-scroll="${k.replace(/["\\]/g, '\\$&')}"]`);
    if (!el) continue;
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}

/** Put a page drawn in the frame on screen, every scrolling region where it was. */
export function paintFrame(app: HTMLElement, html: string): void {
  const kept = scrollsIn(app as unknown as Parameters<typeof scrollsIn>[0]);
  app.classList?.remove('board');   // ?: a test's stand-in #app may have no classList
  app.innerHTML = html;
  restoreScrolls(app as unknown as Parameters<typeof restoreScrolls>[0], kept);
}
