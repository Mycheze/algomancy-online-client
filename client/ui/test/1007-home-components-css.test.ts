/* 1007 · THE HOME COMPONENTS' CSS HOLDS ITS PROMISES (2026-11-03)
 *
 * The four layout promises the redesign's home rests on, read off the real
 * stylesheet (readStylePieces, 910) with tokens resolved:
 *
 *   §1 the app shell is the window's height (100dvh after a 100vh fallback),
 *      `auto 1fr auto`, overflow hidden; its main region scrolls inside
 *      itself; below 760×600 it lets go (height auto, the page scrolls)
 *   §2 an icon button is at least 48px tall and wide (a finger's target)
 *   §3 a sheet's panel never leaves the window (max-height 100% of the
 *      gutter box) and its body scrolls; no animation or transition anywhere
 *      in the sheet, because a repaint redraws an open sheet and it would replay
 *   §4 the buttons with no border of their own (icon button, segmented
 *      option, sheet ✕) name their border on :hover, so base.css's
 *      `button:hover` (0,1,1) does not paint them a gold edge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStylePieces, resolveTokens } from './read-styles.ts';

/** one components piece's text, by its bare name (910: no test spells a .css path) */
const piece = (name: string): string => {
  const hit = readStylePieces().find(p => p.piece.startsWith('components/') && p.piece.split('/').pop()!.split('.')[0] === name);
  assert.ok(hit, `no components piece named ${name}`);
  return hit.text.replace(/\/\*[\s\S]*?\*\//g, '');
};
/** the body of the first rule whose selector list is exactly `sel`, in `css` */
const rule = (css: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `no rule ${sel}`);
  return m[1]!;
};

test('§1 the shell: exactly the window, only the main region scrolls, and it lets go below a tablet', () => {
  const css = piece('app-shell');
  const shell = rule(css, '.ui-app-shell');
  assert.match(shell, /height:\s*100vh;\s*height:\s*100dvh/, '100dvh, after a 100vh fallback');
  assert.match(shell, /overflow:\s*hidden/);
  assert.match(shell, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  const main = rule(css, '.ui-app-shell__main');
  assert.match(main, /min-height:\s*0/);
  assert.match(main, /overflow:\s*auto/);
  const at = css.indexOf('@media (max-width: 759.98px), (max-height: 599.98px)');
  assert.ok(at > 0, 'the below-a-tablet query');
  const phone = css.slice(at);
  assert.match(rule(phone, '.ui-app-shell'), /height:\s*auto;[^}]*min-height:\s*100dvh;[^}]*overflow:\s*visible/);
  assert.match(rule(phone, '.ui-app-shell__main'), /overflow:\s*visible/);
});

test('§2 an icon button is a finger\'s target: at least 48px each way', () => {
  const body = resolveTokens(rule(piece('icon-button'), '.ui-icon-button'));
  assert.match(body, /min-height:\s*48px/);
  assert.match(body, /min-width:\s*48px/);
});

test('§3 a sheet stays in the window, scrolls inside itself, and never animates', () => {
  const css = piece('sheet');
  assert.match(rule(css, '.ui-sheet'), /position:\s*fixed;\s*inset:\s*0/);
  assert.match(rule(css, '.ui-sheet__panel'), /max-height:\s*100%/);
  const body = rule(css, '.ui-sheet__body');
  assert.match(body, /min-height:\s*0/);
  assert.match(body, /overflow:\s*auto/);
  assert.ok(!/\b(animation|transition)\b/.test(css), 'an animation in the sheet replays on every repaint');
});

test('§4 the borderless buttons name their border on :hover (base.css\'s button:hover is 0,1,1)', () => {
  for (const [name, sel] of [['icon-button', '.ui-icon-button:hover'], ['segmented', '.ui-segmented__option:hover'], ['sheet', '.ui-sheet__close:hover']] as const) {
    assert.match(rule(piece(name), sel), /border-color:\s*transparent/, `${sel}`);
  }
});
