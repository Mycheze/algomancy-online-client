/* 1040 — THE APP SHELL'S `contained` COLUMN (owner, 2026-11-03: "When the
 * screen is big enough to allow it, add some padding around the edges so
 * things don't look so far apart and smushed in the corners. On my laptop,
 * all the icons are so hidden down in the edges").
 *
 * §1 the markup: `contained` adds ui-app-shell--contained (a page's own class
 *    still LAST — report.ts names the page by it, 287); left out, nothing
 * §2 the CSS: the two bars' content and the main region take the SAME side
 *    padding, max(gutter, half of what the window has beyond the column),
 *    and the two sizes are tokens
 * §3 the home is contained, and its own rules neither re-pad the regions
 *    sideways nor cap its columns narrower than the shell's column — so the
 *    toolbar's first button stands over the Play card's left edge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appShell } from '../components/app-shell.ts';
import { readStylePieces, readStyles } from './read-styles.ts';

/** every rule's selector and body, comments out, @media kept as a prefix */
function rules(css: string): { sel: string; body: string; media: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { sel: string; body: string; media: string }[] = [];
  const walk = (src: string, media: string): void => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < src.length && depth; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; }
      const inner = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(inner, head); else if (!head.startsWith('@')) out.push({ sel: head, body: inner, media });
      i = j;
    }
  };
  walk(text, '');
  return out;
}
const ALL = rules(readStyles());
const PHONE = /max-width:\s*759\.98px|max-height:\s*599\.98px/;

test('1040 §1 contained adds its class; the page class stays last', () => {
  assert.match(appShell({ contained: true, className: 'homepage' }), /^<div class="ui-app-shell ui-app-shell--contained homepage">/);
  assert.match(appShell({ className: 'homepage' }), /^<div class="ui-app-shell homepage">/, 'not asked for, not drawn');
});

test('1040 §2 the bars and the main region share one column', () => {
  const want = ['.ui-app-shell--contained > .ui-app-shell__top > .ui-app-shell__bar',
    '.ui-app-shell--contained > .ui-app-shell__bottom > .ui-app-shell__bar', '.ui-app-shell--contained > .ui-app-shell__main'];
  const r = ALL.find(x => !x.media && want.every(w => x.sel.split(',').map(s => s.trim()).includes(w)));
  assert.ok(r, 'one rule must pad all three regions alike');
  const pad = 'max(var(--shell-gutter), calc((100% - var(--shell-content-max)) / 2))';
  for (const side of ['left', 'right']) {
    assert.ok(r.body.replace(/\s+/g, ' ').includes(`padding-${side}: ${pad}`), `padding-${side} is not the column formula: ${r.body}`);
  }
  const root = ALL.find(x => x.sel === ':root' && /--shell-content-max/.test(x.body))?.body ?? '';
  assert.match(root, /--shell-content-max:\s*\d+px/, 'the column width is a token');
  assert.match(root, /--shell-gutter:\s*clamp\(/, 'the gutter grows with the window');
});

// (960 §0 and 1010 §1 pin the contained root on the drawn home)
test('1040 §3 the home keeps to the shell column', () => {
  const src = readStylePieces().find(p => /^\d+-home\.css$/.test(p.piece.split('/').pop()!))!.text;
  const home = rules(src.slice(src.indexOf('── the home screen (client/docs/24-redesign/'), src.indexOf('── recent updates')));
  const regions = home.filter(x => !PHONE.test(x.media) && /\.ui-app-shell__(main|bar)\b|\.hometools|\.homebottom/.test(x.sel));
  assert.ok(regions.length >= 2, 'positive control: the home styles its regions');
  for (const r of regions) {
    assert.doesNotMatch(r.body, /(^|;|\s)padding(-left|-right|-inline)?\s*:/,
      `${r.sel} pads a region sideways, pulling it off the shell's column: ${r.body.trim()}`);
  }
  const main = home.find(x => x.sel === '.homemain' && !x.media);
  assert.ok(main, 'positive control: .homemain is read');
  assert.doesNotMatch(main.body, /max-width/, '.homemain is capped narrower than the shell column');
});
