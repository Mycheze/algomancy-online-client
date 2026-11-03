/* App shell — the frame of a page that never scrolls: a top bar, the main
 * area, a bottom bar.
 *
 * The redesign's rule (client/docs/24-redesign/, principle 2): no page scrolls
 * up or down; a region may scroll inside itself. The shell is exactly the
 * window's height (100dvh, with a 100vh fallback for a browser without dvh),
 * a grid of `auto 1fr auto`, `overflow: hidden`; the main region takes what
 * the bars leave and scrolls inside itself (`min-height: 0; overflow: auto`).
 * A region given no markup is left out, and its grid row is empty.
 *
 * shellBar() is the layout for what goes IN a bar: three zones, start |
 * centre | end, the centre truly centred whatever the two sides hold (the
 * sketch's Decks Cards · account · Test Rules Alerts Report). Its height is at
 * least --shell-bar-h, which the anchored sheets (sheet.ts) clear.
 *
 * Below a tablet — narrower than 760px or shorter than 600px — the shell lets
 * go: plain stacked flow, at least the window's height, and the PAGE may
 * scroll. Phones are "not broken", not designed for (docs/24, principle 1).
 *
 * ⚠ The shell is the window's height only if nothing around it adds any.
 * base.css gives <body> margin 0, and pages/06-home.css makes #app (off the
 * board) plain block flow with no padding, so a shell that is #app's only
 * child fits exactly. Two things still add height today: the legal footer
 * (#legalfoot, a layer AFTER #app, shown on every off-board page) and
 * 48-legal.css's `min-height: calc(100dvh - 128px)` on #app's first child. A
 * page drawn in the shell must hide #legalfoot (the redesign moves its text
 * into the bottom bar), or the page scrolls by the footer's height. */
import { type Common, rootAttrs } from './_shared.ts';

export interface AppShellProps extends Common {
  /** trusted markup: the top bar (usually shellBar()) */
  topHtml?: string;
  /** trusted markup: the main area, which scrolls inside itself */
  mainHtml?: string;
  /** trusted markup: the bottom bar */
  bottomHtml?: string;
}

export function appShell(p: AppShellProps): string {
  return `<div${rootAttrs('ui-app-shell', p)}>`
    + (p.topHtml ? `<header class="ui-app-shell__top">${p.topHtml}</header>` : '')
    + `<main class="ui-app-shell__main">${p.mainHtml ?? ''}</main>`
    + (p.bottomHtml ? `<footer class="ui-app-shell__bottom">${p.bottomHtml}</footer>` : '')
    + '</div>';
}

export interface ShellBarProps extends Common {
  startHtml?: string;
  centerHtml?: string;
  endHtml?: string;
}

/** a bar's three zones: start (left), centre, end (right) */
export function shellBar(p: ShellBarProps): string {
  return `<div${rootAttrs('ui-app-shell__bar', p)}>`
    + `<div class="ui-app-shell__zone ui-app-shell__zone--start">${p.startHtml ?? ''}</div>`
    + `<div class="ui-app-shell__zone ui-app-shell__zone--center">${p.centerHtml ?? ''}</div>`
    + `<div class="ui-app-shell__zone ui-app-shell__zone--end">${p.endHtml ?? ''}</div>`
    + '</div>';
}
