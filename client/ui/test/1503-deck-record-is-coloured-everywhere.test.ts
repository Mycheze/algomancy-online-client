/* 1503 — A DECK'S RECORD IS GREEN OR RED WHEREVER IT IS DRAWN (BL-10;
 * docs/23-ui-inventory/03 §0.3.1 / §9.2, the good/bad colour on records).
 *
 * A deck's win rate or W–L is drawn as `<b class="good|bad">` in three places:
 * the Decks page's Games sheet, a row of the Metagame's published-deck list,
 * and one shared deck's page. Only the Games sheet's wrapper had a rule, so on
 * the other two a 25% deck read exactly like a 75% one.
 *
 * §1 each place, rendered: its good and bad marks are reached by a rule that
 *    colours them success green / danger red
 * §2 the census: every source that writes a good/bad record mark is one §1 renders
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { allRows } from '../cardindex.ts';
import { metaHtml, type MetaView } from '../pages/meta.ts';
import { decksSheetHtml } from '../pages/decks.ts';
import type { PublicDeck } from '../meta.ts';
import { readStyles } from './read-styles.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable).map(r => r.name);
type Rec = { games: number; wins: number; losses: number; unresolved: number };
const WON: Rec = { games: 8, wins: 6, losses: 2, unresolved: 0 };
const LOST: Rec = { games: 8, wins: 2, losses: 6, unresolved: 0 };

function deck(i: number, record: Rec): PublicDeck {
  return {
    id: `d${i}`, name: `Deck ${i}`, cards: [...NAMES.slice(i, i + 14), ...NAMES.slice(i, i + 14), NAMES[i + 20]!, NAMES[i + 21]!],
    cover: NAMES[i]!, author: 'Ann', visibility: 'public', owner: { id: `u${i}`, username: `Builder${i}` },
    createdAt: '2026-10-01', updatedAt: '2026-10-02', problems: [],
    record: { ...record, lastPlayed: null }, copies: 1,
  };
}

function view(over: Partial<MetaView>): MetaView {
  return {
    view: 'list', rows: null, minGames: 5, one: null, loading: false, msg: '', msgTone: 'error', sort: 'winrate', els: [], text: '', ladderText: '',
    focus: null, deckGroup: 'type', statsOpen: false, descOpen: false, exporting: null, backTo: 'list', ladder: null,
    signedIn: false, mine: false, link: 'http://x/?deck=d1', exportText: '', stats: null, chrome: { signedIn: false, alerts: 0 }, ...over,
  };
}

const PLACES: { name: string; html: (r: Rec) => string }[] = [
  { name: 'the Decks page\'s Games sheet', html: r => decksSheetHtml({ kind: 'games', record: r, rows: [] }) },
  { name: 'a Metagame row', html: r => metaHtml(view({ rows: [deck(1, r)] })) },
  { name: 'a shared deck\'s page', html: r => metaHtml(view({ view: 'deck', one: deck(1, r) })) },
];

/** every rule as [selector, body], comments out; an @media's prelude is cut off its first rule */
const rules: [string, string][] = [];
for (const m of readStyles().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const head = m[1]!.replace(/^[\s\S]*@media[^{]*$/, '').trim();
  for (const sel of head.split(',')) if (sel.trim()) rules.push([sel.trim().replace(/\s+/g, ' '), m[2]!]);
}

/** each element carrying `tone` as a class: its own classes, and its ancestors' outermost first */
function marks(html: string, tone: string): { own: string[]; up: string[][] }[] {
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'col', 'wbr']);
  const stack: { tag: string; cls: string[] }[] = [];
  const out: { own: string[]; up: string[][] }[] = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, selfClose] = t;
    const name = tag!.toLowerCase();
    if (close) {
      const at = stack.map(s => s.tag).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const cls = (/\bclass="([^"]*)"/.exec(attrs!)?.[1] ?? '').split(/\s+/).filter(Boolean);
    if (cls.includes(tone)) out.push({ own: cls, up: stack.map(s => s.cls) });
    if (!selfClose && !VOID.has(name)) stack.push({ tag: name, cls });
  }
  return out;
}

const classesOf = (compound: string): string[] | null =>
  /^(?:\.[\w-]+)+$/.test(compound) ? compound.slice(1).split('.') : null;

/** a rule of class-only compounds joined by descendant spaces that matches this element */
function reaches(sel: string, m: { own: string[]; up: string[][] }): boolean {
  const parts = sel.split(' ').map(classesOf);
  if (parts.some(p => p === null)) return false;
  const last = parts.at(-1)!;
  const before = parts.slice(0, -1) as string[][];
  if (!last.every(c => m.own.includes(c))) return false;
  let i = m.up.length - 1;
  for (const need of before.reverse()) {
    while (i >= 0 && !need.every(c => m.up[i]!.includes(c))) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

const COLOUR = { good: 'var(--color-success)', bad: 'var(--color-danger)' } as const;

test('1503 §1 a deck\'s record is coloured on the Games sheet, a Metagame row and a shared deck', () => {
  for (const place of PLACES) {
    for (const [tone, rec] of [['good', WON], ['bad', LOST]] as const) {
      const found = marks(place.html(rec), tone);
      assert.ok(found.length >= 1, `positive control: ${place.name} draws a ${tone} record mark`);
      for (const m of found) {
        const colours = rules.filter(([sel]) => reaches(sel, m))
          .map(([, body]) => /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()).filter(Boolean);
        assert.ok(colours.includes(COLOUR[tone]),
          `${place.name}: its ${tone} record (inside ${m.up.map(c => c.join('.')).filter(Boolean).join(' > ')}) is drawn in the plain text colour — no rule gives it ${COLOUR[tone]}`);
      }
    }
  }
});

test('1503 §2 every source that writes a good/bad record mark is one §1 renders', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const writers: string[] = [];
  for (const dir of ['', 'pages/', 'components/']) {
    for (const f of readdirSync(root + dir)) {
      if (!f.endsWith('.ts')) continue;
      if (/'good' : 'bad'|'bad' : 'good'/.test(readFileSync(root + dir + f, 'utf8'))) writers.push(dir + f);
    }
  }
  assert.deepEqual(writers.sort(), ['pages/decks.ts', 'pages/meta.ts'],
    'a new place draws a good/bad record: render it in §1 and give it the colour');
});
