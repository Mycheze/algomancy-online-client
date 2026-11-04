/* 1002 · ui/components/icon.ts — every icon in ICON_NAMES is one valid,
 * stroke-only <svg> in currentColor, decorative unless titled; an unknown name
 * throws. The "no fill colour" check is the one that keeps the set ONE style:
 * a glyph pasted in from elsewhere with fill="#000" goes red here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, type IconName, icon } from '../components/icon.ts';

/** the names the redesign's home asked for (the brief, 2026-11-03) */
const ASKED = ['decks', 'cards', 'account', 'test', 'rules', 'alerts', 'report', 'play', 'join', 'league', 'challenge',
  'matchmaking', 'updates', 'info', 'close', 'chevron-right', 'chevron-down', 'learn', 'stats', 'admin', 'link',
  'signin', 'clock', 'users', 'pause',
  // the deck screens' tools (BL-65 W0, 2026-11-04)
  'undo', 'redo', 'edit', 'filter', 'plus', 'import', 'export', 'share', 'copy', 'trash'];

test('the set holds every asked-for name, once', () => {
  for (const n of ASKED) assert.ok((ICON_NAMES as string[]).includes(n), `no icon named ${n}`);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
});

test('every icon is one 24×24 stroke-only svg in currentColor, with no colour of its own', () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="ui-icon ui-icon--[\w-]+" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1\.75" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">/, name);
    assert.ok(svg.endsWith('</svg>') && svg.split('<svg').length === 2, `${name}: not one svg`);
    // every fill / stroke / colour inside the root is absent or currentColor/none
    const inner = svg.slice(svg.indexOf('>') + 1);
    for (const m of inner.matchAll(/\b(fill|stroke|color|stop-color|style)="([^"]*)"/g)) {
      assert.ok(m[2] === 'none' || m[2] === 'currentColor', `${name}: ${m[1]}="${m[2]}" — an icon takes its colour from the text`);
    }
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(svg), `${name}: a colour literal in the svg`);
    // only drawing elements, so a stray <text> or <image> cannot sneak in
    for (const m of inner.matchAll(/<([a-z]+)\b/g)) assert.ok(['path', 'circle', 'rect', 'title'].includes(m[1]!), `${name}: <${m[1]}>`);
    assert.ok(/<(path|circle|rect)\b/.test(inner), `${name}: draws nothing`);
  }
});

test('size: a number is px, a string any length; the default is 1em', () => {
  assert.match(icon('play', { size: 24 }), / width="24px" height="24px"/);
  assert.match(icon('play', { size: '1.5rem' }), / width="1\.5rem" height="1\.5rem"/);
  assert.match(icon('play'), / width="1em" height="1em"/);
});

test('decorative by default; a title makes it a named image, escaped', () => {
  const named = icon('info', { title: 'About <this>' });
  assert.match(named, /role="img"/);
  assert.ok(!named.includes('aria-hidden'));
  assert.match(named, /<title>About &lt;this&gt;<\/title>/);
  assert.ok(!named.includes('<this>'));
});

test('dataBtn, className and attrs pass through', () => {
  const svg = icon('close', { dataBtn: 'x', className: 'mine', attrs: { 'data-k': '"q"' } });
  assert.match(svg, /^<svg class="ui-icon ui-icon--close mine" data-btn="x"/);
  assert.match(svg, /data-k="&quot;q&quot;"/);
});

test('an unknown name throws', () => {
  assert.throws(() => icon('nope' as IconName), /no icon named "nope"/);
});
