/* 1485 · A CARD'S BLURB IS THE SAME QUIET LINE WHEREVER IT IS DRAWN
 * (BL-10, the visual polish pass; docs/23-ui-inventory/05 §18.2: "`.cardsub`
 * styled only under `.homecard` and `.singleduel` — the queue blurb and
 * single-card waiting blurb are unstyled paragraphs").
 *
 * `.cardsub` is the muted 12px line under a card's or a room's heading. Its
 * colour and size are the class's own, not its parent's, so the Single Card
 * Duel room and the home's Single Card Duel sheet draw "Thirty copies…" as
 * quietly as the Competitive and Challenge cards do. Margins stay with each place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStyles } from './read-styles.ts';
import { singleWaitingHtml } from '../pages/waiting.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');

/** every top-level (not @media) rule as [selectors, body], in cascade order */
function rules(text: string): [string[], string][] {
  const out: [string[], string][] = [];
  let depth = 0, start = 0, open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) open = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const prelude = text.slice(start, open).trim();
        if (!prelude.startsWith('@')) out.push([prelude.split(',').map(s => s.trim().replace(/\s+/g, ' ')), text.slice(open + 1, i)]);
        start = i + 1;
      }
    }
  }
  return out;
}
const all = rules(css);
const decl = (body: string, prop: string): string | null =>
  body.match(new RegExp(`(?:^|[;\\s{])${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;

test('1485 §1 BL-10: .cardsub is muted and 12px on its own, with no parent needed', () => {
  const own = all.filter(([s]) => s.includes('.cardsub')).map(([, b]) => b).join(';');
  assert.match(decl(own, 'color') ?? '', /var\(--(dim|color-text-muted)\)/, 'the blurb is the muted text colour');
  assert.equal(decl(own, 'font-size'), 'var(--text-12)', 'and the small size');
});

test('1485 §2 BL-10: no later rule gives a blurb another colour or size in one place only', () => {
  const at = all.findIndex(([s]) => s.includes('.cardsub'));
  const scoped = all.slice(at + 1).filter(([s, b]) =>
    s.some(x => /\.cardsub(?![-\w])/.test(x)) && (decl(b, 'color') !== null || decl(b, 'font-size') !== null));
  assert.deepEqual(scoped.map(([s]) => s.join(', ')), []);
});

test('1485 §3 BL-10: the Single Card Duel room draws its blurb as a .cardsub, and every page that draws one is covered', () => {
  const html = singleWaitingHtml({
    room: 'QXZZ', link: 'http://x/?room=QXZZ', friends: '', drawn: null,
    mineIn: false, oppIn: false, oppHere: false, myName: 'Ann', oppName: 'Bo',
    card: null, picker: '', error: '', chrome: { signedIn: true, alerts: 0 },
  });
  assert.match(html, /<p class="cardsub">Thirty copies/);
  const ui = join(import.meta.dirname, '..');
  const sources = [
    ...readdirSync(ui).filter(f => f.endsWith('.ts')).map(f => join(ui, f)),
    ...readdirSync(join(ui, 'pages')).filter(f => f.endsWith('.ts')).map(f => join(ui, 'pages', f)),
  ];
  const drawers = sources.filter(f => /class="[^"]*\bcardsub\b/.test(readFileSync(f, 'utf8')));
  assert.ok(drawers.length >= 3, `the blurb is drawn on several pages (found ${drawers.length})`);
});
