/* 1235 · AN ELEMENT SHAPE WITH NO WORD BESIDE IT SHOWS ITS ICON IN THE ACCESSIBLE MODE (BL-51 (c), 2026-11-12)
 *
 * BL-51's second finish line: "with it on, every element is told apart by its
 * SHAPE or a label as well as its colour". The audit of every element-coloured
 * shape found the chips, buttons, resource cards and the favourite-element
 * picker already carry the element's icon or its name. Four did not, and were
 * colour alone:
 *   - the profile's share bars (Elements played, Recycled): a segment was matched
 *     to its legend row by hue, and the legend's own marks were plain squares;
 *   - the Games tab's element dots: a game's trio, or yours vs theirs, as discs;
 *   - the deck's Stats sheet's Elements bar, whose segments were in the fixed
 *     element order while its legend runs biggest first, so even position did
 *     not match them up;
 *   - the deck builder strip's element dots (a disc and a count).
 * Each now carries elIcon() in its markup, hidden in the standard look; the mode
 * shows it (styles/shared/10). The deck bar follows its legend's order.
 *
 *   §1 every swatch, segment and dot those pages draw carries its own element's icon
 *   §2 the deck's Elements bar runs in its legend's order
 *   §3 the stylesheet: the icon is hidden in the standard look and shown, at a
 *      legible size, in the mode
 *   §4 a census of the sources: no swatch, segment or dot is drawn without its icon
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { analyzeDeck, cardFacts, deckElements } from '../deckstats.ts';
import { deckStatsHtml, statsStripHtml } from '../pages/deckstats.ts';
import { profileHtml, profileView, type ProfileState } from '../pages/profile.ts';
import type { Me, Profile } from '../account.ts';
import { readStyles } from './read-styles.ts';

const UI = join(import.meta.dirname, '..');

const PROFILE = {
  games: 2, wins: 1, losses: 1, unresolved: 0, byMode: { draft: 1, constructed: 1 }, cardElements: { fire: 3, water: 1, earth: 6 },
  recycled: { wood: 2, dark: 1 }, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
  resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, turnsPlayed: 2, longestGameTurns: 1, flawlessWins: 0, closeWins: 0, streak: 0, bestStreak: 1,
  rating: {}, ratedGames: {}, firstPlayed: null, lastPlayed: null,
} as unknown as Profile;

const row = (code: string, els: string[], sides?: [string[], string[]]) => ({
  code, playedAt: '2026-11-01T10:00:00Z', mode: sides ? 'constructed' : 'draft', els, ...(sides ? { sides } : {}), turns: 8,
  deckId: null, finished: true, diverged: false, result: 'win' as const, opponent: 'Nyar', opponentId: 'u2', life: [5, 0] as [number, number],
  unitsPlayed: 4, spellsPlayed: 1, damageDealt: 20, favoriteElement: null,
});

const ME: Me = {
  id: 'u1', username: 'Quill', createdAt: '2026-09-01T00:00:00Z', favoriteElement: null, profile: PROFILE,
  topCards: [], earned: 0, opponents: [], achievements: [], friends: [], incoming: [], outgoing: [], decks: [],
  history: [row('QXZK', ['fire', 'metal', 'light']), row('ABCD', ['wood'], [['wood', 'dark'], ['water']])],
};

const page = (tab: ProfileState['tab']): string => profileHtml(profileView({
  me: ME, tab, discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '', claimMsg: '',
  leaders: null, leadersFailed: false, board: 'all', ladder: null,
  prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false }, artFor: c => c,
}, 0));

/** every <span class="CLS EL" …>…</span> (or CLS alone, its element read off the parent), with what it holds */
function shapes(html: string, cls: string): { el: string; inner: string }[] {
  return [...html.matchAll(new RegExp(`<span class="${cls}(?: (\\w+))?"[^>]*>(.*?)</span>`, 'gs'))]
    .map(m => ({ el: m[1] ?? '', inner: m[2]! }));
}
const ICON = (el: string) => new RegExp(`^<img class="elicon" src="[^"]*/${el}\\.webp" alt=""`);

const facts = (n: string) => cardFacts(n)!;
const byEl = (el: string) => DECK_LIST.filter(n => facts(n).factions.length === 1 && facts(n).factions[0] === el && !facts(n).isX);
// fire first in the fixed order, but the fewest copies: the order must come from the counts
const DECK = [...byEl('fire').slice(0, 2), ...byEl('water').slice(0, 9), ...byEl('earth').slice(0, 5)];

test('1235 §1 every element swatch, segment and dot carries its own element\'s icon', () => {
  const overview = page('overview');
  const ov = shapes(overview, 'pfswatch');
  // the two bars and their legends: earth, fire, water and wood, dark
  assert.deepEqual(ov.map(s => s.el).sort(), ['dark', 'dark', 'earth', 'earth', 'fire', 'fire', 'water', 'water', 'wood', 'wood']);
  for (const s of ov) assert.match(s.inner, ICON(s.el), `overview: the ${s.el} swatch`);
  const games = shapes(page('games'), 'pfswatch');
  assert.deepEqual(games.map(s => s.el), ['fire', 'metal', 'light', 'wood', 'dark', 'water'], 'the Games tab: a trio, then yours vs theirs');
  for (const s of games) assert.match(s.inner, ICON(s.el), `games: the ${s.el} dot`);

  const a = analyzeDeck(DECK);
  const segs = shapes(deckStatsHtml(a), 'elbarseg');
  assert.equal(segs.length, 3);
  for (const s of segs) assert.match(s.inner, ICON(s.el), `deck stats: the ${s.el} segment`);
  const strip = statsStripHtml(a);
  const dots = [...strip.matchAll(/<span class="ttel (\w+)"><span class="ttdot"[^>]*>(.*?)<\/span>/g)];
  assert.equal(dots.length, 3);
  for (const [, el, inner] of dots) assert.match(inner!, ICON(el!), `the builder strip: the ${el} dot`);
});

test('1235 §2 the deck\'s Elements bar runs in its legend\'s order, biggest first', () => {
  const a = analyzeDeck(DECK);
  const html = deckStatsHtml(a);
  const bar = shapes(html, 'elbarseg').map(s => s.el);
  const legend = [...html.matchAll(/<span class="acctel (\w+)">/g)].map(m => m[1]);
  assert.deepEqual(bar, ['water', 'earth', 'fire']);
  assert.deepEqual(legend, bar);
  assert.deepEqual(deckElements(a).map(e => e.el), bar);
});

test('1235 §3 the stylesheet: the icon is hidden in the standard look, shown at 16px in the mode', () => {
  // every rule, by each selector of its list (as 1221 reads them)
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  const RULES = new Map<string, string[]>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of m[1]!.split(',')) {
      const k = sel.trim().replace(/\s+/g, ' ');
      RULES.set(k, [...(RULES.get(k) ?? []), m[2]!]);
    }
  }
  const rule = (sel: string): string => (RULES.get(sel) ?? []).join(';');
  const A = ':root[data-colors="accessible"]';
  for (const host of ['.pfswatch', '.elbarseg', '.ttdot']) {
    assert.match(rule(`${host} > .elicon`), /display:\s*none/, `${host}: no icon in the standard look`);
    const shown = rule(`${A} ${host} > .elicon`);
    assert.match(shown, /display:\s*block/, `${host}: the icon shows in the mode`);
    assert.match(shown, /width:\s*16px/);
    assert.match(shown, /height:\s*16px/);
    assert.match(shown, /margin:\s*0/, `${host}: none of .elicon's own margin inside a shape`);
  }
  // a swatch and a dot on their own become the icon's size; a bar is tall enough for it
  for (const host of ['.pfswatch', '.ttdot']) assert.match(rule(`${A} ${host}`), /width:\s*16px/, `${host} in the mode`);
  for (const bar of ['.pfbar', '.elbar']) {
    const h = /height:\s*(\d+)px/.exec(rule(`${A} ${bar}`))?.[1];
    assert.ok(h && Number(h) >= 16, `${bar} in the mode: ${h}px holds a 16px icon`);
  }
  // a bar's segment centres it and clips it, and stays a flexible segment
  for (const seg of ['.pfbar .pfswatch', '.elbarseg']) {
    const r = rule(`${A} ${seg}`);
    assert.match(r, /justify-content:\s*center/, seg);
    assert.match(r, /overflow:\s*hidden/, seg);
    assert.match(r, /width:\s*auto/, seg);
  }
});

test('1235 §4 a census of the sources: no element swatch, segment or dot is drawn without its icon', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'storybook'].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(UI);
  const found: string[] = [];
  const bare: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<span class="(pfswatch|elbarseg|ttdot)\b[^>]*>(.*?)<\/span>/gs)) {
      found.push(`${f.slice(UI.length + 1)}: ${m[1]}`);
      if (!/^\$\{elIcon\(/.test(m[2]!)) bare.push(`${f.slice(UI.length + 1)}: ${m[0]}`);
    }
  }
  assert.ok(found.length >= 4, `only ${found.length} sites found — the census is reading nothing: ${found.join('; ')}`);
  assert.deepEqual(bare, [], 'an element shape with no icon in it');
});
