/* 1212 · THE SAME THING IS SAID IN THE SAME WORDS
 * (BL-10, the visual polish pass, 2026-11-10; docs/23-ui-inventory/05 §18.12:
 * "Same idea, different words: 'draft step' / 'draw phase' / 'Draw step';
 * 'Join matchmaking queue' vs 'Find a game'; … 'has not arrived yet' vs 'not
 * here yet'").
 *
 * Three pairs a player meets one after the other:
 *
 *  §1 an absent opponent in a waiting room. The Constructed, Single Card Duel
 *     and match rooms said "not here yet"; the live draft lobby said "has not
 *     arrived yet", and named a nameless opponent "Your opponent" where the
 *     other rooms' seat rows say "Opponent".
 *  §2 the button to the queue screen. The home strip says "Find a game"; the
 *     post-game's button to the same screen said "Join matchmaking queue".
 *  §3 constructed's draw. The rules call drawing 4 and putting 2 back one
 *     "draw phase" (CR 901.5), and the panel says "draw phase"; the bar that
 *     brings a hidden panel back said "Draw step" — the rules' name for the
 *     draw of 2 alone (CR 503.1).
 *
 * Left on purpose: "Leave" (a waiting room's way out — you leave the room)
 * beside "Return to home" (after a game); "Opponent" as a column head or a
 * name, "Your opponent" inside a sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UI_DIR, CR_DOC } from '../../engine/scripts/paths.mjs';
import { lobbyHtml, type LobbyView } from '../pages/lobby.ts';

const src = (rel: string): string => readFileSync(join(UI_DIR, rel), 'utf8');
/** the source with its comments taken out, so only what is drawn is read */
const code = (rel: string): string => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGES = readdirSync(join(UI_DIR, 'pages')).filter(f => f.endsWith('.ts')).map(f => `pages/${f}`);

function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    lobby: { method: 'pick-one', methods: [{ id: 'pick-one', label: 'Pick one', blurb: '' }], locked: [false, false], mine: {} },
    seat: 0, names: ['Ann', 'Bo'], peers: [true, false], room: 'QXZZ', link: 'http://x/?room=QXZZ&seat=1',
    friends: '', pick: null, ranking: [], ready: false,
    chrome: { signedIn: true, alerts: 0 },
    ...over,
  };
}

test('1212 §1 every waiting room says an absent opponent is "not here yet", and calls a nameless one "Opponent"', () => {
  const away = lobbyHtml(view());
  assert.match(away, /<span>Bo — not here yet<\/span>/, 'the draft lobby, as the other rooms');
  assert.match(lobbyHtml(view({ names: ['Ann'] as unknown as LobbyView['names'] })), /<span>Opponent — not here yet<\/span>/,
    'a nameless opponent is "Opponent", as in the other rooms\' seat rows');
  for (const f of ['pages/lobby.ts', 'pages/waiting.ts', 'pages/match.ts']) {
    assert.match(code(f), /'not here yet'/, `${f} draws the absent seat as "not here yet"`);
  }
  for (const f of [...PAGES, 'main.ts']) {
    assert.doesNotMatch(code(f), /has not arrived yet/, `${f}: an absent opponent is "not here yet" everywhere`);
  }
});

test('1212 §2 the post-game\'s button to the queue screen reads like the home strip\'s', () => {
  const strip = code('pages/queue.ts').match(/data-btn="queue-open">([^<]+)</)?.[1];
  const post = code('pages/postgame.ts').match(/label: '([^']+)', dataBtn: 'pg-queue'/)?.[1];
  assert.equal(strip, 'Find a game');
  assert.equal(post, strip, 'two buttons to one screen, one name');
  for (const f of [...PAGES, 'main.ts']) assert.doesNotMatch(code(f), /Join matchmaking queue/, f);
});

test('1212 §3 constructed\'s draw-4-put-2-back is the "draw phase" on the bar as in the panel and the rules', () => {
  assert.match(readFileSync(CR_DOC, 'utf8'), /taken together as one draw phase/, 'the rules\' own name for it');
  const main = code('main.ts');
  const bar = main.match(/function pickShowHtml\(\)[\s\S]*?\n}/)?.[0] ?? '';
  assert.ok(bar, 'the bar that brings a hidden pick back');
  assert.match(bar, /draft \? 'Draft step' : 'Draw phase'/);
  assert.match(main, /— draw phase<\/span>/, 'the panel it brings back says the same');
  assert.doesNotMatch(main, /'Draw step'/, 'nothing in the client calls constructed\'s draw the draw step');
});
